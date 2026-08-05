import type { ReplaySourceKind } from "@growthmind/shared";

export const RRWEB_SOURCE_KIND = "rrweb" satisfies ReplaySourceKind;

export const DEFAULT_RRWEB_HOST = "https://api.rrweb.com";

// One vendor doc example also showed an "/rr" prefix; this constant is the single place
// to flip if a live probe proves it (ADD AD-4).
export const RECORDINGS_PATH = "/recordings";

function trimHost(host: string): string {
  return host.replace(/\/+$/, "");
}

export function recordingsUrl(host: string): string {
  return `${trimHost(host)}${RECORDINGS_PATH}`;
}

export function recordingEventsUrl(host: string, recordingId: string): string {
  return `${trimHost(host)}${RECORDINGS_PATH}/${encodeURIComponent(recordingId)}/events`;
}

export const PAGE_LIMIT = 100;

export const MAX_PAGES_PER_RUN = 25;

export const MAX_EVENT_PAGES = 50;

export const MAX_RATE_LIMIT_ATTEMPTS = 5;

export const REQUEST_TIMEOUT_MS = 30_000;
