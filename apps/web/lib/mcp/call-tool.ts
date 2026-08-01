// The tool core: Every decision this surface makes, and no transport.
//
// What this file may not name, and why that is the whole point
//
// The seam this sprint exists to cut is: the SDK renders, and it never decides. One
// half of that seam is enforced by a source scan. This file may not contain the
// transport package's name, nor any identifier a wire layer is built from. That is not
// a style rule. A file that can name the wire will eventually branch on it, and the day
// it does, the security argument written at the top of `./server.ts`. Authenticate
// first, take the organization from the credential and nowhere else, one read and one
// null branch, parse every output. Stops being readable in one place.
//
// So what arrives here is a tool name off the wire, an unparsed argument value, a read
// port and a credential. What leaves is a union. There is no envelope, no status, no
// framing, and nothing in between that a transport could change.
//
// The organization comes from the credential, structurally
//
// The credential is its own parameter, never a field on `input`. That is what makes "no
// argument off the wire can reach a read" a property of the signature rather than a
// promise in a comment: `input` is `unknown` until a tool's own schema parses it, no
// tool schema has an organization key, and the read port requires one, so the only
// value that can satisfy the port is the one that came from the key the caller
// presented.
//
// Four decisions, in this order, and none of them moved in the split
//
// 1. Resolve the name. An unknown name is refused with instructions and never
//  thrown: `resolveMcpTool` returns a result union whose message already
//  names the three tools and says which one to start from. That sentence is
//  ours — the layer above may frame it, never author it.
//
// 2. Parse the arguments through the exact schema `@growthmind/shared` exports
//  And the descriptor advertises. The two are the same object, so what
//  validates a call and what a caller was shown cannot drift apart.
//
// 3. One read, one `null` branch. Each id-taking tool makes a single call that
//  carries the organization and the id together, and turns `null` into one
//  frozen refusal. This file never learns whether the row was missing or
//  somebody else's, so it cannot say — the obligation
//  `packages/shared/src/mcp/types.ts` handed forward, and the reason there
//  is no existence check anywhere below.
//
// 4. Parse every output before it leaves, through the schema that owns it. A
//  store's declared type is a claim about today's writes, not about what is
//  persisted (edge taxonomy); and the output schemas carry real
//  invariants — a count without its denominator, a window whose `truncated`
//  contradicts its own numbers, a first attempt with earlier work behind it
//  are all refused. A producer bug becomes one detail-free refusal, never a
//  wrong answer an agent acts on.
//
// The one catch, and the one log
//
// A fault in a read, in the renderer or in an output schema is caught here and becomes
// `UNAVAILABLE`. This is the only place a tool fault is logged. The layer above keeps a
// catch of its own for a fault that escapes IT (a different fault, with a different
// message) and the two can never both fire for one event, because this function does
// not throw. Two catches claiming one fault is the shape that makes a log unreadable
// during an incident, and `__tests__/mcp/failure-isolation.test.ts` asserts the count
// is exactly one.
//
// Read-only, structurally
//
// Nothing in this file writes. The switch below is exhaustive over `McpToolName`, so a
// fourth tool added to `@growthmind/shared` fails to compile here rather than arriving
// unhandled, and the only dependency this file has that could write anything is
// `McpReadPort`, whose three methods are all reads. `report_shipped`, the draft
// contract's one write tool, is absent from the descriptor list and asserted absent by
// name in `packages/shared/__tests__/mcp/tools.test.ts`.
//
// Precedent: `worker/src/tasks/delivery-tick.ts`, the task body is a plain function
// over ports, and the Graphile-aware wrapper decides nothing.
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

import type { McpCredential } from "./credentials";
import type { McpReadPort, OpenFixRow } from "./read-port";
import { NOT_FOUND, UNAVAILABLE, malformedInput, unknownTool, type McpRefusal } from "./refusals";

/**
 * What one tool call came to. A value, never something a caller can send back out
 * unexamined. The rendering layer decides how each arm reaches the client, and this
 * file decides which arm it is.
 *
 * `result` is `unknown` because it is a different shape per tool and has already been
 * parsed by the schema that owns it; typing it as a union of three would be a second
 * copy of the contract that could drift from the first.
 */
