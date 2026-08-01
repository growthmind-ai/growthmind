// The read-only machine surface's behaviour, driven through its real entry point.
//
// Every test here calls `handleMcpRequest` with a real `Request` and asserts on a real
// `Response`. The cross-tenant identity proof lives in `./cross-tenant.test.ts` and the
// credential decision in `./credentials.test.ts`; this file covers the rest of the
// surface. What it refuses, what it answers when there is nothing to answer with, and
// the read-only shape itself.
//
// The rows are `WIRE-R1…R22`, and two of them change their claim
//
// Twenty-one rows live here (`WIRE-R10` is the source scanner and lives in
// `./refusal-identity-guard.test.ts`). Every one keeps its claim except two, and both
// exceptions are named deviations with a reason on the record:
//
// `WIRE-R7` inverts. It used to say "a method other than GET or POST is
//  refused"; it now says every method other than POST is refused, including
//  GET. The catalogue moved onto the wire protocol as `tools/list`, so
//  a `GET` has nothing left to answer with and returns 405 carrying the
//  re-authored `WRONG_METHOD` sentence — which tells an agent what to send
//  instead, because Next's own bodiless 405 would not.
//
// `WIRE-R1` becomes a `tools/call` with an unknown `params.name`, answered
//  as a tool execution error on HTTP 200 rather than an HTTP 400. See the
//  diagnosis comment on the row itself — it is the one row in this file that
//  is unachievable under the wrong SDK surface, and the failure looks like an
//  ordinary red.
//
// The two bands, and why this file parses where the identity suites may not
//
// SDK-rendered answers, every tool result, every tool execution error, every
// `tools/list`. Arrive as `{ 200, "text/event-stream", 'event: message\ndata: {…}\n\n'
// }` under the pinned `responseMode: "sse"`. Pre-SDK refusals, the 401 and the 405,
// both produced by `refusalResponse` before `wire.ts` is called at all. Arrive as `{
// 4xx, "application/json;charset=utf-8", … }`. Both constants are named below and
// asserted by the rows that sit in them.
//
// This file is not one of the four identity suites, so `JSON.parse` is available here
// and is used, deliberately, to read a result's fields. That is not a loosening:
// `WIRE-R10` bans parsing in `cross-tenant.test.ts`, `cross-tenant-real-keys.test.ts`,
// `credentials.test.ts` and `api-key-credentials.test.ts` because parsing discards the
// bytes those files exist to compare. Nothing in this file compares a cross-tenant
// pair. The two identity rows it does carry (`WIRE-R12`, `WIRE-R22`) compare raw
// `fingerprint`s and never a parsed object.
//
// Protocol errors are read by raw containment, not by frame. `-32700` and friends are
// the transport's to emit, and the framing it wraps them in is its business and was not
// measured. The rows that assert one look for the serialised code in the raw body,
// exactly as `./wire-envelope.test.ts` does, so they cannot fail on a framing detail
// nobody pinned.
//
// Lane prefix `mcproute`.
import { renderFixSpec } from "@growthmind/core";
import {
  FORBIDDEN_PRODUCT_JARGON,
  LIST_OPEN_FIXES_MAX_ITEMS,
  MCP_TOOL,
  MCP_TOOLS,
  fixSpecEnvelopeSchema,
  getFindingInputSchema,
  getFixInputSchema,
  listOpenFixesInputSchema,
  listOpenFixesOutputSchema,
} from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import * as mcpRoute from "../../app/api/mcp/route";
import {
  BODY_TOO_LARGE,
  BROWSER_ORIGIN,
  MALFORMED_BODY,
  NOT_FOUND,
  UNAUTHENTICATED,
  UNAVAILABLE,
  WRONG_CONTENT_TYPE,
  WRONG_METHOD,
  malformedInput,
  unknownTool,
} from "../../lib/mcp/refusals";
import { createAbsentReadPort, type McpReadPort } from "../../lib/mcp/read-port";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import { JSON_RPC_ERROR_CODE } from "../../lib/mcp/wire-constants";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  findingRecordFor,
  fixRecordFor,
  openFixRowFor,
  rawBodyRequest,
  rpcRequest,
  sseDataLine,
  toolCallRequest,
  verbRequest,
  KEY_A,
  ORG_A,
  type RecordingReadPort,
  type ResponseFingerprint,
} from "./helpers/mcp-fixture";
import { carriesFilePath, carriesStackFrame } from "./helpers/wire-probes";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });
const PROJECT_A = "project-mcproute";

