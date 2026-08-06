import type { ReplaySource } from "@growthmind/adapters";
import {
  compactTranscript,
  countNotable,
  buildTranscript,
  renderDigest,
  renderRecordingFloor,
  renderTranscript,
  renderWithheldRecordingFloor,
  readPersistedTranscript,
  resumeDigest,
  reviewFindingText,
  serialisePersistedTranscript,
  PERSISTED_TRANSCRIPT_VERSION,
} from "@growthmind/core";
import type { FloorNarration, ScannedText, TranscriptDigest } from "@growthmind/core";
import type {
  PersistRecordingSummaryInput,
  RecordingSummariesRepo,
  RefreshFailedPullInput,
  TranscriptPullStop,
} from "@growthmind/db";
import {
  recordingSessionKey,
  REPLAY_PULL_STOP_MESSAGES,
  SESSION_GROUPING_VERSION,
} from "@growthmind/shared";
import type {
  ReplayEventsResult,
  ReplayRecordingSummary,
  ReplaySourceKind,
  RrwebEvent,
  SummarySource,
  TenantContext,
} from "@growthmind/shared";

import type { AnalysisLogger } from "../analysis/types";
import type { ConfiguredNarrator } from "./narrator-deps";

export type ReplayLane = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly projectId: string;
};

export interface ReplayLaneSource {
  listDueLanes(): Promise<readonly ReplayLane[]>;
}

export type ResolvedReplaySource =
  | { readonly ok: true; readonly source: ReplaySource }
  | { readonly ok: false; readonly code: string };

export interface ReplayNarrationDeps {
  readonly lanes: ReplayLaneSource;
  readonly sourceFor: (ctx: TenantContext, projectId: string) => Promise<ResolvedReplaySource>;
  readonly summariesFor: (ctx: TenantContext) => RecordingSummariesRepo;
  readonly contextFor: (lane: ReplayLane) => TenantContext;

  readonly narrator: ConfiguredNarrator | null;

  readonly perProjectCap: number;

  // Lanes are unbounded, so the per-lane cap bounds a lane and nothing else. This bounds the tick.
  readonly perTickCap: number;

  readonly listPages: number;

  readonly logger: AnalysisLogger;
}

export type ReplayNarrationOutcome = {
  readonly lanesRead: number;
  readonly summarised: number;
  readonly retried: number;
  readonly skipped: number;
  readonly failed: number;
};

type NarrationText = {
  readonly summarySource: SummarySource;
  readonly headline: string;
  readonly context: readonly string[];
};

async function narrationFor(
  digest: TranscriptDigest,
  narrator: ConfiguredNarrator | null,
): Promise<{ text: NarrationText; tokensIn: number | null; tokensOut: number | null }> {
  const floor = renderRecordingFloor(digest);

  if (narrator === null) {
    return {
      text: { summarySource: "floor_no_key_configured", ...floor },
      tokensIn: null,
      tokensOut: null,
    };
  }

  const result = await narrator.port.narrate({
    digest: renderDigest(digest),
    pages: digest.pages,
    durationMs: digest.durationMs,
  });

  const tokensIn = result.usage.inputTokens ?? null;
  const tokensOut = result.usage.outputTokens ?? null;

  if (!result.ok) {
    const summarySource: SummarySource =
      result.code === "output_invalid" ? "floor_model_output_invalid" : "floor_model_call_failed";

    return { text: { summarySource, ...floor }, tokensIn, tokensOut };
  }

  return {
    text: {
      summarySource: "model_rendered",
      headline: result.headline,
      context: [result.context],
    },
    tokensIn,
    tokensOut,
  };
}

type ScannedNarration = {
  readonly summarySource: SummarySource;
  readonly headline: ScannedText;
  readonly context: readonly ScannedText[];
};

// Model text passes the same residual-PII seam as every other producer of written text, and
// so does the floor: a recorded url can carry an identifier the templates then repeat.
function scan(text: NarrationText): ScannedNarration | null {
  const verdict = reviewFindingText({ headline: text.headline, context: [...text.context] });

  if (verdict.held) {
    return null;
  }

  return {
    summarySource: text.summarySource,
    headline: verdict.headline,
    context: verdict.context,
  };
}