export type McpToolOutcome =
  | { readonly ok: true; readonly tool: McpToolName; readonly result: unknown }
  | { readonly ok: false; readonly refusal: McpRefusal };

/**
 * A tool's own descriptor, by name.
 *
 * `resolveMcpTool` already returns one for a name off the wire; this is the lookup for
 * the one schema this file needs at module scope, and it throws at import time if a
 * name in the contract has no descriptor. A boot failure the first call notices, rather
 * than a `undefined.parse` on a live one.
 */
function requireTool(name: McpToolName): McpToolDescriptor {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`mcp: the contract names a tool "${name}" with no descriptor`);
  }
  return tool;
}

/**
 * `get_finding`'s output schema, taken from the descriptor rather than imported by
 * name.
 *
 * `@growthmind/shared`'s barrel re-exports `listOpenFixesOutputSchema` and
 * `fixSpecEnvelopeSchema` but not `getFindingOutputSchema`, and the package exposes no
 * second entry point to reach it through. Reaching it via `MCP_TOOLS` is not a
 * workaround so much as the stricter route: the descriptor is what a client is shown,
 * so parsing through it makes "what we validate" and "what we advertise" the same
 * object by construction. See `FindingRecord` in `./read-port.ts` for the type side of
 * the same gap.
 */
const GET_FINDING_OUTPUT_SCHEMA = requireTool(MCP_TOOL.GET_FINDING).outputSchema;

/**
 * One tool call, decided.
 *
 * Never throws, and never returns a transport value. Every failure, an unknown name,
 * arguments that do not fit, a row that is not there, a read that broke. Comes back as
 * `{ ok: false, refusal }`. A fault inside a read, a renderer or an output schema is
 * caught here and becomes `UNAVAILABLE`, so the caller above never has to distinguish
 * "this refused" from "this exploded".
 *
 * `name` is unresolved on purpose. It is a raw string off the wire, and
 * `resolveMcpTool` owns turning it into one of the three or into the refusal that names
 * all three.
 */
export async function callTool(
  name: string,
  input: unknown,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  const resolution = resolveMcpTool(name);
  if (!resolution.ok) {
    return { ok: false, refusal: unknownTool(resolution.message) };
  }

  try {
    return await runTool(resolution.tool.name, input, reads, credential);
  } catch (error) {
    // The only catch in the file, and it exists so that a fault in a read, in the
    // renderer, or in an output schema is one detail-free refusal rather than an
    // unhandled rejection with a stack trace on the wire. The detail goes to the log,
    // which is ours; the agent gets one sentence.
    console.error("mcp: a tool call could not be completed", {
      tool: resolution.tool.name,
      error,
    });
    return { ok: false, refusal: UNAVAILABLE };
  }
}

/**
 * One resolved tool call.
 *
 * Exhaustive over `McpToolName` with no `default`, so a fourth tool added to the
 * contract is a `bun run typecheck` failure here rather than a name that resolves and
 * then does nothing. Each arm parses its input through the exact schema
 * `@growthmind/shared` exports and the descriptor advertises. The two are the same
 * object, and `__tests__/mcp/route.test.ts` pins that identity so this file cannot
 * start validating against something a client was never shown.
 *
 * The name is the resolved one rather than the string off the wire, so the sentence
 * `malformedInput` builds names the tool the contract knows about and not whatever
 * spelling arrived.
 */
async function runTool(
  name: McpToolName,
  input: unknown,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  switch (name) {
    case MCP_TOOL.LIST_OPEN_FIXES: {
      const parsed = listOpenFixesInputSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, refusal: malformedInput(name, parsed.error.issues) };
      }
      return listOpenFixes(parsed.data, reads, credential);
    }

    case MCP_TOOL.GET_FIX: {
      const parsed = getFixInputSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, refusal: malformedInput(name, parsed.error.issues) };
      }
      return getFix(parsed.data.fixId, reads, credential);
    }

    case MCP_TOOL.GET_FINDING: {
      const parsed = getFindingInputSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, refusal: malformedInput(name, parsed.error.issues) };
      }
      return getFinding(parsed.data.findingId, reads, credential);
    }
  }
}