/** The two content-type bands, both measured exactly. */
const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";
const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

function depsWith(reads: McpReadPort): McpServerDeps {
  return { credentials: CREDENTIALS, reads };
}

/** The composition this branch actually ships: a real credential gate over an absent
 * store. */
function absentDeps(log: (message: string) => void = () => undefined): McpServerDeps {
  return depsWith(createAbsentReadPort(log));
}

/** A credential that resolves over a store that records every organization it was asked
 * about. For the rows whose claim is that a port was not reached. */
function spyDeps(): { readonly spy: RecordingReadPort; readonly deps: McpServerDeps } {
  const spy = fakeReadPort();
  return { spy, deps: depsWith(spy.port) };
}

async function call(deps: McpServerDeps, tool: string, input?: unknown): Promise<Response> {
  return handleMcpRequest(toolCallRequest({ tool, input, key: KEY_A }), deps);
}

async function callPrint(
  deps: McpServerDeps,
  tool: string,
  input?: unknown,
): Promise<ResponseFingerprint> {
  return fingerprint(await call(deps, tool, input));
}

// Reading an SDK-rendered answer

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The JSON-RPC message inside an SSE frame, as an object.
 *
 * `sseDataLine` does the unframing with string operations only; the parse is this
 * file's own, and is allowed here for the reason the header states.
 */
function frameOf(print: ResponseFingerprint): Record<string, unknown> {
  const parsed: unknown = JSON.parse(sseDataLine(print.body));
  if (!isRecord(parsed)) {
    throw new Error("mcproute: the SSE frame did not carry a JSON-RPC object");
  }
  return parsed;
}

/** The `result` of an SDK-rendered answer. Throws rather than returning `undefined`, so
 * a row that reached for a result on an error frame fails with a sentence instead of
 * comparing against nothing. */
function resultOf(print: ResponseFingerprint): Record<string, unknown> {
  const result = frameOf(print).result;
  if (!isRecord(result)) {
    throw new Error(`mcproute: the frame carried no JSON-RPC result. Body: ${print.body}`);
  }
  return result;
}

/** The first block of text a tool result carries. The place every refusal sentence
 * lands once it travels as a tool execution error (rule 2). */
function toolTextOf(print: ResponseFingerprint): string {
  const content = resultOf(print).content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error(`mcproute: the result carried no content. Body: ${print.body}`);
  }
  const first: unknown = content[0];
  if (!isRecord(first) || typeof first.text !== "string") {
    throw new Error(`mcproute: the first content block carried no text. Body: ${print.body}`);
  }
  return first.text;
}

/** The wire form of a protocol error code inside a serialised JSON-RPC error object.
 * Matched as a substring of the raw body, because the framing the transport wraps its
 * own errors in is its business and was not measured. */
function errorCodeMarker(code: number): string {
  return `"code":${code}`;
}

// Refusals that instruct

