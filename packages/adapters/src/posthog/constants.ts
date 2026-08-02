import type { SessionSourceKind } from "@growthmind/shared";

export const POSTHOG_SOURCE_KIND = "posthog" satisfies SessionSourceKind;

function trimHost(host: string): string {
  return host.replace(/\/+$/, "");
}

export function eventsUrl(host: string, sourceProjectId: string): string {
  return `${trimHost(host)}/api/projects/${encodeURIComponent(sourceProjectId)}/events`;
}

export function personsUrl(host: string, sourceProjectId: string): string {
  return `${trimHost(host)}/api/projects/${encodeURIComponent(sourceProjectId)}/persons`;
}

// No `encodeURIComponent`, unlike its two siblings: the list path has nothing
// customer-supplied between host and path end. The trailing slash is the vendor's — it is
// the path the live probe in scripts/spikes/notes/posthog-projects-endpoint.md got 200 on.
export function projectsUrl(host: string): string {
  return `${trimHost(host)}/api/projects/`;
}

// Ingest origins, US before EU; the order is contract, not presentation. That live spike
// established both that `/api/projects/` is served on the ingest origin and that a
// wrong-region key answers 401, not 403 — so both statuses mean "try the next origin".
export const PROBE_ORIGINS = ["https://us.i.posthog.com", "https://eu.i.posthog.com"] as const;

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

export const OVERLAP_WINDOW_SECONDS = 900;

export const IDENTITY_LOOKUP_BUDGET = 50;

export const MAX_RATE_LIMIT_ATTEMPTS = 5;

export const REQUEST_TIMEOUT_MS = 30_000;

export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export const MAX_RESPONSE_CHUNKS = 4096;

export const BASE_DELAY_MS = 1000;

export const MAX_BACKOFF_MS = 60_000;

export const RETRY_AFTER_CAP_MS = 120_000;

export const JITTER_SPREAD_MS = 1000;
