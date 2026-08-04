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

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";
const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

function depsWith(reads: McpReadPort): McpServerDeps {
  return { credentials: CREDENTIALS, reads };
}

function absentDeps(log: (message: string) => void = () => undefined): McpServerDeps {
  return depsWith(createAbsentReadPort(log));
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frameOf(print: ResponseFingerprint): Record<string, unknown> {
  const parsed: unknown = JSON.parse(sseDataLine(print.body));
  if (!isRecord(parsed)) {
    throw new Error("mcproute: the SSE frame did not carry a JSON-RPC object");
  }
  return parsed;
}

function resultOf(print: ResponseFingerprint): Record<string, unknown> {
  const result = frameOf(print).result;
  if (!isRecord(result)) {
    throw new Error(`mcproute: the frame carried no JSON-RPC result. Body: ${print.body}`);
  }
  return result;
}

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

function errorCodeMarker(code: number): string {
  return `"code":${code}`;
}

describe("what the surface refuses, and how it says so", () => {
  test("WIRE-R1 — an unknown tool name is refused with the names that exist, never with a server error", async () => {
    const print = await callPrint(absentDeps(), "delete_everything", {});

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(resultOf(print).isError).toBe(true);

    const text = toolTextOf(print);
    for (const tool of [MCP_TOOL.LIST_OPEN_FIXES, MCP_TOOL.GET_FIX, MCP_TOOL.GET_FINDING]) {
      expect(text).toContain(tool);
    }

    expect(print.body).not.toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.INVALID_PARAMS));
  });

  test("WIRE-R2 — a body that is not JSON is refused as a parse error in plain English with no stack trace", async () => {
    const print = await fingerprint(
      await handleMcpRequest(rawBodyRequest("this is not json {{{", KEY_A), absentDeps()),
    );

    expect(print.body).toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.PARSE_ERROR));
    expect(print.status).toBeLessThan(500);

    expect(carriesStackFrame(print.body)).toBe(false);
    expect(carriesFilePath(print.body)).toBe(false);
    expect(print.body).not.toContain("SyntaxError");
    expect(print.body).not.toContain("stack");
  });

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

    const print = await fingerprint(
      await handleMcpRequest(
        rpcRequest({ method: "tools/call", params: { arguments: {} }, key: KEY_A }),
        deps,
      ),
    );

    expect(print.status).toBeLessThan(500);
    expect(print.body).toContain('"jsonrpc":"2.0"');

    expect(spy.organizationsAsked).toEqual([]);
  });

  test("WIRE-R4 — a limit above the ceiling is refused, never quietly capped", async () => {
    const atBoundary = await callPrint(absentDeps(), MCP_TOOL.LIST_OPEN_FIXES, {
      limit: LIST_OPEN_FIXES_MAX_ITEMS + 1,
    });
    expect(atBoundary.status).toBe(200);
    expect(atBoundary.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(resultOf(atBoundary).isError).toBe(true);
    expect(toolTextOf(atBoundary)).toContain("limit");

    const farAbove = await callPrint(absentDeps(), MCP_TOOL.LIST_OPEN_FIXES, { limit: 987654 });
    expect(resultOf(farAbove).isError).toBe(true);
    expect(toolTextOf(farAbove)).toContain("limit");

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

    expect(print.body).not.toContain("424242");
  });

  test("WIRE-R7 — every method other than POST is refused, including GET", async () => {
    for (const method of ["GET", "DELETE"]) {
      const print = await fingerprint(
        await handleMcpRequest(verbRequest({ method, key: KEY_A }), absentDeps()),
      );

      expect(`${method}: ${print.status}`).toBe(`${method}: 405`);
      expect(`${method}: ${print.contentType}`).toBe(`${method}: ${PRE_SDK_CONTENT_TYPE}`);
      expect(print.body).toContain(WRONG_METHOD.message);
    }

    const exported = Object.keys(mcpRoute);
    for (const verb of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(exported).not.toContain(verb);
    }
  });

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

    const messages = [
      ...Object.values(corpus),
      unknownTool('There is no tool called "x" here.').message,
      overLimit.success
        ? ""
        : malformedInput(MCP_TOOL.LIST_OPEN_FIXES, overLimit.error.issues).message,
    ];

    expect(messages).toHaveLength(10);
    expect(messages.every((message) => message.length > 0)).toBe(true);
    for (const message of messages) {
      for (const jargon of FORBIDDEN_PRODUCT_JARGON) {
        expect(message.toLowerCase()).not.toContain(jargon);
      }
    }
  });

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

