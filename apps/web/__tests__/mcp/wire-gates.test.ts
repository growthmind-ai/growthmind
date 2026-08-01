// The gates in front of the wire, WIRE-G1…G6.
//
// Four of these rows are about a request that never reaches a tool, one is about a
// header that must never appear on the way out, and one is about a refusal we
// deliberately do not author. Together they are the boundary between "anyone can POST
// here" and "this is a machine surface with rules", and every one of them has a fail
// direction that has to be chosen out loud rather than inherited from whichever branch
// happened to be written first.
//
// The origin gate is a classifier, and classifiers miss
//
// `Origin` present → 403. `Origin` absent → proceed. That is the whole rule, with no
// allow-list and no configuration, because no allow-list can be configuration-free and
// `docker compose up` must work on any hostname.
//
// The miss direction is therefore load-bearing: failing closed on absence would refuse
// every real MCP client. An exclusion predicate firing on a superset of its target,
// which is the single most common way a deterministic gate breaks a product. `WIRE-G2`
// proves the direction behaviourally and `WIRE-G4` proves it is written down in words,
// because a fail direction nobody wrote down is one the next author reverses while
// tidying.
//
// WIRE-G6 is leg-qualified, and the qualification is the point
//
// The transport serves two protocol eras from one handler, and the `Accept`
// requirement. Both `application/json` and `text/event-stream`. Is a legacy-leg
// behaviour. Measured: the modern leg answers 200 to `application/json` alone. So a
// `WIRE-G6` authored against a modern-envelope request would pass for the wrong reason,
// or fail and be "fixed" by deleting the assertion. Every request in this file is
// fixture-minted and therefore legacy (no `_meta` claim keys, no `Mcp-Method` header)
// which is the leg a stock client actually negotiates.
//
// ⚠️ a NOTE for anyone holding an earlier version of this task. It said `WIRE-G6`
// "constructs its own Requests, bypassing the helper's WIRE_HEADERS". It does not, and
// must not: the fixture grew a per-request `headers` override for exactly these three
// rows (`WIRE-G1`'s `Origin`, `WIRE-G3`'s content type, `WIRE-G6`'s narrowed `accept`),
// so a deviation is one visible entry at the call site while everything else (the
// content type, the credential, the leg) stays truthful. A hand-rolled `Request` would
// be one forgotten header away from asserting against a different refusal entirely.
//
// All six are green, and two more gates have landed since
//
// These rows were authored red: as of Wave 0 `server.ts` imported neither
// `BROWSER_ORIGIN` nor `WRONG_CONTENT_TYPE` and answered every JSON-RPC body with a
// pre-protocol `MALFORMED_BODY` 400. Waves 7–8 built both gates and the wire behind
// them, and every row here passes. `WIRE-G6` was green from the start and must stay
// so. It is the row saying authentication can never move behind a content-negotiation
// check.
//
// Two gates of `server.ts` are not covered here, deliberately. The post-sprint audit
// added a body size ceiling and a batch (array-body) refusal, both firing after the
// four gates above. They are availability bounds rather than header gates, they need
// bodies this file's rows never mint, and they live in `./wire-bounds.test.ts` with the
// measurements that produced them.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MCP_TOOL, MCP_TOOLS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { BROWSER_ORIGIN, UNAUTHENTICATED, WRONG_CONTENT_TYPE } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import { MCP_HEADER } from "../../lib/mcp/wire-constants";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  rpcRequest,
  toolCallRequest,
  verbRequest,
  KEY_A,
  ORG_A,
  type RecordingReadPort,
} from "./helpers/mcp-fixture";
import { carriesFilePath, carriesStackFrame } from "./helpers/wire-probes";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function spyDeps(): { readonly spy: RecordingReadPort; readonly deps: McpServerDeps } {
  const spy = fakeReadPort();
  return { spy, deps: { credentials: CREDENTIALS, reads: spy.port } };
}

/** The two content-type bands, both measured exactly. The pre-SDK band carries the
 * charset suffix `Response.json` adds; the SDK-rendered band, under the pinned
 * `responseMode: "sse"`, carries none. */
const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

/** Both media types the legacy leg requires, in the header value a real client sends.
 * Named here because `WIRE-G6` asserts the refusal sentence names them individually. */
const REQUIRED_MEDIA_TYPES = ["application/json", "text/event-stream"] as const;

// WIRE-G1, a browser caller

