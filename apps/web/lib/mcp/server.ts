// THE READ-ONLY MACHINE SURFACE'S REQUEST HANDLER (O-009).
//
// A plain function over `Request` with its two effects injected, so the whole
// surface is driven end to end through its REAL entry point in tests, with
// fakes — the D11 discipline `worker/src/tasks/delivery-tick.ts` follows for
// the same reason. `../../app/api/mcp/route.ts` is the only queue of one line
// that knows about Next.js and about which implementations are wired in.
//
// ---------------------------------------------------------------------------
// THE ORDER OF OPERATIONS IS PART OF THE SECURITY ARGUMENT
// ---------------------------------------------------------------------------
//
//   1. AUTHENTICATE FIRST, before the body is read, before the tool name is
//      resolved, before anything is parsed. An unauthenticated caller must not
//      be able to learn which tool names exist, which arguments are valid, or
//      whether a payload was well formed — every one of those is a probe, and
//      the answers differ. So there is exactly one thing an anonymous caller
//      can find out: that it is not authenticated.
//
//   2. RESOLVE THE ORGANIZATION FROM THE CREDENTIAL, never from the body. It is
//      structurally impossible to do otherwise here: `McpCredential` is the
//      only place an organization id exists in this file, no tool input schema
//      has such a key, and the read port requires the field. There is no line
//      below where a body value could be substituted.
//
//   3. ONE READ, ONE `null` BRANCH. Each id-taking tool makes a single call
//      that carries the organization and the id together, and turns `null` into
//      one frozen refusal. This handler never learns whether the row was
//      missing or somebody else's, so it cannot say — which is the whole
//      obligation `packages/shared/src/mcp/types.ts` handed forward, and the
//      reason there is no existence check anywhere in this file.
//
//   4. PARSE EVERY OUTPUT before it goes out, through the schema that owns it.
//      A store's declared type is a claim about today's writes, not about
//      what is persisted (edge taxonomy D5); and the output schemas carry real
//      invariants — a count without its denominator, a window whose `truncated`
//      contradicts its own numbers, a first attempt with earlier work behind it
//      are all refused. A producer bug becomes a 500 with no detail in it,
//      never a wrong answer an agent acts on.
//
// ---------------------------------------------------------------------------
// READ-ONLY, STRUCTURALLY
// ---------------------------------------------------------------------------
//
// Nothing in this file writes. The switch below is exhaustive over
// `McpToolName`, so a fourth tool added to `@growthmind/shared` fails to
// compile here rather than arriving unhandled — and the only dependency this
// handler has that could write anything is `McpReadPort`, whose three methods
// are all reads. `report_shipped`, the draft contract's one write tool, is
// absent from the descriptor list and asserted absent by name in
// `packages/shared/__tests__/mcp/tools.test.ts`.
import { renderFixSpec } from "@growthmind/core";
import {
  FIX_ATTEMPT_CEILING,
  MCP_TOOL,
  MCP_TOOLS,
  fixSpecEnvelopeSchema,
  getFindingInputSchema,
  getFixInputSchema,
  listOpenFixesInputSchema,
  listOpenFixesOutputSchema,
  resolveMcpTool,
  type ListOpenFixesInput,
  type McpToolDescriptor,
  type McpToolName,
} from "@growthmind/shared";

import type { McpCredential, McpCredentialSource } from "./credentials";
import { presentedCredential } from "./credentials";
import type { McpReadPort, OpenFixRow } from "./read-port";
import {
  MALFORMED_BODY,
  NOT_FOUND,
  UNAUTHENTICATED,
  UNAVAILABLE,
  WRONG_METHOD,
  malformedInput,
  refusalResponse,
  unknownTool,
} from "./refusals";

/**
 * A tool's own descriptor, by name.
 *
 * `resolveMcpTool` already returns one for a name off the wire; this is the
 * lookup for the two schemas this file needs at module scope, and it THROWS at
 * import time if a name in the contract has no descriptor — a boot failure the
 * first request notices, rather than a `undefined.parse` on a live call.
 */
