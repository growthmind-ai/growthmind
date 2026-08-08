import type { AssessedProblem } from "../analyse/types";
import type { CorpusFact, CorpusFacts } from "../facts/types";
import { proposalHaystack } from "./match";
import type { ContradictionRow, LeadVerdict } from "./types";

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  no: 0,
  none: 0,
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const SESSION_COUNT = /(\w+)\s+(?:of\s+(\w+)\s+)?sessions?\b/g;

function asNumber(token: string | undefined): number | null {
  if (token === undefined) return null;
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

/** Every session count the proposal states in words, plus the one it states structurally. */
export function statedCounts(proposal: AssessedProblem): readonly number[] {
  const found: number[] = [proposal.sessionsAffected];

  for (const match of proposalHaystack(proposal).matchAll(SESSION_COUNT)) {
    const numerator = asNumber(match[1]);
    if (numerator !== null) found.push(numerator);
  }

  return found;
}

export function isAbout(fact: CorpusFact, proposal: AssessedProblem): boolean {
  const haystack = proposalHaystack(proposal);
  return fact.subjectSignals.some((signal) => haystack.includes(signal.toLowerCase()));
}

/**
 * A claim about something already counted may state the count or its complement — "0 of 4
 * connected" and "4 of 4 did not" are the same fact. Any other number disagrees with the record.
 */
export function findContradictions(
  facts: CorpusFacts,
  proposals: readonly AssessedProblem[],
): readonly ContradictionRow[] {
  const rows: ContradictionRow[] = [];

  for (const proposal of proposals) {
    const counts = statedCounts(proposal);

    for (const fact of facts.facts) {
      if (!isAbout(fact, proposal)) continue;
      if (counts.some((count) => count === fact.count || count === fact.of - fact.count)) continue;

      rows.push({
        proposalId: proposal.id,
        title: proposal.title,
        factId: fact.id,
        factStatement: fact.statement,
        claimed: counts.map(String).join(", "),
      });
    }
  }

  return rows;
}

/**
 * Whether the analyser opened with the corpus's own headline. A string settles it whenever any
 * proposal is recognisably about the fact; only a corpus where none is falls through to the judge.
 */
export function leadDeterministically(
  facts: CorpusFacts,
  proposals: readonly AssessedProblem[],
): LeadVerdict | null {
  if (proposals.length === 0) {
    return { led: false, proposalId: null, method: "matched", note: "no proposals" };
  }

  const about = proposals.filter((proposal) => isAbout(facts.headline, proposal));
  if (about.length === 0) return null;

  const first = about[0];
  if (first === undefined) return null;

  return {
    led: first.id === proposals[0]?.id,
    proposalId: first.id,
    method: "matched",
    note: null,
  };
}
