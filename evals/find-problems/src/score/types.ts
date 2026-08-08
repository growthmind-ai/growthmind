export type VerdictMethod = "matched" | "judged";

export interface MatchVerdict {
  readonly keyProblemId: string;
  readonly proposalId: string | null;
  readonly method: VerdictMethod;
  readonly note: string | null;
}

export interface RecommendationVerdict {
  readonly proposalId: string;
  readonly actionable: boolean;
  readonly method: VerdictMethod;
  readonly note: string | null;
}

export interface LeadVerdict {
  readonly led: boolean;
  readonly proposalId: string | null;
  readonly method: VerdictMethod;
  readonly note: string | null;
}

/** A claim whose number disagrees with one the harness counted. */
export interface ContradictionRow {
  readonly proposalId: string;
  readonly title: string;
  readonly factId: string;
  readonly factStatement: string;
  readonly claimed: string;
}

export interface FoundRow {
  readonly keyProblemId: string;
  readonly keyTitle: string;
  readonly proposalId: string;
  readonly method: VerdictMethod;
}

export interface MissedRow {
  readonly keyProblemId: string;
  readonly keyTitle: string;
  readonly severity: "high" | "medium" | "low";
}

export interface ProposalRow {
  readonly proposalId: string;
  readonly title: string;
  readonly statedOutOf: string;
  readonly validCitations: number;
}

export interface Scorecard {
  readonly scenarioId: string;

  readonly keyTotal: number;
  readonly found: readonly FoundRow[];
  readonly missed: readonly MissedRow[];

  readonly proposalsTotal: number;

  /** No key problem and no checkable citation: the model made it up. */
  readonly invented: readonly ProposalRow[];

  /** No key problem but citations that check out: a real observation the key does not list. */
  readonly beyondTheKey: readonly ProposalRow[];

  readonly unsupportedClaims: readonly ProposalRow[];
  readonly claimsOverstatingTheCorpus: readonly ProposalRow[];

  /** Did the analyser open with the fact the corpus itself leads on? */
  readonly headlineFact: string;
  readonly ledWithHeadlineFact: boolean;
  readonly leadProposalId: string | null;
  readonly leadMethod: VerdictMethod;

  readonly claimsContradictingAFact: readonly ContradictionRow[];

  readonly actionableRecommendations: number;
  readonly recommendationsJudged: number;

  readonly rowsMatched: number;
  readonly rowsJudged: number;
}
