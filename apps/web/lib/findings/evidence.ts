import { beatsFromActions, type CauseBeatEvidence } from "@growthmind/core";
import type { CauseClaimRecord, FindingRecord, SessionRecordingCitation } from "@growthmind/db";
import { citesLabel, type BeatView, type ClaimView } from "@growthmind/shared";

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;

export type CitationsForFn = (
  projectId: string,
  sessionIds: readonly string[],
) => Promise<readonly SessionRecordingCitation[]>;

export interface EvidenceBuildResult {
  readonly beats: readonly BeatView[];
  readonly claims: readonly ClaimView[];
  readonly droppedClaims: number;
}

// Matches packages/core/src/replay/render.ts's own stamp format (minutes unpadded, seconds
// zero-padded) so a beat's timestamp reads the same wherever it is rendered.
function stampOf(atMs: number): string {
  const totalSeconds = Math.floor(atMs / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function beatViewOf(beat: CauseBeatEvidence): BeatView {
  return {
    index: beat.index,
    at: stampOf(beat.atMs),
    kind: beat.kind,
    text: beat.text,
    notable: beat.notable,
    attempt: beat.attempt,
  };
}

function firstCitedBeat(
  beats: readonly CauseBeatEvidence[],
  citesBeats: readonly number[],
): CauseBeatEvidence | undefined {
  const index = citesBeats[0];
  return index === undefined ? undefined : beats[index];
}

// Pre-built, never constructed client-side (view.ts:1-2). Null when the anchor session's own
// citation is unresolvable (mask/withheld, D5) — falling back to a dead link is worse than no
// link at all.
function hrefOf(
  citation: SessionRecordingCitation | undefined,
  cited: CauseBeatEvidence | undefined,
): string | null {
  if (citation === undefined || cited === undefined) return null;
  return `/replays/${citation.recordingId}?t=${String(cited.atMs)}`;
}

function claimViewOf(
  claim: CauseClaimRecord["claims"][number],
  beats: readonly CauseBeatEvidence[],
  citation: SessionRecordingCitation | undefined,
): ClaimView {
  const cited = firstCitedBeat(beats, claim.citesBeats);

  return {
    statement: claim.statement,
    citesBeats: claim.citesBeats,
    citesLabel: citesLabel(cited === undefined ? "" : stampOf(cited.atMs)),
    citesHref: hrefOf(citation, cited),
  };
}

// The EvidenceView builder (ADD Decision 8) — only ever called with a non-null causeClaims
// row, and only then does it call citationsFor at all (Decision 3's "row existence is the
// attempted signal" predicate, re-checked here rather than re-derived differently).
export async function buildEvidenceView(
  finding: FindingRecord,
  causeClaims: CauseClaimRecord | null,
  citationsFor: CitationsForFn,
): Promise<EvidenceBuildResult | null> {
  if (causeClaims === null) return null;

  const citations = await citationsFor(finding.projectId, [causeClaims.anchorSessionId]);
  const citation = citations.find((entry) => entry.sessionId === causeClaims.anchorSessionId);

  const beats: readonly CauseBeatEvidence[] =
    citation === undefined || citation.actions === null ? [] : beatsFromActions(citation.actions);

  return {
    beats: beats.map(beatViewOf),
    claims: causeClaims.claims.map((claim) => claimViewOf(claim, beats, citation)),
    droppedClaims: causeClaims.droppedClaims,
  };
}
