import type { ConnectionState, ConnectionSummary, ExclusionReason } from "@growthmind/shared";
import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { CountBasis, SetAsideBasis } from "../../src/counts/measured-count";
import { isMeasuredCount, measuredCount } from "../../src/counts/measured-count";
import { detectFunnelDropoff } from "../../src/detect/funnel-dropoff";
import type {
  DetectorCorpus,
  DetectorCoverage,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { evidenceSignalSchema } from "../../src/evidence/signals";
import { EVIDENCE_SHAPE_VERSION, evidenceShape } from "../../src/findings/evidence-shape";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";
import { detectorProposedClassSchema } from "../../src/rules/types";

const WINDOW_START = new Date("2026-07-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-08T00:00:00.000Z");
const CONNECTED_AT = new Date("2026-06-01T00:00:00.000Z");
const LAST_POLLED_AT = new Date("2026-07-07T23:00:00.000Z");

const FIRST_SESSION_STARTED_AT = new Date("2026-07-03T09:00:00.000Z");

const EVENT_STRIDE_MS = 1_000;
const SESSION_STRIDE_MS = 60_000;
const COHORT_STRIDE_MS = 60 * 60 * 1_000;

function cohortStart(index: number): Date {
  return new Date(FIRST_SESSION_STARTED_AT.getTime() + index * COHORT_STRIDE_MS);
}

const PROJECT_ID = "prj-t1-funnel-dropoff";
const ORIGIN = "/pricing";
const DESTINATION = "/checkout";

const COLLAPSED_ORDER_PATH = "/orders/:id";

const NORMALISATION_VERSION = 1;

const EVENT_NAMES: readonly string[] = ["step_a", "step_b", "step_c"];

const KEPT_AT_ORIGIN = 30;
const KEPT_DROPPED = 18;
const KEPT_CONVERTED = KEPT_AT_ORIGIN - KEPT_DROPPED;
const SET_ASIDE_HEADLESS = 6;
const SET_ASIDE_INTERNAL = 4;

const BOUNDARY_AT_ORIGIN = 25;
const BOUNDARY_DROPPED_ONE_BELOW = 9;
const BOUNDARY_DROPPED_AT_THRESHOLD = 10;
const BOUNDARY_SET_ASIDE = 5;

const BELOW_FLOOR_AT_ORIGIN = 19;
const BELOW_FLOOR_DROPPED = 18;

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

function connectionSummary(watermarkAt: Date | null): ConnectionSummary {
  return {
    id: "conn-t1-funnel-dropoff",
    organizationId: "org-t1-funnel-dropoff",
    projectId: PROJECT_ID,
    sourceKind: "posthog",
    host: "https://eu.posthog.invalid",
    sourceProjectId: "77001",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: LAST_POLLED_AT,

    watermarkAt,
    backfillBefore: null,
    pollIntervalSeconds: 300,
    connectedAt: CONNECTED_AT,
    inferredInternalDomain: null,
    internalDomainProvenance: null,
  };
}

const CONNECTED_RECEIVING: ConnectionState = {
  status: "connected_receiving",
  connection: connectionSummary(LAST_POLLED_AT),
};

const CONNECTED_NO_EVENTS_YET: ConnectionState = {
  status: "connected_no_events_yet",
  connection: connectionSummary(LAST_POLLED_AT),
};

const CONNECTED_NEVER_POLLED: ConnectionState = {
  status: "connected_never_polled",
  connection: connectionSummary(null),
};

type SessionSpec = {
  readonly sessionId: string;

  readonly startedAt: Date;

  readonly paths: readonly (string | null)[];
  readonly exclusionReason: ExclusionReason;
  readonly normalisationVersion: number | null;
};

function sessionTimeline(spec: SessionSpec): SessionTimeline {
  const events: readonly TimelineEvent[] = spec.paths.map((urlPath, index) => ({
    sourceEventId: `${spec.sessionId}-e${String(index).padStart(3, "0")}`,
    name: EVENT_NAMES[index % EVENT_NAMES.length],
    occurredAt: new Date(spec.startedAt.getTime() + index * EVENT_STRIDE_MS),
    urlPath,

    urlPathNormalisationVersion: urlPath === null ? null : spec.normalisationVersion,
  }));

  return {
    sessionId: spec.sessionId,
    startedAt: spec.startedAt,
    exclusionReason: spec.exclusionReason,
    entryUrlPath: spec.paths.find((path) => path !== null) ?? null,
    events,
  };
}

function cohort(input: {
  readonly idPrefix: string;
  readonly count: number;
  readonly paths: readonly (string | null)[];
  readonly exclusionReason: ExclusionReason;
  readonly firstStartedAt: Date;
}): readonly SessionTimeline[] {
  const sessions: SessionTimeline[] = [];
  for (let index = 0; index < input.count; index += 1) {
    sessions.push(
      sessionTimeline({
        sessionId: `${input.idPrefix}-${String(index).padStart(3, "0")}`,
        startedAt: new Date(input.firstStartedAt.getTime() + index * SESSION_STRIDE_MS),
        paths: input.paths,
        exclusionReason: input.exclusionReason,
        normalisationVersion: NORMALISATION_VERSION,
      }),
    );
  }
  return sessions;
}

const SET_ASIDE_REASONS: readonly ExclusionReason[] = [
  "internal_domain",
  "automation_headless",
  "automation_known_agent",
  "automation_coding_agent",
];

function basisOf(sessions: readonly SessionTimeline[]): CountBasis {
  const setAside: SetAsideBasis[] = [];
  for (const reason of SET_ASIDE_REASONS) {
    const count = sessions.filter((session) => session.exclusionReason === reason).length;
    if (count > 0) {
      setAside.push({ reason, count, label: EXCLUSION_REASON_LABELS[reason] });
    }
  }

  return {
    totalInWindow: sessions.length,
    kept: sessions.filter((session) => session.exclusionReason === "none").length,
    setAside,
  };
}

function coverageOf(sessions: readonly SessionTimeline[], truncated: boolean): DetectorCoverage {
  let eventsWithoutUrlPath = 0;
  for (const session of sessions) {
    for (const event of session.events) {
      if (event.urlPath === null) eventsWithoutUrlPath += 1;
    }
  }
  return { truncated, eventsWithoutUrlPath };
}

function corpusOf(input: {
  readonly sessions: readonly SessionTimeline[];
  readonly connectionState: ConnectionState;
  readonly truncated: boolean;
}): DetectorCorpus {
  return {
    projectId: PROJECT_ID,
    window: { start: WINDOW_START, end: WINDOW_END },
    connectionState: input.connectionState,
    sessions: input.sessions,
    basis: basisOf(input.sessions),
    coverage: coverageOf(input.sessions, input.truncated),
  };
}

function firingSessions(): readonly SessionTimeline[] {
  return [
    ...cohort({
      idPrefix: "kept-converted",
      count: KEPT_CONVERTED,
      paths: [ORIGIN, DESTINATION],
      exclusionReason: "none",
      firstStartedAt: cohortStart(0),
    }),
    ...cohort({
      idPrefix: "kept-dropped",
      count: KEPT_DROPPED,
      paths: [ORIGIN],
      exclusionReason: "none",
      firstStartedAt: cohortStart(1),
    }),
    ...cohort({
      idPrefix: "setaside-headless",
      count: SET_ASIDE_HEADLESS,
      paths: [ORIGIN],
      exclusionReason: "automation_headless",
      firstStartedAt: cohortStart(2),
    }),
    ...cohort({
      idPrefix: "setaside-internal",
      count: SET_ASIDE_INTERNAL,
      paths: [ORIGIN],
      exclusionReason: "internal_domain",
      firstStartedAt: cohortStart(3),
    }),
  ];
}

function firingCorpus(truncated = false): DetectorCorpus {
  return {
    ...corpusOf({
      sessions: firingSessions(),
      connectionState: CONNECTED_RECEIVING,
      truncated,
    }),
  };
}

function rateBoundaryCorpus(input: {
  readonly dropped: number;
  readonly setAsidePaths: readonly (string | null)[];
}): DetectorCorpus {
  const sessions = [
    ...cohort({
      idPrefix: "kept-converted",
      count: BOUNDARY_AT_ORIGIN - input.dropped,
      paths: [ORIGIN, DESTINATION],
      exclusionReason: "none",
      firstStartedAt: cohortStart(0),
    }),
    ...cohort({
      idPrefix: "kept-dropped",
      count: input.dropped,
      paths: [ORIGIN],
      exclusionReason: "none",
      firstStartedAt: cohortStart(1),
    }),
    ...cohort({
      idPrefix: "setaside-headless",
      count: BOUNDARY_SET_ASIDE,
      paths: input.setAsidePaths,
      exclusionReason: "automation_headless",
      firstStartedAt: cohortStart(2),
    }),
  ];

  return corpusOf({ sessions, connectionState: CONNECTED_RECEIVING, truncated: false });
}

function nullPathCorpus(): DetectorCorpus {
  const sessions = [
    ...cohort({
      idPrefix: "kept-converted",
      count: KEPT_CONVERTED,
      paths: [ORIGIN, null, DESTINATION],
      exclusionReason: "none",
      firstStartedAt: cohortStart(0),
    }),
    ...cohort({
      idPrefix: "kept-dropped",
      count: KEPT_DROPPED,
      paths: [ORIGIN, null],
      exclusionReason: "none",
      firstStartedAt: cohortStart(1),
    }),
  ];
  return corpusOf({ sessions, connectionState: CONNECTED_RECEIVING, truncated: false });
}

function collapsedPathCorpus(): DetectorCorpus {
  const sessions = [
    ...cohort({
      idPrefix: "kept-converted",
      count: KEPT_CONVERTED,
      paths: [COLLAPSED_ORDER_PATH, DESTINATION],
      exclusionReason: "none",
      firstStartedAt: cohortStart(0),
    }),
    ...cohort({
      idPrefix: "kept-dropped",
      count: KEPT_DROPPED,
      paths: [COLLAPSED_ORDER_PATH],
      exclusionReason: "none",
      firstStartedAt: cohortStart(1),
    }),
  ];
  return corpusOf({ sessions, connectionState: CONNECTED_RECEIVING, truncated: false });
}

function emptyCorpus(connectionState: ConnectionState): DetectorCorpus {
  return corpusOf({ sessions: [], connectionState, truncated: false });
}

function withEveryEventNamed(corpus: DetectorCorpus, name: string): DetectorCorpus {
  return {
    ...corpus,
    sessions: corpus.sessions.map((session) => ({
      ...session,
      events: session.events.map((event) => ({ ...event, name })),
    })),
  };
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("detectFunnelDropoff", () => {
  test("should emit a qualifying origin's drop-off as a MeasuredCount over sessions", () => {
    const corpus = firingCorpus();

    expect(corpus.basis.totalInWindow).toBe(
      KEPT_AT_ORIGIN + SET_ASIDE_HEADLESS + SET_ASIDE_INTERNAL,
    );
    expect(corpus.basis.kept).toBe(KEPT_AT_ORIGIN);

    const result = detectFunnelDropoff(corpus, ruleSetV1());

    expect(result.detector).toBe("funnel_dropoff");

    expect(result.candidates).toHaveLength(1);

    const candidate = result.candidates[0];
    expect(candidate.detector).toBe("funnel_dropoff");
    expect(candidate.timeframe).toEqual(corpus.window);
    expect(candidate.counts.length).toBeGreaterThan(0);

    for (const count of candidate.counts) {
      expect(isMeasuredCount(count)).toBe(true);

      expect(count.unit).toBe("sessions");

      expect(count.denominator).toBe(KEPT_AT_ORIGIN);
      expect(count.basis).toEqual(corpus.basis);
      expect(count.timeframe).toEqual(corpus.window);
    }

    expect(
      candidate.counts.some(
        (count) => count.numerator === KEPT_DROPPED && count.denominator === KEPT_AT_ORIGIN,
      ),
    ).toBe(true);
  });

  test("should return an empty result for zero sessions, distinguishable from did-not-run", () => {
    const corpus = emptyCorpus(CONNECTED_NO_EVENTS_YET);
    expect(corpus.basis).toEqual({ totalInWindow: 0, kept: 0, setAside: [] });

    const result = detectFunnelDropoff(corpus, ruleSetV1());

    expect(result.detector).toBe("funnel_dropoff");
    expect(result.candidates).toEqual([]);
    expect(result.connectionState.status).toBe("connected_no_events_yet");
    expect(result.coverage).toEqual({ truncated: false, eventsWithoutUrlPath: 0 });
  });

  test("should return an empty result for a project connected but never polled, distinguishable from polled-and-empty", () => {
    const rules = ruleSetV1();

    const neverPolled = detectFunnelDropoff(emptyCorpus(CONNECTED_NEVER_POLLED), rules);
    const polledAndEmpty = detectFunnelDropoff(emptyCorpus(CONNECTED_NO_EVENTS_YET), rules);

    expect(neverPolled.candidates).toEqual([]);
    expect(polledAndEmpty.candidates).toEqual([]);

    expect(neverPolled.connectionState.status).toBe("connected_never_polled");
    expect(polledAndEmpty.connectionState.status).toBe("connected_no_events_yet");
    expect(neverPolled.connectionState.status).not.toBe(polledAndEmpty.connectionState.status);
  });

  test("should run with exactly one session and not promote a 1-of-1 count to a finding", () => {
    const rules = ruleSetV1();
    const corpus = corpusOf({
      sessions: cohort({
        idPrefix: "solo",
        count: 1,
        paths: [ORIGIN, DESTINATION],
        exclusionReason: "none",
        firstStartedAt: cohortStart(0),
      }),
      connectionState: CONNECTED_RECEIVING,
      truncated: false,
    });

    expect(corpus.basis.kept).toBe(1);

    expect(corpus.basis.kept).toBeLessThan(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.detector).toBe("funnel_dropoff");
    expect(result.candidates).toEqual([]);
  });

  test("should return no transitions for a session with exactly one event", () => {
    const rules = ruleSetV1();
    const corpus = corpusOf({
      sessions: cohort({
        idPrefix: "single-event",
        count: KEPT_AT_ORIGIN,
        paths: [ORIGIN],
        exclusionReason: "none",
        firstStartedAt: cohortStart(0),
      }),
      connectionState: CONNECTED_RECEIVING,
      truncated: false,
    });

    expect(corpus.basis.kept).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates).toEqual([]);
    expect(result.coverage.eventsWithoutUrlPath).toBe(0);
  });

  test("should return no transitions for a one-step funnel, not an error", () => {
    const rules = ruleSetV1();

    const corpus = corpusOf({
      sessions: cohort({
        idPrefix: "one-step",
        count: KEPT_AT_ORIGIN,
        paths: [ORIGIN, ORIGIN, ORIGIN],
        exclusionReason: "none",
        firstStartedAt: cohortStart(0),
      }),
      connectionState: CONNECTED_RECEIVING,
      truncated: false,
    });

    expect(corpus.basis.kept).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.detector).toBe("funnel_dropoff");
    expect(result.connectionState.status).toBe("connected_receiving");
    expect(result.candidates).toEqual([]);
  });

  test("should exclude null-url_path events from transitions and record them in coverage, never silently", () => {
    const corpus = nullPathCorpus();

    expect(corpus.coverage.eventsWithoutUrlPath).toBe(KEPT_AT_ORIGIN);

    const result = detectFunnelDropoff(corpus, ruleSetV1());

    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect([ORIGIN, DESTINATION]).toContain(candidate.surface);
    expect(candidate.surface.length).toBeGreaterThan(0);
    expect(
      candidate.counts.some(
        (count) => count.numerator === KEPT_DROPPED && count.denominator === KEPT_AT_ORIGIN,
      ),
    ).toBe(true);

    expect(result.coverage.eventsWithoutUrlPath).toBe(KEPT_AT_ORIGIN);
    expect(candidate.coverage.eventsWithoutUrlPath).toBe(KEPT_AT_ORIGIN);
  });

  test("should count a redaction-collapsed path (/orders/:id) as one surface, not an anomaly", () => {
    const result = detectFunnelDropoff(collapsedPathCorpus(), ruleSetV1());

    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];

    expect([COLLAPSED_ORDER_PATH, DESTINATION]).toContain(candidate.surface);

    expect(candidate.surface).not.toMatch(/\/\d/);

    expect(candidate.surfaceNormalisationVersion).toBe(NORMALISATION_VERSION);

    expect(
      candidate.counts.some(
        (count) => count.numerator === KEPT_DROPPED && count.denominator === KEPT_AT_ORIGIN,
      ),
    ).toBe(true);
  });

  test("should not fire at one below funnelDropoffRateThreshold", () => {
    const rules = ruleSetV1();

    const corpus = rateBoundaryCorpus({
      dropped: BOUNDARY_DROPPED_ONE_BELOW,
      setAsidePaths: [ORIGIN],
    });

    expect(corpus.basis.kept).toBe(BOUNDARY_AT_ORIGIN);

    expect(BOUNDARY_DROPPED_ONE_BELOW * 100).toBeLessThan(
      rules.funnelDropoffRateThresholdPercent * BOUNDARY_AT_ORIGIN,
    );

    expect(BOUNDARY_DROPPED_ONE_BELOW).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);
    expect(BOUNDARY_AT_ORIGIN).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates).toEqual([]);
  });

  test("should fire at exactly funnelDropoffRateThreshold", () => {
    const rules = ruleSetV1();

    const corpus = rateBoundaryCorpus({
      dropped: BOUNDARY_DROPPED_AT_THRESHOLD,
      setAsidePaths: [ORIGIN, DESTINATION],
    });

    expect(corpus.basis.kept).toBe(BOUNDARY_AT_ORIGIN);
    expect(BOUNDARY_DROPPED_AT_THRESHOLD).toBe(BOUNDARY_DROPPED_ONE_BELOW + 1);

    expect(BOUNDARY_DROPPED_AT_THRESHOLD * 100).toBe(
      rules.funnelDropoffRateThresholdPercent * BOUNDARY_AT_ORIGIN,
    );

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates).toHaveLength(1);
    expect(
      result.candidates[0].counts.some(
        (count) =>
          count.numerator === BOUNDARY_DROPPED_AT_THRESHOLD &&
          count.denominator === BOUNDARY_AT_ORIGIN,
      ),
    ).toBe(true);
  });

  test("should not fire below funnelMinSessionsAtOrigin regardless of rate", () => {
    const rules = ruleSetV1();
    const corpus = corpusOf({
      sessions: [
        ...cohort({
          idPrefix: "kept-converted",
          count: BELOW_FLOOR_AT_ORIGIN - BELOW_FLOOR_DROPPED,
          paths: [ORIGIN, DESTINATION],
          exclusionReason: "none",
          firstStartedAt: cohortStart(0),
        }),
        ...cohort({
          idPrefix: "kept-dropped",
          count: BELOW_FLOOR_DROPPED,
          paths: [ORIGIN],
          exclusionReason: "none",
          firstStartedAt: cohortStart(1),
        }),
      ],
      connectionState: CONNECTED_RECEIVING,
      truncated: false,
    });

    expect(corpus.basis.kept).toBe(BELOW_FLOOR_AT_ORIGIN);
    expect(BELOW_FLOOR_AT_ORIGIN).toBe(rules.funnelMinSessionsAtOrigin - 1);

    expect(BELOW_FLOOR_DROPPED * 100).toBeGreaterThanOrEqual(
      rules.funnelDropoffRateThresholdPercent * BELOW_FLOOR_AT_ORIGIN,
    );
    expect(BELOW_FLOOR_DROPPED).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates).toEqual([]);
  });

  test("should never propose changed_mind", () => {
    const rules = ruleSetV1();

    expect(detectorProposedClassSchema.options).not.toContain("changed_mind");

    const candidates = [
      firingCorpus(),
      rateBoundaryCorpus({ dropped: BOUNDARY_DROPPED_AT_THRESHOLD, setAsidePaths: [ORIGIN] }),
      nullPathCorpus(),
      collapsedPathCorpus(),
      firingCorpus(true),
    ].flatMap((corpus) => detectFunnelDropoff(corpus, rules).candidates);

    expect(candidates.length).toBeGreaterThan(0);

    for (const candidate of candidates) {
      expect(candidate.claimedClass).not.toBe("changed_mind");
      expect(detectorProposedClassSchema.parse(candidate.claimedClass)).toBe(
        candidate.claimedClass,
      );
    }
  });

  test("should contain no event-name literal (operates on url_path transitions only)", async () => {
    const source = await Bun.file(`${import.meta.dir}/../../src/detect/funnel-dropoff.ts`).text();
    const code = stripComments(source);

    expect(code).toContain("detectFunnelDropoff");

    expect(code).not.toMatch(/["'`]\$[A-Za-z_][A-Za-z0-9_]*["'`]/);
    for (const reserved of [
      "$pageview",
      "$exception",
      "$autocapture",
      "$pathname",
      "$current_url",
      "$rageclick",
    ]) {
      expect(code).not.toContain(reserved);
    }

    const rules = ruleSetV1();
    const asCaptured = detectFunnelDropoff(firingCorpus(), rules);
    const renamed = detectFunnelDropoff(
      withEveryEventNamed(firingCorpus(), "an_event_name_no_detector_has_heard_of"),
      rules,
    );

    expect(renamed).toEqual(asCaptured);
  });

  test("should propagate coverage.truncated onto every candidate", () => {
    const corpus = firingCorpus(true);
    expect(corpus.coverage.truncated).toBe(true);

    const result = detectFunnelDropoff(corpus, ruleSetV1());

    expect(result.coverage.truncated).toBe(true);

    expect(result.candidates.length).toBeGreaterThan(0);

    for (const candidate of result.candidates) {
      expect(candidate.coverage.truncated).toBe(true);
      expect(candidate.coverage).toEqual(result.coverage);
    }
  });
});

