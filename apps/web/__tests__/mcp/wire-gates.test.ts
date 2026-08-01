// THE GATES IN FRONT OF THE WIRE — WIRE-G1…G6 (O-013, lane W0-T-A).
//
// Four of these rows are about a request that never reaches a tool, one is
// about a header that must never appear on the way out, and one is about a
// refusal we deliberately do not author. Together they are the boundary between
// "anyone can POST here" and "this is a machine surface with rules", and every
// one of them has a fail DIRECTION that has to be chosen out loud rather than
// inherited from whichever branch happened to be written first.
//
// ---------------------------------------------------------------------------
// THE ORIGIN GATE IS A CLASSIFIER, AND CLASSIFIERS MISS (D10)
// ---------------------------------------------------------------------------
//
// `Origin` present → 403. `Origin` absent → proceed. That is the whole rule,
// with no allow-list and no configuration, because no allow-list can be
// configuration-free and `docker compose up` must work on any hostname (D-9).
//
// The miss direction is therefore load-bearing: failing CLOSED on absence would
// refuse every real MCP client — an exclusion predicate firing on a superset of
// its target, which is the single most common way a deterministic gate breaks a
// product. `WIRE-G2` proves the direction behaviourally and `WIRE-G4` proves it
// is written down in words, because a fail direction nobody wrote down is one
// the next author reverses while tidying.
//
// ---------------------------------------------------------------------------
// WIRE-G6 IS LEG-QUALIFIED, AND THE QUALIFICATION IS THE POINT
// ---------------------------------------------------------------------------
//
// The transport serves two protocol eras from one handler, and the `Accept`
// requirement — both `application/json` AND `text/event-stream` — is a LEGACY-LEG
// behaviour. Measured: the modern leg answers 200 to `application/json` alone.
// So a `WIRE-G6` authored against a modern-envelope request would pass for the
// wrong reason, or fail and be "fixed" by deleting the assertion. Every request
// in this file is fixture-minted and therefore legacy — no `_meta` claim keys,
// no `Mcp-Method` header — which is the leg a stock client actually negotiates.
//
// ⚠️ A NOTE FOR ANYONE HOLDING AN EARLIER VERSION OF THIS TASK. It said
// `WIRE-G6` "constructs its own Requests, bypassing the helper's WIRE_HEADERS".
// It does not, and must not: the fixture grew a per-request `headers` override
// for exactly these three rows (`WIRE-G1`'s `Origin`, `WIRE-G3`'s content type,
// `WIRE-G6`'s narrowed `accept`), so a deviation is one visible entry at the
// call site while everything else — the content type, the credential, the leg —
// stays truthful. A hand-rolled `Request` would be one forgotten header away
// from asserting against a different refusal entirely.
//
// ---------------------------------------------------------------------------
// RED, AND WHY
// ---------------------------------------------------------------------------
//
// The Origin and Content-Type gates do not exist yet: `server.ts` imports
// neither `BROWSER_ORIGIN` nor `WRONG_CONTENT_TYPE` as of Wave 0, and answers
// every JSON-RPC body with our pre-protocol `MALFORMED_BODY` 400. Waves 7–8
// build both gates and the wire behind them. `WIRE-G6(b)` is green now and must
// stay green — it is the row saying authentication can never move behind a
// content-negotiation check.
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

/** The two content-type bands (D-6), both measured exactly. The pre-SDK band
 * carries the charset suffix `Response.json` adds; the SDK-rendered band, under
 * the pinned `responseMode: "sse"`, carries none. */
const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

/** Both media types the legacy leg requires, in the header value a real client
 * sends. Named here because `WIRE-G6` asserts the refusal SENTENCE names them
 * individually. */
const REQUIRED_MEDIA_TYPES = ["application/json", "text/event-stream"] as const;

// ---------------------------------------------------------------------------
// WIRE-G1 — a browser caller
// ---------------------------------------------------------------------------

