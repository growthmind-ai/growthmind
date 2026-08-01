// Every cross-boundary string for the spike lives here (taxonomy): env var names,
// event names, the marker property, endpoint URL builders, and run defaults. Capture
// and poll sides both import from this module, never a raw string at a call site.

/** Canonical env var names. Values equal keys so call sites can't typo one. */
export const ENV_VARS = {
  POSTHOG_HOST: "POSTHOG_HOST",
  POSTHOG_PROJECT_API_KEY: "POSTHOG_PROJECT_API_KEY",
  POSTHOG_PERSONAL_API_KEY: "POSTHOG_PERSONAL_API_KEY",
  POSTHOG_PROJECT_ID: "POSTHOG_PROJECT_ID",
  /** Optional, recording-leg browser override. */
  CHROME_PATH: "CHROME_PATH",
} as const;

/** The four variables the credential gate requires. */
export const REQUIRED_ENV_VARS = [
  ENV_VARS.POSTHOG_HOST,
  ENV_VARS.POSTHOG_PROJECT_API_KEY,
  ENV_VARS.POSTHOG_PERSONAL_API_KEY,
  ENV_VARS.POSTHOG_PROJECT_ID,
] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

/** Event names captured by the three legs. */
export const EVENT_NAMES = {
  customEvent: "gm_spike_custom_event",
  exception: "$exception",
  /** the declared fallback shape if `$exception` never becomes readable. */
  failedRequest: "gm_spike_failed_request",
} as const;

/** The per-trial marker property both capture and poll key on. */
export const MARKER_PROP = "gm_spike_marker";

/** Run defaults. All overridable via CLI flags. */
export const DEFAULT_TRIALS = 20;
export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const DEFAULT_TIMEOUT_MS = 120_000;

function trimHost(host: string): string {
  return host.replace(/\/+$/, "");
}

/** Ingestion capture endpoint (project phc_ key). */
export function captureUrl(host: string): string {
  return `${trimHost(host)}/capture/`;
}

/** Events list read API (personal phx_ key), primary endpoint. */
export function eventsUrl(host: string, projectId: string): string {
  return `${trimHost(host)}/api/projects/${projectId}/events`;
}

/** HogQL query API (personal phx_ key), secondary endpoint. */
export function queryUrl(host: string, projectId: string): string {
  return `${trimHost(host)}/api/projects/${projectId}/query`;
}

/** Session recordings list API (personal phx_ key), recording leg. */
export function recordingsUrl(host: string, projectId: string): string {
  return `${trimHost(host)}/api/projects/${projectId}/session_recordings`;
}