describe("what the surface refuses, and how it says so", () => {
  /**
   * ⚠️ if this row is red at wave 8, read this before debugging anything else.
   *
   * It is achievable only under the Surface B, and `W0-P2d` measured exactly why. With
   * `registerTool` alone, `McpServer` resolves `params.name` against its own registry
   * first and answers `-32602 "Tool not_a_tool not found"`. A protocol error carrying
   * none of our tool names and none of our sentence. Under Surface B, a `tools/call`
   * override on the inner `server.server`, registered after the `registerTool` loop,
   * receives `params.name` itself and answers `resolveMcpTool`'s own message.
   *
   * So a red here almost certainly means one of three things, in order of likelihood:
   * the override is missing; it is registered on the `McpServer` facade rather than on
   * `server.server`; or it is registered before the loop and the loop overwrote it.
   * Measured: `setRequestHandler` does not throw when it lands correctly.
   */
  test("WIRE-R1 — an unknown tool name is refused with the names that exist, never with a server error", async () => {
    const print = await callPrint(absentDeps(), "delete_everything", {});

    // The band first: an unknown tool is our refusal travelling as a tool execution
    // error on 200, never the sdk's `-32602` and never a 500.
    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(resultOf(print).isError).toBe(true);

    // The message is `resolveMcpTool`'s own. It lists the tools and says which one to
    // start from, so the agent can carry on rather than stop.
    const text = toolTextOf(print);
    for (const tool of [MCP_TOOL.LIST_OPEN_FIXES, MCP_TOOL.GET_FIX, MCP_TOOL.GET_FINDING]) {
      expect(text).toContain(tool);
    }
    // And it is the sdk's protocol error that must not be what came back.
    expect(print.body).not.toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.INVALID_PARAMS));
  });

  test("WIRE-R2 — a body that is not JSON is refused as a parse error in plain English with no stack trace", async () => {
    const print = await fingerprint(
      await handleMcpRequest(rawBodyRequest("this is not json {{{", KEY_A), absentDeps()),
    );

    // The precondition: this really is the parse refusal, and not a 406 or a 500 that
    // also happens to carry no stack frame. The two absences below are worth nothing
    // without it.
    expect(print.body).toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.PARSE_ERROR));
    expect(print.status).toBeLessThan(500);

    // The framing is the transport's and the sentence in it is not ours, but what must
    // never ride along is: a stack frame, a file path, or the engine's own exception
    // name.
    expect(carriesStackFrame(print.body)).toBe(false);
    expect(carriesFilePath(print.body)).toBe(false);
    expect(print.body).not.toContain("SyntaxError");
    expect(print.body).not.toContain("stack");
  });

  // Non-vacuity for the two leak scanners the row above leans on. A scanner that has
  // gone blind reports "no leak" on a body that is nothing but leak.
  test("WIRE-R2 — the leak scanners do fire on a known-positive control", () => {
    const leaky =
      "TypeError: x is not a function\n    at renderMcpWire (apps/web/lib/mcp/wire.ts:97:9)";

    expect(carriesStackFrame(leaky)).toBe(true);
    expect(carriesFilePath(leaky)).toBe(true);
    expect(carriesStackFrame(MALFORMED_BODY.message)).toBe(false);
    expect(carriesFilePath(MALFORMED_BODY.message)).toBe(false);
  });

  test("WIRE-R3 — a tools/call with no tool name is refused rather than guessed at", async () => {
    const { spy, deps } = spyDeps();

    // `params` present, `name` absent. The shape a client sends when it has built the
    // envelope correctly and forgotten what it was calling.
    const print = await fingerprint(
      await handleMcpRequest(
        rpcRequest({ method: "tools/call", params: { arguments: {} }, key: KEY_A }),
        deps,
      ),
    );

    // Answered rather than thrown on, and answered as a message rather than as an empty
    // body.
    expect(print.status).toBeLessThan(500);
    expect(print.body).toContain('"jsonrpc":"2.0"');

    // The half that matters: a call that named no tool cannot have touched anything
    // that reads data. Never guessed at, never defaulted to the tool a caller
    // "probably" meant.
    expect(spy.organizationsAsked).toEqual([]);
  });

  test("WIRE-R4 — a limit above the ceiling is refused, never quietly capped", async () => {
    // The boundary case: one more than the ceiling. A surface that capped would answer
    // 200 with a result here, which is the thing this row forbids.
    const atBoundary = await callPrint(absentDeps(), MCP_TOOL.LIST_OPEN_FIXES, {
      limit: LIST_OPEN_FIXES_MAX_ITEMS + 1,
    });
    expect(atBoundary.status).toBe(200);
    expect(atBoundary.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(resultOf(atBoundary).isError).toBe(true);
    expect(toolTextOf(atBoundary)).toContain("limit");

    // And a value far above it, chosen so the "never echoed" assertion below cannot
    // pass by coincidence: `26` could plausibly appear inside some other number on the
    // wire, `987654` could not.
    const farAbove = await callPrint(absentDeps(), MCP_TOOL.LIST_OPEN_FIXES, { limit: 987654 });
    expect(resultOf(farAbove).isError).toBe(true);
    expect(toolTextOf(farAbove)).toContain("limit");

    // The value the caller sent never travels back. It may be somebody's id in another
    // field, and a refusal that echoes its input is a refusal that can be made to say
    // anything.
    expect(farAbove.body).not.toContain("987654");
  });

  test("WIRE-R5 — a limit below one is refused too — the ceiling is bounded on both sides", async () => {
    const print = await callPrint(absentDeps(), MCP_TOOL.LIST_OPEN_FIXES, { limit: 0 });

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(resultOf(print).isError).toBe(true);
    expect(toolTextOf(print)).toContain("limit");
  });

  test("WIRE-R6 — a tool argument of the wrong shape is refused with the field named, never a 500", async () => {
    const print = await callPrint(absentDeps(), MCP_TOOL.GET_FIX, { fixId: 424242 });

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(resultOf(print).isError).toBe(true);
    expect(toolTextOf(print)).toContain("fixId");

    // Same rule as `WIRE-R4`: the field is named, the value never is.
    expect(print.body).not.toContain("424242");
  });

  /**
   * ⚠️ claim inverted. This row used to read "a method other than GET or POST"; `GET`
   * is now refused too, because the catalogue it used to serve moved onto the wire
   * protocol as `tools/list`. The row is not dropped. An agent that GETs must still
   * receive a sentence saying what to send instead, which is why `GET` stays an
   * explicitly exported handler returning `refusalResponse(WRONG_METHOD)` rather than
   * being delegated to the sdk's own bodiless 405.
   */
  test("WIRE-R7 — every method other than POST is refused, including GET", async () => {
    for (const method of ["GET", "DELETE"]) {
      const print = await fingerprint(
        await handleMcpRequest(verbRequest({ method, key: KEY_A }), absentDeps()),
      );

      // Pre-sdk 405 band: `GET` never reaches the transport at all, so the framing pin
      // cannot touch this answer.
      expect(`${method}: ${print.status}`).toBe(`${method}: 405`);
      expect(`${method}: ${print.contentType}`).toBe(`${method}: ${PRE_SDK_CONTENT_TYPE}`);
      expect(print.body).toContain(WRONG_METHOD.message);
    }

    // The other half of "unmounted": `PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS` are not
    // exported by the route module at all, so Next answers them with its own 405 and
    // nothing of ours ever runs. Asserted structurally, because a handler test cannot
    // exercise Next's routing.
    const exported = Object.keys(mcpRoute);
    for (const verb of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(exported).not.toContain(verb);
    }
  });

  /**
   * The corpus grows, and it enumerates every constant by name.
   *
   * Two of the eight were re-authored this sprint (`WRONG_METHOD` and `MALFORMED_BODY`
   * both named things that stopped being true. A `GET` catalogue and a `tool`/`input`
   * envelope), and two were new (`BROWSER_ORIGIN`, `WRONG_CONTENT_TYPE`). A corpus that
   * listed messages without naming them would let a new refusal ship unaudited, so the
   * names are the assertion: adding a ninth constant fails the count until somebody
   * adds it here and reads what it says.
   *
   * ⚠️ the eighth arrived this way, and the mechanism worked exactly as designed.
   * `BODY_TOO_LARGE` is the one sentence the post-sprint audit added: the size gate in
   * `server.ts` needed an answer, and reusing `MALFORMED_BODY` would have told an agent
   * its JSON was shaped wrong when what was wrong was the size, the same "different
   * mistakes, different next actions" argument that keeps `WRONG_CONTENT_TYPE` separate
   * from `MALFORMED_BODY`. Adding it here is not a loosening of this row; it is the
   * row's own extension point, used deliberately and with the sentence read.
   */
  test("WIRE-R8 — every refusal this surface can produce is plain English with no product vocabulary", () => {
    const overLimit = listOpenFixesInputSchema.safeParse({ limit: 999 });
    expect(overLimit.success).toBe(false);

    const corpus: Readonly<Record<string, string>> = {
      UNAUTHENTICATED: UNAUTHENTICATED.message,
      NOT_FOUND: NOT_FOUND.message,
      UNAVAILABLE: UNAVAILABLE.message,
      BROWSER_ORIGIN: BROWSER_ORIGIN.message,
      WRONG_CONTENT_TYPE: WRONG_CONTENT_TYPE.message,
      WRONG_METHOD: WRONG_METHOD.message,
      BODY_TOO_LARGE: BODY_TOO_LARGE.message,
      MALFORMED_BODY: MALFORMED_BODY.message,
    };

    // All eight, by name. A ninth frozen refusal added to `refusals.ts` and not added
    // here fails this line rather than shipping unread.
    expect(Object.keys(corpus).toSorted()).toEqual([
      "BODY_TOO_LARGE",
      "BROWSER_ORIGIN",
      "MALFORMED_BODY",
      "NOT_FOUND",
      "UNAUTHENTICATED",
      "UNAVAILABLE",
      "WRONG_CONTENT_TYPE",
      "WRONG_METHOD",
    ]);

    // The two refusals built by a function rather than frozen as a constant are audited
    // too. They are just as customer-facing.
    const messages = [
      ...Object.values(corpus),
      unknownTool('There is no tool called "x" here.').message,
      overLimit.success
        ? ""
        : malformedInput(MCP_TOOL.LIST_OPEN_FIXES, overLimit.error.issues).message,
    ];

    // Non-vacuity: the corpus is real before anything is claimed about it.
    expect(messages).toHaveLength(10);
    expect(messages.every((message) => message.length > 0)).toBe(true);
    for (const message of messages) {
      for (const jargon of FORBIDDEN_PRODUCT_JARGON) {
        expect(message.toLowerCase()).not.toContain(jargon);
      }
    }
  });

  /**
   * The two crown jewels, pinned against literals written into this file.
   *
   * Copied verbatim from `origin/main`. The point is not that the sentences are good.
   * It is that a reword becomes a failing test with the old text visible in the diff,
   * so the change is a decision somebody makes rather than one that happens. Both carry
   * the cross-tenant guarantee: `NOT_FOUND` is the same answer for a foreign id and a
   * nonexistent one, and `UNAUTHENTICATED` is the same answer for all six credential
   * failures.
   *
   * Frozen is asserted too, because a constant that can be mutated at runtime is a
   * constant only by convention.
   */
  test("WIRE-R9 — the two refusals that carry the cross-tenant guarantee are byte-identical to the ones on main", () => {
    expect(UNAUTHENTICATED.message).toBe(
      "This request did not arrive with a key this server reads, so nothing was looked at. " +
        "The key a website sends its activity with is not the same key a coding agent reads with — " +
        "ask whoever runs this product for one made for coding agents.",
    );

    expect(NOT_FOUND.message).toBe(
      "There is nothing here with that id. Call list_open_fixes to see the ids you can ask about.",
    );

    expect(Object.isFrozen(UNAUTHENTICATED)).toBe(true);
    expect(Object.isFrozen(NOT_FOUND)).toBe(true);
  });
});

