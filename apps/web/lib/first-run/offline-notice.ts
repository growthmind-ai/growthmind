import { STAGE_OFFLINE_NOTICE, STAGE_OFFLINE_SETUP_NOTICE } from "@growthmind/shared";

export interface OfflineNoticeInput {
  readonly lost: boolean;

  readonly armed: boolean;

  readonly terminal: boolean;
}

// One sentence claims a check is still running, and it is only true between arming and a
// terminal state. Everywhere else the page can claim nothing beyond its own reachability.
export function resolveOfflineNotice(input: OfflineNoticeInput): string | null {
  if (!input.lost) {
    return null;
  }

  return input.armed && !input.terminal ? STAGE_OFFLINE_NOTICE : STAGE_OFFLINE_SETUP_NOTICE;
}
