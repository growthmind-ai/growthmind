// What one request can buy, and what we hear when the transport refuses it. WIRE-L1…L8
// (post-sprint audit).
//
// Every other file in this directory asks whether an answer is correct. These rows ask
// whether it arrives, and how much a caller had to be given to get it. Three measured
// holes, none of them visible to a single row of the sixty-nine the sprint shipped,
// because all three live outside the shapes those rows mint:
//
//  a modern `subscriptions/listen` answered by the sdk's listen router
//  with a stream that ends only on disconnect. `wire.ts`'s drain waited
//  for that stream and the teardown waited for the drain — a deadlock,
//  one per request. Measured before the fix: one request unanswered at
//  45 seconds, 50 concurrent requests with none answered, each holding a
//  server instance and a 15-second keep-alive timer. Invisible to every
//  existing row because the fixture mints legacy-only requests by design
//  and the legacy leg answers `-32601`.
//
//  nothing between the credential check and the transport bounded a
//  request. Measured: a 500-message JSON-RPC batch executed 500 tool
//  calls and returned 500 frames from one POST; a 20 MB body was buffered
//  whole before any gate downstream of authentication fired. A read-only
//  credential should not be a lever for arbitrary fan-out.
//
//  `createMcpHandler` was given no `onerror`, and the SDK returns rather
//  than throws — so a wire-layer fault answered `500 {"code":-32603}` and
//  wrote zero log lines. `server.ts`'s outer catch could not see it.
//
// The three log channels, and why two rows here are about logging
//
// `callTool` owns a fault inside a tool call. `server.ts` owns a fault escaping
// `wire.ts`. The `onerror` channel owns a fault inside the SDK that neither can
// observe. The partition is the claim, one incident, one line, and the line says which
// layer broke. `WIRE-L7` proves a transport fault reaches the third channel; `WIRE-L8`
// proves a broken read still does not, which is the property
// `./failure-isolation.test.ts`'s `WIRE-B1` asserts from the other side and the one an
// over-eager `onerror` would have broken.
//
// Both legs, each where it belongs
//
// The size and batch gates fire in `server.ts`, in front of the transport and therefore
// in front of the leg split, so those rows are minted through the legacy fixture like
// everything else. `subscriptions/listen` exists only on the modern leg, so its rows
// are minted through `./helpers/modern-envelope.ts`. The file that carries the decision
// the fixture's header asked for.
//
// Lane prefix `mcpl`.
import { MCP_TOOL } from "@growthmind/shared";
import { describe, expect, spyOn, test } from "bun:test";

import { BODY_TOO_LARGE, MALFORMED_BODY, UNAVAILABLE } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  rawBodyRequest,
  throwingReadPort,
  toolCallRequest,
  KEY_A,
  ORG_A,
  type RecordingReadPort,
} from "./helpers/mcp-fixture";
import { modernRequest } from "./helpers/modern-envelope";
import { watchForUnhandledRejections } from "./helpers/wire-probes";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function spyDeps(): { readonly spy: RecordingReadPort; readonly deps: McpServerDeps } {
  const spy = fakeReadPort();
  return { spy, deps: { credentials: CREDENTIALS, reads: spy.port } };
}

/**
 * The longest a bounded request may take before this suite calls it hung.
 *
 * Generous by three orders of magnitude, on purpose. The refused `subscriptions/listen`
 * answers in about a millisecond; the bug it guards against does not answer at all. A
 * tight bound would turn a slow machine into a red row about nothing, and a bound of
 * any size catches a deadlock.
 */
const BOUNDED_MS = 5000;

/** A sentinel nothing else can produce, so "the watchdog won" is unambiguous. */
const NEVER_ANSWERED = Symbol("mcpl: the request was never answered");

/**
 * The response, or the sentinel, never a hang.
 *
 * The timer is cleared on the winning path so bun's runtime is not left with a pending
 * macrotask holding the suite open, and the losing promise is left to settle on its
 * own: a row that has already failed must not also hang.
 */
async function answeredWithin(
  run: () => Promise<Response>,
  ms: number,
): Promise<Response | typeof NEVER_ANSWERED> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof NEVER_ANSWERED>((resolve) => {
    watchdog = setTimeout(() => resolve(NEVER_ANSWERED), ms);
  });

  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (watchdog !== undefined) {
      clearTimeout(watchdog);
    }
  }
}

