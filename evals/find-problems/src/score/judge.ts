import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

import type { AssessedProblem } from "../analyse/types";
import type { CorpusFacts } from "../facts/types";
import type { AnswerKey } from "../scenario/types";
import { leadDeterministically } from "./facts";
import type { LeadVerdict, MatchVerdict, RecommendationVerdict } from "./types";

const matchJudgementSchema = z.object({
  verdicts: z.array(
    z.object({
      keyProblemId: z.string(),
      proposalId: z
        .string()
        .nullable()
        .describe("The proposal that describes the same problem, or null if none does."),
      why: z.string(),
    }),
  ),
});

const recommendationJudgementSchema = z.object({
  verdicts: z.array(
    z.object({
      proposalId: z.string(),
      actionable: z
        .boolean()
        .describe("True only if an engineer could start the change from this alone."),
      why: z.string(),
    }),
  ),
});

const JUDGE_SYSTEM = [
  "You are grading one model's read of a set of session recordings against a list of problems a human confirmed are really in the product.",
  "Two descriptions match when they are about the same underlying product problem, even in different words. They do not match when one is merely near the other, or is a symptom of a different problem.",
  "Be strict. A generous match makes the grade useless.",
].join("\n");

function describeProposals(proposals: readonly AssessedProblem[]): string {
  return proposals
    .map((proposal) =>
      [
        `${proposal.id}: ${proposal.title}`,
        `  what it says: ${proposal.whatWasSeen}`,
        `  recommendation: ${proposal.recommendation.action} (on ${proposal.recommendation.whereInProduct})`,
      ].join("\n"),
    )
    .join("\n");
}

export async function judgeUnresolvedMatches(
  model: LanguageModel,
  input: {
    readonly key: AnswerKey;
    readonly proposals: readonly AssessedProblem[];
    readonly unresolvedKeyIds: readonly string[];
  },
): Promise<readonly MatchVerdict[]> {
  if (input.unresolvedKeyIds.length === 0 || input.proposals.length === 0) return [];

  const wanted = input.key.problems.filter((problem) =>
    input.unresolvedKeyIds.includes(problem.id),
  );

  const prompt = [
    "Problems confirmed to be in the product:",
    wanted.map((problem) => `${problem.id}: ${problem.title}\n  ${problem.statement}`).join("\n"),
    "",
    "What the model proposed:",
    describeProposals(input.proposals),
    "",
    "For each confirmed problem, name the proposal that describes the same problem, or null.",
  ].join("\n");

  const { object } = await generateObject({
    model,
    schema: matchJudgementSchema,
    system: JUDGE_SYSTEM,
    prompt,
  });

  const known = new Set(input.proposals.map((proposal) => proposal.id));

  return object.verdicts
    .filter((verdict) => input.unresolvedKeyIds.includes(verdict.keyProblemId))
    .map((verdict) => ({
      keyProblemId: verdict.keyProblemId,
      proposalId:
        verdict.proposalId !== null && known.has(verdict.proposalId) ? verdict.proposalId : null,
      method: "judged" as const,
      note: verdict.why,
    }));
}

const leadJudgementSchema = z.object({
  proposalId: z
    .string()
    .nullable()
    .describe("The proposal that is about that fact, or null if none is."),
  why: z.string(),
});

/** The one row a string cannot always settle: whether the opening problem is the headline one. */
export async function judgeHeadlineLead(
  model: LanguageModel,
  input: { readonly facts: CorpusFacts; readonly proposals: readonly AssessedProblem[] },
): Promise<LeadVerdict> {
  const settled = leadDeterministically(input.facts, input.proposals);
  if (settled !== null) return settled;

  const prompt = [
    `A fact counted from the recordings: ${input.facts.headline.statement}`,
    "",
    "What the model proposed, in the order it proposed them:",
    describeProposals(input.proposals),
    "",
    "Which proposal, if any, is about that fact? Null if none of them is.",
  ].join("\n");

  const { object } = await generateObject({
    model,
    schema: leadJudgementSchema,
    system: JUDGE_SYSTEM,
    prompt,
  });

  const known = new Set(input.proposals.map((proposal) => proposal.id));
  const proposalId =
    object.proposalId !== null && known.has(object.proposalId) ? object.proposalId : null;

  return {
    led: proposalId !== null && proposalId === input.proposals[0]?.id,
    proposalId,
    method: "judged",
    note: object.why,
  };
}

export async function judgeRecommendations(
  model: LanguageModel,
  proposals: readonly AssessedProblem[],
): Promise<readonly RecommendationVerdict[]> {
  if (proposals.length === 0) return [];

  const prompt = [
    "Each entry below is a proposed product change. Say for each whether an engineer could start the work from this alone, without going back to ask what was meant.",
    "A change that names no screen, no control and no concrete edit is not actionable, however sensible it sounds.",
    "",
    describeProposals(proposals),
  ].join("\n");

  const { object } = await generateObject({
    model,
    schema: recommendationJudgementSchema,
    system: JUDGE_SYSTEM,
    prompt,
  });

  const known = new Set(proposals.map((proposal) => proposal.id));

  return object.verdicts
    .filter((verdict) => known.has(verdict.proposalId))
    .map((verdict) => ({
      proposalId: verdict.proposalId,
      actionable: verdict.actionable,
      method: "judged" as const,
      note: verdict.why,
    }));
}