const STRUGGLE_ORIGIN = "/t1str/pricing";
const STRUGGLE_DESTINATION = "/t1str/checkout";

const STRUGGLE_DETOUR = "/t1str/help";

const STRUGGLE_AT_ORIGIN = 20;
const STRUGGLE_DROPPED = 8;

const STRUGGLE_REVISITING = 4;

const STRUGGLE_SHALLOW_MANY = 8;

const STRUGGLE_ALL_REVISITING = STRUGGLE_AT_ORIGIN - STRUGGLE_DROPPED;

const BACKTRACK_CONVERTED = 12;
const BACKTRACK_RETURNERS = 8;
const BACKTRACK_DROPPED = 14;

type RevisitCohort = {
  readonly count: number;

  readonly visits: number;

  readonly detour: string;
};

function visitPaths(spec: RevisitCohort): readonly string[] {
  const paths: string[] = [];
  for (let visit = 0; visit < spec.visits; visit += 1) {
    if (visit > 0) paths.push(spec.detour);
    paths.push(STRUGGLE_ORIGIN);
  }
  return paths;
}

function struggleCorpus(input: {
  readonly converted: number;
  readonly revisits: readonly RevisitCohort[];
}): DetectorCorpus {
  const sessions: SessionTimeline[] = [
    ...cohort({
      idPrefix: "t1str-converted",
      count: input.converted,
      paths: [STRUGGLE_ORIGIN, STRUGGLE_DESTINATION],
      exclusionReason: "none",
      firstStartedAt: cohortStart(0),
    }),
  ];

  for (let index = 0; index < input.revisits.length; index += 1) {
    const spec = input.revisits[index];
    sessions.push(
      ...cohort({
        idPrefix: `t1str-revisit-${index}`,
        count: spec.count,
        paths: visitPaths(spec),
        exclusionReason: "none",
        firstStartedAt: cohortStart(index + 1),
      }),
    );
  }

  return corpusOf({ sessions, connectionState: CONNECTED_RECEIVING, truncated: false });
}

