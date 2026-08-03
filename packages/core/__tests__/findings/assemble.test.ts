import type { ConnectionState, ConnectionSummary } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { CountBasis } from "../../src/counts/measured-count";
import { measuredCount } from "../../src/counts/measured-count";
import { detectErrorEvent } from "../../src/detect/error-event";
import { detectFunnelDropoff } from "../../src/detect/funnel-dropoff";
import type {
  DetectorCorpus,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { assembleCandidates } from "../../src/findings/assemble";
import { candidateFindingSchema } from "../../src/findings/candidate";
import { EVIDENCE_SHAPE_VERSION } from "../../src/findings/evidence-shape";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

const WINDOW = {
  start: new Date("2026-07-01T00:00:00.000Z"),
  end: new Date("2026-07-08T00:00:00.000Z"),
} as const;
const CONNECTED_AT = new Date("2026-06-01T00:00:00.000Z");
const LAST_POLLED_AT = new Date("2026-07-07T23:00:00.000Z");
const FIRST_SESSION_AT = new Date("2026-07-03T09:00:00.000Z");
const EXCEPTION_AT = new Date("2026-07-03T12:00:00.000Z");

const SESSION_STRIDE_MS = 60_000;
const EVENT_STRIDE_MS = 1_000;

const PROJECT_ID = "prj-o012-assemble";
const ORIGIN = "/pricing";
const DESTINATION = "/checkout";
const NORMALISATION_VERSION = 1;

const ACTION_NAME = "checkout_submitted";

function ruleSet(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(2);
  if (!rules) throw new Error("rule set version 2 must remain resolvable forever");
  return rules;
}

function connectionState(): ConnectionState {
  const connection: ConnectionSummary = {
    id: "conn-o012-assemble",
    organizationId: "org-o012-assemble",
    projectId: PROJECT_ID,
    sourceKind: "posthog",
    host: "https://eu.posthog.invalid",
    sourceProjectId: "77012",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: LAST_POLLED_AT,
    watermarkAt: LAST_POLLED_AT,
    backfillBefore: null,
    pollIntervalSeconds: 300,
    connectedAt: CONNECTED_AT,
    inferredInternalDomain: null,
    internalDomainProvenance: null,
  };
  return { status: "connected_receiving", connection };
}

function pathSession(id: string, startedAt: Date, paths: readonly string[]): SessionTimeline {
  const events: readonly TimelineEvent[] = paths.map((urlPath, index) => ({
    sourceEventId: `${id}-e${String(index).padStart(3, "0")}`,
    name: `step_${String(index)}`,
    occurredAt: new Date(startedAt.getTime() + index * EVENT_STRIDE_MS),
    urlPath,
    urlPathNormalisationVersion: NORMALISATION_VERSION,
  }));
  return {
    sessionId: id,
    startedAt,
    exclusionReason: "none",
    entryUrlPath: paths[0] ?? null,
    events,
  };
}

function cohort(
  idPrefix: string,
  count: number,
  paths: readonly string[],
  firstStartedAt: Date,
): readonly SessionTimeline[] {
  return Array.from({ length: count }, (_unused, index) =>
    pathSession(
      `${idPrefix}-${String(index).padStart(3, "0")}`,
      new Date(firstStartedAt.getTime() + index * SESSION_STRIDE_MS),
      paths,
    ),
  );
}

function errorSession(id: string, gapMs: number, exceptionName: string): SessionTimeline {
  const actionAt = new Date(EXCEPTION_AT.getTime() - gapMs);
  return {
    sessionId: id,
    startedAt: actionAt,
    exclusionReason: "none",
    entryUrlPath: ORIGIN,
    events: [
      {
        sourceEventId: `${id}-action`,
        name: ACTION_NAME,
        occurredAt: actionAt,
        urlPath: ORIGIN,
        urlPathNormalisationVersion: NORMALISATION_VERSION,
      },
      {
        sourceEventId: `${id}-exception`,
        name: exceptionName,
        occurredAt: EXCEPTION_AT,
        urlPath: ORIGIN,
        urlPathNormalisationVersion: NORMALISATION_VERSION,
      },
    ],
  };
}

function corpusOf(sessions: readonly SessionTimeline[]): DetectorCorpus {
  const basis: CountBasis = {
    totalInWindow: sessions.length,
    kept: sessions.length,
    setAside: [],
  };
  return {
    projectId: PROJECT_ID,
    window: WINDOW,
    connectionState: connectionState(),
    sessions,
    basis,
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

const DETOUR = "/faq";

function funnelCorpus(input: { strugglers: number; struggleVisits: number }): DetectorCorpus {
  const strugglePaths: string[] = [];
  for (let visit = 0; visit < input.struggleVisits; visit += 1) {
    strugglePaths.push(ORIGIN, DETOUR);
  }
  const struggleSessions = cohort("struggle", input.strugglers, strugglePaths, FIRST_SESSION_AT);
  const dropped = cohort(
    "drop",
    12,
    [ORIGIN],
    new Date(FIRST_SESSION_AT.getTime() + 60 * 60 * 1_000),
  );
  const converted = cohort(
    "convert",
    18 - input.strugglers,
    [ORIGIN, DESTINATION],
    new Date(FIRST_SESSION_AT.getTime() + 2 * 60 * 60 * 1_000),
  );
  return corpusOf([...struggleSessions, ...dropped, ...converted]);
}

// Wave 2 adds `signals` to CandidateFinding; this reads the key the ADD's R-1 names.
function signalsOf(candidate: unknown): readonly EvidenceSignal[] | undefined {
  const record = candidate as Record<string, unknown>;
  return record["signals"] as readonly EvidenceSignal[] | undefined;
}

describe("assembleCandidates", () => {
  test("assembles a gate-passed funnel candidate into a schema-accepted CandidateFinding", () => {
    const rules = ruleSet();
    const result = detectFunnelDropoff(funnelCorpus({ strugglers: 3, struggleVisits: 3 }), rules);
    expect(result.candidates.length).toBe(1);

    const assembled = assembleCandidates([result], rules);

    expect(assembled.rejected).toEqual([]);
    expect(assembled.candidates.length).toBe(1);

    const candidate = assembled.candidates[0];
    if (candidate === undefined) throw new Error("asserted one candidate above");

    expect(candidate.detector).toBe("funnel_dropoff");
    expect(candidate.claimedClass).toBe("confusing");
    expect(candidate.finalClass).toBe("confusing");
    expect(candidate.trace.at(-1)?.satisfied).toBe(true);
    expect(candidate.surface).toBe(ORIGIN);

    expect(candidate.ranking.sampleSize).toBe(candidate.counts[0]);

    expect(candidate.thresholdRuleSetVersion).toBe(rules.version);
    expect(candidate.evidenceShapeVersion).toBe(EVIDENCE_SHAPE_VERSION);

    expect(candidate.evidenceShape).toContain('"symptomClass":"confusing"');
  });

  test("reports at_threshold when every proving magnitude sits exactly at its inclusive boundary", () => {
    const rules = ruleSet();

    const result = detectFunnelDropoff(funnelCorpus({ strugglers: 3, struggleVisits: 3 }), rules);
    const assembled = assembleCandidates([result], rules);

    expect(assembled.candidates[0]?.ranking.confidenceBasis).toBe("at_threshold");
  });

  test("reports threshold_met the moment a proving signal clears its magnitudes with room", () => {
    const rules = ruleSet();

    const result = detectFunnelDropoff(funnelCorpus({ strugglers: 4, struggleVisits: 4 }), rules);
    const assembled = assembleCandidates([result], rules);

    expect(assembled.candidates[0]?.ranking.confidenceBasis).toBe("threshold_met");
  });

  test("a gate-dropped candidate is named in rejected and never becomes a finding", () => {
    const rules = ruleSet();

    const result = detectFunnelDropoff(funnelCorpus({ strugglers: 0, struggleVisits: 0 }), rules);
    expect(result.candidates.length).toBe(1);

    const assembled = assembleCandidates([result], rules);

    expect(assembled.candidates).toEqual([]);
    expect(assembled.rejected.length).toBe(1);
    const rejection = assembled.rejected[0];
    if (rejection === undefined) throw new Error("asserted one rejection above");
    expect(rejection.detector).toBe("funnel_dropoff");
    expect(rejection.surface).toBe(ORIGIN);

    expect(rejection.trace.some((entry) => !entry.satisfied)).toBe(true);
  });

  test("two detectors firing on one surface assemble into ONE flat candidate list", () => {
    const rules = ruleSet();

    const funnel = funnelCorpus({ strugglers: 3, struggleVisits: 3 });
    const errors = Array.from({ length: rules.errorMinAffectedSessions }, (_unused, i) =>
      errorSession(`err-${String(i)}`, 1_000, rules.exceptionEventName),
    );
    const corpus = corpusOf([...funnel.sessions, ...errors]);

    const results: readonly DetectorResult[] = [
      detectFunnelDropoff(corpus, rules),
      detectErrorEvent(corpus, rules),
    ];
    const assembled = assembleCandidates(results, rules);

    expect(assembled.candidates.length).toBe(2);
    expect(new Set(assembled.candidates.map((c) => c.detector))).toEqual(
      new Set(["funnel_dropoff", "error_event"]),
    );
    expect(new Set(assembled.candidates.map((c) => c.surface))).toEqual(new Set([ORIGIN]));
  });

  test("a downgraded claim's identity follows the gate's conclusion, not the detector's ambition", () => {
    const rules = ruleSet();
    const basis: CountBasis = { totalInWindow: 5, kept: 5, setAside: [] };
    const count = (numerator: number) =>
      measuredCount({ numerator, denominator: 5, unit: "sessions", timeframe: WINDOW, basis });

    const constructed: DetectorResult = {
      detector: "error_event",
      connectionState: connectionState(),
      coverage: { truncated: false, eventsWithoutUrlPath: 0 },
      candidates: [
        {
          detector: "error_event",
          claimedClass: "broken",
          claimSubject: "surface",
          surface: ORIGIN,
          surfaceNormalisationVersion: NORMALISATION_VERSION,
          signals: [
            {
              kind: "failure_correlated",
              eventName: rules.exceptionEventName,
              occurredAt: EXCEPTION_AT,
              precedingActionName: ACTION_NAME,
              correlationWindowMs: rules.errorCorrelationWindowMs,
              correlatedSessions: count(rules.errorMinAffectedSessions - 1),
            },
            {
              kind: "struggle",
              subkind: "repeated_attempt",
              surface: ORIGIN,
              attempts: rules.struggleRepeatedAttemptMin + 2,
              strugglingSessions: count(rules.struggleMinStrugglingSessions + 2),
            },
          ],
          counts: [count(5), count(4)],
          timeframe: WINDOW,
          coverage: { truncated: false, eventsWithoutUrlPath: 0 },
        },
      ],
    };

    const assembled = assembleCandidates([constructed], rules);

    expect(assembled.candidates.length).toBe(1);
    const candidate = assembled.candidates[0];
    if (candidate === undefined) throw new Error("asserted one candidate above");

    expect(candidate.claimedClass).toBe("broken");
    expect(candidate.finalClass).toBe("confusing");

    expect(candidate.evidenceShape).toContain('"symptomClass":"confusing"');
    expect(candidate.evidenceShape).not.toContain('"symptomClass":"broken"');

    expect(candidate.trace.length).toBe(2);
    expect(candidate.trace[0]?.satisfied).toBe(false);
    expect(candidate.trace.at(-1)?.satisfied).toBe(true);
  });

  test("carries signals forward from the detector candidate", () => {
    const rules = ruleSet();
    const basis: CountBasis = { totalInWindow: 5, kept: 5, setAside: [] };
    const count = (numerator: number) =>
      measuredCount({ numerator, denominator: 5, unit: "sessions", timeframe: WINDOW, basis });

    const signals: readonly EvidenceSignal[] = [
      {
        kind: "failure_correlated",
        eventName: rules.exceptionEventName,
        occurredAt: EXCEPTION_AT,
        precedingActionName: ACTION_NAME,
        correlationWindowMs: rules.errorCorrelationWindowMs,
        correlatedSessions: count(rules.errorMinAffectedSessions - 1),
      },
      {
        kind: "struggle",
        subkind: "repeated_attempt",
        surface: ORIGIN,
        attempts: rules.struggleRepeatedAttemptMin + 2,
        strugglingSessions: count(rules.struggleMinStrugglingSessions + 2),
      },
    ];

    const constructed: DetectorResult = {
      detector: "error_event",
      connectionState: connectionState(),
      coverage: { truncated: false, eventsWithoutUrlPath: 0 },
      candidates: [
        {
          detector: "error_event",
          claimedClass: "broken",
          claimSubject: "surface",
          surface: ORIGIN,
          surfaceNormalisationVersion: NORMALISATION_VERSION,
          signals,
          counts: [count(5), count(4)],
          timeframe: WINDOW,
          coverage: { truncated: false, eventsWithoutUrlPath: 0 },
        },
      ],
    };

    const candidate = assembleCandidates([constructed], rules).candidates[0];
    if (candidate === undefined)
      throw new Error("the constructed result must assemble a candidate");

    expect(signalsOf(candidate)).toHaveLength(2);
    expect(signalsOf(candidate)?.map((signal) => signal.kind)).toEqual([
      "failure_correlated",
      "struggle",
    ]);

    const withoutTheKey = candidateFindingSchema.parse({
      detector: candidate.detector,
      claimedClass: candidate.claimedClass,
      finalClass: candidate.finalClass,
      trace: candidate.trace,
      counts: candidate.counts,
      timeframe: candidate.timeframe,
      claimSubject: candidate.claimSubject,
      surface: candidate.surface,
      surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
      evidenceShape: candidate.evidenceShape,
      evidenceShapeVersion: candidate.evidenceShapeVersion,
      thresholdRuleSetVersion: candidate.thresholdRuleSetVersion,
      ranking: candidate.ranking,
      coverage: candidate.coverage,
    });

    expect(signalsOf(withoutTheKey)).toEqual([]);
  });

  test("empty detector results assemble to nothing, loudly typed rather than crashed", () => {
    const rules = ruleSet();

    expect(assembleCandidates([], rules)).toEqual({ candidates: [], rejected: [] });

    const empty = detectFunnelDropoff(corpusOf([]), rules);
    expect(assembleCandidates([empty], rules)).toEqual({ candidates: [], rejected: [] });
  });
});