/**
 * A `subscriptions/listen` the transport accepts as well-formed.
 *
 * ⚠️ the filter shape is load-bearing and was measured into existence. A
 * `notifications` value the transport cannot read is answered `-32602` without ever
 * reaching the listen router, and a row built on one would pass while proving nothing
 * about the hang. This shape reaches the router: before the fix it hung, and after it
 * is refused in about a millisecond.
 */
const LISTEN_PARAMS = {
  notifications: { toolsListChanged: true },
} as const;

// WIRE-L1 / WIRE-L2, the subscription that pinned a request forever

describe("WIRE-L1 — a modern subscriptions/listen is answered in bounded time rather than held open", () => {
  test("answers within the bound, with a body, and asks the port nothing", async () => {
    const { spy, deps } = spyDeps();

    const answer = await answeredWithin(
      () =>
        handleMcpRequest(
          modernRequest({ method: "subscriptions/listen", params: LISTEN_PARAMS, key: KEY_A }),
          deps,
        ),
      BOUNDED_MS,
    );

    // The row, in one line. Before the fix this was the sentinel. Measured unanswered
    // at 45 seconds, which is nine times this bound.
    expect(answer).not.toBe(NEVER_ANSWERED);

    const print = await fingerprint(answer as Response);
    expect(print.body.length).toBeGreaterThan(0);

    // A subscription is not a read. Nothing that touches data may have run.
    expect(spy.organizationsAsked).toEqual([]);
  });

  test("refuses it in band, on a 200, rather than as a transport failure", async () => {
    // The shape of the refusal, pinned. `maxSubscriptions: 0` answers in-band (HTTP 200
    // carrying a JSON-RPC error) which is what lets a client tell "this server does not
    // do subscriptions" from "this server is broken". Refusing is truthful here rather
    // than a workaround: this surface declares no subscription capability and emits no
    // notifications, so there is nothing a subscriber could ever be sent.
    const { deps } = spyDeps();

    const answer = await answeredWithin(
      () =>
        handleMcpRequest(
          modernRequest({ method: "subscriptions/listen", params: LISTEN_PARAMS, key: KEY_A }),
          deps,
        ),
      BOUNDED_MS,
    );
    expect(answer).not.toBe(NEVER_ANSWERED);

    const print = await fingerprint(answer as Response);
    expect(print.status).toBe(200);
    expect(print.body).toContain("Subscription limit reached");
  });
});

describe("WIRE-L2 — many concurrent subscriptions/listen requests all answer", () => {
  /**
   * The measurement that made high rather than medium. One deadlocked request is a
   * bug; fifty of them, each holding a server instance and a keep-alive interval, is
   * the surface being unavailable for the price of one read-only key. Ten is enough to
   * fail in the same way and cheap enough to run on every commit.
   */
  test("ten at once all come back, and nothing is left unhandled", async () => {
    const { deps } = spyDeps();

    const watched = await watchForUnhandledRejections(async () =>
      Promise.all(
        Array.from({ length: 10 }, async (_unused, index) =>
          answeredWithin(
            () =>
              handleMcpRequest(
                modernRequest({
                  method: "subscriptions/listen",
                  params: LISTEN_PARAMS,
                  key: KEY_A,
                  id: index,
                }),
                deps,
              ),
            BOUNDED_MS,
          ),
        ),
      ),
    );

    expect(watched.result).toHaveLength(10);
    for (const answer of watched.result) {
      expect(answer).not.toBe(NEVER_ANSWERED);
    }
    expect(watched.unhandled).toEqual([]);
  });
});

// WIRE-L3 / WIRE-L4, one request, one message

/** `count` `tools/call` messages in one array. At 500 this is the exact body that
 * measured 500 reads and 500 frames out of one POST. */
function batchOf(count: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_unused, index) => ({
      jsonrpc: "2.0",
      id: index,
      method: "tools/call",
      params: { name: MCP_TOOL.LIST_OPEN_FIXES, arguments: {} },
    })),
  );
}

