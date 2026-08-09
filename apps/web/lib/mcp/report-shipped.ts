import { shippedPromiseBody } from "@growthmind/core";
import { MCP_TOOL, reportShippedInputSchema, reportShippedOutputSchema } from "@growthmind/shared";

import type { McpCredential } from "./credentials";
import {
  DATE_IS_OURS,
  NOT_OUR_PROJECT,
  NO_PROJECT,
  ambiguousProject,
  malformedInput,
  type McpRefusal,
} from "./refusals";
import type { McpWritePort } from "./write-port";

// The spellings a caller reaches for when it wants to name its own date. A key this list misses
// is still an unrecognised key to the strict schema, so both branches refuse and only these get
// the sentence that names the rule.
export const REFUSED_INPUT_KEYS = [
  "readoutDate",
  "readout_date",
  "resultsBy",
  "results_by",
  "date",
] as const;

export type ReportShippedOutcome =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly refusal: McpRefusal };

function namesItsOwnDate(input: unknown): boolean {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  return REFUSED_INPUT_KEYS.some((key) => key in input);
}

export async function reportShipped(
  input: unknown,
  writes: McpWritePort,
  credential: McpCredential,
  reportedAt: Date,
): Promise<ReportShippedOutcome> {
  if (namesItsOwnDate(input)) {
    return { ok: false, refusal: DATE_IS_OURS };
  }

  const parsed = reportShippedInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, refusal: malformedInput(MCP_TOOL.REPORT_SHIPPED, parsed.error.issues) };
  }

  const answer = await writes.reportShipped({
    principal: credential.context,
    projectId: parsed.data.projectId ?? null,
    page: parsed.data.page,
    control: parsed.data.control ?? null,
    description: parsed.data.description,
    reportedAt,
  });

  if (answer.outcome === "no_project") {
    return { ok: false, refusal: NO_PROJECT };
  }

  if (answer.outcome === "not_our_project") {
    return { ok: false, refusal: NOT_OUR_PROJECT };
  }

  if (answer.outcome === "ambiguous_project") {
    return { ok: false, refusal: ambiguousProject(answer.projectIds) };
  }

  const change = answer.change;

  return {
    ok: true,
    result: reportShippedOutputSchema.parse({
      changeId: change.changeId,
      page: change.page,
      control: change.control,
      readoutDueAt: change.readoutDueAt.toISOString(),

      // The same sentence the acknowledgement says in Slack: it names the date, and it says
      // plainly that nothing here checked the change is really live.
      acknowledgement: shippedPromiseBody({
        change: change.description,
        page: change.page,
        readoutDueAt: change.readoutDueAt,
      }),
    }),
  };
}