function requireTool(name: McpToolName): McpToolDescriptor {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`mcp: the contract names a tool "${name}" with no descriptor`);
  }
  return tool;
}

/**
 * `get_finding`'s output schema, taken from the DESCRIPTOR rather than imported
 * by name.
 *
 * `@growthmind/shared`'s barrel re-exports `listOpenFixesOutputSchema` and
 * `fixSpecEnvelopeSchema` but not `getFindingOutputSchema`, and the package
 * exposes no second entry point to reach it through. Reaching it via
 * `MCP_TOOLS` is not a workaround so much as the stricter route: the descriptor
 * is what a client is SHOWN, so parsing through it makes "what we validate" and
 * "what we advertise" the same object by construction. See `FindingRecord` in
 * `./read-port.ts` for the type side of the same gap.
 */
const GET_FINDING_OUTPUT_SCHEMA = requireTool(MCP_TOOL.GET_FINDING).outputSchema;

/** The two things this handler cannot construct for itself: who is asking, and
 * where the answers come from. Both are ports; neither names a table. */
export interface McpServerDeps {
  readonly credentials: McpCredentialSource;
  readonly reads: McpReadPort;
}

/**
 * The whole surface, in one function.
 *
 * `GET` lists the tools that exist; `POST` calls one. Both require a credential
 * — the catalogue is a static contract and leaks no customer data, but a
 * surface with two authentication rules has one rule somebody will get wrong,
 * and there is no client that needs the catalogue without also needing to call
 * something.
 */
export async function handleMcpRequest(request: Request, deps: McpServerDeps): Promise<Response> {
  const credential = await authenticate(request, deps.credentials);
  if (credential === null) {
    return refusalResponse(UNAUTHENTICATED);
  }

  if (request.method === "GET") {
    return catalogueResponse();
  }

  if (request.method !== "POST") {
    return refusalResponse(WRONG_METHOD);
  }

  const call = await readToolCall(request);
  if (call === null) {
    return refusalResponse(MALFORMED_BODY);
  }

  // An unknown name is REFUSED WITH INSTRUCTIONS and never thrown:
  // `resolveMcpTool` returns a result union whose message already names the
  // three tools and says which one to start from.
  const resolution = resolveMcpTool(call.tool);
  if (!resolution.ok) {
    return refusalResponse(unknownTool(resolution.message));
  }

  try {
    return await runTool(resolution.tool.name, call.input, deps.reads, credential);
  } catch (error) {
    // THE ONLY CATCH IN THE FILE, and it exists so that a fault in a read, in
    // the renderer, or in an output schema is a 500 with nothing in it rather
    // than an unhandled rejection with a stack trace on the wire. The detail
    // goes to the log, which is ours; the agent gets one sentence.
    console.error("mcp: a tool call could not be completed", {
      tool: resolution.tool.name,
      error,
    });
    return refusalResponse(UNAVAILABLE);
  }
}

/**
 * Who is asking, or nobody.
 *
 * FAIL CLOSED ON EVERY PATH, including a credential store that throws. A
 * database outage becoming "not authenticated" rather than "service
 * unavailable" is deliberate: an authentication path that degrades open is not
 * an authentication path, and the difference is visible in the log where it
 * belongs rather than on the wire where it is an oracle.
 */
async function authenticate(
  request: Request,
  credentials: McpCredentialSource,
): Promise<McpCredential | null> {
  const presented = presentedCredential(request);
  if (presented === null) {
    return null;
  }

  try {
    return await credentials.resolve(presented);
  } catch (error) {
    console.error("mcp: the presented key could not be checked, so it was refused", error);
    return null;
  }
}

/** What a call names and what it carries. `input` stays `unknown` until the
 * tool's own schema parses it — this envelope decides nothing about arguments. */
interface McpToolCall {
  readonly tool: string;
  readonly input: unknown;
}

