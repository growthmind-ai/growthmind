export const ENV_VARS = {
  POSTHOG_HOST: "POSTHOG_HOST",
  POSTHOG_PROJECT_API_KEY: "POSTHOG_PROJECT_API_KEY",
  POSTHOG_PERSONAL_API_KEY: "POSTHOG_PERSONAL_API_KEY",
  POSTHOG_PROJECT_ID: "POSTHOG_PROJECT_ID",

  CHROME_PATH: "CHROME_PATH",
} as const;

export const REQUIRED_ENV_VARS = [
  ENV_VARS.POSTHOG_HOST,
  ENV_VARS.POSTHOG_PROJECT_API_KEY,
  ENV_VARS.POSTHOG_PERSONAL_API_KEY,
  ENV_VARS.POSTHOG_PROJECT_ID,
] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export const EVENT_NAMES = {
  customEvent: "gm_spike_custom_event",
  exception: "$exception",

  failedRequest: "gm_spike_failed_request",
} as const;

export const MARKER_PROP = "gm_spike_marker";

export const DEFAULT_TRIALS = 20;
export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const DEFAULT_TIMEOUT_MS = 120_000;

function trimHost(host: string): string {
  return host.replace(/\/+$/, "");
}

export function captureUrl(host: string): string {
  return `${trimHost(host)}/capture/`;
}

export function eventsUrl(host: string, projectId: string): string {
  return `${trimHost(host)}/api/projects/${projectId}/events`;
}

export function queryUrl(host: string, projectId: string): string {
  return `${trimHost(host)}/api/projects/${projectId}/query`;
}

export function recordingsUrl(host: string, projectId: string): string {
  return `${trimHost(host)}/api/projects/${projectId}/session_recordings`;
}
