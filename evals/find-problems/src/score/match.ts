import type { AssessedProblem } from "../analyse/types";
import type { AnswerKey, KeyProblem } from "../scenario/types";
import type { MatchVerdict } from "./types";

export function proposalHaystack(problem: AssessedProblem): string {
  return [
    problem.title,
    problem.whatWasSeen,
    problem.recommendation.action,
    problem.recommendation.whereInProduct,
  ]
    .join(" ")
    .toLowerCase();
}

export function matchesKeyProblem(key: KeyProblem, problem: AssessedProblem): boolean {
  const haystack = proposalHaystack(problem);
  return key.matchAny.some((signal) => haystack.includes(signal.toLowerCase()));
}

export interface DeterministicMatchResult {
  readonly verdicts: readonly MatchVerdict[];
  readonly unresolvedKeyIds: readonly string[];
}

/**
 * Cheap pass first so the judge is only asked about rows a string cannot settle, and the
 * scorecard can say which rows were which.
 */
export function matchDeterministically(
  key: AnswerKey,
  proposals: readonly AssessedProblem[],
): DeterministicMatchResult {
  const verdicts: MatchVerdict[] = [];
  const unresolvedKeyIds: string[] = [];

  for (const keyProblem of key.problems) {
    const hit = proposals.find((proposal) => matchesKeyProblem(keyProblem, proposal));
    if (hit === undefined) {
      unresolvedKeyIds.push(keyProblem.id);
      continue;
    }
    verdicts.push({
      keyProblemId: keyProblem.id,
      proposalId: hit.id,
      method: "matched",
      note: null,
    });
  }

  return { verdicts, unresolvedKeyIds };
}
