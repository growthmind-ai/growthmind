import { z } from "zod";

import {
  getFindingInputSchema,
  getFindingOutputSchema,
  getFixInputSchema,
  fixSpecEnvelopeSchema,
  listOpenFixesInputSchema,
  listOpenFixesOutputSchema,
} from "./types";

// The read-only machine surface's tool descriptors (O-009; `docs/architecture.md`
// §7). Three tools, all reads. The shapes they bind live in `./types.ts`.
//
// ---------------------------------------------------------------------------
// WHY THE NAMES ARE CONSTANTS
// ---------------------------------------------------------------------------
//
// A tool name is a WIRE CONTRACT with a program nobody here controls. A client
// asks for a tool by string; nothing type-checks the two sides against each
// other. So a rename is not a compile error and not a runtime error either — it
// is a capability that silently stops being reachable, and the agent that used
// to call it now decides the product cannot do that thing. This is exactly the
// hazard `worker/src/task-names.ts` documents for Graphile Worker task
// identifiers, arriving one layer further out where the caller is a customer's
// coding agent rather than our own runtime.
//
// The mitigation is the same one: names are exported constants, never raw
// strings, and `__tests__/mcp/tools.test.ts` pins each literal so a rename
// fails a named test instead of a customer's workflow.
//
// ---------------------------------------------------------------------------
// WHY THE DESCRIPTIONS ARE WRITTEN THE WAY THEY ARE
// ---------------------------------------------------------------------------
//
// A model reads these to decide whether to call the tool, so they are prompts,
// not documentation. Each one says what you get back and WHEN to reach for it,
// in the words the agent's own user would use. No product vocabulary: an agent
// that has to learn our ontology burns context doing it, and the audit in the
// test file scans every description against `FORBIDDEN_PRODUCT_JARGON` — the
// same list the customer-facing strings are held to, reused rather than
// re-authored, because two lists drift.
//
// ---------------------------------------------------------------------------
// READ-ONLY, AND HOW THAT IS ACTUALLY GUARANTEED
// ---------------------------------------------------------------------------
//
// `readOnlyHint` is a LABEL for the client (it maps onto MCP's tool annotation
// of the same name), and a label is not a guarantee — a client is free to
// ignore it. The guarantee is structural: this module exports three tools and
// none of them writes anything. The draft contract's one write tool,
// `report_shipped`, is deliberately absent, and a test asserts its absence by
// name so it cannot arrive here without someone deciding to put it here.
//
// ---------------------------------------------------------------------------
// WHAT AN INPUT SCHEMA MAY NOT CONTAIN
// ---------------------------------------------------------------------------
//
// An organization key. The organization comes from the authenticated credential
// and from nowhere else, so no tool call can name one. See the header of
// `./types.ts`; the recursive key walk that enforces it lives in the test file.

/**
 * The tool names, as constants. Snake case because that is the grammar MCP
 * clients and the draft contract both use, and because these three strings are
 * quoted verbatim in O-009's definition of done.
 *
 * Named for what the agent WANTS, not for what this system calls things
 * internally: `get_fix`, never `get_experiment_dispatch`.
 */
export const MCP_TOOL = {
  LIST_OPEN_FIXES: "list_open_fixes",
  GET_FIX: "get_fix",
  GET_FINDING: "get_finding",
} as const;

export type McpToolName = (typeof MCP_TOOL)[keyof typeof MCP_TOOL];

/**
 * The same three names as a non-empty readonly tuple, so the Zod enum below and
 * the descriptor list are provably the same set. The `satisfies` clause makes
 * adding a name in one place and not the other a compile error rather than a
 * tool that exists but cannot be called.
 */
export const MCP_TOOL_NAMES = [
  MCP_TOOL.LIST_OPEN_FIXES,
  MCP_TOOL.GET_FIX,
  MCP_TOOL.GET_FINDING,
] as const satisfies readonly [McpToolName, ...McpToolName[]];

/**
 * The grammar a tool name must obey: lower case, starting with a letter, words
 * joined by underscores. Exported so a test can assert every name against it —
 * a name that only fails inside somebody else's MCP client is a name no test of
 * ours catches.
 */
export const MCP_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Parses a name off the wire. An unknown name fails; it is never ignored. */
export const mcpToolNameSchema = z.enum(MCP_TOOL_NAMES);

/**
 * One tool, as a client sees it.
 *
 * `inputSchema` is a `ZodObject` rather than any `ZodType` for two reasons: MCP
 * tool inputs are objects, and the org-key walk needs a `shape` to recurse
 * through. A tool whose input were a bare string could not be audited, so the
 * type refuses one.
 */