function struggleFixture(revisits: readonly RevisitCohort[]): DetectorCorpus {
  const revisiting = revisits.reduce((sum, spec) => sum + spec.count, 0);
  const converted = STRUGGLE_AT_ORIGIN - STRUGGLE_DROPPED - revisiting;
  if (converted < 0) {
    throw new Error("struggleFixture: the revisiting cohorts exceed the continuing budget");
  }

  return struggleCorpus({
    converted,
    revisits: [...revisits, { count: STRUGGLE_DROPPED, visits: 1, detour: STRUGGLE_DETOUR }],
  });
}

function struggleAtMinimumCorpus(rules: ThresholdRuleSet): DetectorCorpus {
  return struggleFixture([
    {
      count: STRUGGLE_REVISITING,
      visits: rules.struggleRepeatedAttemptMin,
      detour: STRUGGLE_DETOUR,
    },
  ]);
}

type StruggleSignal = Extract<EvidenceSignal, { kind: "struggle" }>;

function struggleSignalsOf(result: DetectorResult): readonly StruggleSignal[] {
  return result.candidates
    .flatMap((candidate) => candidate.signals)
    .filter((signal): signal is StruggleSignal => signal.kind === "struggle");
}

describe("detectFunnelDropoff — struggle.attempts (PL ruling 31)", () => {
  test("should emit a repeated_attempt struggle at exactly struggleRepeatedAttemptMin visits", () => {
    const rules = ruleSetV1();
    const corpus = struggleAtMinimumCorpus(rules);

    expect(corpus.basis.kept).toBe(STRUGGLE_AT_ORIGIN);
    expect(corpus.basis.kept).toBe(rules.funnelMinSessionsAtOrigin);
    expect(STRUGGLE_DROPPED).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);
    expect(STRUGGLE_DROPPED * 100).toBe(
      rules.funnelDropoffRateThresholdPercent * corpus.basis.kept,
    );

    const result = detectFunnelDropoff(corpus, rules);
    const struggles = struggleSignalsOf(result);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].counts[1].numerator).toBe(STRUGGLE_DROPPED);

    expect(struggles.length).toBeGreaterThan(0);
    for (const struggle of struggles) {
      expect(struggle.subkind).toBe("repeated_attempt");

      expect(struggle.surface).toBe(STRUGGLE_ORIGIN);
      expect(struggle.attempts).toBe(rules.struggleRepeatedAttemptMin);
    }

    for (const candidate of result.candidates) {
      expect(candidate.claimedClass).toBe("confusing");
      expect(candidate.signals.filter((signal) => signal.kind === "struggle")).toHaveLength(1);
    }
  });

  test("should not emit a struggle signal one below struggleRepeatedAttemptMin", () => {
    const rules = ruleSetV1();
    const nearMissVisits = rules.struggleRepeatedAttemptMin - 1;

    expect(nearMissVisits).toBeGreaterThanOrEqual(2);

    const corpus = struggleFixture([{ count: 1, visits: nearMissVisits, detour: STRUGGLE_DETOUR }]);

    expect(corpus.basis.kept).toBe(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates.length).toBeGreaterThan(0);

    expect(struggleSignalsOf(result)).toEqual([]);
  });

  test("should take attempts as a per-session maximum, never a sum across sessions", () => {
    const rules = ruleSetV1();
    const perSessionVisits = rules.struggleRepeatedAttemptMin - 1;

    const corpus = struggleFixture([
      { count: STRUGGLE_SHALLOW_MANY, visits: perSessionVisits, detour: STRUGGLE_DETOUR },
    ]);

    expect(STRUGGLE_SHALLOW_MANY * perSessionVisits).toBeGreaterThanOrEqual(
      rules.struggleRepeatedAttemptMin,
    );
    expect(perSessionVisits).toBeLessThan(rules.struggleRepeatedAttemptMin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(struggleSignalsOf(result)).toEqual([]);
  });

  test("should report the greatest single session's visit count as attempts", () => {
    const rules = ruleSetV1();
    const deepestVisits = rules.struggleRepeatedAttemptMin + 1;
    const shallowVisits = rules.struggleRepeatedAttemptMin - 1;
    const deepestCount = 2;
    const shallowCount = STRUGGLE_SHALLOW_MANY - deepestCount;

    const corpus = struggleFixture([
      { count: shallowCount, visits: shallowVisits, detour: STRUGGLE_DETOUR },
      { count: deepestCount, visits: deepestVisits, detour: STRUGGLE_DETOUR },
    ]);

    expect(corpus.basis.kept).toBe(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);
    const struggles = struggleSignalsOf(result);

    expect(struggles.length).toBeGreaterThan(0);
    for (const struggle of struggles) {
      expect(struggle.attempts).toBe(deepestVisits);
      expect(struggle.attempts).not.toBe(
        shallowCount * shallowVisits + deepestCount * deepestVisits,
      );
    }
  });

  test("should never emit a backtrack struggle signal — it has no producer this sprint", () => {
    const rules = ruleSetV1();

    const backtrackCorpus = struggleCorpus({
      converted: BACKTRACK_CONVERTED,
      revisits: [
        {
          count: BACKTRACK_RETURNERS,
          visits: rules.struggleRepeatedAttemptMin,
          detour: STRUGGLE_DESTINATION,
        },
        { count: BACKTRACK_DROPPED, visits: 1, detour: STRUGGLE_DETOUR },
      ],
    });

    expect(backtrackCorpus.basis.kept).toBe(
      BACKTRACK_CONVERTED + BACKTRACK_RETURNERS + BACKTRACK_DROPPED,
    );
    expect(BACKTRACK_DROPPED * 100).toBeGreaterThanOrEqual(
      rules.funnelDropoffRateThresholdPercent * backtrackCorpus.basis.kept,
    );

    const struggles = [
      detectFunnelDropoff(backtrackCorpus, rules),
      detectFunnelDropoff(struggleAtMinimumCorpus(rules), rules),
      detectFunnelDropoff(firingCorpus(), rules),
    ].flatMap((result) => struggleSignalsOf(result));

    expect(struggles.length).toBeGreaterThan(0);
    expect(struggles.map((struggle) => struggle.subkind)).not.toContain("backtrack");
    for (const struggle of struggles) {
      expect(struggle.subkind).toBe("repeated_attempt");
    }

    expect(
      evidenceSignalSchema.parse({
        kind: "struggle",
        subkind: "backtrack",
        surface: STRUGGLE_ORIGIN,
        attempts: rules.struggleRepeatedAttemptMin,

        strugglingSessions: measuredCount({
          numerator: 1,
          denominator: 1,
          unit: "sessions",
          timeframe: { start: new Date("2026-04-06"), end: new Date("2026-04-13") },
          basis: { totalInWindow: 1, kept: 1, setAside: [] },
        }),
      }),
    ).toMatchObject({ kind: "struggle", subkind: "backtrack" });
  });
});

