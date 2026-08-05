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

// The vendor answers HTTP 400 "Cannot request more than 20 blob keys at once" above this
// span (verified live against eu.posthog.com, 2026-08-05); a recording of a few minutes
// already exceeds it, so pullEvents must chunk the blob-key range rather than request it whole.
export const MAX_BLOB_KEY_SPAN = 20;

// Bounds pullEvents' chunk walk the same way MAX_PAGES_PER_RUN bounds listRecordings' page
// walk — this package's structural test forbids an unbounded loop.
export const MAX_BLOB_CHUNKS_PER_PULL = 25;

// Bounds the same walk by bytes: the measured complete-pull p90 of 16.26 MiB, rounded up
// to the next power of two. Re-derive it from complete pulls only — a pooled p90 rounds
// to 16 MiB and truncates the largest recording measured.
export const MAX_PULL_BYTES = 33_554_432;

export const OVERLAP_WINDOW_SECONDS = 900;

export const IDENTITY_LOOKUP_BUDGET = 50;

export const MAX_RATE_LIMIT_ATTEMPTS = 5;

export const REQUEST_TIMEOUT_MS = 30_000;
