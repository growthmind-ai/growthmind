import type { ConnectionState } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { MeasuredCount } from "../../src/counts/measured-count";
import { detectErrorEvent } from "../../src/detect/error-event";
import { detectFunnelDropoff } from "../../src/detect/funnel-dropoff";
import type {
  AnalysisWindow,
  DetectorCandidate,
  DetectorCorpus,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";
import { traceEntry } from "../../src/evidence/trace";
import type { CandidateFinding } from "../../src/findings/candidate";
import { candidateFindingSchema } from "../../src/findings/candidate";
import { EVIDENCE_SHAPE_VERSION } from "../../src/findings/evidence-shape";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";
import { detectorNameSchema } from "../../src/rules/types";
import { COUNT_ROLES, resolveCounts } from "../../src/summary/count-roles";

const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

const FIXTURE_PROJECT_ID = "t1cr-project";
const FIXTURE_NORMALISATION_VERSION = 1;
const FIXTURE_EVIDENCE_SHAPE = "t1cr-evidence-shape";

const EVENT_STRIDE_MS = 1_000;
const SESSION_STRIDE_MS = 60_000;
const PERCENT_SCALE = 100;

const FUNNEL_HEADROOM_SESSIONS = 10;

const FUNNEL_RATE_HEADROOM_SESSIONS = 1;

const ERROR_HEADROOM_SESSIONS = 2;

const FUNNEL_ORIGIN = "/t1cr/pricing";
const FUNNEL_DESTINATION = "/t1cr/checkout";
const FUNNEL_EVENT_NAME = "t1cr_step_viewed";

const ERROR_SURFACE = "/t1cr/settings";
const ERROR_ACTION = "t1cr_save_clicked";

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

const FIXTURE_CONNECTION_STATE: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "t1cr-connection",
    organizationId: "t1cr-org",
    projectId: FIXTURE_PROJECT_ID,
    sourceKind: "posthog",
    host: "https://t1cr.example.invalid",
    sourceProjectId: "t1cr-source-project",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: FIXTURE_WINDOW.end,
    watermarkAt: FIXTURE_WINDOW.end,
    backfillBefore: null,
    pollIntervalSeconds: 60,
    connectedAt: FIXTURE_WINDOW.start,
    inferredInternalDomain: null,
    internalDomainProvenance: null,
  },
};

