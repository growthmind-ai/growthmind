// EIGHT ENVELOPE SHAPES THIS SURFACE HAS TO HAVE AN ANSWER FOR — WIRE-W1…W8
// (O-013, lane W0-T-A, the D5 data-shape suite).
//
// Once a surface speaks JSON-RPC, the set of things a caller can put on the
// wire stops being "our envelope, or nothing". A batch arrives as an array. An
// id arrives as `null`. `jsonrpc` goes missing. A notification carries no id at
// all. A method nobody implemented is asked for. `params` is absent. The body
// is not JSON. Every one of those has a defined answer in the protocol, and a
// surface that answers any of them with a 500 — or with an exception nobody
// caught — is a surface a coding agent cannot use, because the agent cannot
// tell "I sent that wrong" from "this server is broken".
//
// ---------------------------------------------------------------------------
// WHAT THESE ROWS ASSERT, AND WHAT THEY DELIBERATELY DO NOT
// ---------------------------------------------------------------------------
//
// The protocol-level codes below — `-32700`, `-32600`, `-32601` — are the
// TRANSPORT'S TO EMIT, never ours (D-7). These rows therefore assert WHAT
// ARRIVES and never that we authored it: each one names a code from
// `../../lib/mcp/wire-constants.ts`'s `JSON_RPC_ERROR_CODE` — which exists as a
// tripwire rather than a vocabulary in use — and looks for it in the answer.
// If a row here ever tempts someone to hand-roll an error object in
// `server.ts`, the row has been misread: the fix is always to let the transport
// frame it.
//
// ---------------------------------------------------------------------------
// EVERY REQUEST IS LEGACY-LEG AND FIXTURE-MINTED (D-13)
// ---------------------------------------------------------------------------
//
// Nothing here builds a `Request` by hand. The fixture's constructors carry
// `accept: application/json, text/event-stream` on every request, and the
// legacy leg — the one a stock client actually negotiates — refuses anything
// less with a 406 before the body is parsed. A hand-rolled `Request` would make
// most of this file assert against a content-negotiation refusal instead of the
// envelope answer it names.
//
// ---------------------------------------------------------------------------
// RED, AND WHY EACH ONE IS RED
// ---------------------------------------------------------------------------
//
// As of Wave 0 the route still reads its own pre-protocol envelope — a `tool`
// key and an `input` key on the body — so every JSON-RPC message minted here
// reaches it as an object with no `tool` field and comes back as HTTP 400
// `MALFORMED_BODY`. That is the right red: the surface does not speak this
// protocol yet, and waves 7–8 are what make it. WIRE-W1 is the one exception
// and its comment says so.
//
// DO NOT MAKE THESE GREEN BY TEACHING `server.ts` TO RECOGNISE JSON-RPC BY
// HAND. Task 8.1 hands the request to the transport; a second parser written to
// satisfy this file would be exactly the drift this sprint removes.
import { MCP_TOOL } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import { JSON_RPC_ERROR_CODE } from "../../lib/mcp/wire-constants";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  notificationRequest,
  rawBodyRequest,
  rpcRequest,
  toolCallRequest,
  KEY_A,
  ORG_A,
  type RecordingReadPort,
} from "./helpers/mcp-fixture";
import { watchForUnhandledRejections } from "./helpers/wire-probes";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

/** A credential that resolves and a store that records every organization it is
 * asked about. The store is EMPTY in every row here: none of these rows is
 * about data, and several are about the port never being reached at all. */
function spyDeps(): { readonly spy: RecordingReadPort; readonly deps: McpServerDeps } {
  const spy = fakeReadPort();
  return { spy, deps: { credentials: CREDENTIALS, reads: spy.port } };
}

/**
 * The marker that says an answer is a JSON-RPC message at all.
 *
 * Matched as a SUBSTRING OF THE RAW BODY rather than by parsing, for the reason
 * `WIRE-R10` bans parsing in the identity suites: what these rows care about is
 * what came back on the wire, and a parse would discard the framing that is
 * half of it. The transport serialises with `JSON.stringify`, so the envelope
 * field is always exactly this, in both bands — measured on both legs.
 */
const JSONRPC_MARKER = '"jsonrpc":"2.0"';

/** The wire form of a protocol error code, as it appears inside a serialised
 * JSON-RPC error object. */
