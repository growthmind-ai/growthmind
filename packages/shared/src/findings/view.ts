// Dates and durations arrive pre-formatted: React 19.2 double-invokes render, so a
// component may not construct one (see .claude/rules/components.md).

export const FINDING_GROUPS = ["explained", "described", "measurement", "withheld"] as const;

export type FindingGroup = (typeof FINDING_GROUPS)[number];

export interface FindingRow {
  readonly id: string;
  readonly group: FindingGroup;

  // Two fields, not one sentence: eleven five-clause sentences at one weight is a wall of
  // text. These are the columns the finding already has — the list shows both, at different
  // weights, and the detail page shows the whole thing.
  readonly headline: string;
  readonly context: string;

  // The honest-limit clause, held apart so it can be rendered quieter than the claim.
  readonly aside: string | null;

  // Null denominator for a row that counts something other than affected sessions.
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly observedOn: string;
}

export interface CoverageCounts {
  readonly sessionsRead: number;
  readonly sessionsSetAside: number;
  readonly found: number;
  readonly explained: number;
  readonly described: number;
  readonly withheld: number;
}

export interface OverviewView {
  readonly window: string;
  readonly coverage: CoverageCounts;

  // How the calls we already made turned out. This is the accountability claim, and it is
  // the one number on this page a reader can hold us to.
  readonly calibration: { readonly right: number; readonly wrong: number; readonly pending: number };
  readonly rows: readonly FindingRow[];
}

export const TRANSCRIPT_BEAT_KINDS = [
  "navigate",
  "click",
  "input",
  "network",
  "console",
  "exception",
  "text_appeared",
  "idle",
  "exit",
] as const;

export type TranscriptBeatKind = (typeof TRANSCRIPT_BEAT_KINDS)[number];

export interface BeatView {
  readonly index: number;
  readonly at: string;
  readonly kind: TranscriptBeatKind;
  readonly text: string;

  // Failure beats carry the weight of the finding, so they are emphasised rather
  // than coloured — a second colour would read as a severity badge.
  readonly notable: boolean;
  readonly attempt: number | null;
}

export interface ClaimView {
  readonly statement: string;

  // Beat indexes, not ids: the note is placed on the grid row of its first citation.
  readonly citesBeats: readonly number[];
  readonly citesLabel: string;
}

export interface SessionChoice {
  readonly id: string;
  readonly label: string;
}

export interface EvidenceView {
  readonly id: string;
  readonly headline: string;
  readonly countLine: string;

  readonly beats: readonly BeatView[];
  readonly claims: readonly ClaimView[];

  readonly droppedClaims: number;
  readonly cohortLine: string | null;
  readonly sessions: readonly SessionChoice[];
  readonly currentSessionId: string;
  readonly coverageLine: string;

  // Set when the mask floor refused the recording (ADD-001 AD-7). Beats stay empty and
  // the page renders its second layout rather than an empty transcript.
  readonly withheld: boolean;
}

export function rowsInGroup(
  rows: readonly FindingRow[],
  group: FindingGroup,
): readonly FindingRow[] {
  return rows.filter((row) => row.group === group);
}

export function beatsAreCited(claims: readonly ClaimView[], index: number): boolean {
  return claims.some((claim) => claim.citesBeats.includes(index));
}

// Grid rows for the margin notes, 1-based, where beat `i` occupies row `i + 1`. Two claims
// citing the same beat would otherwise be placed on one row and overlap, so each is pushed
// below its predecessor — the note stays as close to its evidence as collision allows.
export function claimRows(claims: readonly ClaimView[]): readonly number[] {
  const rows: number[] = [];
  let previous = 0;

  for (const claim of claims) {
    const anchored =
      claim.citesBeats.length === 0 ? previous + 1 : Math.min(...claim.citesBeats) + 1;

    const row = Math.max(anchored, previous + 1);
    rows.push(row);
    previous = row;
  }

  return rows;
}
