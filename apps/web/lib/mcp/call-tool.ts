import { renderFixSpec } from "@growthmind/core";
import { describeDriverError } from "@growthmind/db";
import {
  FIX_ATTEMPT_CEILING,
  MCP_TOOL,
  MCP_TOOLS,
  fixSpecEnvelopeSchema,
  getFindingInputSchema,
  getFixInputSchema,
  getGrowthContextInputSchema,
  getGrowthContextOutputSchema,
  listOpenFixesInputSchema,
  listOpenFixesOutputSchema,
  logger,
  resolveMcpTool,
  type GetGrowthContextInput,
  type ListOpenFixesInput,
  type McpToolDescriptor,
  type McpToolName,
} from "@growthmind/shared";

import type { McpCredential } from "./credentials";
import type { McpReadPort, OpenFixRow } from "./read-port";
import { reportShipped } from "./report-shipped";
import {
  NOT_FOUND,
  NO_PROJECT,
  UNAVAILABLE,
  ambiguousProject,
  malformedInput,
  unknownTool,
  type McpRefusal,
} from "./refusals";
import { createAbsentWritePort, type McpWritePort } from "./write-port";

// One object rather than a growing tail of positional arguments, because the write tool this
// surface just gained will not be the last one.
export interface McpPorts {
  readonly reads: McpReadPort;
  readonly writes?: McpWritePort;
}

const ABSENT_WRITES = createAbsentWritePort((message) => {
  logger.warn(message);
});

export type McpToolOutcome =
  | { readonly ok: true; readonly tool: McpToolName; readonly result: unknown }
  | { readonly ok: false; readonly refusal: McpRefusal };

function requireTool(name: McpToolName): McpToolDescriptor {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`mcp: the contract names a tool "${name}" with no descriptor`);
  }
  return tool;
}

const GET_FINDING_OUTPUT_SCHEMA = requireTool(MCP_TOOL.GET_FINDING).outputSchema;

export async function callTool(
  name: string,
  input: unknown,
  ports: McpPorts,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  const resolution = resolveMcpTool(name);
  if (!resolution.ok) {
    return { ok: false, refusal: unknownTool(resolution.message) };
  }

  try {
    return await runTool(resolution.tool.name, input, ports, credential);
  } catch (error) {
    logger.error("mcp: a tool call could not be completed", {
      tool: resolution.tool.name,

      // This wraps a database write now, and the driver puts every bound parameter in the
      // message — the caller's own description and page among them.
      reason: describeDriverError(error),
    });
    return { ok: false, refusal: UNAVAILABLE };
  }
}

async function runTool(
  name: McpToolName,
  input: unknown,
  ports: McpPorts,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  const reads = ports.reads;

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

    case MCP_TOOL.GET_GROWTH_CONTEXT: {
      const parsed = getGrowthContextInputSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, refusal: malformedInput(name, parsed.error.issues) };
      }
      return getGrowthContext(parsed.data, reads, credential);
    }

    case MCP_TOOL.REPORT_SHIPPED: {
      const outcome = await reportShipped(
        input,
        ports.writes ?? ABSENT_WRITES,
        credential,
        new Date(),
      );

      return outcome.ok ? answered(MCP_TOOL.REPORT_SHIPPED, outcome.result) : outcome;
    }
  }
}

function answered(tool: McpToolName, result: unknown): McpToolOutcome {
  return { ok: true, tool, result };
}

async function listOpenFixes(
  input: ListOpenFixesInput,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  const page = await reads.listOpenFixes({
    principal: credential.context,
    projectId: input.projectId ?? null,
    limit: input.limit,
  });

  // The read port hands these back ranked by expected value, which is what §6 means by
  // urgency and what this tool's description promises. Re-sorting here on the readout date
  // put them back in deadline order and quietly undid that ranking.
  const chosen = page.fixes.slice(0, input.limit);

  return answered(
    MCP_TOOL.LIST_OPEN_FIXES,
    listOpenFixesOutputSchema.parse({
      fixes: chosen.map(toSummary),
      window: {
        returned: chosen.length,
        totalOpen: page.totalOpen,

        truncated: chosen.length < page.totalOpen,
      },
    }),
  );
}

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

async function getFix(
  fixId: string,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  const record = await reads.getFix({ principal: credential.context, fixId });
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

      attemptsAllowed: FIX_ATTEMPT_CEILING,
      alreadyLanded: record.alreadyLanded,
      impact: record.impact,
      resultsBy: record.resultsBy,
      dateIsFinal: true,
    }),
  );
}

async function getFinding(
  findingId: string,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  const record = await reads.getFinding({
    principal: credential.context,
    findingId,
  });
  if (record === null) {
    return { ok: false, refusal: NOT_FOUND };
  }

  return answered(MCP_TOOL.GET_FINDING, GET_FINDING_OUTPUT_SCHEMA.parse(record));
}

async function getGrowthContext(
  input: GetGrowthContextInput,
  reads: McpReadPort,
  credential: McpCredential,
): Promise<McpToolOutcome> {
  const answer = await reads.getGrowthContext({
    principal: credential.context,
    surface: input.surface ?? null,
    projectId: input.projectId ?? null,
  });

  if (answer.outcome === "no_project") {
    return { ok: false, refusal: NO_PROJECT };
  }

  if (answer.outcome === "ambiguous_project") {
    return { ok: false, refusal: ambiguousProject(answer.projectIds) };
  }

  const record = answer.record;

  return answered(
    MCP_TOOL.GET_GROWTH_CONTEXT,
    getGrowthContextOutputSchema.parse({
      projectId: record.projectId,
      surface: record.surface,
      changeable: record.changeable,
      whatMatters: record.whatMatters,
      knownProblems: record.knownProblems,
      declined: record.declined,
      business: record.business,

      nothingKnownYet:
        record.whatMatters.length === 0 &&
        record.knownProblems.length === 0 &&
        record.declined.length === 0 &&
        record.business.length === 0,
    }),
  );
}
