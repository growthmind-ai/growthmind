import { z } from "zod";

import {
  getFindingInputSchema,
  getFindingOutputSchema,
  getFixInputSchema,
  getGrowthContextInputSchema,
  getGrowthContextOutputSchema,
  fixSpecEnvelopeSchema,
  listOpenFixesInputSchema,
  listOpenFixesOutputSchema,
} from "./types";

export const MCP_TOOL = {
  LIST_OPEN_FIXES: "list_open_fixes",
  GET_FIX: "get_fix",
  GET_FINDING: "get_finding",
  GET_GROWTH_CONTEXT: "get_growth_context",
} as const;

export type McpToolName = (typeof MCP_TOOL)[keyof typeof MCP_TOOL];

export const MCP_TOOL_NAMES = [
  MCP_TOOL.LIST_OPEN_FIXES,
  MCP_TOOL.GET_FIX,
  MCP_TOOL.GET_FINDING,
  MCP_TOOL.GET_GROWTH_CONTEXT,
] as const satisfies readonly [McpToolName, ...McpToolName[]];

export const MCP_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export const mcpToolNameSchema = z.enum(MCP_TOOL_NAMES);

export interface McpToolDescriptor {
  readonly name: McpToolName;

  readonly title: string;

  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly outputSchema: z.ZodType;

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

const getGrowthContextTool: McpToolDescriptor = {
  name: MCP_TOOL.GET_GROWTH_CONTEXT,
  title: "What we know about a page",
  description:
    "Tells you what a page is for in this business, and whether the people who own it have " +
    "ruled it out of bounds for a coding agent. Call this when you are about to work on a page " +
    "and nobody has handed you a fix — while you are still deciding what to build. Name a page " +
    "address to ask about one page, or leave it out to see which pages matter here. You get " +
    "back what the page is for, whether work on it is allowed and why not when it is not, the " +
    "problems already known on it, and the ideas a person has already turned down so you do " +
    "not raise them again. An empty answer means nothing is known here yet, which is not a " +
    "reason to stop.",
  inputSchema: getGrowthContextInputSchema,
  outputSchema: getGrowthContextOutputSchema,
  readOnlyHint: true,
};

export const MCP_TOOLS: readonly McpToolDescriptor[] = [
  listOpenFixesTool,
  getFixTool,
  getFindingTool,
  getGrowthContextTool,
];

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
    return {
      ok: false,
      code: "unknown_tool",
      message: `The tool "${name}" is known but is not set up on this server. Nothing you can do will make this call work; carry on without it.`,
      knownTools: MCP_TOOL_NAMES,
    };
  }

  return { ok: true, tool };
}