// Three rungs, and the last cannot fail: model text, then the measured floor, then the
// floor with every substituted value dropped. A recording always ends with a summary.
function scanDown(narrated: NarrationText, floor: FloorNarration): ScannedNarration {
  const withheld = renderWithheldRecordingFloor();

  return (
    scan(narrated) ??
    scan({ summarySource: "floor_model_text_rejected", ...floor }) ??
    (scan({ summarySource: "floor_model_text_rejected", ...withheld }) as ScannedNarration)
  );
}

type PullOutcome = {
  readonly events: readonly RrwebEvent[];
  readonly stop: TranscriptPullStop;
  readonly reason: string | null;
  readonly bytesReceived: number | null;
  readonly resumeCursor: string | null;
};

// The rrweb source reads parsed JSON pages and reports 0 on every arm, so carrying its count
// through would store "not measured" as "measured zero".
function readPull(provider: ReplaySourceKind, pulled: ReplayEventsResult): PullOutcome {
  const bytesReceived = provider === "rrweb" ? null : pulled.bytesReceived;

  if (!pulled.ok) {
    return {
      events: pulled.partialEvents,
      stop: "failed",
      reason: pulled.failure.message,
      bytesReceived,
      resumeCursor: pulled.resumeCursor,
    };
  }

  return {
    events: pulled.events,
    stop: pulled.stop,
    reason: pulled.stop === "exhausted" ? null : REPLAY_PULL_STOP_MESSAGES[pulled.stop],
    bytesReceived,
    resumeCursor: pulled.stop === "exhausted" ? null : pulled.resumeCursor,
  };
}

type PulledEvidence = {
  readonly digest: TranscriptDigest;
  readonly transcript: string;
  readonly pull: PullOutcome;
  readonly watermark: Date | null;
  readonly clockOriginAtMs: number | null;
};

// One builder for the first attempt and the retry, so a re-read row can never carry a different
// shape from the row it replaces.
function evidenceFor(args: PulledEvidence) {
  return {
    transcript: args.transcript,
    pages: args.digest.pages,
    durationMs: args.digest.durationMs,
    actionCount: args.digest.actions.length + args.digest.omitted,
    notableCount: countNotable(args.digest.actions),
    droppedEvents: args.digest.droppedEvents,

    // What the narrator read, beat for beat: a citation resting on a beat the row never
    // stored is the break this outcome exists to close.
    actions: serialisePersistedTranscript(args.digest.actions, PERSISTED_TRANSCRIPT_VERSION),
    actionsVersion: PERSISTED_TRANSCRIPT_VERSION,
    actionsOmitted: args.digest.omitted,

    pullStop: args.pull.stop,
    pullReason: args.pull.reason,
    pullWatermarkAt: args.watermark,
    bytesReceived: args.pull.bytesReceived,

    pullResumeCursor: args.pull.resumeCursor,
    pullOriginAt: args.clockOriginAtMs === null ? null : new Date(args.clockOriginAtMs),
  };
}

function persistInputFor(
  args: PulledEvidence & {
    readonly projectId: string;
    readonly provider: ReplaySourceKind;
    readonly recording: ReplayRecordingSummary;
    readonly text: ScannedNarration;
    readonly resolvedModelId: string | null;
    readonly tokensIn: number | null;
    readonly tokensOut: number | null;
  },
): PersistRecordingSummaryInput {
  const sessionKey = recordingSessionKey(args.provider, args.recording.recordingId);

  return {
    projectId: args.projectId,
    recordingId: args.recording.recordingId,
    summarySource: args.text.summarySource,
    headline: args.text.headline,
    context: args.text.context,
    startedAt: args.recording.startedAt,

    provider: args.provider,
    sessionKey,
    sessionGroupingVersion: sessionKey === null ? null : SESSION_GROUPING_VERSION,

    ...evidenceFor(args),

    resolvedModelId: args.resolvedModelId,
    tokensIn: args.tokensIn,
    tokensOut: args.tokensOut,
  };
}

function refreshInputFor(
  args: PulledEvidence & {
    readonly projectId: string;
    readonly recording: ReplayRecordingSummary;
  },
): RefreshFailedPullInput {
  return {
    projectId: args.projectId,
    recordingId: args.recording.recordingId,
    ...evidenceFor(args),
  };
}

