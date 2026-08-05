import type { ReplayFailureCode } from "./types";

export const REPLAY_FAILURE_MESSAGES: Record<ReplayFailureCode, string> = {
  invalid_credentials: "That key did not work. Check you copied it correctly, then try again.",
  missing_read_scope:
    "That key can only record sessions, not read them back. Create a new key with read access at app.rrweb.com/api-keys, then try again.",
  recording_not_found:
    "We could not find that recording. It may have been deleted, or the reference we kept for it is out of date.",
  unreachable:
    "We could not reach your recording source. Check the address is correct and reachable from this machine, then try again.",
  rate_limited:
    "Your recording source asked us to slow down, so we stopped this check early. We will pick up where we left off on the next one.",
  misconfigured:
    "This installation cannot read session replays yet. Complete the replay source setup, then try again.",
};

// What the person watching sees, as opposed to what the adapter hit. Each names the one
// thing to do next rather than stating that something went wrong.
export const REPLAY_NO_CONNECTION =
  "Connect your analytics to watch recordings. Recordings come from the same place your events do, so there is nothing to show until it is connected.";

export const REPLAY_NONE_YET =
  "No recordings yet. They appear here once people have used your product and their sessions have finished.";

export const REPLAY_LIST_UNREADABLE =
  "We could not load your recordings just now. Nothing is lost — try again in a moment.";

export const REPLAY_EMPTY_RECORDING =
  "This recording arrived empty, so there is nothing to play. That usually means the session ended before anything was captured.";

export const ALL_REPLAY_SOURCE_MESSAGES: readonly string[] = [
  ...Object.values(REPLAY_FAILURE_MESSAGES),
  REPLAY_NO_CONNECTION,
  REPLAY_NONE_YET,
  REPLAY_LIST_UNREADABLE,
  REPLAY_EMPTY_RECORDING,
];
