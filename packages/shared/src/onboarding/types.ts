import { z } from "zod";

import type { ConnectionState } from "../session-source/types";
import type { AnalysisOutcome, AnalysisRunStatus } from "../summary/types";
import { summarySourceSchema } from "../summary/types";

export const onboardingCountSchema = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  unit: z.literal("sessions"),
});
export type OnboardingCount = z.infer<typeof onboardingCountSchema>;

export const onboardingFindingSchema = z.object({
  finalClass: z.string(),
  headline: z.string(),

  context: z.array(z.string()),
  counts: z.array(onboardingCountSchema),
  surface: z.string(),

  confidenceBasis: z.string(),
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  summarySource: summarySourceSchema,
});
export type OnboardingFinding = z.infer<typeof onboardingFindingSchema>;

export const endedReasonSchema = z.enum([
  "failed",
  "no_candidates_passed_gate",
  "no_sessions_to_analyse",
]);
export type EndedReason = z.infer<typeof endedReasonSchema>;

export type CounterRow = {
  readonly label: string;
  readonly value: number;
};

export type OnboardingCounterView = {
  readonly state: ConnectionState;

  readonly rows: readonly CounterRow[];

  readonly setAside: readonly CounterRow[];

  readonly identityUnverified: CounterRow;

  readonly asOfStatement: string;
  readonly windowStatement: string;
  readonly completenessStatement: string;
};

export type FirstRunStatus = {
  readonly finding: OnboardingFinding | null;
  readonly armedAt: Date | null;

  readonly retrievedAt: Date | null;

  readonly readingAt: Date | null;
  readonly endedAt: Date | null;
  readonly runStatus: AnalysisRunStatus | null;
  readonly runOutcome: AnalysisOutcome | null;

  readonly counter: OnboardingCounterView;

  readonly channelId: string | null;
};
