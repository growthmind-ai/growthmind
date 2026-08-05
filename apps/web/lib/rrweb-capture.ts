import { start as startRrweb, type browserClientRecordOptions } from "@rrweb/browser-client";

import { logger } from "@growthmind/shared";

// AD-5a: the installed SDK has no unmask/allowlist seam, so masking has no
// exemptions — a rule that misses must fail toward masking (architecture §5).
// AD-5b: this covers text nodes and input values only. rrweb 2.1.1 serialises
// title/alt/aria-label/placeholder/data-* verbatim and offers no hook to mask them.
export const REPLAY_CAPTURE_CONFIG = {
  includePii: false,
  maskAllInputs: true,
  maskTextSelector: "*",
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
