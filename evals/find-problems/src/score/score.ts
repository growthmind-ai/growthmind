import { statedOutOf } from "../analyse/support";
import type { AssessedProblem } from "../analyse/types";
import type { AnswerKey } from "../scenario/types";
import type {
  FoundRow,
  MatchVerdict,
  MissedRow,
  ProposalRow,
  RecommendationVerdict,
  Scorecard,
} from "./types";

function rowOf(problem: AssessedProblem): ProposalRow {
  return {
    proposalId: problem.id,
    title: problem.title,
    statedOutOf: statedOutOf(problem),
    validCitations: problem.validCitations,
  };
}

export interface ScoreInput {
  readonly key: AnswerKey;
  readonly proposals: readonly AssessedProblem[];
  readonly matchVerdicts: readonly MatchVerdict[];
  readonly recommendationVerdicts: readonly RecommendationVerdict[];
}

export function scoreCorpus(input: ScoreInput): Scorecard {
  const settled = input.matchVerdicts.filter(
    (verdict): verdict is MatchVerdict & { proposalId: string } => verdict.proposalId !== null,
  );

  const found: FoundRow[] = [];
  const missed: MissedRow[] = [];

  for (const keyProblem of input.key.problems) {
    const verdict = settled.find((candidate) => candidate.keyProblemId === keyProblem.id);
    if (verdict === undefined) {
      missed.push({
        keyProblemId: keyProblem.id,
        keyTitle: keyProblem.title,
        severity: keyProblem.severity,
      });
      continue;
    }
    found.push({
      keyProblemId: keyProblem.id,
      keyTitle: keyProblem.title,
      proposalId: verdict.proposalId,
      method: verdict.method,
    });
  }

  const claimedProposalIds = new Set(found.map((row) => row.proposalId));
  const unmatched = input.proposals.filter((proposal) => !claimedProposalIds.has(proposal.id));

  return {
    scenarioId: input.key.scenarioId,
    keyTotal: input.key.problems.length,
    found,
    missed,
    proposalsTotal: input.proposals.length,
    invented: unmatched.filter((proposal) => proposal.support === "unsupported").map(rowOf),
    beyondTheKey: unmatched.filter((proposal) => proposal.support === "cited").map(rowOf),
    unsupportedClaims: input.proposals
      .filter((proposal) => proposal.support === "unsupported")
      .map(rowOf),
    claimsOverstatingTheCorpus: input.proposals
      .filter((proposal) => proposal.claimedMoreThanCorpus)
      .map(rowOf),
    actionableRecommendations: input.recommendationVerdicts.filter((verdict) => verdict.actionable)
      .length,
    recommendationsJudged: input.recommendationVerdicts.filter(
      (verdict) => verdict.method === "judged",
    ).length,
    rowsMatched: found.filter((row) => row.method === "matched").length,
    rowsJudged: found.filter((row) => row.method === "judged").length,
  };
}