const D2B_ORIGIN = "/t1d2b/pricing";
const D2B_DESTINATION = "/t1d2b/checkout";
const D2B_DETOUR = "/t1d2b/help";

const D2B_CONVERTED = 4;
const D2B_REVISITING = 8;
const D2B_DROPPED = 8;

function selfTransitionCorpus(collapsed: boolean): DetectorCorpus {
  const converted = collapsed
    ? [D2B_ORIGIN, D2B_DESTINATION]
    : [D2B_ORIGIN, D2B_ORIGIN, D2B_DESTINATION];
  const revisiting = collapsed
    ? [D2B_ORIGIN, D2B_DETOUR, D2B_ORIGIN]
    : [D2B_ORIGIN, D2B_ORIGIN, D2B_DETOUR, D2B_ORIGIN, D2B_ORIGIN];
  const dropped = collapsed ? [D2B_ORIGIN] : [D2B_ORIGIN, D2B_ORIGIN, D2B_ORIGIN];

  return corpusOf({
    sessions: [
      ...cohort({
        idPrefix: "t1d2b-converted",
        count: D2B_CONVERTED,
        paths: converted,
        exclusionReason: "none",
        firstStartedAt: cohortStart(0),
      }),
      ...cohort({
        idPrefix: "t1d2b-revisiting",
        count: D2B_REVISITING,
        paths: revisiting,
        exclusionReason: "none",
        firstStartedAt: cohortStart(1),
      }),
      ...cohort({
        idPrefix: "t1d2b-dropped",
        count: D2B_DROPPED,
        paths: dropped,
        exclusionReason: "none",
        firstStartedAt: cohortStart(2),
      }),
    ],
    connectionState: CONNECTED_RECEIVING,
    truncated: false,
  });
}

