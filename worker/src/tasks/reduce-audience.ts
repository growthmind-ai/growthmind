import type { GrowthContextRepo } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";

import type { BusinessResearcherPort } from "./business-research";
import type { TaskLogger } from "../task-logger";

export interface ReduceAudienceDeps {
  readonly growthFor: (ctx: TenantContext) => GrowthContextRepo;

  // Null when no model is configured. The sentence keeps no proposal, which narrows nothing
  // and is the same state it was already in.
  readonly researcher: BusinessResearcherPort | null;
  readonly logger: TaskLogger;
}

export interface ReduceAudienceInput {
  readonly ctx: TenantContext;
  readonly projectId: string;
  readonly statement: string;
}

export type ReduceAudienceOutcome = "proposed" | "nothing_to_propose" | "no_model" | "failed";

export async function runReduceAudience(
  deps: ReduceAudienceDeps,
  input: ReduceAudienceInput,
): Promise<ReduceAudienceOutcome> {
  if (deps.researcher === null) return "no_model";

  const reduced = await deps.researcher.reduceAudience(input.statement);

  if (!reduced.ok) {
    deps.logger.warn(
      `reduce audience: project ${input.projectId} could not reduce a who_counts sentence — ${reduced.reason}`,
    );
    return "failed";
  }

  // A null rule is written too. Without it every re-read asks the model the same question
  // about the same sentence and gets the same nothing.
  await deps.growthFor(input.ctx).proposeAudience({
    projectId: input.projectId,
    statement: input.statement,
    rule: reduced.rule,
  });

  return reduced.rule === null ? "nothing_to_propose" : "proposed";
}