describe("WIRE-G1 — a request carrying a browser origin is refused before the body is read", () => {
  /**
   * The credential is VALID on purpose. A 403 for a request that would have
   * been refused anyway proves nothing about the origin gate; this one would
   * have been served.
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

// ---------------------------------------------------------------------------
// WIRE-G2 — no origin at all
// ---------------------------------------------------------------------------

describe("WIRE-G2 — a request with no origin header is served, so a self-hosted stack works on any hostname", () => {
  /**
   * The declared fail-open direction, proved rather than described — and
   * `WIRE-G1`'s non-vacuity half: a gate that refused everything would satisfy
   * `WIRE-G1` perfectly.
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

// ---------------------------------------------------------------------------
// WIRE-G3 — a body that did not arrive as JSON
// ---------------------------------------------------------------------------

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

  // NON-VACUITY. A gate that refused every content type would pass the row
  // above and break every real client.
  test("the same request as JSON is still served", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps);
    const print = await fingerprint(response);

    expect(print.status).toBe(200);
    expect(print.body).not.toContain(WRONG_CONTENT_TYPE.message);
  });
});

// ---------------------------------------------------------------------------
// WIRE-G4 — the fail direction, in words
// ---------------------------------------------------------------------------

/** The leading comment block of a module — everything above the first line of
 * code. A declaration buried beside the function that implements it is not a
 * header, and a reader looking for the rules reads the top. */
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
 * Does the header state which way a MISSING `Origin` sends the request?
 *
 * PROXIMITY RATHER THAN SENTENCE SPLITTING, DELIBERATELY. Prose in this
 * codebase wraps across lines and is full of full stops inside backticked file
 * names, so splitting on `.` would cut a declaration in half and fail the row
 * for a punctuation reason. Instead: find every statement of a direction, and
 * require the header to be talking about the origin gate within a paragraph's
 * distance of it.
 *
 * Either direction satisfies this scanner. The row's claim is that the decision
 * is DECLARED, not which decision it is — `WIRE-G1` and `WIRE-G2` are what
 * prove the behaviour, and a header claiming a direction the code does not take
 * would fail there, loudly, rather than here.
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
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const SERVER_SRC = "apps/web/lib/mcp/server.ts";

  test("server.ts's header says which way a missing Origin fails", () => {
    const source = readFileSync(path.join(REPO_ROOT, SERVER_SRC), "utf8");

    expect(source.length).toBeGreaterThan(0);
    expect(declaresAFailDirection(source)).toBe(true);
  });

  // NON-VACUITY, both ways. A scanner that answered `true` for anything would
  // pass on a header that never mentions the gate, and one that answered
  // `false` for everything would make the row above unpassable.
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
    // And the direction must be in the HEADER, not merely somewhere in the file.
    expect(declaresAFailDirection(["const x = 1;", "// origin: fails open"].join("\n"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WIRE-G5 — no session id, ever
// ---------------------------------------------------------------------------

describe("WIRE-G5 — no response ever carries a session id header", () => {
  /**
   * This surface is STATELESS, and the header is how a client would learn
   * otherwise. A session id appearing on one answer would tell a client to send
   * it back on the next, and the next request would be answered from a session
   * this server never stored.
   *
   * ⚠️ EACH CASE ASSERTS ITS OWN STATUS BEFORE READING THE HEADER, AND THAT
   * PRECONDITION IS NOT DECORATION. An absence assertion is vacuous unless the
   * response really is the one it means to inspect: four refusals of the wrong
   * kind carry no session id either, and the row would pass forever while the
   * wire behind it answered nothing correctly.
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

// ---------------------------------------------------------------------------
// WIRE-G6 — the Accept refusal, on the legacy leg, behind the credential
// ---------------------------------------------------------------------------

describe("WIRE-G6 — a LEGACY-leg request that will not accept both media types is refused by the transport with a sentence that says which, and never before the credential is checked", () => {
  /** The deviation, at the call site: one header, narrowed. Everything else —
   * the content type, the legacy leg, the JSON-RPC body — is the fixture's. */
  const NARROWED_ACCEPT = { accept: "application/json" } as const;

  test("(a) an authenticated tools/list that accepts only JSON is refused 406, naming both media types", async () => {
    const { deps } = spyDeps();

    const response = await handleMcpRequest(
      rpcRequest({ method: "tools/list", key: KEY_A, headers: NARROWED_ACCEPT }),
      deps,
    );
    const print = await fingerprint(response);

    // The positive half first: this is the transport's content-negotiation
    // refusal and not something else that happened to be unhelpful.
    expect(print.status).toBe(406);
    for (const mediaType of REQUIRED_MEDIA_TYPES) {
      expect(print.body).toContain(mediaType);
    }

    // Only now the absences. The refusal is the SDK's, not ours (D-4, D-7) — we
    // author no Accept gate, because ours would be the same kind of hand-rolled
    // classifier D-12 declined for the protocol-version header — so this half
    // is a claim about somebody else's sentence, and worth making for exactly
    // that reason.
    expect(carriesStackFrame(print.body)).toBe(false);
    expect(carriesFilePath(print.body)).toBe(false);
  });

  // NON-VACUITY for the two leak scanners above. A scanner that has gone blind
  // reports "no leak" on a body that is nothing but leak.
  test("(a) the leak scanners do find a stack frame and a file path in a known-positive control", () => {
    const leaky = 'TypeError: x is not a function\n    at renderMcpWire (apps/web/lib/mcp/wire.ts:97:9)';

    expect(carriesStackFrame(leaky)).toBe(true);
    expect(carriesFilePath(leaky)).toBe(true);
    // And they do not fire on an ordinary refusal sentence — the fixture window
    // carries ISO timestamps, which look like positions to a loose matcher.
    expect(carriesStackFrame(BROWSER_ORIGIN.message)).toBe(false);
    expect(carriesFilePath("the window ran from 2026-06-01T00:00:00.000Z")).toBe(false);
  });

  test("(b) the identical request with no credential is answered 401 instead, exactly as a full-Accept request is", async () => {
    const { deps } = spyDeps();

    const narrowed = await fingerprint(
      await handleMcpRequest(
        rpcRequest({ method: "tools/list", headers: NARROWED_ACCEPT }),
        deps,
      ),
    );
    const full = await fingerprint(
      await handleMcpRequest(rpcRequest({ method: "tools/list" }), deps),
    );

    expect(narrowed.status).toBe(401);
    expect(narrowed.body).toContain(UNAUTHENTICATED.message);

    // The whole claim, in one comparison: what an anonymous caller gets back
    // does not depend on what it said it would accept. If the transport's 406
    // ever moved in front of the credential check, this is the row that fails —
    // and what it would be failing about is an unauthenticated oracle, because
    // a caller able to make the answer change has learned something.
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