type PullAttempt = "first" | "retry";

async function narrateOne(
  deps: ReplayNarrationDeps,
  lane: ReplayLane,
  source: ReplaySource,
  summaries: RecordingSummariesRepo,
  recording: ReplayRecordingSummary,
  watermark: Date | null,
  attempt: PullAttempt,
): Promise<void> {
  // The held row is what an earlier attempt already read: its resume cursor tells the source
  // where to continue rather than re-fetching chunks it already paid for, and its clock origin
  // keeps the continuation's atMs on the same timeline as the beats already stored.
  const held = attempt === "retry" ? await summaries.findFor(lane.projectId, recording.recordingId) : null;
  const resumeFrom = held?.pullResumeCursor ?? null;
  const priorClockOriginAtMs = held?.pullOriginAt === null || held?.pullOriginAt === undefined
    ? null
    : held.pullOriginAt.getTime();

  const pulled = await source.pullEvents(
    recording.recordingId,
    resumeFrom === null ? undefined : { resumeFrom },
  );
  const pull = readPull(source.kind, pulled);

  if (!pulled.ok) {
    deps.logger.info(
      `replay narration: recording ${recording.recordingId} in project ${lane.projectId} was ` +
        `read only in part (${pulled.failure.code}); narrating what arrived`,
    );
  }

  const freshWalk = buildTranscript(pull.events, priorClockOriginAtMs);

  // A held row carries only the digest an earlier attempt persisted, not the raw events behind
  // it — resumeDigest continues that digest with the newly pulled beats rather than replacing it,
  // so a resumed pull never reports fewer beats than the row already held. Re-read through
  // readPersistedTranscript rather than trusting the stored shape: it is the one place a stored
  // payload is proven readable, on this boundary same as any other (D5).
  const heldTranscript = held === null ? null : readPersistedTranscript(held.actions);

  const { walk, digest } =
    heldTranscript === null || held === null
      ? { walk: freshWalk, digest: compactTranscript(freshWalk) }
      : resumeDigest(
          {
            actions: heldTranscript.actions,
            omitted: held.actionsOmitted ?? 0,
            pages: held.pages,
            durationMs: held.durationMs,
            droppedEvents: held.droppedEvents,
            clockOriginAtMs: priorClockOriginAtMs,
          },
          freshWalk,
        );

  const evidence = {
    digest,
    transcript: renderTranscript(walk),
    pull,
    watermark,
    clockOriginAtMs: walk.clockOriginAtMs,
  };

  // The row already carries a narration bought with a model call, and the words describe a
  // recording, not a pull. Re-reading the beats does not buy a second one.
  if (attempt === "retry") {
    await summaries.refreshFailedPull(
      refreshInputFor({ projectId: lane.projectId, recording, ...evidence }),
    );

    return;
  }

  const narrated = await narrationFor(digest, deps.narrator);
  const text = scanDown(narrated.text, renderRecordingFloor(digest));

  await summaries.persist(
    persistInputFor({
      projectId: lane.projectId,
      provider: source.kind,
      recording,
      ...evidence,
      text,
      resolvedModelId: deps.narrator?.resolvedModelId ?? null,
      tokensIn: narrated.tokensIn,
      tokensOut: narrated.tokensOut,
    }),
  );
}

// The watermark is max(started_at) over the rows a project holds, and `sinceAt` drops everything
// at or below it. That is only safe while every recording below the newest held row is already
// held — so a lane drains from the oldest end. Reading the newest first advanced the watermark
// past a backlog that was then never listed again (B-053).
function oldestFirst(
  recordings: readonly ReplayRecordingSummary[],
): readonly ReplayRecordingSummary[] {
  return recordings.toSorted(
    (left, right) => (left.startedAt?.getTime() ?? 0) - (right.startedAt?.getTime() ?? 0),
  );
}

type LaneTally = {
  summarised: number;
  retried: number;
  skipped: number;
  failed: number;
  attempted: number;
};