/**
 * Reads the two envelope fields off an unknown JSON body.
 *
 * DELIBERATELY NOT A SCHEMA. `apps/web` does not depend on `zod` itself — it
 * reads the schemas `@growthmind/shared` exports, and a second copy of Zod in
 * this workspace would be a second set of internals for those schemas to fail
 * against. What is hand-checked here is the ENVELOPE only: is this an object,
 * and is `tool` a string. Every claim about arguments is made by the exported
 * schema that owns them, a few lines further down.
 */
async function readToolCall(request: Request): Promise<McpToolCall | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (!isRecord(body)) {
    return null;
  }

  const tool = body.tool;
  if (typeof tool !== "string") {
    return null;
  }

  // `undefined` becomes `{}` so the zero-argument call an agent makes first —
  // `list_open_fixes` with nothing at all — reaches the schema that supplies
  // its defaults, rather than being refused for sending nothing.
  return { tool, input: body.input ?? {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One tool call.
 *
 * EXHAUSTIVE OVER `McpToolName` WITH NO `default`, so a fourth tool added to
 * the contract is a `bun run typecheck` failure here rather than a name that
 * resolves and then does nothing. Each arm parses its input through the exact
 * schema `@growthmind/shared` exports AND the descriptor advertises — the two
 * are the same object, and `__tests__/mcp/route.test.ts` pins that identity so
 * this file cannot start validating against something a client was never shown.
 */
async function runTool(
  name: McpToolName,
  input: unknown,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<Response> {
  switch (name) {
    case MCP_TOOL.LIST_OPEN_FIXES: {
      const parsed = listOpenFixesInputSchema.safeParse(input);
      if (!parsed.success) {
        return refusalResponse(malformedInput(name, parsed.error.issues));
      }
      return listOpenFixes(parsed.data, reads, credential);
    }

    case MCP_TOOL.GET_FIX: {
      const parsed = getFixInputSchema.safeParse(input);
      if (!parsed.success) {
        return refusalResponse(malformedInput(name, parsed.error.issues));
      }
      return getFix(parsed.data.fixId, reads, credential);
    }

    case MCP_TOOL.GET_FINDING: {
      const parsed = getFindingInputSchema.safeParse(input);
      if (!parsed.success) {
        return refusalResponse(malformedInput(name, parsed.error.issues));
      }
      return getFinding(parsed.data.findingId, reads, credential);
    }
  }
}

/**
 * The most urgent slice of what is open, never everything.
 *
 * THE ORGANIZATION IS THE CREDENTIAL'S. A `projectId` argument narrows WITHIN
 * it; the port resolves that project inside the same organization, so a project
 * id belonging to somebody else narrows to nothing and this answers with an
 * empty list and a truthful window — the identical answer a project id that
 * never existed gets.
 *
 * SORTED HERE AS WELL AS IN THE PORT. Ordering is part of the contract
 * (`listOpenFixesOutputSchema`: soonest `resultsBy` first, so a truncated list
 * is the most urgent slice rather than an arbitrary one), and re-sorting 25
 * rows costs nothing while removing the whole class of bug where an
 * implementation forgets its `order by`. Ties break on `fixId` so two calls
 * against one store answer identically — an agent that re-reads a list must not
 * see a different order and conclude something moved. `toSorted` rather than
 * `sort`: the input is the port's array and is not ours to mutate.
 */
async function listOpenFixes(
  input: ListOpenFixesInput,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<Response> {
  const page = await reads.listOpenFixes({
    organizationId: credential.organizationId,
    projectId: input.projectId ?? null,
    limit: input.limit,
  });

  const chosen = page.fixes.toSorted(byUrgencyThenId).slice(0, input.limit);

  return okResponse(
    MCP_TOOL.LIST_OPEN_FIXES,
    listOpenFixesOutputSchema.parse({
      fixes: chosen.map(toSummary),
      window: {
        returned: chosen.length,
        totalOpen: page.totalOpen,
        // Asserted by the schema against the two numbers beside it, so a
        // producer that cut the list and forgot the flag fails to parse.
        truncated: chosen.length < page.totalOpen,
      },
    }),
  );
}

function byUrgencyThenId(left: OpenFixRow, right: OpenFixRow): number {
  const byDate = Date.parse(left.resultsBy) - Date.parse(right.resultsBy);
  if (byDate !== 0) {
    return byDate;
  }
  // Code-unit comparison, not `localeCompare`: the tie-break must be the same
  // on every machine, and a locale-aware collation is not.
  if (left.fixId < right.fixId) return -1;
  if (left.fixId > right.fixId) return 1;
  return 0;
}

/**
 * A stored row as a wire row. FIELD BY FIELD, never a spread — the same rule
 * `packages/db`'s `toMetadata` follows, so a column added to the store cannot
 * ride out to a coding agent because nobody updated a mapping.
 *
 * `status` is written here rather than copied: the wire literal is `"open"`,
 * and this list may only contain open work.
 */
function toSummary(row: OpenFixRow): Record<string, unknown> {
  return {
    fixId: row.fixId,
    findingId: row.findingId,
    summary: row.summary,
    impact: row.impact,
    openedAt: row.openedAt,
    resultsBy: row.resultsBy,
    status: "open",
  };
}

/**
 * One fix's instructions.
 *
 * THE JOIN THE CONTRACT NAMED HAPPENS HERE, in one line.
 * `packages/shared/src/mcp/types.ts` carries the spec as one opaque `specText`
 * because it may not import `@growthmind/core`; `renderFixSpec` produces the
 * sectioned `FixSpec`; `apps/web` may import both, so this is where
 * `sentences.join("\n")` belongs and the only place it exists.
 *
 * `renderFixSpec` REFUSES rather than degrades — an unnormalised page address,
 * a template that reads as code, a count that describes people all throw. That
 * throw reaches the one catch in this file and becomes a 500 with no detail:
 * a fix spec that cannot be rendered safely is one we do not serve, and it is
 * emphatically not a `NOT_FOUND`, which would tell an agent the work does not
 * exist.
 */
async function getFix(
  fixId: string,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<Response> {
  const record = await reads.getFix({ organizationId: credential.organizationId, fixId });
  if (record === null) {
    return refusalResponse(NOT_FOUND);
  }

  const spec = renderFixSpec(record.spec);

  return okResponse(
    MCP_TOOL.GET_FIX,
    fixSpecEnvelopeSchema.parse({
      fixId: record.fixId,
      findingId: record.findingId,
      status: record.status,
      specText: spec.sentences.join("\n"),
      attempt: record.attempt,
      // Contract constants, stated by the surface that owns the contract — a
      // store cannot get them wrong because a store is never asked.
      attemptsAllowed: FIX_ATTEMPT_CEILING,
      alreadyLanded: record.alreadyLanded,
      impact: record.impact,
      resultsBy: record.resultsBy,
      dateIsFinal: true,
    }),
  );
}

/** The evidence behind one problem. One read, one `null` branch, one answer. */
async function getFinding(
  findingId: string,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<Response> {
  const record = await reads.getFinding({
    organizationId: credential.organizationId,
    findingId,
  });
  if (record === null) {
    return refusalResponse(NOT_FOUND);
  }

  return okResponse(MCP_TOOL.GET_FINDING, GET_FINDING_OUTPUT_SCHEMA.parse(record));
}

/**
 * The tools that exist.
 *
 * Name, title, description and the read-only label — the four things a client's
 * tool picker and a model's decision to call need. The machine-readable input
 * schemas are deliberately not rendered here: turning them into JSON Schema
 * needs `zod` as a direct dependency of `apps/web`, and a second copy of Zod
 * beside the one `@growthmind/shared` builds its schemas with is a subtle
 * source of mismatches. When this surface moves to a `packages/mcp` that may
 * import Zod and core directly (the move `packages/shared/src/mcp/types.ts`
 * already names), that is where the schemas render.
 */
function catalogueResponse(): Response {
  return Response.json({
    ok: true,
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      readOnlyHint: tool.readOnlyHint,
    })),
  });
}

/** One producer of the success envelope, so every answer has the same shape and
 * every response carries the name of the tool that produced it. */
function okResponse(tool: McpToolName, result: unknown): Response {
  return Response.json({ ok: true, tool, result });
}