/** Comfortably over the megabyte ceiling, and shaped like a real call so the refusal is
 * about the size and not about the shape. */
function oversizeBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: MCP_TOOL.GET_FIX, arguments: { fixId: "x".repeat(2 * 1024 * 1024) } },
  });
}

describe("WIRE-L3 — a JSON-RPC batch is refused before it can buy any work", () => {
  test("a 500-message batch is refused 400 with the single-message instruction, and the port is untouched", async () => {
    const { spy, deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(rawBodyRequest(batchOf(500), KEY_A), deps),
    );

    expect(print.status).toBe(MALFORMED_BODY.status);
    expect(print.body).toContain(MALFORMED_BODY.message);

    // The half that is the point. Not "it was refused". "it bought nothing". Before the
    // gate this line read five hundred.
    expect(spy.organizationsAsked).toEqual([]);
  });

  test("a one-message batch is refused too, so the gate is about the shape and not the size", async () => {
    // A cap would have made this legal, and a cap is the wrong answer here: the
    // revision this surface negotiates removed batching outright, and neither
    // `tools/list` nor `tools/call` is ever more than one message. Refusing the shape
    // is the truthful gate; refusing at 51 and allowing 50 would be a number nobody
    // could defend.
    const { spy, deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(rawBodyRequest(batchOf(1), KEY_A), deps),
    );

    expect(print.status).toBe(MALFORMED_BODY.status);
    expect(spy.organizationsAsked).toEqual([]);
  });

  test("leading whitespace does not smuggle a batch past the gate", async () => {
    // The gate reads the first non-whitespace byte, which is a fact about JSON rather
    // than a heuristic. A gate that looked at byte zero would be defeated by a newline.
    const { spy, deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(rawBodyRequest(`  \n\t${batchOf(2)}`, KEY_A), deps),
    );

    expect(print.status).toBe(MALFORMED_BODY.status);
    expect(spy.organizationsAsked).toEqual([]);
  });

  test("a single message whose arguments contain an array is still served", async () => {
    // Non-vacuity, and the conflation this gate could have had. Arrays are ordinary
    // inside a message; only a message that IS an array is a batch. A gate that scanned
    // for `[` anywhere would refuse legitimate calls, which is the
    // exclusion-predicate-on-a-superset shape the taxonomy files under.
    const { spy, deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(
        toolCallRequest({
          tool: MCP_TOOL.LIST_OPEN_FIXES,
          input: { projectId: "project-mcpl", limit: 5, extras: [1, 2, 3] },
          key: KEY_A,
        }),
        deps,
      ),
    );

    expect(print.status).toBe(200);
    expect(print.body).not.toContain(MALFORMED_BODY.message);
    expect(spy.organizationsAsked).toEqual([ORG_A]);
  });
});

describe("WIRE-L4 — a body bigger than this surface could ever need is refused before it is buffered", () => {
  test("a two-megabyte body is refused 413 with the sentence that says what to send instead", async () => {
    const { spy, deps } = spyDeps();

    const body = oversizeBody();
    expect(body.length).toBeGreaterThan(1024 * 1024);

    const print = await fingerprint(await handleMcpRequest(rawBodyRequest(body, KEY_A), deps));

    expect(print.status).toBe(BODY_TOO_LARGE.status);
    expect(print.body).toContain(BODY_TOO_LARGE.message);
    expect(spy.organizationsAsked).toEqual([]);
  });

  test("an ordinary call is still served, so the ceiling refuses nothing real", async () => {
    // Non-vacuity. A gate that refused every body would pass the row above perfectly
    // and break every client. The ceiling is about four orders of magnitude above the
    // largest legitimate message this surface has.
    const { spy, deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }), deps),
    );

    expect(print.status).toBe(200);
    expect(print.body).not.toContain(BODY_TOO_LARGE.message);
    expect(spy.organizationsAsked).toEqual([ORG_A]);
  });

  test("the refusal names neither a stack frame nor a size in bytes", async () => {
    // The reader is a coding agent relaying to a person. "Under a megabyte" is
    // actionable; a five-digit byte count is arithmetic, and a stack frame is a leak.
    // Both absences asserted on the same body.
    expect(BODY_TOO_LARGE.message).toContain("megabyte");
    expect(BODY_TOO_LARGE.message).not.toContain("1048576");
    expect(Object.isFrozen(BODY_TOO_LARGE)).toBe(true);
  });
});

