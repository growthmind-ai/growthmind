// @growthmind/adapters — outbound ports and their vendor implementations.
//
// Nothing credential-bearing is exported from here. The port's own shapes all
// live in @growthmind/shared, so a consumer that only needs a shape does not
// need this package at all — which is what keeps packages/db free of any
// dependency on it (the connection service injects its source factory).
export type { SessionSource } from "./session-source";

export { createPostHogSessionSource } from "./posthog/session-source";
export { POSTHOG_SOURCE_KIND } from "./posthog/constants";
export type { PostHogSourceConfig, PostHogSourceDeps, FetchLike } from "./posthog/deps";