// The absent store

describe("an installation with nowhere to record a fix answers truthfully", () => {
  test("WIRE-R11 — list_open_fixes answers a well-formed empty list rather than crashing or inventing a row", async () => {
    const print = await callPrint(absentDeps(), MCP_TOOL.LIST_OPEN_FIXES, {});

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const result = resultOf(print);
    expect(result.isError).toBeUndefined();

    // ⚠️ read from `structuredContent`, and that is load-bearing. A tool that
    // advertises an output schema and answers without schema-valid structured content
    // is rejected by a real client that has listed first. Measured, `ProtocolError
    // -32600`. The server does not enforce it, so this row is where a handler-level
    // test can see the value at all.
    const structured = result.structuredContent;
    expect(isRecord(structured)).toBe(true);
    expect(structured).toEqual({
      fixes: [],
      window: { returned: 0, totalOpen: 0, truncated: false },
    });

    // And the answer really satisfies the contract, not merely this assertion.
    expect(() => listOpenFixesOutputSchema.parse(structured)).not.toThrow();
  });

  test("WIRE-R12 — get_fix and get_finding answer exactly as they answer an id that does not exist", async () => {
    const deps = absentDeps();

    const fix = await callPrint(deps, MCP_TOOL.GET_FIX, { fixId: "fix-mcproute-anything" });
    const finding = await callPrint(deps, MCP_TOOL.GET_FINDING, {
      findingId: "finding-mcproute-anything",
    });

    // The band before the identity: two answers that were both the wrong kind of answer
    // compare equal to each other all day.
    expect(fix.status).toBe(200);
    expect(fix.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(fix).toEqual(finding);

    expect(resultOf(fix).isError).toBe(true);
    expect(toolTextOf(fix)).toBe(NOT_FOUND.message);
  });

  test("WIRE-R13 — the absence is said out loud rather than swallowed", async () => {
    const lines: string[] = [];
    const deps = absentDeps((message) => lines.push(message));

    await call(deps, MCP_TOOL.LIST_OPEN_FIXES, {});
    await call(deps, MCP_TOOL.LIST_OPEN_FIXES, {});

    // Said, and said once per process. A line per request would drown the log it is
    // supposed to be findable in.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("mcp");
  });
});

// Answering from a store

describe("what a tool answers when there is something to answer with", () => {
  test("WIRE-R14 — get_fix carries the sentences the renderer produced, joined, and nothing it composed itself", async () => {
    const record = fixRecordFor({
      fixId: "fix-mcproute-1",
      findingId: "finding-mcproute-1",
      resultsBy: "2026-07-01T00:00:00.000Z",
    });
    const reads = fakeReadPort({ fixes: [{ organizationId: ORG_A, record }] });

    const print = await callPrint(depsWith(reads.port), MCP_TOOL.GET_FIX, { fixId: record.fixId });

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const envelope = fixSpecEnvelopeSchema.parse(resultOf(print).structuredContent);

    expect(envelope.specText).toBe(renderFixSpec(record.spec).sentences.join("\n"));
    expect(envelope.fixId).toBe(record.fixId);
    expect(envelope.findingId).toBe(record.findingId);
    // The two contract constants are the surface's to state, never the store's.
    expect(envelope.attemptsAllowed).toBe(3);
    expect(envelope.dateIsFinal).toBe(true);
    // The product decision, visible on the wire: a spec describes, it does not patch.
    expect(envelope.specText).not.toContain("```");
    expect(envelope.specText).not.toContain("@@");
  });

  test("WIRE-R15 — open fixes come back soonest results date first and say when the list was cut short", async () => {
    const rows = [
      { fixId: "fix-mcproute-late", resultsBy: "2026-09-01T00:00:00.000Z" },
      { fixId: "fix-mcproute-soon", resultsBy: "2026-07-01T00:00:00.000Z" },
      { fixId: "fix-mcproute-mid", resultsBy: "2026-08-01T00:00:00.000Z" },
    ];
    const reads = fakeReadPort({
      openFixes: rows.map((row) => ({
        organizationId: ORG_A,
        projectId: PROJECT_A,
        row: openFixRowFor({
          fixId: row.fixId,
          findingId: `finding-${row.fixId}`,
          resultsBy: row.resultsBy,
        }),
      })),
    });

    const print = await callPrint(depsWith(reads.port), MCP_TOOL.LIST_OPEN_FIXES, { limit: 2 });

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const parsed = listOpenFixesOutputSchema.parse(resultOf(print).structuredContent);

    expect(parsed.fixes.map((fix) => fix.fixId)).toEqual(["fix-mcproute-soon", "fix-mcproute-mid"]);
    expect(parsed.window).toEqual({ returned: 2, totalOpen: 3, truncated: true });
  });

  /**
   * The behavioural twin of `WIRE-J2`'s io-input assertion, and `WIRE-E3` confirms the
   * same thing through a real client.
   *
   * `limit` is declared `.default` with no `.optional`, so an output-side
   * rendering of the schema would advertise it as required and a strict client would
   * refuse the zero-argument call an agent makes first. This row is the server-side
   * half of that proof: the call is legal and the port is reached exactly once.
   *
   * The request carries NO `arguments` key at all (not `arguments: {}`) which is what a
   * client that has nothing to send actually puts on the wire, and a different code
   * path from an empty object.
   */
  test("WIRE-R16 — a zero-argument list call is already bounded and needs no ceiling from the caller", async () => {
    const reads = fakeReadPort({});

    const print = await fingerprint(
      await handleMcpRequest(
        rpcRequest({
          method: "tools/call",
          params: { name: MCP_TOOL.LIST_OPEN_FIXES },
          key: KEY_A,
        }),
        depsWith(reads.port),
      ),
    );

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(reads.organizationsAsked).toEqual([ORG_A]);
  });

  test("WIRE-R17 — a finding record satisfies the very schema the get_finding descriptor advertises", () => {
    // The drift pin for `FindingRecord`, which `apps/web` has to state itself because
    // the shared barrel does not export `getFindingOutputSchema`. A field the contract
    // adds, renames or tightens fails here.
    const descriptor = MCP_TOOLS.find((tool) => tool.name === MCP_TOOL.GET_FINDING);
    expect(descriptor).toBeDefined();
    expect(() =>
      descriptor?.outputSchema.parse(
        findingRecordFor({ findingId: "finding-mcproute-2", fixId: null }),
      ),
    ).not.toThrow();
  });
});

// Read-only, and the contract it validates against

describe("this surface reads and does nothing else", () => {
  /**
   * ⚠️ the `toEqual` is deliberate and survives this sprint unchanged. adds NO export
   * to the composition root: the SDK handler is constructed inside `wire.ts`,
   * `handleMcpRequest` keeps its signature, and research OQ-6 closes with "nothing new
   * is exported". An exact-equality assertion is what makes that a decision rather than
   * a hope. A fifth export fails here, loudly, on the day it is added.
   */
  test("WIRE-R18 — the route mounts no method that could write", () => {
    const exported = Object.keys(mcpRoute).toSorted();
    expect(exported).toEqual(["GET", "POST", "dynamic", "resolveMcpDeps"]);
    for (const verb of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(exported).not.toContain(verb);
    }
  });

  test("WIRE-R19 — every tool this surface exposes is a read, and the write tool is absent", () => {
    expect(MCP_TOOLS).toHaveLength(3);
    expect(MCP_TOOLS.every((tool) => tool.readOnlyHint)).toBe(true);
    expect(MCP_TOOLS.map((tool) => tool.name)).not.toContain("report_shipped");
  });

  /**
   * The catalogue, after it moved onto the wire protocol.
   *
   * Four fields per tool, because those four are what a client's tool picker and a
   * model's decision to call actually consume: the name it invokes, the title a person
   * reads, the description a model reads, and the input schema its own parser compiles.
   * `annotations.readOnlyHint` is the fifth and it is the read-only promise arriving
   * where a client can see it. Asserted here rather than only on our descriptors,
   * because a promise that never reaches the wire is not a promise.
   */
  test("WIRE-R20 — tools/list answers with the three tools and requires a credential like everything else", async () => {
    const anonymous = await fingerprint(
      await handleMcpRequest(rpcRequest({ method: "tools/list" }), absentDeps()),
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(anonymous.body).toContain(UNAUTHENTICATED.message);

    const print = await fingerprint(
      await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), absentDeps()),
    );
    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const tools = resultOf(print).tools;
    if (!Array.isArray(tools)) {
      throw new Error(`mcproute: tools/list carried no tools array. Body: ${print.body}`);
    }
    expect(tools).toHaveLength(3);

    const advertised = new Map<string, Record<string, unknown>>();
    for (const entry of tools) {
      if (!isRecord(entry) || typeof entry.name !== "string") {
        throw new Error(`mcproute: a tools/list entry carried no name. Body: ${print.body}`);
      }
      advertised.set(entry.name, entry);
    }

    for (const descriptor of MCP_TOOLS) {
      const entry = advertised.get(descriptor.name);
      if (entry === undefined) {
        throw new Error(`mcproute: tools/list omitted ${descriptor.name}`);
      }
      expect(entry.title).toBe(descriptor.title);
      expect(entry.description).toBe(descriptor.description);
      expect(isRecord(entry.inputSchema)).toBe(true);

      const annotations = entry.annotations;
      if (!isRecord(annotations)) {
        throw new Error(`mcproute: ${descriptor.name} advertised no annotations`);
      }
      expect(annotations.readOnlyHint).toBe(true);
    }
  });

  test("WIRE-R21 — each tool's arguments are parsed by the very schema its descriptor advertises", () => {
    // The handler switches on a name and then reaches for a schema by import. These
    // identities are what stop it validating against something a client was never
    // shown.
    const byName = new Map(MCP_TOOLS.map((tool) => [tool.name, tool.inputSchema]));
    expect(byName.get(MCP_TOOL.LIST_OPEN_FIXES)).toBe(listOpenFixesInputSchema);
    expect(byName.get(MCP_TOOL.GET_FIX)).toBe(getFixInputSchema);
    expect(byName.get(MCP_TOOL.GET_FINDING)).toBe(getFindingInputSchema);
  });

  test("WIRE-R21 — and each tool's ANSWER is parsed by the very output schema its descriptor advertises", () => {
    /**
     * The half this row was missing (post-sprint audit). The identity above is pinned
     * for inputs only, and the two imported output schemas were exactly as free to
     * drift: `call-tool.ts` parses a `get_fix` answer with `fixSpecEnvelopeSchema` and
     * a `list_open_fixes` answer with `listOpenFixesOutputSchema`, both imported by
     * name rather than taken off the descriptor. If either import stopped being the
     * object the descriptor advertises, the server would happily serve an answer no
     * client could validate. Invisible server-side, and rejected client-side as
     * `ProtocolError -32600`, which is the one defect class in this sprint that would
     * have reached a customer's coding agent.
     *
     * `get_finding` is absent by necessity rather than by oversight and that is not a
     * gap: `@growthmind/shared`'s barrel does not re-export `getFindingOutputSchema`,
     * so `call-tool.ts` reaches it through the descriptor itself
     * (`requireTool.outputSchema`). The identity holds by construction there, with
     * no second reference to pin it against.
     */
    const byName = new Map(MCP_TOOLS.map((tool) => [tool.name, tool.outputSchema]));
    expect(byName.get(MCP_TOOL.LIST_OPEN_FIXES)).toBe(listOpenFixesOutputSchema);
    expect(byName.get(MCP_TOOL.GET_FIX)).toBe(fixSpecEnvelopeSchema);

    // Non-vacuity: all three descriptors really do carry an output schema, so the two
    // identities above are not being asserted about `undefined`.
    for (const tool of MCP_TOOLS) {
      expect(byName.get(tool.name)).toBeDefined();
    }
  });

  /**
   * The anonymous oracle, closed, and now also proving the parser was never reached
   * (rule 1).
   *
   * The syntactically invalid body is the load-bearing case. A surface that parsed
   * before it authenticated would answer it with a `-32700` and answer the well-formed
   * one with a 401, two different answers, and therefore an oracle an anonymous caller
   * can use to learn whether its payload shape was right. Byte-identity between the two
   * is the proof that authentication runs on the raw `Request`, in front of the
   * envelope, exactly as `WIRE-O1` asserts from the other side.
   */
  test("WIRE-R22 — an anonymous caller learns nothing except that it is anonymous", async () => {
    const deps = absentDeps();
    const answers = await Promise.all(
      [
        toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES }),
        toolCallRequest({ tool: "no_such_tool" }),
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: 42 } }),
        rpcRequest({ method: "tools/list" }),
        rawBodyRequest('{"jsonrpc":"2.0","id":1,"method":', null),
        rawBodyRequest("not json at all", null),
      ].map(async (request) => fingerprint(await handleMcpRequest(request, deps))),
    );

    const [first] = answers;
    // Pre-sdk 401 band, asserted before the comparison. Six identical wrong answers
    // would satisfy the loop below without proving anything.
    expect(first?.status).toBe(401);
    expect(first?.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(first?.body).toContain(UNAUTHENTICATED.message);

    for (const answer of answers) {
      expect(answer).toEqual(first);
    }

    // And the parser really was never reached: not one of the six carries a parse
    // error, though two of them are unparseable.
    for (const answer of answers) {
      expect(answer.body).not.toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.PARSE_ERROR));
    }
  });
});
