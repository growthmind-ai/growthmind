export interface CorpusFact {
  readonly id: string;

  /** Plain English, always "N of M …", because the harness owns the arithmetic. */
  readonly statement: string;

  readonly count: number;
  readonly of: number;

  /** The sessions this fact counts, so a reader can check it rather than trust it. */
  readonly sessionIds: readonly string[];

  /** Phrases that mean a claim is about this fact. The scorer is their only reader. */
  readonly subjectSignals: readonly string[];
}

export interface CorpusFacts {
  /** What "connected" means here, in one line, carried with the numbers it decides. */
  readonly definitionOfActivation: string;

  /** The first sentence a growth engineer writes. Always `facts[0]`. */
  readonly headline: CorpusFact;

  readonly facts: readonly CorpusFact[];
}