describe("detectFunnelDropoff — the structural properties", () => {
  test("the dropped and struggling cohorts are structurally disjoint", () => {
    const rules = ruleSetV1();

    const corpus = struggleFixture([
      {
        count: STRUGGLE_ALL_REVISITING,
        visits: rules.struggleRepeatedAttemptMin,
        detour: STRUGGLE_DETOUR,
      },
    ]);

    expect(corpus.basis.kept).toBe(STRUGGLE_AT_ORIGIN);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    const struggles = struggleSignalsOf(result);
    expect(struggles).toHaveLength(1);

    const atOrigin = candidate.counts[0].numerator;
    const dropped = candidate.counts[1].numerator;
    const struggling = struggles[0].strugglingSessions.numerator;

    expect(atOrigin).toBe(STRUGGLE_AT_ORIGIN);
    expect(dropped).toBe(STRUGGLE_DROPPED);

    expect(struggling).toBe(STRUGGLE_ALL_REVISITING);

    expect(dropped + struggling).toBe(atOrigin);
  });

  test("the self-transition filter is unreachable while pathWalk collapses consecutive repeats", () => {
    const rules = ruleSetV1();

    const withRepeats = detectFunnelDropoff(selfTransitionCorpus(false), rules);
    const preCollapsed = detectFunnelDropoff(selfTransitionCorpus(true), rules);

    expect(withRepeats.candidates).toHaveLength(1);
    expect(withRepeats.candidates[0].surface).toBe(D2B_ORIGIN);
    expect(withRepeats.candidates[0].counts[0].numerator).toBe(
      D2B_CONVERTED + D2B_REVISITING + D2B_DROPPED,
    );
    expect(withRepeats.candidates[0].counts[1].numerator).toBe(D2B_DROPPED);

    expect(struggleSignalsOf(withRepeats)).toEqual([]);

    expect(withRepeats).toEqual(preCollapsed);
  });
});