function errorCodeMarker(code: number): string {
  return `"code":${code}`;
}

/**
 * The content type of every answer the SDK rendered, under the pinned
 * `responseMode: "sse"` (D-4/D-6). Measured, exactly: no charset suffix.
 */
const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

// ---------------------------------------------------------------------------
// WIRE-W1 — a batch body
// ---------------------------------------------------------------------------

describe("WIRE-W1 — a batch request is answered without crashing the handler", () => {
  /**
   * ⚠️ THE WEAKEST ROW IN THE FILE, ON PURPOSE, AND IT IS ALREADY GREEN.
   *
   * A JSON-RPC batch is an ARRAY, and the revision this surface negotiates
   * removed batching — so what the transport answers is its business, and the
   * only thing this row is entitled to claim is that an array is a shape the
   * surface HAS an answer for. Today that answer is our pre-protocol
   * `MALFORMED_BODY` (an array is not a record); after wave 8 it is whatever the
   * transport frames. Both satisfy the claim, which is why this row is green now
   * and stays green.
   *
   * Pinning the exact code would be authoring an assertion against behaviour
   * nobody has measured, and it would go red at wave 8 for a reason that says
   * nothing about this surface.
   */
  test("an array body comes back as a response below 500, with something in it", async () => {
    const { deps } = spyDeps();

    const watched = await watchForUnhandledRejections(async () =>
      handleMcpRequest(
        rawBodyRequest('[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]', KEY_A),
        deps,
      ),
    );
    const print = await fingerprint(watched.result);

    expect(print.status).toBeLessThan(500);
    expect(print.body.length).toBeGreaterThan(0);
    // The half that is not vacuous today: an array is the shape most likely to
    // reach a `.map` that assumed an object, and a rejection nobody handled
    // would be invisible to the status assertion above.
    expect(watched.unhandled).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WIRE-W2 — a null id
// ---------------------------------------------------------------------------

describe("WIRE-W2 — a request with a null id is answered rather than dropped", () => {
  /**
   * `id: null` is a REQUEST, not a notification. The difference is one byte on
   * the wire and the whole of what a caller gets back: a notification is
   * answered with nothing (WIRE-W4), and a null-id request must be answered
   * with a message. A surface that treats them alike leaves a client waiting
   * forever for an answer that was never framed.
   */
  test("id: null comes back as a JSON-RPC message, not an empty body", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({ method: "tools/list", id: null, key: KEY_A }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.body.length).toBeGreaterThan(0);
    expect(print.body).toContain(JSONRPC_MARKER);
  });
});

// ---------------------------------------------------------------------------
// WIRE-W3 — a body with no `jsonrpc` field
// ---------------------------------------------------------------------------

describe("WIRE-W3 — a body missing the jsonrpc field is refused as an invalid request", () => {
  test("carries the invalid-request code and never a 500", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      rawBodyRequest('{"id":1,"method":"tools/list"}', KEY_A),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.body).toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.INVALID_REQUEST));
    expect(print.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// WIRE-W4 — a notification
// ---------------------------------------------------------------------------

describe("WIRE-W4 — a notification with no id is answered with no JSON-RPC message", () => {
  /**
   * `notifications/initialized` is the second of the three requests a real
   * client's `connect()` makes, and it is answered 202 with an EMPTY BODY and no
   * content-type at all — measured. So this row asserts the absence of a message
   * rather than the presence of one, and the status half is what stops that
   * absence from being satisfied by a refusal that happened to be empty.
   */
  test("yields a zero-length body and a status below 300", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      notificationRequest({ method: "notifications/initialized", key: KEY_A }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.status).toBeLessThan(300);
    expect(print.body.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WIRE-W5 — an unknown method
// ---------------------------------------------------------------------------

describe("WIRE-W5 — an unknown method is refused with method-not-found and never a 500", () => {
  /**
   * `tools/destroy` is chosen rather than a nonsense string because it is the
   * shape of the mistake that actually happens: a method that looks like one of
   * ours, on a surface that only reads. The port half is the important one — an
   * unknown method must not reach anything that touches data.
   */
  test("answers tools/destroy with method-not-found, below 500, and asks the port nothing", async () => {
    const { spy, deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({ method: "tools/destroy", key: KEY_A }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.body).toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.METHOD_NOT_FOUND));
    expect(print.status).toBeLessThan(500);
    expect(spy.organizationsAsked).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WIRE-W6 — no params at all
// ---------------------------------------------------------------------------

describe("WIRE-W6 — a request with no params at all is answered rather than thrown on", () => {
  /**
   * `params` ABSENT is not `params: {}`. A handler that reaches for
   * `params.name` on a message that carries no `params` key throws a
   * `TypeError` inside the framing layer, which is the least useful failure
   * available: no code, no sentence, and a 500 for a request that was legal.
   *
   * Both halves are asserted because the two paths are different code: one
   * method takes no arguments by design, the other takes them and must refuse
   * their absence in a way a caller can act on.
   */
  test("tools/list with no params comes back as a JSON-RPC message", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.body).toContain(JSONRPC_MARKER);
  });

  test("tools/call with no params comes back as a JSON-RPC message rather than a fault", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/call", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.body).toContain(JSONRPC_MARKER);
    expect(print.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// WIRE-W7 — malformed JSON
// ---------------------------------------------------------------------------

describe("WIRE-W7 — malformed JSON is refused as a parse error before any tool is resolved", () => {
  /**
   * The port half is the ordering claim, one layer below `WIRE-O1`'s: a body
   * that cannot be parsed cannot have named a tool, so nothing that touches
   * data may have run by the time the answer is framed.
   */
  test("answers with the parse-error code and asks the port nothing", async () => {
    const { spy, deps } = spyDeps();

    const response = await handleMcpRequest(
      rawBodyRequest('{"jsonrpc":"2.0","id":1,"method":', KEY_A),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.body).toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.PARSE_ERROR));
    expect(spy.organizationsAsked).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WIRE-W8 — two identical calls, two identical answers, one effect each
// ---------------------------------------------------------------------------

describe("WIRE-W8 — two identical tool calls produce two identical answers and no second effect", () => {
  /**
   * D4, and the row that guards the whole identity mechanism from underneath.
   *
   * The cross-tenant proof rests on two DIFFERENT requests answering with the
   * same bytes. That proof is worthless if the same request twice does not — so
   * this row asserts the floor the others stand on. The fixture defaults the
   * JSON-RPC id to 1 precisely so both calls share one, because the id is echoed
   * into every answer and two answers can only be byte-identical if it was held
   * constant.
   *
   * ⚠️ SDK-RENDERED BAND: `text/event-stream`, NOT `application/json`. Round 1
   * pinned `responseMode: "json"` and this row was authored to it; round 2
   * measured that the mode is INERT on the legacy leg and pinned `"sse"`, which
   * moved the whole SDK-rendered band. §6's per-row line still carries the stale
   * text; the band paragraph and D-6 win.
   *
   * WHAT THIS ROW NOW GUARDS is the measured ABSENCE of a per-event `id:` line.
   * Nothing in this package emits one today, on either leg under any mode — so
   * the byte-identity exclusion list is empty. If a `bun update` starts emitting
   * event ids, two identical requests stop being byte-identical and this row
   * goes red first, which is exactly why `WIRE-K6(c)` stands beside it.
   */
  test("two calls with the same id are byte-identical, and the port is read exactly twice", async () => {
    const { spy, deps } = spyDeps();

    const first = await handleMcpRequest(
      toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }),
      deps,
    );
    const second = await handleMcpRequest(
      toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }),
      deps,
    );

    const firstPrint = await fingerprint(first);
    const secondPrint = await fingerprint(second);

    // The band, asserted before the comparison: two answers that were both the
    // wrong kind of answer would compare equal to each other all day.
    expect(firstPrint.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(firstPrint).toEqual(secondPrint);

    // Two reads, one per call, both against the credential's organization —
    // never a cache that answered the second from the first, and never a second
    // read the caller did not ask for.
    expect(spy.organizationsAsked).toEqual([ORG_A, ORG_A]);
  });

  /**
   * "No second effect" is a claim about writes, and the strongest form of it is
   * that there is no write to make: the port this surface has is three reads.
   * Asserted structurally rather than by counting, so a fourth method that could
   * write fails here the day it is added rather than the day it is called.
   */
  test("the only port the surface has is the read port, and it has three read methods", () => {
    const { spy } = spyDeps();

    expect(Object.keys(spy.port).toSorted()).toEqual(["getFinding", "getFix", "listOpenFixes"]);
  });
});
