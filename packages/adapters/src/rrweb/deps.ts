import type { FetchLike } from "../posthog/deps";

export type { FetchLike };

export interface RrwebSourceConfig {
  readonly host: string;

  readonly apiKey: string;
}

export interface RrwebSourceDeps {
  readonly fetch: FetchLike;

  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => Date;

  readonly random: () => number;

  readonly deadlineExceededAfter?: (ms: number) => boolean;
}
