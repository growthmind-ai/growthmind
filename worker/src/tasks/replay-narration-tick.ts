import type { ReplaySource } from "@growthmind/adapters";
import {
  compactTranscript,
  countNotable,
  buildTranscript,
  renderDigest,
  renderRecordingFloor,
  renderTranscript,
  renderWithheldRecordingFloor,
  reviewFindingText,
  serialisePersistedTranscript,
  PERSISTED_TRANSCRIPT_VERSION,
} from "@growthmind/core";
import type { FloorNarration, ScannedText, TranscriptDigest } from "@growthmind/core";
import type {
  PersistRecordingSummaryInput,
  RecordingSummariesRepo,
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
  readonly listPages: number;

  readonly logger: AnalysisLogger;
}

export type ReplayNarrationOutcome = {
  readonly lanesRead: number;
  readonly summarised: number;
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
    };
  }

  return {
    events: pulled.events,
    stop: pulled.stop,
    reason: pulled.stop === "exhausted" ? null : REPLAY_PULL_STOP_MESSAGES[pulled.stop],
    bytesReceived,
  };
}

function persistInputFor(args: {
  readonly projectId: string;
  readonly provider: ReplaySourceKind;
  readonly recording: ReplayRecordingSummary;
  readonly digest: TranscriptDigest;
  readonly transcript: string;
  readonly pull: PullOutcome;
  readonly watermark: Date | null;
  readonly text: ScannedNarration;
  readonly resolvedModelId: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}): PersistRecordingSummaryInput {
  const sessionKey = recordingSessionKey(args.provider, args.recording.recordingId);

  return {
    projectId: args.projectId,
    recordingId: args.recording.recordingId,
    summarySource: args.text.summarySource,
    headline: args.text.headline,
    context: args.text.context,
    transcript: args.transcript,
    pages: args.digest.pages,
    durationMs: args.digest.durationMs,
    actionCount: args.digest.actions.length + args.digest.omitted,
    notableCount: countNotable(args.digest.actions),
    droppedEvents: args.digest.droppedEvents,
    startedAt: args.recording.startedAt,

    provider: args.provider,
    sessionKey,
    sessionGroupingVersion: sessionKey === null ? null : SESSION_GROUPING_VERSION,

    // What the narrator read, beat for beat: a citation resting on a beat the row never
    // stored is the break this outcome exists to close.
    actions: serialisePersistedTranscript(args.digest.actions, PERSISTED_TRANSCRIPT_VERSION),
    actionsVersion: PERSISTED_TRANSCRIPT_VERSION,
    actionsOmitted: args.digest.omitted,

    pullStop: args.pull.stop,
    pullReason: args.pull.reason,
    pullWatermarkAt: args.watermark,
    bytesReceived: args.pull.bytesReceived,

    resolvedModelId: args.resolvedModelId,
    tokensIn: args.tokensIn,
    tokensOut: args.tokensOut,
  };
}

async function narrateOne(
  deps: ReplayNarrationDeps,
  lane: ReplayLane,
  source: ReplaySource,
  summaries: RecordingSummariesRepo,
  recording: ReplayRecordingSummary,
  watermark: Date | null,
): Promise<boolean> {
  const pulled = await source.pullEvents(recording.recordingId);
  const pull = readPull(source.kind, pulled);

  if (!pulled.ok) {
    deps.logger.info(
      `replay narration: recording ${recording.recordingId} in project ${lane.projectId} was ` +
        `read only in part (${pulled.failure.code}); narrating what arrived`,
    );
  }

  const transcript = buildTranscript(pull.events);
  const digest = compactTranscript(transcript);

  const narrated = await narrationFor(digest, deps.narrator);
  const text = scanDown(narrated.text, renderRecordingFloor(digest));

  await summaries.persist(
    persistInputFor({
      projectId: lane.projectId,
      provider: source.kind,
      recording,
      digest,
      transcript: renderTranscript(transcript),
      pull,
      watermark,
      text,
      resolvedModelId: deps.narrator?.resolvedModelId ?? null,
      tokensIn: narrated.tokensIn,
      tokensOut: narrated.tokensOut,
    }),
  );

  return true;
}

async function runLane(
  deps: ReplayNarrationDeps,
  lane: ReplayLane,
): Promise<{ summarised: number; skipped: number; failed: number }> {
  const ctx = deps.contextFor(lane);
  const tally = { summarised: 0, skipped: 0, failed: 0 };

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

  const known = await summaries.summarisedIds(
    lane.projectId,
    recordings.map((recording) => recording.recordingId),
  );

  const fresh = recordings.filter((recording) => !known.has(recording.recordingId));
  tally.skipped = recordings.length - fresh.length;

  for (const recording of fresh.slice(0, deps.perProjectCap)) {
    try {
      await narrateOne(deps, lane, resolved.source, summaries, recording, watermark);
      tally.summarised += 1;
    } catch (error) {
      tally.failed += 1;
      deps.logger.error(
        `replay narration: recording ${recording.recordingId} in project ${lane.projectId} ` +
          `could not be summarised: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  if (fresh.length > deps.perProjectCap) {
    deps.logger.info(
      `replay narration: project ${lane.projectId} had ${String(fresh.length)} new recordings and ` +
        `this tick summarised ${String(deps.perProjectCap)}; the rest follow next tick`,
    );
  }

  return tally;
}

export async function runReplayNarrationTick(
  deps: ReplayNarrationDeps,
): Promise<ReplayNarrationOutcome> {
  const lanes = await deps.lanes.listDueLanes();
  const total = { lanesRead: lanes.length, summarised: 0, skipped: 0, failed: 0 };

  for (const lane of lanes) {
    try {
      const tally = await runLane(deps, lane);
      total.summarised += tally.summarised;
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
      `${String(total.summarised)} recordings, skipped ${String(total.skipped)} already held, ` +
      `${String(total.failed)} failed`,
  );

  return total;
}
