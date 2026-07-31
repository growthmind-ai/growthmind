// The read-only machine surface's behaviour, driven through its real entry
// point (O-009).
//
// Every test here calls `handleMcpRequest` with a real `Request` and asserts on
// a real `Response`. The cross-tenant identity proof lives in
// `./cross-tenant.test.ts` and the credential decision in `./credentials.test.ts`;
// this file covers the rest of the surface — what it refuses, what it answers
// when there is nothing to answer with, and the read-only shape itself.
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
  MALFORMED_BODY,
  NOT_FOUND,
  UNAUTHENTICATED,
  UNAVAILABLE,
  WRONG_METHOD,
  malformedInput,
} from "../../lib/mcp/refusals";
import { createAbsentReadPort, type McpReadPort } from "../../lib/mcp/read-port";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  findingRecordFor,
  fixRecordFor,
  openFixRowFor,
  rawBodyRequest,
  toolCallRequest,
  KEY_A,
  ORG_A,
} from "./helpers/mcp-fixture";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });
const PROJECT_A = "project-mcproute";

function depsWith(reads: McpReadPort): McpServerDeps {
  return { credentials: CREDENTIALS, reads };
}

/** The composition this branch actually ships: a real credential gate over an
 * absent store. */
function absentDeps(log: (message: string) => void = () => undefined): McpServerDeps {
  return depsWith(createAbsentReadPort(log));
}

async function call(deps: McpServerDeps, tool: string, input?: unknown): Promise<Response> {
  return handleMcpRequest(toolCallRequest({ tool, input, key: KEY_A }), deps);
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("mcproute: response body was not an object");
  }
  return { ...parsed };
}

function messageOf(body: Record<string, unknown>): string {
  const error = body.error;
  if (typeof error !== "object" || error === null || !("message" in error)) {
    throw new Error("mcproute: response carried no error message");
  }
  const message = error.message;
  return typeof message === "string" ? message : "";
}

// ---------------------------------------------------------------------------
// Refusals that instruct
// ---------------------------------------------------------------------------

