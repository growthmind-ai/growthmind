// Unit tests for funnel_dropoff: the fourteen named tests for the T1 path-transition detector.
//
// What this file is for, in one sentence: `funnel_dropoff` is one of only two detectors
// this sprint ships, and every claim it makes reaches a founder as a sentence with a
// denominator in it, so the count, the denominator, and the boundary that decided to
// speak at all are the contract, not the internals.
//
// The load-bearing pair is tests 9 and 10. Their fixtures differ by exactly one
// session, and `40%` is an integer percent compared with exact integer arithmetic
// (`numerator * 100 >= 40 * denominator`). That is precisely why the rule-set member
// is named `funnelDropoffRateThresholdPercent` rather than holding `0.4`: float
// division can land one ulp low and silently turn the inclusive "fires at exactly the
// threshold" into "fires just above it", which no test written in floats can see.
//
// House rules honoured here (state.md standing constraints):
// Fixture time is a required parameter. There is no `Date.now` in this
//  file; every instant descends from the frozen constants below. The whole
//  suite is time-of-day invariant by construction.
// : the corpus carries every selected session with its own
//  `exclusionReason`, and the detector applies. So the fixtures below
//  put set-aside sessions IN the corpus and assert they reach neither a
//  numerator nor a denominator. Both boundary fixtures are deliberately
//  built so that a leak flips the verdict — a silent regression cannot
//  pass tests 9 and 10.
// : there is no `now`/clock parameter. Window instants arrive
//  as `corpus.window`.
// : the rule set is handed in as a parameter, fetched by version
//  (`THRESHOLD_RULE_SETS.get`), never as "whatever is current".
// No node builtin. The one test that reads source text uses `Bun.file` and
//  `import.meta.dir`, not `node:fs`.
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

// Frozen fixture time (no `Date.now` anywhere in `__tests__`)

const WINDOW_START = new Date("2026-07-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-08T00:00:00.000Z");
const CONNECTED_AT = new Date("2026-06-01T00:00:00.000Z");
const LAST_POLLED_AT = new Date("2026-07-07T23:00:00.000Z");
/** Every session's `startedAt` descends from this instant plus an offset. */
const FIRST_SESSION_STARTED_AT = new Date("2026-07-03T09:00:00.000Z");

const EVENT_STRIDE_MS = 1_000;
const SESSION_STRIDE_MS = 60_000;
const COHORT_STRIDE_MS = 60 * 60 * 1_000;

/** Cohort n starts an hour after cohort n-1, so no two fixture sessions share a
 * `startedAt` and no id collides. */
function cohortStart(index: number): Date {
  return new Date(FIRST_SESSION_STARTED_AT.getTime() + index * COHORT_STRIDE_MS);
}

// Surfaces and magnitudes

const PROJECT_ID = "prj-t1-funnel-dropoff";
const ORIGIN = "/pricing";
const DESTINATION = "/checkout";
/** . `normaliseUrlPath` already collapsed `/orders/1` and `/orders/2` to this one
 * surface upstream. What the detector sees is a single path, and the assertion is that
 * it counts it as one thing rather than as an anomaly. */
const COLLAPSED_ORDER_PATH = "/orders/:id";
/**  adjacency: a real version, never `null` and never coerced to `0`. */
const NORMALISATION_VERSION = 1;

/** The detector must not care what an event is called. These names are deliberately
 * unlike any vendor reserved literal, and test 13 additionally renames every one of
 * them and asserts the output does not move. */
const EVENT_NAMES: readonly string[] = ["step_a", "step_b", "step_c"];

/** Test 1's cohort sizes. 18 of 30 is 60%. Comfortably over the 40% gate, so test 1 is
 * about the shape of the count, not about the boundary. */
const KEPT_AT_ORIGIN = 30;
const KEPT_DROPPED = 18;
const KEPT_CONVERTED = KEPT_AT_ORIGIN - KEPT_DROPPED;
const SET_ASIDE_HEADLESS = 6;
const SET_ASIDE_INTERNAL = 4;

/** Tests 9 and 10. 40% of 25 is exactly 10, with no remainder, which is what lets "one
 * below" and "exactly at" differ by a single session. */
const BOUNDARY_AT_ORIGIN = 25;
const BOUNDARY_DROPPED_ONE_BELOW = 9;
const BOUNDARY_DROPPED_AT_THRESHOLD = 10;
const BOUNDARY_SET_ASIDE = 5;

/** Test 11. One below `funnelMinSessionsAtOrigin`, at a rate that would otherwise fire
 * easily. */
const BELOW_FLOOR_AT_ORIGIN = 19;
const BELOW_FLOOR_DROPPED = 18;

// Rule set, fetched by version, never "current"

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

// Connection states, vs are different answers to the customer

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
    // `null` means never polled. The whole of 's distinguishability.
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

/** : we looked, and there is genuinely nothing. */
const CONNECTED_NO_EVENTS_YET: ConnectionState = {
  status: "connected_no_events_yet",
  connection: connectionSummary(LAST_POLLED_AT),
};

/** : we have never looked. */
const CONNECTED_NEVER_POLLED: ConnectionState = {
  status: "connected_never_polled",
  connection: connectionSummary(null),
};

// Corpus fixtures

