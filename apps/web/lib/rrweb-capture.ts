import { start as startRrweb, type browserClientRecordOptions } from "@rrweb/browser-client";

import { logger } from "@growthmind/shared";

// AD-5a: the installed SDK has no unmask/allowlist seam, so masking has no
// exemptions — a rule that misses must fail toward masking (architecture §5).
export const REPLAY_CAPTURE_CONFIG = {
  includePii: false,
  maskAllInputs: true,
  maskTextSelector: "*",
} as const;

type StartFn = (options: browserClientRecordOptions) => void;

export function startReplayCapture(startFn: StartFn = startRrweb): void {
  const publicApiKey = process.env.NEXT_PUBLIC_RRWEB_PUBLIC_KEY;
  if (!publicApiKey) {
    return;
  }

  try {
    startFn({ publicApiKey, ...REPLAY_CAPTURE_CONFIG });
  } catch (error) {
    logger.error("rrweb capture failed to start; recording is disabled", { error });
  }
}
