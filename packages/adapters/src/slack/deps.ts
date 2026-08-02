type FetchLike = typeof globalThis.fetch;

export interface SlackPosterConfig {
  readonly botToken: string;
}

export interface SlackPosterDeps {
  readonly fetch: FetchLike;
}