describe("an installation with nowhere to record a fix answers truthfully", () => {
  test("WIRE-R11 — list_open_fixes answers a well-formed empty list rather than crashing or inventing a row", async () => {
    const print = await callPrint(absentDeps(), MCP_TOOL.LIST_OPEN_FIXES, {});

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const result = resultOf(print);
    expect(result.isError).toBeUndefined();

    const structured = result.structuredContent;
    expect(isRecord(structured)).toBe(true);
    expect(structured).toEqual({
      fixes: [],
      window: { returned: 0, totalOpen: 0, truncated: false },
    });

    expect(() => listOpenFixesOutputSchema.parse(structured)).not.toThrow();
  });

  test("WIRE-R12 — get_fix and get_finding answer exactly as they answer an id that does not exist", async () => {
    const deps = absentDeps();

    const fix = await callPrint(deps, MCP_TOOL.GET_FIX, { fixId: "fix-mcproute-anything" });
    const finding = await callPrint(deps, MCP_TOOL.GET_FINDING, {
      findingId: "finding-mcproute-anything",
    });

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

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("mcp");
  });
});

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

    expect(envelope.attemptsAllowed).toBe(3);
    expect(envelope.dateIsFinal).toBe(true);

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
    const descriptor = MCP_TOOLS.find((tool) => tool.name === MCP_TOOL.GET_FINDING);
    expect(descriptor).toBeDefined();
    expect(() =>
      descriptor?.outputSchema.parse(
        findingRecordFor({ findingId: "finding-mcproute-2", fixId: null }),
      ),
    ).not.toThrow();
  });
});

describe("this surface reads and does nothing else", () => {
  test("WIRE-R18 — the route mounts no method that could write", () => {
    const exported = Object.keys(mcpRoute).toSorted();
    expect(exported).toEqual(["GET", "POST", "dynamic", "resolveMcpDeps"]);
    for (const verb of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(exported).not.toContain(verb);
    }
  });

  test("WIRE-R19 — every tool this surface exposes is a read, and the write tool is absent", () => {
    expect(MCP_TOOLS).toHaveLength(4);
    expect(MCP_TOOLS.every((tool) => tool.readOnlyHint)).toBe(true);
    expect(MCP_TOOLS.map((tool) => tool.name)).not.toContain("report_shipped");
  });

  test("WIRE-R20 — tools/list answers with the four tools and requires a credential like everything else", async () => {
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
    expect(tools).toHaveLength(4);

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
    const byName = new Map(MCP_TOOLS.map((tool) => [tool.name, tool.inputSchema]));
    expect(byName.get(MCP_TOOL.LIST_OPEN_FIXES)).toBe(listOpenFixesInputSchema);
    expect(byName.get(MCP_TOOL.GET_FIX)).toBe(getFixInputSchema);
    expect(byName.get(MCP_TOOL.GET_FINDING)).toBe(getFindingInputSchema);
  });

  test("WIRE-R21 — and each tool's ANSWER is parsed by the very output schema its descriptor advertises", () => {
    const byName = new Map(MCP_TOOLS.map((tool) => [tool.name, tool.outputSchema]));
    expect(byName.get(MCP_TOOL.LIST_OPEN_FIXES)).toBe(listOpenFixesOutputSchema);
    expect(byName.get(MCP_TOOL.GET_FIX)).toBe(fixSpecEnvelopeSchema);

    for (const tool of MCP_TOOLS) {
      expect(byName.get(tool.name)).toBeDefined();
    }
  });

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

    expect(first?.status).toBe(401);
    expect(first?.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(first?.body).toContain(UNAUTHENTICATED.message);

    for (const answer of answers) {
      expect(answer).toEqual(first);
    }

    for (const answer of answers) {
      expect(answer.body).not.toContain(errorCodeMarker(JSON_RPC_ERROR_CODE.PARSE_ERROR));
    }
  });
});