type SessionSpec = {
  readonly sessionId: string;
  /** Required. No fixture may seed a time column from a clock. */
  readonly startedAt: Date;
  /** The `url_path` of each event, in order. `null` is a genuinely path-less event
   * , not a fixture defect. */
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
    // : a path-less event has no normalisation to record, and `null` is never
    // coerced to `0`.
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

/**
 * Derived from the sessions rather than hand-written, so the identity `kept + Σ
 * setAside.count === totalInWindow` (which `measuredCount` asserts) can never be
 * satisfied by a fixture that lies about its own contents.
 */
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

/** Also derived, so `eventsWithoutUrlPath` is always the TRUE number of path-less
 * events in the fixture. */
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

/**
 * The workhorse fixture: 30 kept sessions reach `/pricing`, 18 of them never reach
 * `/checkout`, and ten set-aside sessions sit in the corpus alongside them. Every
 * set-aside session drops, so a detector that forgot would report 28 of 40 rather than
 * 18 of 30. The assertion in test 1 names both numbers.
 */
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

/**
 * Tests 9 and 10. `dropped` is the only thing that changes between them, and
 * `setAsidePaths` decides which way an leak would break the verdict:
 * Test 9 (one below) seeds set-aside droppers, so a leak would push the
 *  rate over the gate and produce a candidate where none is allowed;
 * Test 10 (exactly at) seeds set-aside converters, so a leak would dilute
 *  the rate under the gate and silence a candidate that must be produced.
 * Either way the leak fails a test, which is the point.
 */
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

/** The same 30 kept sessions as `firingSessions`, with a genuinely path-less
 * event wedged into the middle of every one of them. */
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

/** . */
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

/** the runtime half: the same corpus with every event renamed. */
function withEveryEventNamed(corpus: DetectorCorpus, name: string): DetectorCorpus {
  return {
    ...corpus,
    sessions: corpus.sessions.map((session) => ({
      ...session,
      events: session.events.map((event) => ({ ...event, name })),
    })),
  };
}

/** Removes block and line comments so the prose above the function, which legitimately
 * explains why `$pageview` is not used. Cannot be mistaken for an event-name literal in
 * the code (the F-9 precedent). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("detectFunnelDropoff", () => {
  test("should emit a qualifying origin's drop-off as a MeasuredCount over sessions", () => {
    const corpus = firingCorpus();

    // Fixture self-check: 40 sessions selected, 30 kept. If this drifts, every number
    // below stops meaning what its name says.
    expect(corpus.basis.totalInWindow).toBe(
      KEPT_AT_ORIGIN + SET_ASIDE_HEADLESS + SET_ASIDE_INTERNAL,
    );
    expect(corpus.basis.kept).toBe(KEPT_AT_ORIGIN);

    const result = detectFunnelDropoff(corpus, ruleSetV1());

    expect(result.detector).toBe("funnel_dropoff");
    // One qualifying origin (`/pricing`), one candidate. Emits per ORIGIN, not per
    // transition. This fixture has a single destination, so the two happen to coincide
    // here; the multi-destination fixtures at the foot of this file are what tell them
    // apart.
    expect(result.candidates).toHaveLength(1);

    const candidate = result.candidates[0];
    expect(candidate.detector).toBe("funnel_dropoff");
    expect(candidate.timeframe).toEqual(corpus.window);
    expect(candidate.counts.length).toBeGreaterThan(0);

    for (const count of candidate.counts) {
      // /: built by the smart constructor, brand and all. A structurally identical
      // object literal is not a MeasuredCount.
      expect(isMeasuredCount(count)).toBe(true);
      // Sessions, never people. Identity stitching does not exist.
      expect(count.unit).toBe("sessions");
      // /: the denominator is kept sessions. The ten set-aside sessions inflate
      // nothing.
      expect(count.denominator).toBe(KEPT_AT_ORIGIN);
      expect(count.basis).toEqual(corpus.basis);
      expect(count.timeframe).toEqual(corpus.window);
    }

    // The drop-off itself: 18 of 30, not 28 of 40.
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

    // No division, no error, and an answer rather than a silence: the empty candidate
    // list travels with a positive statement of what we know.
    expect(result.detector).toBe("funnel_dropoff");
    expect(result.candidates).toEqual([]);
    expect(result.connectionState.status).toBe("connected_no_events_yet");
    expect(result.coverage).toEqual({ truncated: false, eventsWithoutUrlPath: 0 });
  });

  test("should return an empty result for a project connected but never polled, distinguishable from polled-and-empty", () => {
    const rules = ruleSetV1();

    const neverPolled = detectFunnelDropoff(emptyCorpus(CONNECTED_NEVER_POLLED), rules);
    const polledAndEmpty = detectFunnelDropoff(emptyCorpus(CONNECTED_NO_EVENTS_YET), rules);

    // Both are empty...
    expect(neverPolled.candidates).toEqual([]);
    expect(polledAndEmpty.candidates).toEqual([]);

    // ...and the two are not the same answer to the customer. "We have never looked"
    // and "we looked and found nothing" must never render alike.
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
    // The floor is what must stop this, and it is a magnitude, not a special case for
    // "n === 1" (fail direction lives in the constant).
    expect(corpus.basis.kept).toBeLessThan(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    // The detector runs, it does not refuse, and it does not throw. It simply has
    // nothing worth telling a founder. Fail direction: under-detect.
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

    // Deliberately above the origin floor, so an empty result here can only mean "there
    // were no transitions", never "there were too few sessions".
    expect(corpus.basis.kept).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates).toEqual([]);
    expect(result.coverage.eventsWithoutUrlPath).toBe(0);
  });

  test("should return no transitions for a one-step funnel, not an error", () => {
    const rules = ruleSetV1();
    // Three events, all on the same path: no two consecutive distinct `url_path`
    // values, therefore no transition. Distinct from the single-event case above, and
    // equally not an error.
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

    // A well-formed result, not a throw.
    expect(result.detector).toBe("funnel_dropoff");
    expect(result.connectionState.status).toBe("connected_receiving");
    expect(result.candidates).toEqual([]);
  });

  test("should exclude null-url_path events from transitions and record them in coverage, never silently", () => {
    const corpus = nullPathCorpus();

    // One path-less event per kept session.
    expect(corpus.coverage.eventsWithoutUrlPath).toBe(KEPT_AT_ORIGIN);

    const result = detectFunnelDropoff(corpus, ruleSetV1());

    //  excluded, the path-less event sits between `/pricing` and `/checkout` and
    // must not fragment the transition into two, nor become a surface of its own. One
    // candidate, and the drop-off is unchanged at 18 of 30.
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect([ORIGIN, DESTINATION]).toContain(candidate.surface);
    expect(candidate.surface.length).toBeGreaterThan(0);
    expect(
      candidate.counts.some(
        (count) => count.numerator === KEPT_DROPPED && count.denominator === KEPT_AT_ORIGIN,
      ),
    ).toBe(true);

    //  and recorded, never a silent drop. The number travels on the result and onto
    // the candidate a founder actually reads.
    expect(result.coverage.eventsWithoutUrlPath).toBe(KEPT_AT_ORIGIN);
    expect(candidate.coverage.eventsWithoutUrlPath).toBe(KEPT_AT_ORIGIN);
  });

  test("should count a redaction-collapsed path (/orders/:id) as one surface, not an anomaly", () => {
    const result = detectFunnelDropoff(collapsedPathCorpus(), ruleSetV1());

    // Two source paths legitimately collapsed to one upstream. That is correct
    // behaviour: one surface, one candidate, not one per redacted id, and not a
    // rejected row.
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];

    expect([COLLAPSED_ORDER_PATH, DESTINATION]).toContain(candidate.surface);
    // A raw identifier must never reach a surface (product-decisions).
    expect(candidate.surface).not.toMatch(/\/\d/);
    // : the version that produced the redaction travels with it, and is a real
    // number rather than `null` or a coerced `0`.
    expect(candidate.surfaceNormalisationVersion).toBe(NORMALISATION_VERSION);

    // The denominator counts the collapsed surface, once per session.
    expect(
      candidate.counts.some(
        (count) => count.numerator === KEPT_DROPPED && count.denominator === KEPT_AT_ORIGIN,
      ),
    ).toBe(true);
  });

  test("should not fire at one below funnelDropoffRateThreshold", () => {
    const rules = ruleSetV1();
    // Set-aside droppers: if leaked, the rate would clear the gate and a candidate
    // would appear where none is allowed.
    const corpus = rateBoundaryCorpus({
      dropped: BOUNDARY_DROPPED_ONE_BELOW,
      setAsidePaths: [ORIGIN],
    });

    expect(corpus.basis.kept).toBe(BOUNDARY_AT_ORIGIN);

    // Exact integer arithmetic. 9 * 100 = 900 < 40 * 25 = 1000. No float division
    // anywhere in this comparison, which is the whole reason the rule-set member is an
    // integer percent.
    expect(BOUNDARY_DROPPED_ONE_BELOW * 100).toBeLessThan(
      rules.funnelDropoffRateThresholdPercent * BOUNDARY_AT_ORIGIN,
    );
    // Nothing else is blocking it. Both other gates are satisfied, so an empty result
    // can only mean the rate gate held.
    expect(BOUNDARY_DROPPED_ONE_BELOW).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);
    expect(BOUNDARY_AT_ORIGIN).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    // Fail direction: Under-detect. A missed finding is recoverable; a false claim
    // burns the credibility the MVP exists to test.
    expect(result.candidates).toEqual([]);
  });

  test("should fire at exactly funnelDropoffRateThreshold", () => {
    const rules = ruleSetV1();
    // One session more than the previous test drops. Set-aside converters this time: if
    // leaked, the rate would be diluted below the gate and this candidate would vanish.
    const corpus = rateBoundaryCorpus({
      dropped: BOUNDARY_DROPPED_AT_THRESHOLD,
      setAsidePaths: [ORIGIN, DESTINATION],
    });

    expect(corpus.basis.kept).toBe(BOUNDARY_AT_ORIGIN);
    expect(BOUNDARY_DROPPED_AT_THRESHOLD).toBe(BOUNDARY_DROPPED_ONE_BELOW + 1);

    // The boundary is inclusive, and it is exact, 10 * 100 === 40 * 25, with no
    // rounding on either side. `10 / 25 >= 0.4` is the comparison this test exists to
    // keep out of the implementation.
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

    // "Regardless of rate": 18 of 19 is 94.7% (far over the rate gate) and the absolute
    // drop-off floor is cleared too. Only the origin floor is holding, and it must hold
    // on its own.
    expect(BELOW_FLOOR_DROPPED * 100).toBeGreaterThanOrEqual(
      rules.funnelDropoffRateThresholdPercent * BELOW_FLOOR_AT_ORIGIN,
    );
    expect(BELOW_FLOOR_DROPPED).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);

    const result = detectFunnelDropoff(corpus, rules);

    // A denominator below 20 cannot support a rate claim to a founder.
    expect(result.candidates).toEqual([]);
  });

  test("should never propose changed_mind", () => {
    const rules = ruleSetV1();

    //  the type-level guarantee, asserted at runtime. `changed_mind` is not a member
    // of `DetectorProposedClass`, so this cannot happen today, which is exactly why it
    // is asserted: a later widening of the union would otherwise reopen the door
    // silently.
    expect(detectorProposedClassSchema.options).not.toContain("changed_mind");

    //  over the fixture corpus. `changed_mind`'s proof is satisfied by the absence
    // of everything, so a deterministic detector proposing it for a clean drop-off
    // would tell a founder "this user changed their mind" when the product broke under
    // them.
    const candidates = [
      firingCorpus(),
      rateBoundaryCorpus({ dropped: BOUNDARY_DROPPED_AT_THRESHOLD, setAsidePaths: [ORIGIN] }),
      nullPathCorpus(),
      collapsedPathCorpus(),
      firingCorpus(true),
    ].flatMap((corpus) => detectFunnelDropoff(corpus, rules).candidates);

    // Non-vacuity before checking for offenders: an empty list proves nothing.
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

    // Non-vacuity: prove the scan found the module before asserting it is clean.
    expect(code).toContain("detectFunnelDropoff");

    //  static. came back failed-to-pin, so a detector keyed on a page-view event
    // name would be built on an unpinned assumption. No vendor-reserved literal may
    // survive outside the comments.
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

    //  runtime. The static scan cannot see a name read from a variable, so this is
    // the half that actually holds: rename every event in the corpus and the output
    // must not move by a single field.
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
    // Non-vacuity: a run with no candidates cannot demonstrate propagation.
    expect(result.candidates.length).toBeGreaterThan(0);

    for (const candidate of result.candidates) {
      // the precedent incident was a silent truncation that read as "no more events". The
      // limitation travels with the claim, not beside it in a log.
      expect(candidate.coverage.truncated).toBe(true);
      expect(candidate.coverage).toEqual(result.coverage);
    }
  });
});

// `struggle.attempts` (Wave 7, task 6.7)
//
// The gap this closes. Not one fixture above visits an origin surface more than once,
// so the `struggle` / `repeated_attempt` producer was entirely unasserted, and it is
// the only producer of `confusing` proof in the whole sprint. `funnel_dropoff` proposes
// `confusing` and nothing else, so this signal is the single path by which this product
// ever ships a passing finding. Left untested, a refactor could silence it while every
// suite stayed green and the product went permanently, invisibly quiet.
//
// What ruling 31 says, exactly: `attempts` is the greatest number of separate visits to
// the origin surface made by any one kept session that reached it. A per-session
// maximum, never a sum across sessions. The rule set's own comment ("two visits to a
// path is navigation; three is a pattern") is a statement about one person's session,
// not about a cohort.
//
// Lane: every id and path below is `t1str`-prefixed and collides with nothing above.
// Fixture time still descends from `FIRST_SESSION_STARTED_AT` via `cohortStart`; no
// `Date.now` is introduced.

const STRUGGLE_ORIGIN = "/t1str/pricing";
const STRUGGLE_DESTINATION = "/t1str/checkout";
/** A different path, needed only so that two visits are two visits: `pathWalk`
 * collapses consecutive repeats, so `[O, O]` is one visit and `[O, X, O]` is two. This
 * is what "separate visits" means. */
const STRUGGLE_DETOUR = "/t1str/help";

/**
 * Why this fixture has three cohorts and not two.
 *
 * Under per-origin aggregation `D` is built by `transitionsOf` from the corpus's own
 * walks, so `/t1str/help` (the detour a revisiting session walks through) is itself a
 * member of `D(t1str/pricing)`. A session that revisits the origin therefore continued
 * by construction and can never be counted as dropped. That is a structural property,
 * not an accident, and the test further down this file pins it.
 *
 * The predecessor fixture had one cohort supply both the revisits and the drop-off.
 * After aggregation it produced `dropped = 0`, no candidate fired, and all four tests
 * below died at their non-vacuity preconditions rather than at their subject. The
 * replacement gives the two jobs to two cohorts, which works because the struggle
 * magnitudes are computed over `atOrigin` and not over `dropped`
 * (`funnel-dropoff.ts:294-298`, unmodified by this sprint):
 *
 * A revisit cohort walks `[O, detour, O, …]`, so it continues, and it is
 *  what supplies `attempts` / `strugglingSessions`;
 * A dropped cohort walks `[O]` (the walk ends at the origin) and it is
 *  what supplies the drop-off;
 * A converted cohort walks `[O, destination]` and pads the denominator.
 *
 * All three sit in `atOrigin`, so the drop-off gates and the struggle magnitude are
 * both live in one corpus.
 */
const STRUGGLE_AT_ORIGIN = 20;
const STRUGGLE_DROPPED = 8;
/** The revisiting cohort of `struggleAtMinimumCorpus`. Small enough that the converted
 * cohort still pads `atOrigin` to exactly the origin floor. */
const STRUGGLE_REVISITING = 4;
/** Tests 3 and 4 need many shallow revisiters, so that a summing implementation of
 * `attempts` would clear the minimum while the per-session maximum does not. */
const STRUGGLE_SHALLOW_MANY = 8;
/** The disjointness fixture: Every continuing session revisits, so the dropped cohort
 * and the struggling cohort together partition `atOrigin`. */
const STRUGGLE_ALL_REVISITING = STRUGGLE_AT_ORIGIN - STRUGGLE_DROPPED;

/** The back-navigation fixture (ruling 18). 12 + 8 + 14 = 34 at the origin, 14 of 34 is
 * 41.2%. Over the rate gate, so the candidate fires and the subkind assertion is not
 * vacuous. */
const BACKTRACK_CONVERTED = 12;
const BACKTRACK_RETURNERS = 8;
const BACKTRACK_DROPPED = 14;

type RevisitCohort = {
  readonly count: number;
  /** Separate visits to `STRUGGLE_ORIGIN` each session in this cohort makes. */
  readonly visits: number;
  /** The path walked between two visits. `STRUGGLE_DETOUR` keeps the session a dropper;
   * `STRUGGLE_DESTINATION` makes it a genuine back-navigator. */
  readonly detour: string;
};

/** `visits: 3` -> `[origin, detour, origin, detour, origin]`; `visits: 1` ->
 * `[origin]`, i.e. an ordinary single-visit dropper. */
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

/**
 * Every corpus the four tests below use. The drop-off cohort and the denominator are
 * held fixed at exactly the gate, `STRUGGLE_DROPPED` sessions whose walk ends at the
 * origin, out of exactly `STRUGGLE_AT_ORIGIN`, and only the revisiting cohorts vary. So
 * the drop-off always fires, and an absent struggle signal can only ever be the
 * struggle magnitude holding.
 *
 * The converted cohort is derived rather than passed, so a caller cannot silently drift
 * the denominator off the origin floor while varying the thing the test is actually
 * about.
 */
function struggleFixture(revisits: readonly RevisitCohort[]): DetectorCorpus {
  const revisiting = revisits.reduce((sum, spec) => sum + spec.count, 0);
  const converted = STRUGGLE_AT_ORIGIN - STRUGGLE_DROPPED - revisiting;
  if (converted < 0) {
    throw new Error("struggleFixture: the revisiting cohorts exceed the continuing budget");
  }

  return struggleCorpus({
    converted,
    revisits: [
      ...revisits,
      // The drop-off. `visits: 1` is `[origin]`, a walk that ends at the origin, which
      // is what `dropped` reduces to under.
      { count: STRUGGLE_DROPPED, visits: 1, detour: STRUGGLE_DETOUR },
    ],
  });
}

/** The exactly-at-the-boundary corpus, named because two tests need it. */
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

    // Fixture self-check. Every other gate is satisfied exactly, so what this test
    // observes can only be the struggle magnitude.
    expect(corpus.basis.kept).toBe(STRUGGLE_AT_ORIGIN);
    expect(corpus.basis.kept).toBe(rules.funnelMinSessionsAtOrigin);
    expect(STRUGGLE_DROPPED).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);
    expect(STRUGGLE_DROPPED * 100).toBe(
      rules.funnelDropoffRateThresholdPercent * corpus.basis.kept,
    );

    const result = detectFunnelDropoff(corpus, rules);
    const struggles = struggleSignalsOf(result);

    // Non-vacuity. The drop-off fires (one candidate for the one origin) so the
    // struggle assertions below are about a claim that actually reached a founder.
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].counts[1].numerator).toBe(STRUGGLE_DROPPED);

    // The boundary is inclusive. It fires AT the minimum, not one above it. The fail
    // direction is carried by the magnitude, never by `>` vs `>=`.
    expect(struggles.length).toBeGreaterThan(0);
    for (const struggle of struggles) {
      expect(struggle.subkind).toBe("repeated_attempt");
      // The ORIGIN, the surface the user kept coming back to, and the surface a fix
      // would target.
      expect(struggle.surface).toBe(STRUGGLE_ORIGIN);
      expect(struggle.attempts).toBe(rules.struggleRepeatedAttemptMin);
    }

    // And it travels ON the candidate a founder reads, exactly once. This is the proof
    // `confusing` needs to survive the gate.
    for (const candidate of result.candidates) {
      expect(candidate.claimedClass).toBe("confusing");
      expect(candidate.signals.filter((signal) => signal.kind === "struggle")).toHaveLength(1);
    }
  });

  test("should not emit a struggle signal one below struggleRepeatedAttemptMin", () => {
    const rules = ruleSetV1();
    const nearMissVisits = rules.struggleRepeatedAttemptMin - 1;
    // A near miss must still be a genuine revisit, or this test degenerates into the
    // single-visit case that proves nothing.
    expect(nearMissVisits).toBeGreaterThanOrEqual(2);

    // One session revisits, one below the minimum. Everything else in the corpus visits
    // the origin exactly once, so the per-session maximum is that one session's count
    // and nothing else can raise it.
    const corpus = struggleFixture([{ count: 1, visits: nearMissVisits, detour: STRUGGLE_DETOUR }]);

    expect(corpus.basis.kept).toBe(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    // Non-vacuity. The drop-off itself still fires, so an absent struggle is the
    // magnitude holding, never "the fixture produced nothing at all".
    expect(result.candidates.length).toBeGreaterThan(0);

    // Fail direction under-detect: two visits to a path is navigation, and only the
    // third makes it a pattern. The consequence is deliberate. A `confusing` claim with
    // no proof hits the floor and is dropped. Silence, not a softer claim.
    expect(struggleSignalsOf(result)).toEqual([]);
  });

  test("should take attempts as a per-session maximum, never a sum across sessions", () => {
    const rules = ruleSetV1();
    const perSessionVisits = rules.struggleRepeatedAttemptMin - 1;

    const corpus = struggleFixture([
      { count: STRUGGLE_SHALLOW_MANY, visits: perSessionVisits, detour: STRUGGLE_DETOUR },
    ]);

    // Eight sessions visiting the origin twice each. A summing implementation sees 16
    // and fires; ruling 31 says the greatest single session's count is 2, which is
    // below the minimum, so nothing fires. Eight people each glancing at a page twice
    // is not one person stuck on it.
    expect(STRUGGLE_SHALLOW_MANY * perSessionVisits).toBeGreaterThanOrEqual(
      rules.struggleRepeatedAttemptMin,
    );
    expect(perSessionVisits).toBeLessThan(rules.struggleRepeatedAttemptMin);

    const result = detectFunnelDropoff(corpus, rules);

    // Non-vacuity again: the candidate exists; only the struggle is absent.
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
      // The maximum. Not the sum across sessions, and not the
      // mean: two people came back four times each, and four is the number that
      // reaches a founder.
      expect(struggle.attempts).toBe(deepestVisits);
      expect(struggle.attempts).not.toBe(
        shallowCount * shallowVisits + deepestCount * deepestVisits,
      );
    }
  });

  test("should never emit a backtrack struggle signal — it has no producer this sprint", () => {
    const rules = ruleSetV1();

    // A genuine back-navigation corpus: eight sessions walk origin -> destination ->
    // origin -> destination -> origin. If a single back-navigation were admitted as
    // `confusing` proof, this is where it would fire, and it would fire on a superset
    // of its target, because users navigate back constantly. That is the conflation
    // this sprint exists to prevent, and the deliberate decision here is not to admit it.
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

    // Fixture self-check: the drop-off gate clears, so the corpus does produce a
    // candidate and the subkind assertions below are about what it emitted.
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

    // Non-vacuity before checking for offenders: an empty list proves nothing.
    expect(struggles.length).toBeGreaterThan(0);
    expect(struggles.map((struggle) => struggle.subkind)).not.toContain("backtrack");
    for (const struggle of struggles) {
      expect(struggle.subkind).toBe("repeated_attempt");
    }

    // Non-vacuity of the assertion above. `backtrack` is still a member of the union
    // and still parses, so the loop is green because nothing produces one, not because
    // the subkind was quietly deleted (it stays, typed and tested against constructed
    // inputs, with no producer).
    expect(
      evidenceSignalSchema.parse({
        kind: "struggle",
        subkind: "backtrack",
        surface: STRUGGLE_ORIGIN,
        attempts: rules.struggleRepeatedAttemptMin,
        // Required since strugglingSessions landed: the schema rejects a bare number
        // here ("a count must be built by measuredCount, with its denominator"), which
        // is the denominator rule enforced at runtime. Constructed, not produced, that
        // is the point of this assertion.
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

// /, two structural properties of the emission loop, pinned rather than left as prose.
//
// They rest on different mechanisms, and this block does not conflate them:
// The disjointness is a property of first-visit semantics combined with
//  `D` being built from the corpus's own walks;
// The unreachability is a property of `pathWalk`'s consecutive-repeat
//  Collapse alone, and holds under `indexOf` and `lastIndexOf` alike.
//
// These follow the precedent set for `funnelMinDropoffSessions`: a property that is
// structurally true of the implementation, rather than a magnitude somebody tuned,
// still earns a named test. Otherwise the only record of it is a comment, and a comment
// cannot fail.
//
// Lane: every id and path below is `t1d2b`-prefixed and collides with nothing above.
// Fixture time still descends from `FIRST_SESSION_STARTED_AT` via `cohortStart`; no
// `Date.now` is introduced.

const D2B_ORIGIN = "/t1d2b/pricing";
const D2B_DESTINATION = "/t1d2b/checkout";
const D2B_DETOUR = "/t1d2b/help";

/** 4 + 8 + 8 = 20 at the origin (exactly `funnelMinSessionsAtOrigin`) and 8 of 20 is
 * exactly the 40% rate gate, so the candidate fires and neither assertion below is
 * vacuous. */
const D2B_CONVERTED = 4;
const D2B_REVISITING = 8;
const D2B_DROPPED = 8;

/**
 * The same twenty sessions twice over: once with consecutive repeats of the origin in
 * the raw event stream, once already collapsed by hand. `pathWalk`
 * (`funnel-dropoff.ts:44-56`) collapses the first into the second, which is the whole
 * of the unreachability.
 */
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

    // A known, deliberate property of the first-visit semantics. Recorded here the way
    // recorded `funnelMinDropoffSessions` being structurally unreachable, rather than
    // left as prose nobody can fail.
    //
    // `D` is built by `transitionsOf` from the corpus's own walks, so the surface
    // immediately following the first visit to `O` in any walk is by construction a
    // member of `D`. `dropped` therefore reduces to "the walk ends at the
    // session's first visit to `O`", so every dropped session visited `O` exactly once,
    // and a session that revisited (and can therefore reach
    // `struggleRepeatedAttemptMin`) is never dropped.
    //
    // The product consequence, stated so a renderer author cannot miss it: a "people
    // kept coming back here" clause and a "people left here" clause are about different
    // people. They may be composed about the same surface; they may never be composed
    // about the same cohort.
    //
    // The fixture makes the disjointness observable rather than merely plausible: Every
    // continuing session revisits at the minimum, so the dropped cohort and the
    // struggling cohort together partition `atOrigin`. If a single dropped session were
    // also counted as struggling, the struggling count would exceed the continuing
    // cohort's size and the exact equality below would fail.
    const corpus = struggleFixture([
      {
        count: STRUGGLE_ALL_REVISITING,
        visits: rules.struggleRepeatedAttemptMin,
        detour: STRUGGLE_DETOUR,
      },
    ]);

    expect(corpus.basis.kept).toBe(STRUGGLE_AT_ORIGIN);

    const result = detectFunnelDropoff(corpus, rules);

    // Non-vacuity: one candidate, carrying a struggle signal. Both cohorts are live in
    // this one corpus, which is the only way disjointness is testable.
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    const struggles = struggleSignalsOf(result);
    expect(struggles).toHaveLength(1);

    const atOrigin = candidate.counts[0].numerator;
    const dropped = candidate.counts[1].numerator;
    const struggling = struggles[0].strugglingSessions.numerator;

    expect(atOrigin).toBe(STRUGGLE_AT_ORIGIN);
    expect(dropped).toBe(STRUGGLE_DROPPED);
    // Every session that did not drop revisited at the minimum, and the count says so
    // exactly. No dropped session leaked into it.
    expect(struggling).toBe(STRUGGLE_ALL_REVISITING);
    // The disjointness, asserted: the two cohorts partition the origin cohort. Any
    // overlap would make this sum exceed `atOrigin`.
    expect(dropped + struggling).toBe(atOrigin);
  });

  test("the self-transition filter is unreachable while pathWalk collapses consecutive repeats", () => {
    const rules = ruleSetV1();

    // What makes the filter inert, and what does not.
    //
    // The emission loop removes the origin from its own raw destination set. That
    // filter can never change an outcome, and the reason is `pathWalk` alone: it pushes
    // a path only when `path !== previous`, so no walk carries two adjacent equal
    // entries, and `transitionsOf` pairs only adjacent entries, so an origin is never
    // its own immediate successor and never enters its own raw destination set.
    //
    // This has nothing to do with. `dropped`'s measurement point sits downstream of the
    // destination set and cannot make a self-successor appear; the filter is equally
    // inert under `indexOf` and `lastIndexOf`. The name says "while" deliberately:
    // relax the collapse and `origin -> origin` becomes expressible, at which point
    // this filter stops being inert and starts being load-bearing. That is what this
    // test guards. A change to the collapse fails here rather than silently promoting a
    // dead filter into a live one.
    //
    // The fixture deliberately carries both shapes that could produce a
    // self-transition: a `origin -> detour -> origin` return, and a consecutive run of
    // three raw events on the origin.
    const withRepeats = detectFunnelDropoff(selfTransitionCorpus(false), rules);
    const preCollapsed = detectFunnelDropoff(selfTransitionCorpus(true), rules);

    // Non-vacuity: the repeat-laden corpus really does produce transitions and fire, so
    // the assertions below compare candidates and not empty lists.
    expect(withRepeats.candidates).toHaveLength(1);
    expect(withRepeats.candidates[0].surface).toBe(D2B_ORIGIN);
    expect(withRepeats.candidates[0].counts[0].numerator).toBe(
      D2B_CONVERTED + D2B_REVISITING + D2B_DROPPED,
    );
    expect(withRepeats.candidates[0].counts[1].numerator).toBe(D2B_DROPPED);

    //  the collapse, observed directly. The dropped cohort emits three consecutive
    // raw events on the origin, and the revisiting cohort emits two more consecutive
    // runs. A `pathWalk` without the collapse would read those as separate visits,
    // reach `struggleRepeatedAttemptMin`, and emit a struggle signal. Silence here IS
    // the collapse, and a walk with no adjacent duplicates cannot put the origin in its
    // own destination set.
    expect(struggleSignalsOf(withRepeats)).toEqual([]);

    //  indistinguishable from the hand-collapsed corpus, field for field. The two
    // corpora differ only in consecutive repeats, so nothing the raw repeats could have
    // contributed (a self-transition above all) survived into `transitionsOf`. The
    // filter has nothing to remove: unreachable, not merely unexercised by this
    // fixture.
    expect(withRepeats).toEqual(preCollapsed);
  });
});

// /, `funnelMinDropoffSessions`, the one threshold in this file whose fail direction no
// test name stated (Wave 7).
//
// Why this test hands the detector a rule set that is not v1, and why the next person
// must not "simplify" it back to v1.
//
// At v1 magnitudes this floor is structurally unreachable. It can never be the gate
// that decided. The floor only ever blocks a drop-off of `funnelMinDropoffSessions - 1`
// or fewer. But a transition is only considered at all once its origin holds
// `funnelMinSessionsAtOrigin` sessions, and it must then clear
// `funnelDropoffRateThresholdPercent` of that cohort before it may
// fire. Every drop-off small enough for the floor to block is therefore already blocked
// by the rate gate. At every permitted denominator, because the rate bar only rises as
// the denominator grows. The assertion below states exactly this, in exact integer
// arithmetic, rather than leaving it as prose.
//
// That v1 redundancy is a real finding, not a fixture inconvenience: at v1 the floor is
// dead weight, and it earns its place only as a guard on future rule sets whose rate
// threshold or origin floor moves. A v1-only fixture here could not assert that. It
// could only re-assert a verdict the rate gate had already reached. Passing identically
// against a detector from which the floor had been deleted, which is precisely the
// regression exists to make impossible.
//
// The rule-set parameter design is what makes handing over a different rule set the natural move rather
// than a workaround: the rule set is a parameter, never read internally, and
// `predicates.test.ts` already does the equivalent (a constructed v2 carrying a
// different proof-signal list) to prove a predicate reads its parameter. Exactly one
// member is varied below (the floor itself) so the corpus, the origin gate and the rate
// gate are all held fixed and the only thing that can move the verdict is the floor.
//
// Lane: every id and path below is `t1flr`-prefixed and collides with nothing above.
// Fixture time still descends from `FIRST_SESSION_STARTED_AT` via `cohortStart`; no
// `Date.now` is introduced.

const FLOOR_ORIGIN = "/t1flr/pricing";
const FLOOR_DESTINATION = "/t1flr/checkout";

/** 10 converters + 10 droppers = 20 sessions at the origin (exactly
 * `funnelMinSessionsAtOrigin`) and 10 of 20 is 50%, comfortably over the 40% rate gate.
 * Both of the other two gates are satisfied by construction, so the floor is the only
 * gate left that can speak. */
const FLOOR_AT_ORIGIN = 20;
const FLOOR_DROPPED = 10;

/**
 * A version number no shipped rule set can ever carry, and that is the whole
 * requirement it has to meet.
 *
 * Registered versions are positive and assigned in increasing order
 * (`THRESHOLD_RULE_SETS` holds 1 and 2 today), so a negative version collides with none
 * of them, not with `RULE_SET_V2`, and not with the v3 somebody ships next. It also
 * reads, at a glance, as what it is: a test-local variant, never a decision this
 * product made. `-1` is the sentinel; the assertion in the test below pins that
 * `THRESHOLD_RULE_SETS` does not resolve it.
 *
 * Why not `version: 2`, which this said before. That was written when no v2 existed and
 * "honestly not v1" was the entire point. Shipped v2 (`funnelMinDropoffSessions: 5`,
 * registered at `THRESHOLD_RULE_SETS.get`), and this helper is called twice with
 * different floors, so stamping `2` made three distinct rule sets all claim to be
 * version 2. The moment anything persists a `thresholdRuleSetVersion`, a replay through
 * `THRESHOLD_RULE_SETS.get` reproduces a decision these numbers never made: the
 * identity fork the v2 bump was made to prevent, reintroduced by a fixture. No
 * persistence path exists today, which is exactly why it is cheap to fix now.
 */
const SYNTHETIC_RULE_SET_VERSION = -1;

/** Varies exactly one member, and stamps a version that is deliberately not a
 * registered rule set (above). v1 and v2 are shipped, immutable decisions and nothing
 * here edits either of them. */
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

    // The sentinel is unregistered, asserted rather than assumed. The two variants
    // below are test-local and must never be mistakable for a shipped decision: if a
    // rule set ever ships under this version, a replay by version would reproduce these
    // fixture magnitudes instead of the real ones. Registering it is what this line
    // makes impossible to do quietly.
    expect(THRESHOLD_RULE_SETS.has(SYNTHETIC_RULE_SET_VERSION)).toBe(false);
    expect(THRESHOLD_RULE_SETS.get(SYNTHETIC_RULE_SET_VERSION)).toBeUndefined();
    // Non-vacuity: the map really does resolve the versions that DO exist, so the
    // `false` above is this sentinel's absence and not an empty registry.
    expect(THRESHOLD_RULE_SETS.has(v1.version)).toBe(true);

    // The v1 redundancy, asserted rather than claimed. The largest drop-off the floor
    // can block is `funnelMinDropoffSessions - 1`; the thinnest origin cohort v1
    // permits is `funnelMinSessionsAtOrigin`. Even paired, that drop-off fails the rate
    // gate on its own, and a larger origin cohort only raises the bar. So no v1 fixture
    // exists in which this floor is the binding gate, which is why the rule set below
    // is varied. Exact integer arithmetic: no float division anywhere in this
    // comparison.
    expect((v1.funnelMinDropoffSessions - 1) * 100).toBeLessThan(
      v1.funnelDropoffRateThresholdPercent * v1.funnelMinSessionsAtOrigin,
    );

    const corpus = floorCorpus();

    // Fixture self-check. The other two gates are satisfied, so whatever this test
    // observes can only be the floor.
    expect(corpus.basis.kept).toBe(FLOOR_AT_ORIGIN);
    expect(FLOOR_AT_ORIGIN).toBeGreaterThanOrEqual(v1.funnelMinSessionsAtOrigin);
    expect(FLOOR_DROPPED * 100).toBeGreaterThanOrEqual(
      v1.funnelDropoffRateThresholdPercent * FLOOR_AT_ORIGIN,
    );

    // Non-vacuity, and the inclusive half of the boundary. The same corpus, under a
    // rule set whose floor sits exactly AT the drop-off, does fire. So the silence
    // below is this one magnitude holding, never a fixture that produces nothing, and
    // never some other gate.
    const atFloor = detectFunnelDropoff(corpus, withMinDropoffSessions(v1, FLOOR_DROPPED));
    expect(atFloor.candidates).toHaveLength(1);
    expect(
      atFloor.candidates[0].counts.some(
        (count) => count.numerator === FLOOR_DROPPED && count.denominator === FLOOR_AT_ORIGIN,
      ),
    ).toBe(true);

    // One session below the floor, everything else identical.
    const belowFloor = detectFunnelDropoff(corpus, withMinDropoffSessions(v1, FLOOR_DROPPED + 1));

    // Fail direction: Under-detect. An absolute floor beneath the rate, so a 100% drop
    // of a handful of sessions never fires however extreme the ratio looks. A missed
    // finding is recoverable; a false claim burns the credibility the MVP exists to
    // test.
    expect(belowFloor.candidates).toEqual([]);
  });
});

