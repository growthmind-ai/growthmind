import {
  normalisedPageAddress,
  shippedAlreadyAnsweredBody,
  shippedClockUnchangedBody,
  shippedPromiseBody,
} from "@growthmind/core";
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
import type { ReportedChange, McpWritePort } from "./write-port";

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

// The row stamps the normalisation version and the readout joins on exact equality against the
// spine's paths, so `/Reports`, `/reports/` and `https://app.example/reports?t=1` have to become
// the one spelling here or the change measures nothing and forks its own key. The normaliser is
// the spine's own, never a second copy of its rules.
function normalisedPage(page: string): string | null {
  return normalisedPageAddress(page);
}

const UNREADABLE_PAGE =
  "is not a page address we can read. Send the path the page lives at, like /reports.";

// A well-formed request we cannot honour: the change key is fixed at page and control (HC-2), so
// there is no second row to open, and the 400 says the caller has nothing to retry unchanged.
function alreadyAnswered(change: ReportedChange): McpRefusal {
  return {
    code: "malformed_request",
    message: shippedAlreadyAnsweredBody({
      change: change.description,
      page: change.page,
      readoutDueAt: change.readoutDueAt,
    }),
    status: 400,
  };
}

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

  const page = normalisedPage(parsed.data.page);
  if (page === null) {
    return {
      ok: false,
      refusal: malformedInput(MCP_TOOL.REPORT_SHIPPED, [
        { path: ["page"], message: UNREADABLE_PAGE },
      ]),
    };
  }

  const answer = await writes.reportShipped({
    principal: credential.context,
    projectId: parsed.data.projectId ?? null,
    page,
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

  if (answer.outcome === "already_answered") {
    return { ok: false, refusal: alreadyAnswered(change) };
  }

  const promise = {
    change: change.description,
    page: change.page,
    readoutDueAt: change.readoutDueAt,
  };

  return {
    ok: true,
    result: reportShippedOutputSchema.parse({
      changeId: change.changeId,
      page: change.page,
      control: change.control,
      readoutDueAt: change.readoutDueAt.toISOString(),

      // The first report says the same sentence the acknowledgement says in Slack: it names the
      // date, and that nothing here checked the change is really live. A re-report says the date
      // has not moved, because a second promise would read as a second clock (FR-5.5).
      acknowledgement:
        answer.outcome === "clock_unchanged"
          ? shippedClockUnchangedBody(promise)
          : shippedPromiseBody(promise),
    }),
  };
}
