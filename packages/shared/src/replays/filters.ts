import { z } from "zod";

import type { StampedExclusionReason } from "../exclusions/types";
import type { Origin } from "../write-keys/types";

// Changing one of these is a broken-link event for every URL anyone has shared, not a refactor.
export const REPLAY_FILTER_PARAMS = {
  company: "company",
  entry: "entry",
  who: "who",
} as const;

export type ReplayFilterParam = (typeof REPLAY_FILTER_PARAMS)[keyof typeof REPLAY_FILTER_PARAMS];

export const REPLAY_LANES = ["real", "simulated", "excluded"] as const;

export const replayLaneSchema = z.enum(REPLAY_LANES);

export type ReplayLane = z.infer<typeof replayLaneSchema>;

export const REPLAY_DEFAULT_LANE: ReplayLane = "real";

export const replayFiltersSchema = z.object({
  company: z.string().nullable(),
  entry: z.string().nullable(),
  lane: replayLaneSchema.catch(REPLAY_DEFAULT_LANE),
});

export type ReplayFilters = z.infer<typeof replayFiltersSchema>;

export type ReplaySearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

// A repeated param is malformed, and picking one of the values would be inventing a tie-break
// nobody wrote. Dropping it fails toward more rows, never toward another tenant's.
function soleValue(raw: string | readonly string[] | undefined): string | null {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// The one parse: the page calls it against searchParams and the filter bar takes props.
export function replayFiltersOf(search: ReplaySearchParams): ReplayFilters {
  return replayFiltersSchema.parse({
    company: soleValue(search[REPLAY_FILTER_PARAMS.company]),
    entry: soleValue(search[REPLAY_FILTER_PARAMS.entry]),
    lane: soleValue(search[REPLAY_FILTER_PARAMS.who]),
  });
}

// Both time fields are seconds, pass-through, no arithmetic; null is unmeasured and 0 is a
// measurement. See .ai/decisions/0020-o-050-recording-meta-on-the-session-row.md.
export interface RecordingMetaStamp {
  readonly durationSeconds: number | null;
  readonly activeSeconds: number | null;
  readonly clickCount: number | null;
  readonly keypressCount: number | null;
  readonly consoleErrorCount: number | null;
}

// The structural fact packages/core takes, mirroring GroupableSessionFact one directory over.
export interface ReplaySessionFact extends RecordingMetaStamp {
  readonly sessionKey: string;
  readonly startedAt: Date;
  readonly identityEmailDomain: string | null;
  readonly entryUrlPath: string | null;
  readonly origin: Origin;
  readonly exclusionReason: StampedExclusionReason;
}
