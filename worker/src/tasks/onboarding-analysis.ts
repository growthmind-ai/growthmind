import { z } from "zod";

import type { AnalysisLaneDeps, AnalysisLaneSource, LaneRunResult } from "./analysis-tick";
import { runAnalysisLane } from "./analysis-tick";

export const onboardingAnalysisPayloadSchema = z
  .object({
    projectId: z.string().min(1),
  })
  .strict();

export type OnboardingAnalysisPayload = z.infer<typeof onboardingAnalysisPayloadSchema>;

export interface OnboardingAnalysisDeps extends AnalysisLaneDeps {
  readonly lanes: AnalysisLaneSource;
}

export type OnboardingAnalysisResult =
  | { readonly kind: "ran"; readonly projectId: string; readonly lane: LaneRunResult }
  | { readonly kind: "no_lane"; readonly projectId: string }
  | { readonly kind: "invalid_payload" };

export async function runOnboardingAnalysis(
  deps: OnboardingAnalysisDeps,
  payload: unknown,
): Promise<OnboardingAnalysisResult> {
  const parsed = onboardingAnalysisPayloadSchema.safeParse(payload);

  if (!parsed.success) {
     
    deps.logger.error(
      "analysis onboarding: a queued trigger carried a payload this task cannot read, so it was dropped — the hourly check still covers this installation",
    );
    return { kind: "invalid_payload" };
  }

  const { projectId } = parsed.data;

  const at = deps.now();
  const lane = await deps.lanes.laneForProject(projectId, at);

  if (lane === null) {
     
    deps.logger.info(
      `analysis onboarding: project ${projectId} has no lane to check right now, so this trigger did nothing and the hourly check is unaffected`,
    );
    return { kind: "no_lane", projectId };
  }

  const result = await runAnalysisLane(deps, lane, at);

  if (result.outcome === "already_running") {
     
    deps.logger.info(
      `analysis onboarding: project ${projectId} was already being checked, so this trigger left it alone`,
    );
    return { kind: "ran", projectId, lane: result };
  }

  deps.logger.info(
    `analysis onboarding: project ${projectId} checked on the fast path — ${result.outcome}, findings ${String(result.tally.findingsPersisted)}, asked a model to write up ${String(result.tally.modelCallsAttempted)}, not written up at all ${String(result.tally.unrenderable)}, turned away before we looked at them ${String(result.tally.refused)}`,
  );

  return { kind: "ran", projectId, lane: result };
}
