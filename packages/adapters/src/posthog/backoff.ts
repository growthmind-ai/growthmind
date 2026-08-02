import { BASE_DELAY_MS, JITTER_SPREAD_MS, MAX_BACKOFF_MS, RETRY_AFTER_CAP_MS } from "./constants";

export interface BackoffInput {
  readonly attempt: number;

  readonly retryAfterSeconds: number | null;

  readonly random: number;
}

export function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) {
    return null;
  }
  const trimmed = header.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const seconds = Number(trimmed);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return null;
  }
  return seconds;
}

export function computeBackoffDelayMs(input: BackoffInput): number {
  const random = Math.min(Math.max(input.random, 0), 1);

  if (input.retryAfterSeconds !== null && input.retryAfterSeconds > 0) {
    const instructed = Math.min(input.retryAfterSeconds * 1000, RETRY_AFTER_CAP_MS);

    return Math.round(instructed + random * JITTER_SPREAD_MS);
  }

  const attempt = Math.max(1, Math.floor(input.attempt));
  const capped = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);

  return Math.round(capped * (0.5 + 0.5 * random));
}