const FLOOR_ORIGIN = "/t1flr/pricing";
const FLOOR_DESTINATION = "/t1flr/checkout";

const FLOOR_AT_ORIGIN = 20;
const FLOOR_DROPPED = 10;

const SYNTHETIC_RULE_SET_VERSION = -1;

function withMinDropoffSessions(
  rules: ThresholdRuleSet,
  funnelMinDropoffSessions: number,
): ThresholdRuleSet {
  return { ...rules, version: SYNTHETIC_RULE_SET_VERSION, funnelMinDropoffSessions };
}

function floorCorpus(): DetectorCorpus {
  return corpusOf({
    sessions: [
      ...cohort({
        idPrefix: "t1flr-converted",
        count: FLOOR_AT_ORIGIN - FLOOR_DROPPED,
        paths: [FLOOR_ORIGIN, FLOOR_DESTINATION],
        exclusionReason: "none",
        firstStartedAt: cohortStart(0),
      }),
      ...cohort({
        idPrefix: "t1flr-dropped",
        count: FLOOR_DROPPED,
        paths: [FLOOR_ORIGIN],
        exclusionReason: "none",
        firstStartedAt: cohortStart(1),
      }),
    ],
    connectionState: CONNECTED_RECEIVING,
    truncated: false,
  });
}