/** One producer of the answered arm, so every success carries the name of the tool that
 * produced it and nothing else is ever added beside it. */
function answered(tool: McpToolName, result: unknown): McpToolOutcome {
  return { ok: true, tool, result };
}

/**
 * The most urgent slice of what is open, never everything.
 *
 * The organization is the credential's. A `projectId` argument narrows within it; the
 * port resolves that project inside the same organization, so a project id belonging to
 * somebody else narrows to nothing and this answers with an empty list and a truthful
 * window. The identical answer a project id that never existed gets.
 *
 * Sorted here as well as in the port. Ordering is part of the contract
 * (`listOpenFixesOutputSchema`: soonest `resultsBy` first, so a truncated list is the
 * most urgent slice rather than an arbitrary one), and re-sorting 25 rows costs nothing
 * while removing the whole class of bug where an implementation forgets its `order by`.
 * Ties break on `fixId` so two calls against one store answer identically. An agent
 * that re-reads a list must not see a different order and conclude something moved.
 * `toSorted` rather than `sort`: the input is the port's array and is not ours to
 * mutate.
 */
async function listOpenFixes(
  input: ListOpenFixesInput,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  const page = await reads.listOpenFixes({
    organizationId: credential.organizationId,
    projectId: input.projectId ?? null,
    limit: input.limit,
  });

  const chosen = page.fixes.toSorted(byUrgencyThenId).slice(0, input.limit);

  return answered(
    MCP_TOOL.LIST_OPEN_FIXES,
    listOpenFixesOutputSchema.parse({
      fixes: chosen.map(toSummary),
      window: {
        returned: chosen.length,
        totalOpen: page.totalOpen,
        // Asserted by the schema against the two numbers beside it, so a producer that
        // cut the list and forgot the flag fails to parse.
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
  // Code-unit comparison, not `localeCompare`: the tie-break must be the same on every
  // machine, and a locale-aware collation is not.
  if (left.fixId < right.fixId) return -1;
  if (left.fixId > right.fixId) return 1;
  return 0;
}

/**
 * A stored row as a wire row. Field by field, never a spread, the same rule
 * `packages/db`'s `toMetadata` follows, so a column added to the store cannot ride out
 * to a coding agent because nobody updated a mapping.
 *
 * `status` is written here rather than copied: the wire literal is `"open"`, and this
 * list may only contain open work.
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
 * The join the contract named happens here, in one line.
 * `packages/shared/src/mcp/types.ts` carries the spec as one opaque `specText` because
 * it may not import `@growthmind/core`; `renderFixSpec` produces the sectioned
 * `FixSpec`; `apps/web` may import both, so this is where `sentences.join`
 * belongs and the only place it exists.
 *
 * `renderFixSpec` refuses rather than degrades. An unnormalised page address, a
 * template that reads as code, a count that describes people all throw. That throw
 * reaches the one catch in this file and becomes `UNAVAILABLE` with no detail: a fix
 * spec that cannot be rendered safely is one we do not serve, and it is emphatically
 * not a `NOT_FOUND`, which would tell an agent the work does not exist.
 */
async function getFix(
  fixId: string,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  const record = await reads.getFix({ organizationId: credential.organizationId, fixId });
  if (record === null) {
    return { ok: false, refusal: NOT_FOUND };
  }

  const spec = renderFixSpec(record.spec);

  return answered(
    MCP_TOOL.GET_FIX,
    fixSpecEnvelopeSchema.parse({
      fixId: record.fixId,
      findingId: record.findingId,
      status: record.status,
      specText: spec.sentences.join("\n"),
      attempt: record.attempt,
      // Contract constants, stated by the surface that owns the contract. A store
      // cannot get them wrong because a store is never asked.
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
): Promise<McpToolOutcome> {
  const record = await reads.getFinding({
    organizationId: credential.organizationId,
    findingId,
  });
  if (record === null) {
    return { ok: false, refusal: NOT_FOUND };
  }

  return answered(MCP_TOOL.GET_FINDING, GET_FINDING_OUTPUT_SCHEMA.parse(record));
}
