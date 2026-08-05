import { start as startRrweb, type browserClientRecordOptions } from "@rrweb/browser-client";

import { logger } from "@growthmind/shared";

import { REPLAY_MASKING } from "./replay-masking";

// includePii is this vendor's own switch; the masking it shares with the PostHog recorder
// comes from one place so the two cannot answer the same question differently (B-049).
export const REPLAY_CAPTURE_CONFIG = {
  includePii: false,
  ...REPLAY_MASKING,
} as const;

type StartFn = (options: browserClientRecordOptions) => void;

// Latched before the start call, not after: a throwing start still leaves a
// half-open recorder behind it, so a retry would risk a second WebSocket on
// top of that half-open one. The guard closes on attempt, not on success.
let started = false;

export function startReplayCapture(startFn: StartFn = startRrweb): void {
  const publicApiKey = process.env.NEXT_PUBLIC_RRWEB_PUBLIC_KEY;
  if (!publicApiKey || started) {
    return;
  }
  started = true;

  try {
    startFn({ publicApiKey, ...REPLAY_CAPTURE_CONFIG });
  } catch (error) {
    logger.error("rrweb capture failed to start; recording is disabled", { error });
  }
}

// Test-only: the guard is module-level state, so tests need a way back to
// "no page load has happened yet" between cases.
export function resetReplayCaptureGuardForTests(): void {
  started = false;
}