describe("detectFunnelDropoff — funnelMinDropoffSessions", () => {
  test("should not fire below funnelMinDropoffSessions", () => {
    const v1 = ruleSetV1();

    expect(THRESHOLD_RULE_SETS.has(SYNTHETIC_RULE_SET_VERSION)).toBe(false);
    expect(THRESHOLD_RULE_SETS.get(SYNTHETIC_RULE_SET_VERSION)).toBeUndefined();

    expect(THRESHOLD_RULE_SETS.has(v1.version)).toBe(true);

    expect((v1.funnelMinDropoffSessions - 1) * 100).toBeLessThan(
      v1.funnelDropoffRateThresholdPercent * v1.funnelMinSessionsAtOrigin,
    );

    const corpus = floorCorpus();

    expect(corpus.basis.kept).toBe(FLOOR_AT_ORIGIN);
    expect(FLOOR_AT_ORIGIN).toBeGreaterThanOrEqual(v1.funnelMinSessionsAtOrigin);
    expect(FLOOR_DROPPED * 100).toBeGreaterThanOrEqual(
      v1.funnelDropoffRateThresholdPercent * FLOOR_AT_ORIGIN,
    );

    const atFloor = detectFunnelDropoff(corpus, withMinDropoffSessions(v1, FLOOR_DROPPED));
    expect(atFloor.candidates).toHaveLength(1);
    expect(
      atFloor.candidates[0].counts.some(
        (count) => count.numerator === FLOOR_DROPPED && count.denominator === FLOOR_AT_ORIGIN,
      ),
    ).toBe(true);

    const belowFloor = detectFunnelDropoff(corpus, withMinDropoffSessions(v1, FLOOR_DROPPED + 1));

    expect(belowFloor.candidates).toEqual([]);
  });
});

function versionedFiringCorpus(input: {
  readonly convertedVersion: number | null;
  readonly droppedVersion: number | null;
  readonly setAsideVersion?: number | null;
}): DetectorCorpus {
  const keptCohort = (
    idPrefix: string,
    count: number,
    paths: readonly (string | null)[],
    normalisationVersion: number | null,
    cohortIndex: number,
  ): readonly SessionTimeline[] => {
    const sessions: SessionTimeline[] = [];
    for (let index = 0; index < count; index += 1) {
      sessions.push(
        sessionTimeline({
          sessionId: `${idPrefix}-${String(index).padStart(3, "0")}`,
          startedAt: new Date(cohortStart(cohortIndex).getTime() + index * SESSION_STRIDE_MS),
          paths,
          exclusionReason: idPrefix.startsWith("setaside") ? "automation_headless" : "none",
          normalisationVersion,
        }),
      );
    }
    return sessions;
  };

  const sessions: readonly SessionTimeline[] = [
    ...keptCohort(
      "kept-converted",
      KEPT_CONVERTED,
      [ORIGIN, DESTINATION],
      input.convertedVersion,
      0,
    ),
    ...keptCohort("kept-dropped", KEPT_DROPPED, [ORIGIN], input.droppedVersion, 1),
    ...keptCohort(
      "setaside-headless",
      SET_ASIDE_HEADLESS,
      [ORIGIN],
      input.setAsideVersion ?? NORMALISATION_VERSION,
      2,
    ),
  ];

  return corpusOf({ sessions, connectionState: CONNECTED_RECEIVING, truncated: false });
}

function soleCandidateVersion(corpus: DetectorCorpus): number | null | undefined {
  const result = detectFunnelDropoff(corpus, ruleSetV1());

  expect(result.candidates).toHaveLength(1);
  return result.candidates[0].surfaceNormalisationVersion;
}

describe("detectFunnelDropoff — surfaceNormalisationVersion (PL ruling 28)", () => {
  test("should carry the version when every kept session on the surface agrees", () => {
    expect(
      soleCandidateVersion(
        versionedFiringCorpus({
          convertedVersion: NORMALISATION_VERSION,
          droppedVersion: NORMALISATION_VERSION,
        }),
      ),
    ).toBe(NORMALISATION_VERSION);
  });

  test("should report null when kept sessions on the surface disagree on the version", () => {
    expect(
      soleCandidateVersion(
        versionedFiringCorpus({
          convertedVersion: NORMALISATION_VERSION,
          droppedVersion: NORMALISATION_VERSION + 1,
        }),
      ),
    ).toBeNull();
  });

  test("should report null when any kept event on the surface predates version recording", () => {
    expect(
      soleCandidateVersion(
        versionedFiringCorpus({
          convertedVersion: NORMALISATION_VERSION,
          droppedVersion: null,
        }),
      ),
    ).toBeNull();
  });

  test("should report null, never 0, when no kept event on the surface records a version", () => {
    const version = soleCandidateVersion(
      versionedFiringCorpus({ convertedVersion: null, droppedVersion: null }),
    );

    expect(version).toBeNull();
    expect(version).not.toBe(0);
  });

  test("should ignore set-aside sessions when deciding unanimity (ruling 24)", () => {
    expect(
      soleCandidateVersion(
        versionedFiringCorpus({
          convertedVersion: NORMALISATION_VERSION,
          droppedVersion: NORMALISATION_VERSION,
          setAsideVersion: NORMALISATION_VERSION + 99,
        }),
      ),
    ).toBe(NORMALISATION_VERSION);
  });
});

const FORK_ORIGIN = "/esc9f/pricing";
const FORK_DESTINATIONS = ["/esc9f/checkout", "/esc9f/help", "/esc9f/faq"] as const;

const FORK_AT_ORIGIN = 30;
const FORK_DROPPED = 12;

function multiDestinationCorpus(): DetectorCorpus {
  const sessions: SessionTimeline[] = [];
  let index = 0;

  const push = (paths: readonly (string | null)[], count: number): void => {
    for (let n = 0; n < count; n += 1) {
      sessions.push(
        sessionTimeline({
          sessionId: `esc9f-${String(index).padStart(3, "0")}`,
          startedAt: new Date(cohortStart(0).getTime() + index * SESSION_STRIDE_MS),
          paths,
          exclusionReason: "none",
          normalisationVersion: NORMALISATION_VERSION,
        }),
      );
      index += 1;
    }
  };

  const REACHED = [4, 6, 8] as const;
  FORK_DESTINATIONS.forEach((destination, slot) => {
    push([FORK_ORIGIN, destination], REACHED[slot]);
  });

  push([FORK_ORIGIN], FORK_AT_ORIGIN - REACHED.reduce((sum, n) => sum + n, 0));

  return corpusOf({ sessions, connectionState: CONNECTED_RECEIVING, truncated: false });
}

const HEALTHY_HUB_ORIGIN = "/esc9h/pricing";
const HEALTHY_HUB_DESTINATIONS = ["/esc9h/checkout", "/esc9h/help", "/esc9h/faq"] as const;

