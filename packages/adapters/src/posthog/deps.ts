import type { IdentityHmacKey } from "@growthmind/shared";

export type FetchLike = typeof globalThis.fetch;

export interface PostHogSourceDeps {
  readonly fetch: FetchLike;

  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => Date;

  readonly random: () => number;

  readonly identityHmacKey: IdentityHmacKey;

  readonly deadlineExceededAfter?: (ms: number) => boolean;
}

export interface PostHogSourceConfig {
  readonly host: string;

  readonly sourceProjectId: string;

  readonly personalApiKey: string;
}