describe("WIRE-G1 — a request carrying a browser origin is refused before the body is read", () => {
  /**
   * The credential is valid on purpose. A 403 for a request that would have been
   * refused anyway proves nothing about the origin gate; this one would have been
   * served.
   */
  test("an authenticated tools/list with an Origin header is refused 403, and the port is untouched", async () => {
    const { spy, deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({ method: "tools/list", key: KEY_A, headers: { origin: "http://evil.example" } }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.status).toBe(403);
    expect(print.body).toContain(BROWSER_ORIGIN.message);
    expect(spy.organizationsAsked).toEqual([]);
  });
});

// WIRE-G2, no origin at all

describe("WIRE-G2 — a request with no origin header is served, so a self-hosted stack works on any hostname", () => {
  /**
   * The declared fail-open direction, proved rather than described, and `WIRE-G1`'s
   * non-vacuity half: a gate that refused everything would satisfy `WIRE-G1` perfectly.
   */
  test("the identical request minus Origin answers with the three tools", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    for (const tool of MCP_TOOLS) {
      expect(print.body).toContain(tool.name);
    }
    expect(print.body).not.toContain(BROWSER_ORIGIN.message);
  });
});

// WIRE-G3, a body that did not arrive as JSON

describe("WIRE-G3 — a request that does not arrive as JSON is refused with the content type named", () => {
  test("content-type: text/plain is refused 415 with the sentence that says what to send", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({
        method: "tools/list",
        key: KEY_A,
        headers: { [MCP_HEADER.CONTENT_TYPE]: "text/plain" },
      }),
      deps,
    );
    const print = await fingerprint(response);

    expect(print.status).toBe(415);
    expect(print.body).toContain(WRONG_CONTENT_TYPE.message);
  });

  // Non-vacuity. A gate that refused every content type would pass the row above and
  // break every real client.
  test("the same request as JSON is still served", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.status).toBe(200);
    expect(print.body).not.toContain(WRONG_CONTENT_TYPE.message);
  });
});

// WIRE-G4, the fail direction, in words

/** The leading comment block of a module. Everything above the first line of code. A
 * declaration buried beside the function that implements it is not a header, and a
 * reader looking for the rules reads the top. */
function moduleHeader(source: string): string {
  const header: string[] = [];
  for (const line of source.split("\n")) {
    if (line.startsWith("//") || line.trim().length === 0) {
      header.push(line.replace(/^\/\/ ?/, ""));
      continue;
    }
    break;
  }
  return header.join("\n");
}

/**
 * Does the header state which way a missing `Origin` sends the request?
 *
 * Proximity rather than sentence splitting, deliberately. Prose in this codebase wraps
 * across lines and is full of full stops inside backticked file names, so splitting on
 * `.` would cut a declaration in half and fail the row for a punctuation reason.
 * Instead: find every statement of a direction, and require the header to be talking
 * about the origin gate within a paragraph's distance of it.
 *
 * Either direction satisfies this scanner. The row's claim is that the decision is
 * declared, not which decision it is, `WIRE-G1` and `WIRE-G2` are what prove the
 * behaviour, and a header claiming a direction the code does not take would fail there,
 * loudly, rather than here.
 */
function declaresAFailDirection(source: string): boolean {
  const header = moduleHeader(source);
  const window = 240;

  for (const match of header.matchAll(/fails?\s+(?:open|closed)/gi)) {
    const from = Math.max(0, (match.index ?? 0) - window);
    const around = header.slice(from, (match.index ?? 0) + window);
    if (/origin/i.test(around)) {
      return true;
    }
  }
  return false;
}

describe("WIRE-G4 — the origin gate's fail direction is declared in words in the module header", () => {
  const REPO_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  const SERVER_SRC = "apps/web/lib/mcp/server.ts";

  test("server.ts's header says which way a missing Origin fails", () => {
    const source = readFileSync(path.join(REPO_ROOT, SERVER_SRC), "utf8");

    expect(source.length).toBeGreaterThan(0);
    expect(declaresAFailDirection(source)).toBe(true);
  });

  // Non-vacuity, both ways. A scanner that answered `true` for anything would pass on a
  // header that never mentions the gate, and one that answered `false` for everything
  // would make the row above unpassable.
  test("the scanner tells a header that declares the direction from one that only mentions the gate", () => {
    const declares = [
      "// THE HANDLER.",
      "//",
      "// An `Origin` header present at all is refused with 403. A request",
      "// carrying none fails open and is served, because an MCP client is not a",
      "// browser and never sends one.",
      "const x = 1;",
    ].join("\n");

    const silent = [
      "// THE HANDLER.",
      "//",
      "// A request carrying an `Origin` header is refused with 403.",
      "const x = 1;",
    ].join("\n");

    expect(declaresAFailDirection(declares)).toBe(true);
    expect(declaresAFailDirection(silent)).toBe(false);
    // And the direction must be in the header, not merely somewhere in the file.
    expect(declaresAFailDirection(["const x = 1;", "// origin: fails open"].join("\n"))).toBe(
      false,
    );
  });
});

// WIRE-G5, no session id, ever