function corpusOf(sessions: readonly SessionTimeline[]): DetectorCorpus {
  return {
    projectId: FIXTURE_PROJECT_ID,
    window: FIXTURE_WINDOW,
    connectionState: FIXTURE_CONNECTION_STATE,
    sessions,
    basis: { totalInWindow: sessions.length, kept: sessions.length, setAside: [] },
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

function sessionStartedAt(index: number): Date {
  return new Date(FIXTURE_WINDOW.start.getTime() + index * SESSION_STRIDE_MS);
}

function funnelSession(index: number, paths: readonly string[]): SessionTimeline {
  const sessionId = `t1cr-funnel-${String(index).padStart(3, "0")}`;
  const startedAt = sessionStartedAt(index);
  const events: readonly TimelineEvent[] = paths.map((urlPath, step) => ({
    sourceEventId: `${sessionId}-e${String(step)}`,
    name: FUNNEL_EVENT_NAME,
    occurredAt: new Date(startedAt.getTime() + step * EVENT_STRIDE_MS),
    urlPath,
    urlPathNormalisationVersion: FIXTURE_NORMALISATION_VERSION,
  }));

  return {
    sessionId,
    startedAt,
    exclusionReason: "none",
    entryUrlPath: paths[0] ?? null,
    events,
  };
}

function firingFunnelCorpus(ruleSet: ThresholdRuleSet): DetectorCorpus {
  const atOrigin = ruleSet.funnelMinSessionsAtOrigin + FUNNEL_HEADROOM_SESSIONS;
  const dropped = Math.max(
    ruleSet.funnelMinDropoffSessions,
    Math.ceil((ruleSet.funnelDropoffRateThresholdPercent * atOrigin) / PERCENT_SCALE) +
      FUNNEL_RATE_HEADROOM_SESSIONS,
  );
  const continued = atOrigin - dropped;

  const sessions: SessionTimeline[] = [];
  for (let index = 0; index < continued; index += 1) {
    sessions.push(funnelSession(index, [FUNNEL_ORIGIN, FUNNEL_DESTINATION]));
  }
  for (let index = 0; index < dropped; index += 1) {
    sessions.push(funnelSession(continued + index, [FUNNEL_ORIGIN]));
  }

  return corpusOf(sessions);
}

function errorSession(index: number, ruleSet: ThresholdRuleSet): SessionTimeline {
  const sessionId = `t1cr-error-${String(index).padStart(3, "0")}`;
  const startedAt = sessionStartedAt(index);

  const gapMs = Math.floor(ruleSet.errorCorrelationWindowMs / 2);
  const exceptionAt = new Date(startedAt.getTime() + ruleSet.errorCorrelationWindowMs);
  const actionAt = new Date(exceptionAt.getTime() - gapMs);

  const events: readonly TimelineEvent[] = [
    {
      sourceEventId: `${sessionId}-action`,
      name: ERROR_ACTION,
      occurredAt: actionAt,
      urlPath: ERROR_SURFACE,
      urlPathNormalisationVersion: FIXTURE_NORMALISATION_VERSION,
    },
    {
      sourceEventId: `${sessionId}-exception`,
      name: ruleSet.exceptionEventName,
      occurredAt: exceptionAt,
      urlPath: ERROR_SURFACE,
      urlPathNormalisationVersion: FIXTURE_NORMALISATION_VERSION,
    },
  ];

  return {
    sessionId,
    startedAt,
    exclusionReason: "none",
    entryUrlPath: ERROR_SURFACE,
    events,
  };
}

function firingErrorCorpus(ruleSet: ThresholdRuleSet): DetectorCorpus {
  const affected = ruleSet.errorMinAffectedSessions + ERROR_HEADROOM_SESSIONS;
  const sessions: SessionTimeline[] = [];
  for (let index = 0; index < affected; index += 1) {
    sessions.push(errorSession(index, ruleSet));
  }
  return corpusOf(sessions);
}

function firstCandidateOf(result: DetectorResult): DetectorCandidate {
  const candidate = result.candidates[0];
  if (!candidate) {
    throw new Error(`the ${result.detector} fixture corpus produced no candidate to resolve`);
  }
  return candidate;
}

function funnelDetectorCandidate(ruleSet: ThresholdRuleSet): DetectorCandidate {
  return firstCandidateOf(detectFunnelDropoff(firingFunnelCorpus(ruleSet), ruleSet));
}

function errorDetectorCandidate(ruleSet: ThresholdRuleSet): DetectorCandidate {
  return firstCandidateOf(detectErrorEvent(firingErrorCorpus(ruleSet), ruleSet));
}

function candidateFindingFrom(input: {
  readonly source: DetectorCandidate;
  readonly ruleSet: ThresholdRuleSet;
  readonly counts?: readonly MeasuredCount[];
}): CandidateFinding {
  const { source, ruleSet } = input;
  const counts = input.counts ?? source.counts;
  const sampleSize = source.counts[0];
  if (!sampleSize) throw new Error("a detector candidate must carry at least one count");

  return candidateFindingSchema.parse({
    detector: source.detector,
    claimedClass: source.claimedClass,

    finalClass: source.claimedClass,
    trace: [
      traceEntry({
        class: source.claimedClass,
        predicate: "t1cr-fixture-predicate",
        predicateVersion: 1,
        satisfied: true,
      }),
    ],
    counts,
    timeframe: source.timeframe,
    claimSubject: source.claimSubject,
    surface: source.surface,
    surfaceNormalisationVersion: source.surfaceNormalisationVersion,
    evidenceShape: FIXTURE_EVIDENCE_SHAPE,
    evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
    thresholdRuleSetVersion: ruleSet.version,
    ranking: { sampleSize, confidenceBasis: "threshold_met" },
    coverage: source.coverage,
  });
}

function digitRunsIn(text: string): readonly string[] {
  return text.match(/\d+/g) ?? [];
}

function refusalMessageOf(call: () => unknown): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("count roles", () => {
  test("every detector's declared count roles match the arity its detector actually produces", () => {
    const ruleSet = ruleSetV1();

    const results: readonly DetectorResult[] = [
      detectFunnelDropoff(firingFunnelCorpus(ruleSet), ruleSet),
      detectErrorEvent(firingErrorCorpus(ruleSet), ruleSet),
    ];

    for (const result of results) {
      expect(result.candidates.length).toBeGreaterThan(0);
    }

    expect(results.map((result) => result.detector).toSorted()).toEqual(
      [...detectorNameSchema.options].toSorted(),
    );

    const disagreements: string[] = [];
    let compared = 0;

    for (const result of results) {
      const declared = COUNT_ROLES[result.detector].length;
      for (const candidate of result.candidates) {
        compared += 1;
        if (candidate.counts.length !== declared) {
          disagreements.push(
            `${candidate.detector} declares ${String(declared)} count roles but produced ` +
              `${String(candidate.counts.length)} counts`,
          );
        }
      }
    }

    expect(compared).toBeGreaterThan(0);
    expect(disagreements).toEqual([]);

    expect(COUNT_ROLES.funnel_dropoff.length).not.toBe(COUNT_ROLES.error_event.length);
  });

  test("a candidate whose counts arity disagrees with its detector's declared roles is refused", () => {
    const ruleSet = ruleSetV1();
    const funnelSource = funnelDetectorCandidate(ruleSet);
    const errorSource = errorDetectorCandidate(ruleSet);

    const [errorCount] = errorSource.counts;
    if (!errorCount) throw new Error("the error fixture must produce a count");
    const tooMany = candidateFindingFrom({
      source: errorSource,
      ruleSet,
      counts: [errorCount, errorCount],
    });

    const [funnelFirst] = funnelSource.counts;
    if (!funnelFirst) throw new Error("the funnel fixture must produce a count");
    const tooFew = candidateFindingFrom({
      source: funnelSource,
      ruleSet,
      counts: [funnelFirst],
    });

    expect(() => resolveCounts(tooMany)).toThrow();
    expect(() => resolveCounts(tooFew)).toThrow();

    const tooManyMessage = refusalMessageOf(() => resolveCounts(tooMany));
    const tooFewMessage = refusalMessageOf(() => resolveCounts(tooFew));
    expect(tooManyMessage).not.toBeNull();
    expect(tooFewMessage).not.toBeNull();

    expect(tooManyMessage).toContain("error_event");
    expect(digitRunsIn(tooManyMessage ?? "").toSorted()).toEqual(["1", "2"]);
    expect(tooFewMessage).toContain("funnel_dropoff");
    expect(digitRunsIn(tooFewMessage ?? "").toSorted()).toEqual(["1", "2"]);

    const values = [
      ...tooMany.counts.flatMap((count) => [count.numerator, count.denominator]),
      ...tooFew.counts.flatMap((count) => [count.numerator, count.denominator]),
    ];
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => value > COUNT_ROLES.funnel_dropoff.length)).toBe(true);
    for (const value of values) {
      expect(digitRunsIn(tooManyMessage ?? "")).not.toContain(String(value));
      expect(digitRunsIn(tooFewMessage ?? "")).not.toContain(String(value));
    }
  });

  test("resolveCounts returns each count under its declared role for a funnel candidate", () => {
    const ruleSet = ruleSetV1();
    const candidate = candidateFindingFrom({
      source: funnelDetectorCandidate(ruleSet),
      ruleSet,
    });

    const resolved = resolveCounts(candidate);
    expect(resolved.detector).toBe("funnel_dropoff");
    if (resolved.detector !== "funnel_dropoff") {
      throw new Error("the funnel fixture must resolve as a funnel_dropoff candidate");
    }

    expect(resolved.counts.reached_surface).toBe(candidate.counts[0]);
    expect(resolved.counts.left_without_continuing).toBe(candidate.counts[1]);

    expect(Object.keys(resolved.counts).toSorted()).toEqual(
      [...COUNT_ROLES.funnel_dropoff].toSorted(),
    );

    expect(resolved.counts.reached_surface).not.toBe(resolved.counts.left_without_continuing);
    expect(resolved.counts.reached_surface.numerator).toBeGreaterThan(
      resolved.counts.left_without_continuing.numerator,
    );
  });

  test("resolveCounts returns the single affected-sessions role for an error candidate", () => {
    const ruleSet = ruleSetV1();
    const candidate = candidateFindingFrom({
      source: errorDetectorCandidate(ruleSet),
      ruleSet,
    });

    expect(candidate.counts).toHaveLength(1);

    const resolved = resolveCounts(candidate);
    expect(resolved.detector).toBe("error_event");
    if (resolved.detector !== "error_event") {
      throw new Error("the error fixture must resolve as an error_event candidate");
    }

    expect(resolved.counts.affected_sessions).toBe(candidate.counts[0]);
    expect(Object.keys(resolved.counts).toSorted()).toEqual(
      [...COUNT_ROLES.error_event].toSorted(),
    );
  });

  test("COUNT_ROLES has an entry for every detector name", () => {
    const declared: readonly string[] = Object.keys(COUNT_ROLES).toSorted();
    const known: readonly string[] = [...detectorNameSchema.options].toSorted();

    expect(declared.length).toBeGreaterThan(0);
    expect(known.length).toBeGreaterThan(0);

    expect(declared).toEqual(known);

    for (const name of known) expect(declared).toContain(name);
    for (const name of declared) expect(known).toContain(name);

    for (const detector of detectorNameSchema.options) {
      const roles: readonly string[] = COUNT_ROLES[detector];
      expect(roles.length).toBeGreaterThan(0);
      expect(new Set(roles).size).toBe(roles.length);
    }
  });
});
