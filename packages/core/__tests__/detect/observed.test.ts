import type { ConnectionState, ExclusionReason } from "@growthmind/shared";
import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { CountBasis } from "../../src/counts/measured-count";
import { analysedSessions } from "../../src/detect/analysed";
import type {
  AnalysisWindow,
  DetectorCorpus,
  DetectorCoverage,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";
import type {
  ElementIdentity,
  SessionAction,
  SessionTranscript,
  TranscriptCounts,
} from "../../src/replay/types";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

// TODO(O-041 D-11): SessionReplay and the optional DetectorCorpus.replays land in
// src/detect/types.ts; delete these two local declarations and import them then.
type SessionReplay = {
  readonly sessionId: string;
  readonly transcript: SessionTranscript;
};

type ObservedCorpus = DetectorCorpus & {
  readonly replays?: readonly SessionReplay[];
};

type DetectObservedStruggle = (corpus: ObservedCorpus, ruleSet: ThresholdRuleSet) => DetectorResult;

// Typed `string` so the specifier stays unresolvable at compile time: this file must
// typecheck before src/detect/observed.ts exists, and must fail at run time until it does.
const OBSERVED_DETECTOR_MODULE: string = "../../src/detect/observed";

async function loadDetectObservedStruggle(): Promise<DetectObservedStruggle> {
  const loaded = (await import(OBSERVED_DETECTOR_MODULE)) as Record<string, unknown>;
  const detector = loaded["detectObservedStruggle"];

  if (typeof detector !== "function") {
    throw new Error("src/detect/observed.ts must export detectObservedStruggle");
  }

  return detector as DetectObservedStruggle;
}

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

const T3OBS_WINDOW: AnalysisWindow = {
  start: new Date("2026-07-01T00:00:00.000Z"),
  end: new Date("2026-07-08T00:00:00.000Z"),
};

const T3OBS_PROJECT_ID = "t3obs-project";
const T3OBS_SURFACE = "/t3obs/settings";
const T3OBS_HREF = "https://t3obs.example.invalid/t3obs/settings";
const T3OBS_EVENT_NAME = "t3obs_panel_opened";
const T3OBS_NORMALISATION_VERSION = 1;

const T3OBS_ACTION_STRIDE_MS = 1_500;
const T3OBS_EVENT_STRIDE_MS = 1_000;
const T3OBS_SESSION_STRIDE_MS = 60_000;
const T3OBS_FIRST_SESSION_AT = new Date("2026-07-03T09:00:00.000Z");

const T3OBS_SET_ASIDE_SESSION_ID = "t3obs-session-headless";

const T3OBS_CONNECTION_STATE: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "t3obs-connection",
    organizationId: "t3obs-org",
    projectId: T3OBS_PROJECT_ID,
    sourceKind: "posthog",
    host: "https://t3obs.example.invalid",
    sourceProjectId: "t3obs-source-project",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: T3OBS_WINDOW.end,
    watermarkAt: T3OBS_WINDOW.end,
    backfillBefore: null,
    pollIntervalSeconds: 300,
    connectedAt: T3OBS_WINDOW.start,
    inferredInternalDomain: null,
    internalDomainProvenance: null,
  },
};

// Unequal to what analysedSessions recomputes over the kept sessions, so a result that
// forwards corpus.coverage untouched fails the third test instead of passing by accident.
const T3OBS_DECLARED_COVERAGE: DetectorCoverage = {
  truncated: true,
  eventsWithoutUrlPath: 9,
};

const T3OBS_QUIET_COUNTS: TranscriptCounts = {
  clicks: 0,
  deadClicks: 0,
  rageClicks: 0,
  refocuses: 0,
  abandonedFields: 0,
  scrollBacks: 0,
};

const T3OBS_PANEL: ElementIdentity = {
  nodeId: 41,
  tagName: "section",
  classes: ["t3obs-panel"],
  testId: "t3obs-summary-panel",
  attributes: {},
};

function t3obsTranscript(scrollBacks: number): SessionTranscript {
  const opening: SessionAction = { kind: "page", atMs: 0, href: T3OBS_HREF };

  const beats: readonly SessionAction[] = Array.from({ length: scrollBacks }, (_unused, slot) => ({
    kind: "scroll_back" as const,
    atMs: (slot + 1) * T3OBS_ACTION_STRIDE_MS,
    element: T3OBS_PANEL,
  }));

  const endedAtMs = (scrollBacks + 1) * T3OBS_ACTION_STRIDE_MS;

  return {
    actions: [opening, ...beats, { kind: "ended", atMs: endedAtMs }],
    startedAt: T3OBS_FIRST_SESSION_AT,
    durationMs: endedAtMs,
    pages: [T3OBS_SURFACE],
    counts: { ...T3OBS_QUIET_COUNTS, scrollBacks },
    droppedEvents: 0,
  };
}

