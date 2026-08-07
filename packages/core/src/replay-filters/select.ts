import { EXCLUSION_REASON_LABELS, recordingIdFromSessionKey } from "@growthmind/shared";
import type { ReplayFilters, ReplayLane, ReplaySessionFact } from "@growthmind/shared";

import { laneOf } from "./lanes";

// The row the list renders. Both seconds fields are seconds, carried through untouched, and null
// stays null all the way to the badge: null is unmeasured, 0 is a measurement.
export interface ReplayListRow {
  readonly recordingId: string;
  readonly sessionKey: string;
  readonly startedAt: string;
  readonly companyDomain: string | null;
  readonly entryUrlPath: string | null;
  readonly lane: ReplayLane;
  readonly exclusionLabel: string | null;
  readonly durationSeconds: number | null;
  readonly activeSeconds: number | null;
  readonly clickCount: number | null;
  readonly keypressCount: number | null;
  readonly consoleErrorCount: number | null;
}

export interface ReplayProvenance {
  readonly replays: number;
  readonly sessions: number;
}

export interface ReplaySelection {
  readonly rows: readonly ReplayListRow[];
  readonly provenance: ReplayProvenance;
}

export function toReplayRow(fact: ReplaySessionFact): ReplayListRow | null {
  const recordingId = recordingIdFromSessionKey(fact.sessionKey);
  if (recordingId === null) return null;

  const lane = laneOf(fact);

  return {
    recordingId,
    sessionKey: fact.sessionKey,
    startedAt: fact.startedAt.toISOString(),
    companyDomain: fact.identityEmailDomain,
    entryUrlPath: fact.entryUrlPath,
    lane,
    exclusionLabel: lane === "excluded" ? EXCLUSION_REASON_LABELS[fact.exclusionReason] : null,
    durationSeconds: fact.durationSeconds,
    activeSeconds: fact.activeSeconds,
    clickCount: fact.clickCount,
    keypressCount: fact.keypressCount,
    consoleErrorCount: fact.consoleErrorCount,
  };
}

// The lane is the read's, not the selection's: R1 is already lane-scoped in SQL, and applying it
// again here would leave no way to ask the all-lanes question the way out needs.
function matches(session: ReplaySessionFact, filters: ReplayFilters): boolean {
  if (filters.company !== null && session.identityEmailDomain !== filters.company) return false;
  if (filters.entry !== null && session.entryUrlPath !== filters.entry) return false;
  return true;
}

// One pass produces both the rows and the numerator, so the sentence and the cards below it
// cannot disagree. A session with no recording id is counted and not listed — the gap the tail
// note explains.
export function selectReplaySessions(
  sessions: readonly ReplaySessionFact[],
  filters: ReplayFilters,
): ReplaySelection {
  const rows: ReplayListRow[] = [];
  let matched = 0;

  for (const session of sessions) {
    if (!matches(session, filters)) continue;
    matched += 1;

    const row = toReplayRow(session);
    if (row !== null) rows.push(row);
  }

  return { rows, provenance: { replays: rows.length, sessions: matched } };
}
