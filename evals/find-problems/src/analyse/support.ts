import type { AssessedProblem, Citation, ProposedProblem, SessionSummary } from "./types";

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The quote is checked against the beat, not only the beat number. */
export function isCitationCheckable(
  citation: Citation,
  sessions: readonly SessionSummary[],
): boolean {
  const session = sessions.find((candidate) => candidate.sessionId === citation.sessionId);
  if (session === undefined) return false;

  const beat = session.beats.find((candidate) => candidate.index === citation.beat);
  if (beat === undefined) return false;

  const line = normalise(beat.line);
  const quote = normalise(citation.quote);
  if (quote.length === 0) return false;

  return line.includes(quote) || quote.includes(line);
}

/** An unsupported claim is marked, never dropped: it is a result about the model. */
export function assessProblems(
  problems: readonly ProposedProblem[],
  sessions: readonly SessionSummary[],
): readonly AssessedProblem[] {
  return problems.map((problem, position) => {
    const valid = problem.citations.filter((citation) =>
      isCitationCheckable(citation, sessions),
    ).length;

    return {
      ...problem,
      id: `P${String(position + 1)}`,
      support: valid > 0 ? "cited" : "unsupported",
      validCitations: valid,
      invalidCitations: problem.citations.length - valid,
      sessionsTotal: sessions.length,
      claimedMoreThanCorpus: problem.sessionsAffected > sessions.length,
    };
  });
}

export function statedOutOf(problem: AssessedProblem): string {
  return `${String(problem.sessionsAffected)} of ${String(problem.sessionsTotal)} sessions`;
}
