import { NoObjectGeneratedError } from "ai";

import { summaryFailureCodeSchema } from "@growthmind/shared";
import type { SummaryFailureCode, SummaryRenderResult, SummaryUsage } from "@growthmind/shared";

export const SUMMARY_FAILURE_MESSAGES: Record<SummaryFailureCode, string> = {
  output_invalid:
    "We could not read the written explanation that came back, so we left it out. The numbers are unaffected.",

  call_failed:
    "We could not generate a written explanation this time, so we left it out. The numbers are unaffected.",
};

export const UNCLASSIFIED_SUMMARY_ERROR_CODE: SummaryFailureCode = "call_failed";

export function mapSummaryError(error: unknown): SummaryFailureCode {
  if (NoObjectGeneratedError.isInstance(error)) {
    return "output_invalid";
  }
  return UNCLASSIFIED_SUMMARY_ERROR_CODE;
}

export interface SummaryFailureArgs {
  readonly code: SummaryFailureCode;

  readonly resolvedModelId: string;

  readonly usage: SummaryUsage;
}

export function summaryFailure(
  args: SummaryFailureArgs,
): Extract<SummaryRenderResult, { ok: false }> {
  const parsed = summaryFailureCodeSchema.safeParse(args.code);
  const code: SummaryFailureCode = parsed.success ? parsed.data : UNCLASSIFIED_SUMMARY_ERROR_CODE;

  return {
    ok: false,
    code,
    message: SUMMARY_FAILURE_MESSAGES[code],
    resolvedModelId: args.resolvedModelId,
    usage: args.usage,
  };
}
