import type { ReplayFailureCode } from "./types";

export const REPLAY_FAILURE_MESSAGES: Record<ReplayFailureCode, string> = {
  invalid_credentials:
    "That key did not work. Check you copied your rrweb personal key correctly, then try again.",
  missing_read_scope:
    "That key can only record sessions, not read them back. Create a new key with read access at app.rrweb.com/api-keys, then try again.",
  recording_not_found:
    "We could not find that recording. It may have been deleted, or the reference we kept for it is out of date.",
  unreachable:
    "We could not reach your recording source. Check the address is correct and reachable from this machine, then try again.",
  rate_limited:
    "Your recording source asked us to slow down, so we stopped this check early. We will pick up where we left off on the next one.",
  misconfigured: "This installation cannot read session replays yet. Complete the replay source setup, then try again.",
};

export const ALL_REPLAY_SOURCE_MESSAGES: readonly string[] = Object.values(REPLAY_FAILURE_MESSAGES);