describe("what the surface refuses, and how it says so", () => {
  test("an unknown tool name is refused with the names that exist, never with a server error", async () => {
    const response = await call(absentDeps(), "delete_everything", {});
    const body = await bodyOf(response);

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    // The message is `resolveMcpTool`'s own — it lists the tools and says which
    // one to start from, so the agent can carry on rather than stop.
    const message = messageOf(body);
    for (const tool of [MCP_TOOL.LIST_OPEN_FIXES, MCP_TOOL.GET_FIX, MCP_TOOL.GET_FINDING]) {
      expect(message).toContain(tool);
    }
  });

  test("a body that is not JSON is refused in plain English with no stack trace", async () => {
    const response = await handleMcpRequest(
      rawBodyRequest("this is not json {{{", KEY_A),
      absentDeps(),
    );
    const body = await bodyOf(response);

    expect(response.status).toBe(400);
    const message = messageOf(body);
    expect(message).toBe(MALFORMED_BODY.message);
    expect(message).not.toContain("SyntaxError");
    // No stack frame: nothing of the form `file.ts:12:5`, and no `stack` key
    // anywhere in the body.
    expect(message).not.toMatch(/:\d+:\d+/);
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  test("a body with no tool name is refused rather than guessed at", async () => {
    const response = await handleMcpRequest(
      rawBodyRequest(JSON.stringify({ input: {} }), KEY_A),
      absentDeps(),
    );
    expect(response.status).toBe(400);
    expect(messageOf(await bodyOf(response))).toBe(MALFORMED_BODY.message);
  });

  test("a limit above the ceiling is refused, never quietly capped", async () => {
    const response = await call(absentDeps(), MCP_TOOL.LIST_OPEN_FIXES, {
      limit: LIST_OPEN_FIXES_MAX_ITEMS + 1,
    });
    const body = await bodyOf(response);

    expect(response.status).toBe(400);
    expect(messageOf(body)).toContain("limit");
    // Refused, not answered: a capped answer would let an agent believe it had
    // asked for more and received it.
    expect(body.ok).toBe(false);
  });

  test("a limit below one is refused too — the ceiling is bounded on both sides", async () => {
    const response = await call(absentDeps(), MCP_TOOL.LIST_OPEN_FIXES, { limit: 0 });
    expect(response.status).toBe(400);
  });

  test("a tool argument of the wrong shape is refused with the field named, never a 500", async () => {
    const response = await call(absentDeps(), MCP_TOOL.GET_FIX, { fixId: 42 });
    const body = await bodyOf(response);

    expect(response.status).toBe(400);
    expect(messageOf(body)).toContain("fixId");
  });

  test("a method other than GET or POST is refused as a read-only surface", async () => {
    const response = await handleMcpRequest(
      new Request("http://localhost:3000/api/mcp", {
        method: "DELETE",
        headers: { authorization: `Bearer ${KEY_A}` },
      }),
      absentDeps(),
    );
    expect(response.status).toBe(405);
    expect(messageOf(await bodyOf(response))).toBe(WRONG_METHOD.message);
  });

  test("every refusal this surface can produce is plain English with no product vocabulary", () => {
    const overLimit = listOpenFixesInputSchema.safeParse({ limit: 999 });
    expect(overLimit.success).toBe(false);

    const messages = [
      UNAUTHENTICATED.message,
      NOT_FOUND.message,
      UNAVAILABLE.message,
      WRONG_METHOD.message,
      MALFORMED_BODY.message,
      overLimit.success
        ? ""
        : malformedInput(MCP_TOOL.LIST_OPEN_FIXES, overLimit.error.issues).message,
    ];

    // Non-vacuity: the corpus is real before anything is claimed about it.
    expect(messages.every((message) => message.length > 0)).toBe(true);
    for (const message of messages) {
      for (const jargon of FORBIDDEN_PRODUCT_JARGON) {
        expect(message.toLowerCase()).not.toContain(jargon);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The absent store
// ---------------------------------------------------------------------------

describe("an installation with nowhere to record a fix answers truthfully", () => {
  test("list_open_fixes answers a well-formed empty list rather than crashing or inventing a row", async () => {
    const response = await call(absentDeps(), MCP_TOOL.LIST_OPEN_FIXES, {});
    const body = await bodyOf(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      tool: MCP_TOOL.LIST_OPEN_FIXES,
      result: { fixes: [], window: { returned: 0, totalOpen: 0, truncated: false } },
    });
    // And the answer really satisfies the contract, not merely this assertion.
    expect(() => listOpenFixesOutputSchema.parse(body.result)).not.toThrow();
  });

  test("get_fix and get_finding answer exactly as they answer an id that does not exist", async () => {
    const deps = absentDeps();

    const fix = await call(deps, MCP_TOOL.GET_FIX, { fixId: "fix-mcproute-anything" });
    const finding = await call(deps, MCP_TOOL.GET_FINDING, {
      findingId: "finding-mcproute-anything",
    });

    expect(await fingerprint(fix)).toEqual(await fingerprint(finding));
    expect(fix.status).toBe(404);
    expect(messageOf(await bodyOf(await call(deps, MCP_TOOL.GET_FIX, { fixId: "x" })))).toBe(
      NOT_FOUND.message,
    );
  });

  test("the absence is said out loud rather than swallowed", async () => {
    const lines: string[] = [];
    const deps = absentDeps((message) => lines.push(message));

    await call(deps, MCP_TOOL.LIST_OPEN_FIXES, {});
    await call(deps, MCP_TOOL.LIST_OPEN_FIXES, {});

    // Said, and said ONCE per process — a line per request would drown the log
    // it is supposed to be findable in.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("mcp");
  });
});

// ---------------------------------------------------------------------------
// Answering from a store
// ---------------------------------------------------------------------------

describe("what a tool answers when there is something to answer with", () => {
  test("get_fix carries the sentences the renderer produced, joined, and nothing it composed itself", async () => {
    const record = fixRecordFor({
      fixId: "fix-mcproute-1",
      findingId: "finding-mcproute-1",
      resultsBy: "2026-07-01T00:00:00.000Z",
    });
    const reads = fakeReadPort({ fixes: [{ organizationId: ORG_A, record }] });

    const response = await call(depsWith(reads.port), MCP_TOOL.GET_FIX, { fixId: record.fixId });
    const body = await bodyOf(response);
    const envelope = fixSpecEnvelopeSchema.parse(body.result);

    expect(envelope.specText).toBe(renderFixSpec(record.spec).sentences.join("\n"));
    expect(envelope.fixId).toBe(record.fixId);
    expect(envelope.findingId).toBe(record.findingId);
    // The two contract constants are the surface's to state, never the store's.
    expect(envelope.attemptsAllowed).toBe(3);
    expect(envelope.dateIsFinal).toBe(true);
    // The product decision, visible on the wire: a spec describes, it does not
    // patch.
    expect(envelope.specText).not.toContain("```");
    expect(envelope.specText).not.toContain("@@");
  });

  test("open fixes come back soonest results date first and say when the list was cut short", async () => {
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

    const response = await call(depsWith(reads.port), MCP_TOOL.LIST_OPEN_FIXES, { limit: 2 });
    const parsed = listOpenFixesOutputSchema.parse((await bodyOf(response)).result);

    expect(parsed.fixes.map((fix) => fix.fixId)).toEqual(["fix-mcproute-soon", "fix-mcproute-mid"]);
    expect(parsed.window).toEqual({ returned: 2, totalOpen: 3, truncated: true });
  });

  test("a zero-argument list call is already bounded and needs no ceiling from the caller", async () => {
    const reads = fakeReadPort({});
    await handleMcpRequest(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY_A}`, "content-type": "application/json" },
        body: JSON.stringify({ tool: MCP_TOOL.LIST_OPEN_FIXES }),
      }),
      depsWith(reads.port),
    );
    expect(reads.organizationsAsked).toHaveLength(1);
  });

  test("a finding record satisfies the very schema the get_finding descriptor advertises", () => {
    // The drift pin for `FindingRecord`, which `apps/web` has to state itself
    // because the shared barrel does not export `getFindingOutputSchema`. A
    // field the contract adds, renames or tightens fails HERE.
    const descriptor = MCP_TOOLS.find((tool) => tool.name === MCP_TOOL.GET_FINDING);
    expect(descriptor).toBeDefined();
    expect(() =>
      descriptor?.outputSchema.parse(
        findingRecordFor({ findingId: "finding-mcproute-2", fixId: null }),
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Read-only, and the contract it validates against
// ---------------------------------------------------------------------------

describe("this surface reads and does nothing else", () => {
  test("the route mounts no method that could write", () => {
    const exported = Object.keys(mcpRoute).toSorted();
    expect(exported).toEqual(["GET", "POST", "dynamic", "resolveMcpDeps"]);
    for (const verb of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(exported).not.toContain(verb);
    }
  });

  test("every tool this surface exposes is a read, and the write tool is absent", () => {
    expect(MCP_TOOLS).toHaveLength(3);
    expect(MCP_TOOLS.every((tool) => tool.readOnlyHint)).toBe(true);
    expect(MCP_TOOLS.map((tool) => tool.name)).not.toContain("report_shipped");
  });

  test("the catalogue answers with the three tools and requires a credential like everything else", async () => {
    const anonymous = await handleMcpRequest(
      new Request("http://localhost:3000/api/mcp", { method: "GET" }),
      absentDeps(),
    );
    expect(anonymous.status).toBe(401);

    const response = await handleMcpRequest(
      new Request("http://localhost:3000/api/mcp", {
        method: "GET",
        headers: { authorization: `Bearer ${KEY_A}` },
      }),
      absentDeps(),
    );
    const body = await bodyOf(response);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      tools: [
        { name: MCP_TOOL.LIST_OPEN_FIXES, readOnlyHint: true },
        { name: MCP_TOOL.GET_FIX, readOnlyHint: true },
        { name: MCP_TOOL.GET_FINDING, readOnlyHint: true },
      ],
    });
  });

  test("each tool's arguments are parsed by the very schema its descriptor advertises", () => {
    // The handler switches on a name and then reaches for a schema by import.
    // These identities are what stop it validating against something a client
    // was never shown.
    const byName = new Map(MCP_TOOLS.map((tool) => [tool.name, tool.inputSchema]));
    expect(byName.get(MCP_TOOL.LIST_OPEN_FIXES)).toBe(listOpenFixesInputSchema);
    expect(byName.get(MCP_TOOL.GET_FIX)).toBe(getFixInputSchema);
    expect(byName.get(MCP_TOOL.GET_FINDING)).toBe(getFindingInputSchema);
  });

  test("an anonymous caller learns nothing except that it is anonymous", async () => {
    const deps = absentDeps();
    const answers = await Promise.all(
      [
        toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES }),
        toolCallRequest({ tool: "no_such_tool" }),
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: 42 } }),
        rawBodyRequestWithoutKey("not json at all"),
      ].map(async (request) => fingerprint(await handleMcpRequest(request, deps))),
    );

    const [first] = answers;
    for (const answer of answers) {
      expect(answer).toEqual(first);
    }
    expect(first?.status).toBe(401);
  });
});

/** A malformed body with no credential — the probe an anonymous caller would
 * use to find out whether its payload shape was right. */
function rawBodyRequestWithoutKey(body: string): Request {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}