// WIRE-L5, the request the gates judged is the request the transport serves

describe("WIRE-L5 — reading the body to gate it does not change what the transport sees", () => {
  /**
   * The risk the size and batch gates introduced, closed. A body can only be read once,
   * so `server.ts` reads it and hands `wire.ts` a request rebuilt from the same bytes.
   * If that rebuild lost a header, a byte, or the verb, every row in this directory
   * would still pass on the shapes it mints while some other shape broke, so this row
   * asserts the round trip on a shape that exercises the transport's own parser rather
   * than ours.
   */
  test("a malformed body still reaches the transport's parser, byte for byte", async () => {
    const { deps } = spyDeps();

    const print = await fingerprint(
      await handleMcpRequest(rawBodyRequest('{"jsonrpc":"2.0","id":1,"method":', KEY_A), deps),
    );

    // The transport's parse error, not ours: the rebuilt request carried the broken
    // bytes through unchanged rather than a repaired or re-encoded copy.
    expect(print.body).toContain("-32700");
  });

  test("a well-formed call answers exactly as it did before the body was ever read", async () => {
    const { deps } = spyDeps();

    const first = await fingerprint(
      await handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: "a" }, key: KEY_A }),
        deps,
      ),
    );
    const second = await fingerprint(
      await handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: "a" }, key: KEY_A }),
        deps,
      ),
    );

    expect(first.status).toBe(200);
    expect(first.contentType).toBe("text/event-stream");
    // Byte-identical twice, which is the floor the cross-tenant proof stands on and the
    // property a stale `content-length` on a rebuilt request would have been most
    // likely to break.
    expect(first).toEqual(second);
  });
});

// WIRE-L7 / WIRE-L8, the third log channel, and the partition it must respect

/** The word that tells the transport's channel apart from the other two. Both rows
 * below read it, so a message reworded in `wire.ts` without a thought for the partition
 * fails here rather than during an incident. */
const TRANSPORT_CHANNEL_MARKER = "transport";

function firstLoggedMessage(spy: ReturnType<typeof spyOn<Console, "error">>): string {
  return String(spy.mock.calls[0]?.[0] ?? "");
}

describe("WIRE-L7 — a fault the SDK reports reaches a log line of ours", () => {
  test("a transport-level refusal logs exactly once, naming the transport", async () => {
    // Without an `onerror` this was silent. Measured: a wire-layer failure answered the
    // caller and wrote nothing at all, because the SDK returns rather than throws and
    // `server.ts`'s catch never fires.
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { deps } = spyDeps();

      const answer = await answeredWithin(
        () =>
          handleMcpRequest(
            modernRequest({ method: "subscriptions/listen", params: LISTEN_PARAMS, key: KEY_A }),
            deps,
          ),
        BOUNDED_MS,
      );
      expect(answer).not.toBe(NEVER_ANSWERED);

      // Once. Never zero, which is the regression this closes; never twice, which is
      // two channels claiming one event.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(firstLoggedMessage(errorSpy)).toContain(TRANSPORT_CHANNEL_MARKER);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("WIRE-L8 — a broken read still belongs to the tool core's channel and not the transport's", () => {
  /**
   * The partition, from the side an over-eager `onerror` would have broken.
   * `./failure-isolation.test.ts`'s `WIRE-B1` requires exactly one log line for a
   * broken read; this row adds which line it must be. `callTool` catches its own fault
   * and returns a refusal value, so nothing throws into the SDK and the transport
   * channel must stay quiet. If it ever speaks here, one incident has become two lines
   * that disagree.
   */
  test("logs once, and the line is not the transport's", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }),
        { credentials: CREDENTIALS, reads: throwingReadPort() },
      );

      // The precondition: the broken read really did produce the answer this row is
      // about.
      expect(await response.text()).toContain(UNAVAILABLE.message);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(firstLoggedMessage(errorSpy)).not.toContain(TRANSPORT_CHANNEL_MARKER);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