function t3obsSessionId(slot: number): string {
  return `t3obs-session-${String(slot).padStart(2, "0")}`;
}

function t3obsTimeline(input: {
  readonly sessionId: string;
  readonly slot: number;
  readonly exclusionReason: ExclusionReason;
  readonly urlPaths: readonly (string | null)[];
}): SessionTimeline {
  const startedAt = new Date(
    T3OBS_FIRST_SESSION_AT.getTime() + input.slot * T3OBS_SESSION_STRIDE_MS,
  );

  const events: readonly TimelineEvent[] = input.urlPaths.map((urlPath, index) => ({
    sourceEventId: `${input.sessionId}-e${String(index).padStart(2, "0")}`,
    name: T3OBS_EVENT_NAME,
    occurredAt: new Date(startedAt.getTime() + index * T3OBS_EVENT_STRIDE_MS),
    urlPath,
    urlPathNormalisationVersion: urlPath === null ? null : T3OBS_NORMALISATION_VERSION,
  }));

  return {
    sessionId: input.sessionId,
    startedAt,
    exclusionReason: input.exclusionReason,
    entryUrlPath: T3OBS_SURFACE,
    events,
  };
}

function t3obsBasis(keptCount: number): CountBasis {
  return {
    totalInWindow: keptCount + 1,
    kept: keptCount,
    setAside: [
      {
        reason: "automation_headless",
        count: 1,
        label: EXCLUSION_REASON_LABELS.automation_headless,
      },
    ],
    keptUnchecked: 0,
  };
}

function t3obsCorpus(): ObservedCorpus {
  const rules = ruleSetV1();
  const keptCount = rules.struggleObservedMinSessions + 1;
  const scrollBacksPerSession = rules.struggleScrollBackMin + 1;

  const keptSlots: readonly number[] = Array.from({ length: keptCount }, (_unused, slot) => slot);

  const keptTimelines: readonly SessionTimeline[] = keptSlots.map((slot) =>
    t3obsTimeline({
      sessionId: t3obsSessionId(slot),
      slot,
      exclusionReason: "none",
      urlPaths: slot === 0 ? [T3OBS_SURFACE, null] : [T3OBS_SURFACE],
    }),
  );

  const setAsideTimeline = t3obsTimeline({
    sessionId: T3OBS_SET_ASIDE_SESSION_ID,
    slot: keptCount,
    exclusionReason: "automation_headless",
    urlPaths: [null, null, null],
  });

  const replays: readonly SessionReplay[] = [
    ...keptSlots.map((slot) => ({
      sessionId: t3obsSessionId(slot),
      transcript: t3obsTranscript(scrollBacksPerSession),
    })),
    {
      sessionId: T3OBS_SET_ASIDE_SESSION_ID,
      transcript: t3obsTranscript(scrollBacksPerSession),
    },
  ];

  return {
    projectId: T3OBS_PROJECT_ID,
    window: T3OBS_WINDOW,
    connectionState: T3OBS_CONNECTION_STATE,
    sessions: [...keptTimelines, setAsideTimeline],
    basis: t3obsBasis(keptCount),
    coverage: T3OBS_DECLARED_COVERAGE,
    replays,
  };
}

function t3obsCorpusWithoutReplays(): ObservedCorpus {
  const withReplays = t3obsCorpus();

  return {
    projectId: withReplays.projectId,
    window: withReplays.window,
    connectionState: withReplays.connectionState,
    sessions: withReplays.sessions,
    basis: withReplays.basis,
    coverage: withReplays.coverage,
  };
}

describe("detectObservedStruggle", () => {
  test("should not return a candidate when the corpus carries no replays", async () => {
    const detectObservedStruggle = await loadDetectObservedStruggle();

    const result = detectObservedStruggle(t3obsCorpusWithoutReplays(), ruleSetV1());

    expect(result.candidates).toEqual([]);
  });

  test("should return a candidate named observed_struggle claiming confusing", async () => {
    const detectObservedStruggle = await loadDetectObservedStruggle();

    const result = detectObservedStruggle(t3obsCorpus(), ruleSetV1());

    // Widened because detectorNameSchema does not carry the name yet (ADD D-6).
    const detectorName: string = result.detector;

    expect(result.candidates).toHaveLength(1);
    expect(detectorName).toBe("observed_struggle");
    expect(result.candidates[0].claimedClass).toBe("confusing");
    expect(result.candidates[0].claimSubject).toBe("surface");
  });

  test("should carry the corpus connection state and coverage onto its result", async () => {
    const detectObservedStruggle = await loadDetectObservedStruggle();
    const corpus = t3obsCorpus();

    const result = detectObservedStruggle(corpus, ruleSetV1());

    expect(result.connectionState).toBe(corpus.connectionState);
    expect(result.coverage).toEqual(analysedSessions(corpus).coverage);
  });
});