export interface McpToolDescriptor {
  readonly name: McpToolName;
  /** A few words a person would recognise, for a client's tool picker. */
  readonly title: string;
  /** What a model reads to decide whether to call this. */
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly outputSchema: z.ZodType;
  /**
   * Always `true` on this surface. Typed as the literal, so a write tool cannot
   * be added to this list without changing the type it is declared against —
   * the read-only promise fails to compile before it fails in production.
   */
  readonly readOnlyHint: true;
}

const listOpenFixesTool: McpToolDescriptor = {
  name: MCP_TOOL.LIST_OPEN_FIXES,
  title: "Open fixes",
  description:
    "Lists the growth problems in this product that are waiting to be fixed, most urgent first. " +
    "Call this when you have been asked to improve something and you do not already have an id. " +
    "Each entry gives you an id, one line saying what is wrong, how many sessions ran into it " +
    "out of how many were measured, and the date its result is due. You get at most 25 entries " +
    "plus a total, so a bigger total means you are looking at the most urgent slice rather than " +
    "everything.",
  inputSchema: listOpenFixesInputSchema,
  outputSchema: listOpenFixesOutputSchema,
  readOnlyHint: true,
};

const getFixTool: McpToolDescriptor = {
  name: MCP_TOOL.GET_FIX,
  title: "Fix instructions",
  description:
    "Gives you the full instructions for one fix, by its id: what is wrong and where, why it " +
    "matters, the checks it will be judged on, when to stop early, and the date its result is " +
    "due. Read it before you touch any code. It contains no code at all — it names the files " +
    "involved and says what should be true when you are finished, and how to get there is yours " +
    "to work out. It also tells you which attempt this is and what earlier attempts already " +
    "landed, so you only do the part that is missing.",
  inputSchema: getFixInputSchema,
  outputSchema: fixSpecEnvelopeSchema,
  readOnlyHint: true,
};

const getFindingTool: McpToolDescriptor = {
  name: MCP_TOOL.GET_FINDING,
  title: "Evidence behind a problem",
  description:
    "Gives you the evidence behind one problem, by its id: what happened, how many sessions ran " +
    "into it out of how many were measured, over what dates, and links to the recordings and " +
    "requests that show it. Call this when you want to understand a problem before working on " +
    "it, or when you need to explain to a person why the work is worth doing. Everything here is " +
    "something we observed, never something we inferred.",
  inputSchema: getFindingInputSchema,
  outputSchema: getFindingOutputSchema,
  readOnlyHint: true,
};

/**
 * Every tool this surface exposes. THE ORDER IS THE ORDER AN AGENT MEETS THEM
 * IN: the one you can call knowing nothing comes first, then the one that turns
 * an id into work, then the one that explains why the work is worth doing.
 */
export const MCP_TOOLS: readonly McpToolDescriptor[] = [
  listOpenFixesTool,
  getFixTool,
  getFindingTool,
];

/**
 * Resolving a name off the wire.
 *
 * A result union rather than a throw or an `undefined`, because an unknown tool
 * name must be REFUSED and the refusal must instruct: an error tells the agent
 * what to do next, not merely what went wrong. Silently ignoring an unrecognised
 * call is the worst of the three outcomes — the agent waits for an answer that
 * is never coming and has no idea it asked for something that does not exist.
 */
export type McpToolResolution =
  | { readonly ok: true; readonly tool: McpToolDescriptor }
  | {
      readonly ok: false;
      readonly code: "unknown_tool";
      readonly message: string;
      readonly knownTools: readonly McpToolName[];
    };

export function resolveMcpTool(name: string): McpToolResolution {
  const parsed = mcpToolNameSchema.safeParse(name);
  if (!parsed.success) {
    return {
      ok: false,
      code: "unknown_tool",
      message: `There is no tool called "${name}" here. The tools that exist are ${MCP_TOOL_NAMES.join(", ")}. Start with ${MCP_TOOL.LIST_OPEN_FIXES} if you do not have an id yet.`,
      knownTools: MCP_TOOL_NAMES,
    };
  }

  const tool = MCP_TOOLS.find((candidateTool) => candidateTool.name === parsed.data);
  if (tool === undefined) {
    // Unreachable while the `satisfies` clause on `MCP_TOOL_NAMES` and the
    // descriptor list agree — and asserted in the test file so it stays that
    // way. Handled rather than asserted away, because the failure this guards
    // against is a name that parses and then resolves to nothing, which would
    // otherwise be a runtime crash on somebody else's client.
    return {
      ok: false,
      code: "unknown_tool",
      message: `The tool "${name}" is known but is not set up on this server. Nothing you can do will make this call work; carry on without it.`,
      knownTools: MCP_TOOL_NAMES,
    };
  }

  return { ok: true, tool };
}
