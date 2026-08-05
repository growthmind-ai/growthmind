import type { ReplaySourceKind, SessionSourceKind } from "@growthmind/shared";

export const POSTHOG_SOURCE_KIND = "posthog" satisfies SessionSourceKind;
export const POSTHOG_REPLAY_SOURCE_KIND = "posthog" satisfies ReplaySourceKind;

function trimHost(host: string): string {
  return host.replace(/\/+$/, "");
}

export function eventsUrl(host: string, sourceProjectId: string): string {
  return `${trimHost(host)}/api/projects/${encodeURIComponent(sourceProjectId)}/events`;
}

export function personsUrl(host: string, sourceProjectId: string): string {
  return `${trimHost(host)}/api/projects/${encodeURIComponent(sourceProjectId)}/persons`;
}

// Nothing customer-supplied to encode, and the trailing slash is the vendor's.
// see scripts/spikes/notes/posthog-projects-endpoint.md
export function projectsUrl(host: string): string {
  return `${trimHost(host)}/api/projects/`;
}

// Order is contract: a wrong-region key answers 401, not 403, so both mean "try the next".
export const PROBE_ORIGINS = ["https://us.i.posthog.com", "https://eu.i.posthog.com"] as const;

// Every key is SDK-set and may be absent: PostHog derives none server-side. Always optional.
export const PH_PROP = {
  SET: "$set",

  RAW_USER_AGENT: "$raw_user_agent",

  PATHNAME: "$pathname",

  CURRENT_URL: "$current_url",

  SESSION_ID: "$session_id",
} as const;

export const PAGE_LIMIT = 200;

export const PINNED_PAGE_LIMIT_FLOOR = 220;

export const MAX_PAGES_PER_RUN = 25;

// Recordings are a different listing endpoint from events, sized independently of
// PAGE_LIMIT/PINNED_PAGE_LIMIT_FLOOR above (those are pinned to the events endpoint).
export const RECORDINGS_PAGE_LIMIT = 100;

export const OVERLAP_WINDOW_SECONDS = 900;

export const IDENTITY_LOOKUP_BUDGET = 50;

export const MAX_RATE_LIMIT_ATTEMPTS = 5;

export const REQUEST_TIMEOUT_MS = 30_000;