const HEALTHY_HUB_PER_DESTINATION = 10;
const HEALTHY_HUB_AT_ORIGIN = HEALTHY_HUB_PER_DESTINATION * HEALTHY_HUB_DESTINATIONS.length;

const HEALTHY_HUB_WITNESS_DROPPED = 20;

function healthyHubSessions(): readonly SessionTimeline[] {
  const sessions: SessionTimeline[] = [];
  HEALTHY_HUB_DESTINATIONS.forEach((destination, slot) => {
    sessions.push(
      ...cohort({
        idPrefix: `esc9h-${String(slot)}`,
        count: HEALTHY_HUB_PER_DESTINATION,
        paths: [HEALTHY_HUB_ORIGIN, destination],
        exclusionReason: "none",
        firstStartedAt: cohortStart(slot),
      }),
    );
  });
  return sessions;
}

function healthyHubCorpus(): DetectorCorpus {
  return corpusOf({
    sessions: healthyHubSessions(),
    connectionState: CONNECTED_RECEIVING,
    truncated: false,
  });
}

function healthyHubWithDroppersCorpus(): DetectorCorpus {
  return corpusOf({
    sessions: [
      ...healthyHubSessions(),
      ...cohort({
        idPrefix: "esc9h-dropped",
        count: HEALTHY_HUB_WITNESS_DROPPED,
        paths: [HEALTHY_HUB_ORIGIN],
        exclusionReason: "none",
        firstStartedAt: cohortStart(HEALTHY_HUB_DESTINATIONS.length),
      }),
    ],
    connectionState: CONNECTED_RECEIVING,
    truncated: false,
  });
}

const TERMINAL_LANDING = "/esc9t/landing";

const TERMINAL_EXIT = "/esc9t/exit";
const TERMINAL_REACHED_EXIT = 25;

const TERMINAL_DROPPED_AT_LANDING = 17;

function terminalSurfaceCorpus(): DetectorCorpus {
  return corpusOf({
    sessions: [
      ...cohort({
        idPrefix: "esc9t-continued",
        count: TERMINAL_REACHED_EXIT,
        paths: [TERMINAL_LANDING, TERMINAL_EXIT],
        exclusionReason: "none",
        firstStartedAt: cohortStart(0),
      }),
      ...cohort({
        idPrefix: "esc9t-dropped",
        count: TERMINAL_DROPPED_AT_LANDING,
        paths: [TERMINAL_LANDING],
        exclusionReason: "none",
        firstStartedAt: cohortStart(1),
      }),
    ],
    connectionState: CONNECTED_RECEIVING,
    truncated: false,
  });
}

describe("detectFunnelDropoff — one origin with several destinations", () => {
  test("fix (b) — a firing hub emits exactly one candidate for the origin", () => {
    const rules = ruleSetV1();
    const corpus = multiDestinationCorpus();

    expect(corpus.basis.kept).toBe(FORK_AT_ORIGIN);
    expect(FORK_AT_ORIGIN).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);
    expect(FORK_DROPPED).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);

    expect(FORK_DROPPED * 100).toBe(rules.funnelDropoffRateThresholdPercent * FORK_AT_ORIGIN);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates).toHaveLength(1);

    const candidate = result.candidates[0];

    expect(candidate.surface).toBe(FORK_ORIGIN);
    expect(candidate.claimedClass).toBe("confusing");

    expect(candidate.counts[0].numerator).toBe(FORK_AT_ORIGIN);
    expect(candidate.counts[1].numerator).toBe(FORK_DROPPED);
    expect(candidate.counts[1].denominator).toBe(corpus.basis.kept);
  });

  test("every funnel candidate names its origin as the surface, with claimSubject surface", () => {
    const result = detectFunnelDropoff(multiDestinationCorpus(), ruleSetV1());

    expect(result.candidates.length).toBeGreaterThan(0);

    for (const candidate of result.candidates) {
      expect(candidate.surface).toBe(FORK_ORIGIN);
      expect(candidate.surface.length).toBeGreaterThan(0);
      expect(candidate.claimSubject).toBe("surface");
    }
  });

  test("fix (b) — a healthy hub that splits traffic three ways emits no candidate", () => {
    const rules = ruleSetV1();
    const corpus = healthyHubCorpus();

    expect(corpus.basis.kept).toBe(HEALTHY_HUB_AT_ORIGIN);
    expect(HEALTHY_HUB_AT_ORIGIN).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates).toHaveLength(0);

    const witness = detectFunnelDropoff(healthyHubWithDroppersCorpus(), rules);
    expect(witness.candidates).toHaveLength(1);
    expect(witness.candidates[0].surface).toBe(HEALTHY_HUB_ORIGIN);
    expect(witness.candidates[0].counts[1].numerator).toBe(HEALTHY_HUB_WITNESS_DROPPED);
  });

  test("an origin whose destination set is empty emits no candidate", () => {
    const rules = ruleSetV1();
    const corpus = terminalSurfaceCorpus();

    expect(TERMINAL_REACHED_EXIT).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates.map((candidate) => candidate.surface)).not.toContain(TERMINAL_EXIT);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].surface).toBe(TERMINAL_LANDING);
    expect(result.candidates[0].counts[1].numerator).toBe(TERMINAL_DROPPED_AT_LANDING);
  });

  test("fix (b) — one origin mints exactly one evidence_shape", () => {
    const result = detectFunnelDropoff(multiDestinationCorpus(), ruleSetV1());

    const shapes = result.candidates.map((candidate) =>
      evidenceShape(
        {
          detector: candidate.detector,
          surface: candidate.surface,
          surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
          signals: candidate.signals,

          symptomClass: "confusing",
        },
        EVIDENCE_SHAPE_VERSION,
      ),
    );

    expect(shapes).toHaveLength(1);
    expect(new Set(shapes).size).toBe(1);

    // A green result here means resolved. the identity half is closed by fix: one
    // origin, one candidate, one `evidence_shape`, so the signature ledger can hash
    // this without a surface minting three colliding identities on arrival.
  });
});