// `surfaceNormalisationVersion` is unanimous-or-`null`
//
// Why this block exists. `surfaceNormalisationVersion` is a direct input to
// `evidence_shape`, which is a direct input to the signature hash. It is the one input
// this sprint added, and until now only its unanimous case was asserted (the
// collapsed-path test). Every fixture in this file stamps a single uniform version, so
// the disagreement and pre-versioned branches of `surfaceVersionOf` were reachable by
// no test at all.
//
// Fail direction: toward `null`. `null` means "redaction status unknown" and
// is the class a later remediation migration must be able to select. Reporting one
// version when two produced the string would assert a redaction guarantee the run
// cannot make; coercing to `0` would assert a version nobody ever wrote.

/** The firing corpus, but the kept cohorts carry the versions given. Set-aside sessions
 * keep the default, so a detector that forgot ruling 24 and read the version over all
 * sessions rather than kept ones would report differently. */
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
  // Non-vacuity: every assertion below is about the version ON a candidate, so an empty
  // result would pass by asserting nothing.
  expect(result.candidates).toHaveLength(1);
  return result.candidates[0].surfaceNormalisationVersion;
}

describe("detectFunnelDropoff — surfaceNormalisationVersion (PL ruling 28)", () => {
  test("should carry the version when every kept session on the surface agrees", () => {
    // The baseline the other cases are measured against: unanimity IS reported, so a
    // `null` below can only mean disagreement and not a broken fixture.
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
    // The realistic churn event: a window straddling a normaliser bump, so the same
    // surface string was produced by two different rule sets. One of them may still
    // carry a live token; the run cannot say which, so it says so.
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
    // A pre-migration row contaminates the whole surface: unknown is not
    // averaged away by the rows that DO know.
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

    // , stated as the two separate facts it is. `0` is a version somebody could
    // have written; `null` is "we do not know". A remediation query selecting `IS NULL`
    // must not miss these rows, and must not match rows that genuinely recorded version
    // 0.
    expect(version).toBeNull();
    expect(version).not.toBe(0);
  });

  test("should ignore set-aside sessions when deciding unanimity (ruling 24)", () => {
    // The kept sessions all agree; only a set-aside session disagrees. Coverage and
    // identity both describe what was analysed, and a set-aside session is never
    // analysed, so it cannot fork the surface's identity either.
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

// Resolved, one origin, many destinations: One candidate, one identity
//
// Why this block exists, and what it now pins. The emission model had never been
// asserted: every `toHaveLength` elsewhere in this file is `1` because every other
// fixture has a single destination, so nothing pinned what happens when one origin
// leaks to several destinations. That invisibility was, and it had two halves:
//
// Rate inflation, "did not reach this destination" was emitted once per
//  destination and would read to a founder as "dropped here", which it is
//  not. A healthy hub that splits traffic three ways produced three
//  candidates, each claiming "20 of 30 dropped".
// Identity collision, those candidates were distinct claims carrying
//  byte-identical `evidence_shape`s, because the destination was computed
//  and then discarded. the signature ledger hashes `evidence_shape`;
//  one surface minting three colliding identities voids every guarantee it
//  offers.
//
// Takes fix: the detector emits at most one candidate per ORIGIN, aggregating
// across destinations, and `counts[1]` now means "left the origin without going
// anywhere it could have gone". Both halves close at once.
//
// This block now pins the resolution, not the defect. It is deliberately still named
// for, because the regression it guards against is the emission model silently
// reverting to per-destination under and. A green suite here means resolved.
//
// Four fixtures, because fix has four separable claims:
// The firing hub, one qualifying origin emits exactly one candidate;
// The healthy hub. A hub nobody is stuck on emits zero;
// The terminal surface— an origin with an empty `D` emits nothing;
// And over the firing hub, exactly one `evidence_shape`.

// Lane: every id and path in this block is `esc9f`-prefixed, matching its two siblings
// (`esc9h`, `esc9t`) and colliding with nothing above. The predecessor used the file's
// top-level `/pricing` and `/checkout` values. No functional collision, since each test
// builds its own corpus, but it defeated the grep-by-lane discipline every other
// fixture block here follows.
const FORK_ORIGIN = "/esc9f/pricing";
const FORK_DESTINATIONS = ["/esc9f/checkout", "/esc9f/help", "/esc9f/faq"] as const;
/** 4 + 6 + 8 reach a destination; the remaining 12 leave the origin outright. 12 of 30
 * is exactly the 40% rate gate, so the one aggregated candidate fires at the boundary
 * rather than comfortably over it. */
const FORK_AT_ORIGIN = 30;
const FORK_DROPPED = 12;

/** 30 kept sessions all reach `/esc9f/pricing`; each destination is reached by a
 * different small slice, so every transition clears both the absolute floor and the 40%
 * rate gate. */
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

  // A different slice reaches each destination.
  //
  // Before fix, this exact fixture produced three candidates, at 26 / 24 / 22 of
  // 30, one per (origin, destination) pair, each counting "did not reach this
  // destination" and each rendering to a founder as "dropped at /esc9f/pricing". Three
  // near-identical claims about one page, three different numbers, one shared
  // `evidence_shape`. Recorded here so the regression stays legible to a reader who
  // never saw the old loop.
  //
  // After fix it produces one candidate whose `dropped` is 12: the sessions that
  // left `/esc9f/pricing` without reaching any of the three.
  const REACHED = [4, 6, 8] as const;
  FORK_DESTINATIONS.forEach((destination, slot) => {
    push([FORK_ORIGIN, destination], REACHED[slot]);
  });
  // The remainder leave from the origin outright, taking the corpus to 30.
  push([FORK_ORIGIN], FORK_AT_ORIGIN - REACHED.reduce((sum, n) => sum + n, 0));

  return corpusOf({ sessions, connectionState: CONNECTED_RECEIVING, truncated: false });
}

// -- -healthy: the hub nobody is stuck on

const HEALTHY_HUB_ORIGIN = "/esc9h/pricing";
const HEALTHY_HUB_DESTINATIONS = ["/esc9h/checkout", "/esc9h/help", "/esc9h/faq"] as const;
/** 3 x 10 = 30 sessions at the origin, splitting evenly. Comfortably above
 * `funnelMinSessionsAtOrigin`, so a zero here is never a thin denominator. */
const HEALTHY_HUB_PER_DESTINATION = 10;
const HEALTHY_HUB_AT_ORIGIN = HEALTHY_HUB_PER_DESTINATION * HEALTHY_HUB_DESTINATIONS.length;
/** The witness cohort (see `healthyHubWithDroppersCorpus`). 20 of 50 is exactly the 40%
 * rate gate, so the witness fires. */
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

/** Thirty sessions reach `/esc9h/pricing` and every one of them goes somewhere it could
 * have gone. Nobody is stuck. */
function healthyHubCorpus(): DetectorCorpus {
  return corpusOf({
    sessions: healthyHubSessions(),
    connectionState: CONNECTED_RECEIVING,
    truncated: false,
  });
}

/**
 * The non-vacuity witness for the healthy hub: the same thirty sessions, with a cohort
 * whose walks end at the origin bolted on and nothing else changed. A candidate here
 * proves the origin is a live origin in the transition map with a non-empty `D`, so
 * the healthy hub's zero is the drop-off gates speaking, not an inert fixture the
 * detector never looked at.
 */
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

// --: an origin with nowhere to go

const TERMINAL_LANDING = "/esc9t/landing";
/** Reached by more than `funnelMinSessionsAtOrigin` sessions and followed by nothing.
 * The last page of every walk that gets there. `D(exit)` is empty. */
const TERMINAL_EXIT = "/esc9t/exit";
const TERMINAL_REACHED_EXIT = 25;
/** 17 of 42 is 40.4%. Over the rate gate, so the landing fires and the exit's silence
 * is demonstrably the rule rather than an inert corpus. */
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

    // Non-vacuity first. The fixture must be shown to clear every gate, or a count of 1
    // could be produced by a fixture that barely fires at all.
    expect(corpus.basis.kept).toBe(FORK_AT_ORIGIN);
    expect(FORK_AT_ORIGIN).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);
    expect(FORK_DROPPED).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);
    // Exact integer arithmetic: 12 * 100 === 40 * 30, the inclusive boundary with no
    // rounding on either side.
    expect(FORK_DROPPED * 100).toBe(rules.funnelDropoffRateThresholdPercent * FORK_AT_ORIGIN);

    const result = detectFunnelDropoff(corpus, rules);

    // A literal one, asserted, never `FORK_DESTINATIONS.length`, never
    // `toBeGreaterThan`, and never merely iterated over. Three destinations, one stuck
    // surface, one problem, one candidate (fix).
    expect(result.candidates).toHaveLength(1);

    const candidate = result.candidates[0];
    // The surface is the ORIGIN. Where the user got stuck.
    expect(candidate.surface).toBe(FORK_ORIGIN);
    expect(candidate.claimedClass).toBe("confusing");

    // the declared order, with `counts[1]`'s post-fix meaning: the sessions that left
    // the origin without reaching any member of `D`.
    expect(candidate.counts[0].numerator).toBe(FORK_AT_ORIGIN);
    expect(candidate.counts[1].numerator).toBe(FORK_DROPPED);
    expect(candidate.counts[1].denominator).toBe(corpus.basis.kept);
  });

  test("every funnel candidate names its origin as the surface, with claimSubject surface", () => {
    const result = detectFunnelDropoff(multiDestinationCorpus(), ruleSetV1());

    // Non-vacuity: an empty candidate list would satisfy the loop below by asserting
    // nothing at all.
    expect(result.candidates.length).toBeGreaterThan(0);

    // Over every candidate, not the first. /: `claimSubject` states in the type what
    // `surface` is a claim about, rather than leaving it implied by the field being
    // non-optional.
    for (const candidate of result.candidates) {
      expect(candidate.surface).toBe(FORK_ORIGIN);
      expect(candidate.surface.length).toBeGreaterThan(0);
      expect(candidate.claimSubject).toBe("surface");
    }
  });

  test("fix (b) — a healthy hub that splits traffic three ways emits no candidate", () => {
    const rules = ruleSetV1();
    const corpus = healthyHubCorpus();

    // Before fix this fixture produced three candidates, each claiming "20 of 30
    // dropped", because "did not reach this destination" was emitted once per
    // destination, and 20 of the 30 never claimed any given one of the three. That is
    // the rate-inflation half, and it is what this test regression-guards.
    //
    // Silence is the correct output. A pricing page that splits traffic three ways is
    // doing its job; nobody is stuck on it, so there is nothing to tell a founder. Note
    // that the "one candidate with `dropped = 0 of 30`" is unachievable and has been
    // overruled: a `dropped = 0` origin is filtered twice over, by the absolute floor
    // and then by the rate gate. Zero, not one, and zero is right.
    expect(corpus.basis.kept).toBe(HEALTHY_HUB_AT_ORIGIN);
    expect(HEALTHY_HUB_AT_ORIGIN).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates).toHaveLength(0);

    // Non-vacuity, and the whole point: the origin IS a live origin with a non-empty
    // `D`. The same thirty sessions, plus a cohort whose walks end at the origin and
    // nothing else changed, DO produce a candidate for it. So the zero above is the
    // drop-off gates speaking about a surface the detector genuinely examined, never a
    // thin denominator, and never an origin the transition map never held.
    const witness = detectFunnelDropoff(healthyHubWithDroppersCorpus(), rules);
    expect(witness.candidates).toHaveLength(1);
    expect(witness.candidates[0].surface).toBe(HEALTHY_HUB_ORIGIN);
    expect(witness.candidates[0].counts[1].numerator).toBe(HEALTHY_HUB_WITNESS_DROPPED);
  });

  test("an origin whose destination set is empty emits no candidate", () => {
    const rules = ruleSetV1();
    const corpus = terminalSurfaceCorpus();

    // `/esc9t/exit` is reached by more sessions than `funnelMinSessionsAtOrigin` and is
    // followed by nothing. With nowhere reachable, "did not go anywhere it could have
    // gone" is vacuous. Asserting it would claim a 100% drop-off on every exit page in
    // the product.
    expect(TERMINAL_REACHED_EXIT).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates.map((candidate) => candidate.surface)).not.toContain(TERMINAL_EXIT);

    // Non-vacuity: the same corpus fires for a different origin, so the exit's silence
    // is the rule and not an inert fixture the detector skipped for some unrelated
    // reason.
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
          // The gate's final class; `confusing` is what this detector proposes and what
          // a passing claim keeps.
          symptomClass: "confusing",
        },
        EVIDENCE_SHAPE_VERSION,
      ),
    );

    // Both assertions, and the pairing is the point. `size === 1` alone passes
    // vacuously on a one-element array, which is exactly what made the predecessor
    // assertion misleading: it read as "three claims collapsed to one identity" while
    // being satisfiable by "there is one claim". Pinning the length as well is what
    // makes this a statement about the emission model rather than about set arithmetic.
    expect(shapes).toHaveLength(1);
    expect(new Set(shapes).size).toBe(1);

    // A green result here means resolved. the identity half is closed by fix: one
    // origin, one candidate, one `evidence_shape`, so the signature ledger can hash
    // this without a surface minting three colliding identities on arrival.
  });
});