async function runLane(
  deps: ReplayNarrationDeps,
  lane: ReplayLane,
  budget: number,
): Promise<LaneTally> {
  const ctx = deps.contextFor(lane);
  const tally: LaneTally = { summarised: 0, retried: 0, skipped: 0, failed: 0, attempted: 0 };

  const resolved = await deps.sourceFor(ctx, lane.projectId);
  if (!resolved.ok) {
    deps.logger.info(
      `replay narration: project ${lane.projectId} has no readable recording source ` +
        `(${resolved.code}), so nothing was summarised`,
    );
    return tally;
  }

  const summaries = deps.summariesFor(ctx);
  const watermark = await summaries.latestStartedAt(lane.projectId);

  const listed = await resolved.source.listRecordings({
    sinceAt: watermark,
    maxPages: deps.listPages,
  });

  const recordings = listed.ok ? listed.recordings : listed.partialRecordings;

  if (!listed.ok) {
    deps.logger.info(
      `replay narration: project ${lane.projectId} listed only in part ` +
        `(${listed.failure.code}); continuing with ${String(recordings.length)} recordings`,
    );
  }

  const recordingIds = recordings.map((recording) => recording.recordingId);
  const known = await summaries.summarisedIds(lane.projectId, recordingIds);
  const retryable = await summaries.retryablePullIds(lane.projectId, recordingIds);

  const fresh = recordings.filter((recording) => !known.has(recording.recordingId));
  const retries = recordings.filter((recording) => retryable.has(recording.recordingId));

  tally.skipped = recordings.length - fresh.length - retries.length;

  // Recordings with no row at all go first: one the source will never serve comes back every
  // tick, and must not hold a slot ahead of a recording nobody has read yet. A retry already
  // holds a row, so it cannot move the watermark whichever slot it takes.
  const due = [...oldestFirst(fresh), ...oldestFirst(retries)].slice(0, budget);

  for (const recording of due) {
    const attempt: PullAttempt = retryable.has(recording.recordingId) ? "retry" : "first";

    try {
      await narrateOne(deps, lane, resolved.source, summaries, recording, watermark, attempt);

      if (attempt === "retry") {
        tally.retried += 1;
      } else {
        tally.summarised += 1;
      }
    } catch (error) {
      tally.failed += 1;
      deps.logger.error(
        `replay narration: recording ${recording.recordingId} in project ${lane.projectId} ` +
          `could not be summarised: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  tally.attempted = due.length;

  if (fresh.length + retries.length > due.length) {
    // Usually later than the watermark this tick advanced to, so a later tick lists them again —
    // except when one sits at the exact instant the budget cut, which the watermark cannot
    // distinguish from "already read" (B-053's residual). Left as a name-and-count, not a promise.
    deps.logger.info(
      `replay narration: project ${lane.projectId} had ${String(fresh.length + retries.length)} ` +
        `recordings to read and this tick read the ${String(due.length)} oldest; ` +
        `${String(fresh.length + retries.length - due.length)} were left for a later tick`,
    );
  }

  return tally;
}

export async function runReplayNarrationTick(
  deps: ReplayNarrationDeps,
): Promise<ReplayNarrationOutcome> {
  const lanes = await deps.lanes.listDueLanes();
  const total = { lanesRead: 0, summarised: 0, retried: 0, skipped: 0, failed: 0 };
  let budget = deps.perTickCap;

  for (const lane of lanes) {
    if (budget <= 0) {
      deps.logger.info(
        `replay narration: this tick reached its ceiling of ${String(deps.perTickCap)} ` +
          `recordings, so ${String(lanes.length - total.lanesRead)} projects are read next tick`,
      );
      break;
    }

    total.lanesRead += 1;

    try {
      const tally = await runLane(deps, lane, Math.min(deps.perProjectCap, budget));
      budget -= tally.attempted;
      total.summarised += tally.summarised;
      total.retried += tally.retried;
      total.skipped += tally.skipped;
      total.failed += tally.failed;
    } catch (error) {
      deps.logger.error(
        `replay narration: project ${lane.projectId} could not be read this tick: ` +
          `${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  deps.logger.info(
    `replay narration: read ${String(total.lanesRead)} projects, summarised ` +
      `${String(total.summarised)} recordings, read ${String(total.retried)} again after a ` +
      `failed pull, skipped ${String(total.skipped)} already held, ${String(total.failed)} failed`,
  );

  return total;
}
