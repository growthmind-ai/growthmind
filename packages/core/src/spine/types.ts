export const STEP_SPINE_VERSION = 1;

export const SPINE_MIN_REACH_RATIO_PERCENT = 50;

export type SpineIdentity = {
  readonly surface: string;

  readonly surfaceNormalisationVersion: number | null;
  readonly spineVersion: number;
};

export type SpineStep = {
  readonly path: string;
  readonly index: number;

  readonly sessionsReaching: number;
};

export type StepSpine = {
  readonly identity: SpineIdentity;

  readonly minReachRatioPercent: number;
  readonly steps: readonly SpineStep[];
};

export type SpineOptions = {
  readonly minReachRatioPercent?: number;
};

export type SessionPlacement = {
  readonly sessionId: string;

  readonly deepestVisitedIndex: number | null;

  readonly visitedIndexes: readonly number[];
  readonly originVisits: number;
};