describe("WIRE-G5 — no response ever carries a session id header", () => {
  /**
   * This surface is stateless, and the header is how a client would learn otherwise. A
   * session id appearing on one answer would tell a client to send it back on the next,
   * and the next request would be answered from a session this server never stored.
   *
   * ⚠️ each case asserts its own status before reading the header, and that
   * precondition is not decoration. An absence assertion is vacuous unless the response
   * really is the one it means to inspect: four refusals of the wrong kind carry no
   * session id either, and the row would pass forever while the wire behind it answered
   * nothing correctly.
   */
  const cases: readonly {
    readonly name: string;
    readonly status: number;
    readonly run: (deps: McpServerDeps) => Promise<Response>;
  }[] = [
    {
      name: "a tools/list",
      status: 200,
      run: (deps) => handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps),
    },
    {
      name: "a tools/call",
      status: 200,
      run: (deps) =>
        handleMcpRequest(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }), deps),
    },
    {
      name: "an unauthenticated refusal",
      status: 401,
      run: (deps) => handleMcpRequest(rpcRequest({ method: "tools/list" }), deps),
    },
    {
      name: "a wrong-method refusal",
      status: 405,
      run: (deps) => handleMcpRequest(verbRequest({ method: "DELETE", key: KEY_A }), deps),
    },
  ];

  for (const { name, status, run } of cases) {
    test(`${name} carries no session id header`, async () => {
      const { deps } = spyDeps();

      const response = await run(deps);

      expect(response.status).toBe(status);
      expect(response.headers.get(MCP_HEADER.SESSION_ID)).toBe(null);
    });
  }
});

// WIRE-G6, the Accept refusal, on the legacy leg, behind the credential

describe("WIRE-G6 — a LEGACY-leg request that will not accept both media types is refused by the transport with a sentence that says which, and never before the credential is checked", () => {
  /** The deviation, at the call site: one header, narrowed. Everything else, the
   * content type, the legacy leg, the JSON-RPC body. Is the fixture's. */
  const NARROWED_ACCEPT = { accept: "application/json" } as const;

  test("(a) an authenticated tools/list that accepts only JSON is refused 406, naming both media types", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({ method: "tools/list", key: KEY_A, headers: NARROWED_ACCEPT }),
      deps,
    );
    const print = await fingerprint(response);

    // The positive half first: this is the transport's content-negotiation refusal and
    // not something else that happened to be unhelpful.
    expect(print.status).toBe(406);
    for (const mediaType of REQUIRED_MEDIA_TYPES) {
      expect(print.body).toContain(mediaType);
    }

    // Only now the absences. The refusal is the sdk's, not ours. We author no Accept
    // gate, because ours would be the same kind of hand-rolled classifier declined for
    // the protocol-version header, so this half is a claim about somebody else's
    // sentence, and worth making for exactly that reason.
    expect(carriesStackFrame(print.body)).toBe(false);
    expect(carriesFilePath(print.body)).toBe(false);
  });

  // Non-vacuity for the two leak scanners above. A scanner that has gone blind reports
  // "no leak" on a body that is nothing but leak.
  test("(a) the leak scanners do find a stack frame and a file path in a known-positive control", () => {
    const leaky =
      "TypeError: x is not a function\n    at renderMcpWire (apps/web/lib/mcp/wire.ts:97:9)";

    expect(carriesStackFrame(leaky)).toBe(true);
    expect(carriesFilePath(leaky)).toBe(true);
    // And they do not fire on an ordinary refusal sentence. The fixture window carries
    // ISO timestamps, which look like positions to a loose matcher.
    expect(carriesStackFrame(BROWSER_ORIGIN.message)).toBe(false);
    expect(carriesFilePath("the window ran from 2026-06-01T00:00:00.000Z")).toBe(false);
  });

  test("(b) the identical request with no credential is answered 401 instead, exactly as a full-Accept request is", async () => {
    const { deps } = spyDeps();

    const narrowed = await fingerprint(
      await handleMcpRequest(rpcRequest({ method: "tools/list", headers: NARROWED_ACCEPT }), deps),
    );
    const full = await fingerprint(
      await handleMcpRequest(rpcRequest({ method: "tools/list" }), deps),
    );

    expect(narrowed.status).toBe(401);
    expect(narrowed.body).toContain(UNAUTHENTICATED.message);

    // The whole claim, in one comparison: what an anonymous caller gets back does not
    // depend on what it said it would accept. If the transport's 406 ever moved in
    // front of the credential check, this is the row that fails, and what it would be
    // failing about is an unauthenticated oracle, because a caller able to make the
    // answer change has learned something.
    expect(narrowed).toEqual(full);
  });

  test("(c) the same request accepting both media types is served", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
  });
});
