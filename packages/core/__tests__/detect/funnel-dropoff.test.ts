// ADD §7 "Unit — funnel_dropoff" — the fourteen named tests for the T1
// path-transition detector (FR-1, FR-7, FR-9, D-3, D-6, D-7, D-9, D-18).
//
// What this file is for, in one sentence: `funnel_dropoff` is one of only two
// detectors this sprint ships, and every claim it makes reaches a founder as a
// sentence with a denominator in it — so the count, the denominator, and the
// boundary that decided to speak at all are the contract, not the internals.
//
// THE LOAD-BEARING PAIR IS TESTS 9 AND 10. Their fixtures differ by exactly
// ONE session, and `40%` is an INTEGER PERCENT compared with exact integer
// arithmetic (`numerator * 100 >= 40 * denominator`, PL ruling 1). That is
// precisely why the rule-set member is named `funnelDropoffRateThresholdPercent`
// rather than holding `0.4`: float division can land one ulp low and silently
// turn D-6's inclusive "fires at exactly the threshold" into "fires just above
// it", which no test written in floats can see.
//
// House rules honoured here (STATE.md standing constraints):
//   - FIXTURE TIME IS A REQUIRED PARAMETER. There is no `Date.now()` in this
//     file; every instant descends from the frozen constants below. The whole
//     suite is time-of-day invariant by construction.
//   - PL ruling 7: the corpus carries EVERY selected session with its own
//     `exclusionReason`, and the DETECTOR applies FR-7. So the fixtures below
//     put set-aside sessions IN the corpus and assert they reach neither a
//     numerator nor a denominator. Both boundary fixtures are deliberately
//     built so that a leak flips the verdict — a silent FR-7 regression cannot
//     pass tests 9 and 10.
//   - PL ruling 3: there is no `now`/clock parameter. Window instants arrive
//     as `corpus.window`.
//   - D-14: the rule set is handed in as a PARAMETER, fetched BY VERSION
//     (`THRESHOLD_RULE_SETS.get(1)`), never as "whatever is current".
//   - No node builtin. The one test that reads source text uses `Bun.file` and
//     `import.meta.dir`, not `node:fs`.
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

// ---------------------------------------------------------------------------
// Frozen fixture time (ADD §6.5: no `Date.now()` anywhere in `__tests__`)
// ---------------------------------------------------------------------------

const WINDOW_START = new Date("2026-07-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-08T00:00:00.000Z");
const CONNECTED_AT = new Date("2026-06-01T00:00:00.000Z");
const LAST_POLLED_AT = new Date("2026-07-07T23:00:00.000Z");
/** Every session's `startedAt` descends from this instant plus an offset. */
const FIRST_SESSION_STARTED_AT = new Date("2026-07-03T09:00:00.000Z");

const EVENT_STRIDE_MS = 1_000;
const SESSION_STRIDE_MS = 60_000;
const COHORT_STRIDE_MS = 60 * 60 * 1_000;

/** Cohort n starts an hour after cohort n-1, so no two fixture sessions share
 * a `startedAt` and no id collides. */
function cohortStart(index: number): Date {
  return new Date(FIRST_SESSION_STARTED_AT.getTime() + index * COHORT_STRIDE_MS);
}

// ---------------------------------------------------------------------------
// Surfaces and magnitudes
// ---------------------------------------------------------------------------

const PROJECT_ID = "prj-t1-funnel-dropoff";
const ORIGIN = "/pricing";
const DESTINATION = "/checkout";
/** ES-11. `normaliseUrlPath` already collapsed `/orders/1` and `/orders/2` to
 * this ONE surface upstream. What the detector sees is a single path, and the
 * assertion is that it counts it as one thing rather than as an anomaly. */
const COLLAPSED_ORDER_PATH = "/orders/:id";
/** ES-14 adjacency: a real version, never `null` and never coerced to `0`. */
const NORMALISATION_VERSION = 1;

/** D-18. The detector must not care what an event is CALLED. These names are
 * deliberately unlike any vendor reserved literal, and test 13 additionally
 * renames every one of them and asserts the output does not move. */
const EVENT_NAMES: readonly string[] = ["step_a", "step_b", "step_c"];

/** Test 1's cohort sizes. 18 of 30 is 60% — comfortably over the 40% gate, so
 * test 1 is about the SHAPE of the count, not about the boundary. */
const KEPT_AT_ORIGIN = 30;
const KEPT_DROPPED = 18;
const KEPT_CONVERTED = KEPT_AT_ORIGIN - KEPT_DROPPED;
const SET_ASIDE_HEADLESS = 6;
const SET_ASIDE_INTERNAL = 4;

/** Tests 9 and 10. 40% of 25 is exactly 10, with no remainder — which is what
 * lets "one below" and "exactly at" differ by a single session. */
const BOUNDARY_AT_ORIGIN = 25;
const BOUNDARY_DROPPED_ONE_BELOW = 9;
const BOUNDARY_DROPPED_AT_THRESHOLD = 10;
const BOUNDARY_SET_ASIDE = 5;

/** Test 11. One below `funnelMinSessionsAtOrigin`, at a rate that would
 * otherwise fire easily. */
const BELOW_FLOOR_AT_ORIGIN = 19;
const BELOW_FLOOR_DROPPED = 18;

// ---------------------------------------------------------------------------
// Rule set, fetched by version, never "current" (D-14)
// ---------------------------------------------------------------------------

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

// ---------------------------------------------------------------------------
// Connection states — ES-1 vs ES-8 are DIFFERENT ANSWERS to the customer
// ---------------------------------------------------------------------------

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
    // `null` means NEVER POLLED — the whole of ES-8's distinguishability.
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

/** ES-1: we looked, and there is genuinely nothing. */
const CONNECTED_NO_EVENTS_YET: ConnectionState = {
  status: "connected_no_events_yet",
  connection: connectionSummary(LAST_POLLED_AT),
};

/** ES-8: we have never looked. */
const CONNECTED_NEVER_POLLED: ConnectionState = {
  status: "connected_never_polled",
  connection: connectionSummary(null),
};

// ---------------------------------------------------------------------------
// Corpus fixtures
// ---------------------------------------------------------------------------

type SessionSpec = {
  readonly sessionId: string;
  /** REQUIRED. No fixture may seed a time column from a clock (ADD §6.5). */
  readonly startedAt: Date;
  /** The `url_path` of each event, in order. `null` is a genuinely path-less
   * event (BS-4, ES-4), not a fixture defect. */
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
    // ES-14: a path-less event has no normalisation to record, and `null` is
    // never coerced to `0`.
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
 * D-7 / FR-7. Derived from the sessions rather than hand-written, so the
 * identity `kept + Σ setAside.count === totalInWindow` — which `measuredCount`
 * asserts — can never be satisfied by a fixture that lies about its own
 * contents.
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

/** Also derived, so `eventsWithoutUrlPath` is always the TRUE number of
 * path-less events in the fixture (ES-4, BS-4). */
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
 * The workhorse fixture: 30 kept sessions reach `/pricing`, 18 of them never
 * reach `/checkout`, and TEN SET-ASIDE SESSIONS sit in the corpus alongside
 * them (PL ruling 7). Every set-aside session drops, so a detector that
 * forgot FR-7 would report 28 of 40 rather than 18 of 30 — the assertion in
 * test 1 names both numbers.
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
 * Tests 9 and 10. `dropped` is the ONLY thing that changes between them, and
 * `setAsidePaths` decides which way an FR-7 leak would break the verdict:
 *   - test 9 (one below) seeds set-aside DROPPERS, so a leak would push the
 *     rate over the gate and produce a candidate where none is allowed;
 *   - test 10 (exactly at) seeds set-aside CONVERTERS, so a leak would dilute
 *     the rate under the gate and silence a candidate that must be produced.
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

/** ES-4 / BS-4. The same 30 kept sessions as `firingSessions`, with a
 * genuinely path-less event wedged into the middle of every one of them. */
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

/** ES-11. */
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

/** D-18's runtime half: the same corpus with every event RENAMED. */
function withEveryEventNamed(corpus: DetectorCorpus, name: string): DetectorCorpus {
  return {
    ...corpus,
    sessions: corpus.sessions.map((session) => ({
      ...session,
      events: session.events.map((event) => ({ ...event, name })),
    })),
  };
}

/** Removes block and line comments so the prose ABOVE the function — which
 * legitimately explains why `$pageview` is not used — cannot be mistaken for
 * an event-name literal in the code (the F-9 precedent). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

// ---------------------------------------------------------------------------

describe("detectFunnelDropoff", () => {
  test("should emit each transition's drop-off as a MeasuredCount over sessions", () => {
    const corpus = firingCorpus();

    // Fixture self-check: 40 sessions selected, 30 kept. If this drifts, every
    // number below stops meaning what its name says.
    expect(corpus.basis.totalInWindow).toBe(
      KEPT_AT_ORIGIN + SET_ASIDE_HEADLESS + SET_ASIDE_INTERNAL,
    );
    expect(corpus.basis.kept).toBe(KEPT_AT_ORIGIN);

    const result = detectFunnelDropoff(corpus, ruleSetV1());

    expect(result.detector).toBe("funnel_dropoff");
    // One observed transition (`/pricing` -> `/checkout`), one candidate.
    expect(result.candidates).toHaveLength(1);

    const candidate = result.candidates[0];
    expect(candidate.detector).toBe("funnel_dropoff");
    expect(candidate.timeframe).toEqual(corpus.window);
    expect(candidate.counts.length).toBeGreaterThan(0);

    for (const count of candidate.counts) {
      // FR-10 / D-8: built by the smart constructor, brand and all. A
      // structurally identical object literal is NOT a MeasuredCount.
      expect(isMeasuredCount(count)).toBe(true);
      // BS-3: sessions, never people. Identity stitching does not exist.
      expect(count.unit).toBe("sessions");
      // D-7 / FR-7: the denominator is KEPT sessions — the ten set-aside
      // sessions inflate nothing.
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

    // No division, no error, and an ANSWER rather than a silence: the empty
    // candidate list travels with a positive statement of what we know.
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

    // ...and the two are NOT the same answer to the customer. "We have never
    // looked" and "we looked and found nothing" must never render alike.
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
    // The floor is what must stop this, and it is a magnitude, not a
    // special case for "n === 1" (D-6: fail direction lives in the constant).
    expect(corpus.basis.kept).toBeLessThan(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    // The detector RUNS — it does not refuse, and it does not throw. It simply
    // has nothing worth telling a founder. Fail direction: under-detect.
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

    // Deliberately ABOVE the origin floor, so an empty result here can only
    // mean "there were no transitions", never "there were too few sessions".
    expect(corpus.basis.kept).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    expect(result.candidates).toEqual([]);
    expect(result.coverage.eventsWithoutUrlPath).toBe(0);
  });

  test("should return no transitions for a one-step funnel, not an error", () => {
    const rules = ruleSetV1();
    // Three events, all on the SAME path: no two CONSECUTIVE DISTINCT
    // `url_path` values, therefore no transition. Distinct from the
    // single-event case above, and equally not an error.
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

    // (a) EXCLUDED — the path-less event sits BETWEEN `/pricing` and
    // `/checkout` and must not fragment the transition into two, nor become a
    // surface of its own. One candidate, and the drop-off is unchanged at 18
    // of 30.
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect([ORIGIN, DESTINATION]).toContain(candidate.surface);
    expect(candidate.surface.length).toBeGreaterThan(0);
    expect(
      candidate.counts.some(
        (count) => count.numerator === KEPT_DROPPED && count.denominator === KEPT_AT_ORIGIN,
      ),
    ).toBe(true);

    // (b) AND RECORDED — never a silent drop. The number travels on the
    // result AND onto the candidate a founder actually reads.
    expect(result.coverage.eventsWithoutUrlPath).toBe(KEPT_AT_ORIGIN);
    expect(candidate.coverage.eventsWithoutUrlPath).toBe(KEPT_AT_ORIGIN);
  });

  test("should count a redaction-collapsed path (/orders/:id) as one surface, not an anomaly", () => {
    const result = detectFunnelDropoff(collapsedPathCorpus(), ruleSetV1());

    // Two source paths legitimately collapsed to one upstream. That is CORRECT
    // behaviour: one surface, one candidate — not one per redacted id, and not
    // a rejected row.
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];

    expect([COLLAPSED_ORDER_PATH, DESTINATION]).toContain(candidate.surface);
    // A raw identifier must never reach a surface (product-decisions §5).
    expect(candidate.surface).not.toMatch(/\/\d/);
    // ES-14: the version that produced the redaction travels with it, and is a
    // real number rather than `null` or a coerced `0`.
    expect(candidate.surfaceNormalisationVersion).toBe(NORMALISATION_VERSION);

    // The denominator counts the COLLAPSED surface, once per session.
    expect(
      candidate.counts.some(
        (count) => count.numerator === KEPT_DROPPED && count.denominator === KEPT_AT_ORIGIN,
      ),
    ).toBe(true);
  });

  test("should not fire at one below funnelDropoffRateThreshold", () => {
    const rules = ruleSetV1();
    // Set-aside DROPPERS: if FR-7 leaked, the rate would clear the gate and a
    // candidate would appear where none is allowed.
    const corpus = rateBoundaryCorpus({
      dropped: BOUNDARY_DROPPED_ONE_BELOW,
      setAsidePaths: [ORIGIN],
    });

    expect(corpus.basis.kept).toBe(BOUNDARY_AT_ORIGIN);

    // EXACT INTEGER ARITHMETIC (PL ruling 1). 9 * 100 = 900 < 40 * 25 = 1000.
    // No float division anywhere in this comparison, which is the whole reason
    // the rule-set member is an integer percent.
    expect(BOUNDARY_DROPPED_ONE_BELOW * 100).toBeLessThan(
      rules.funnelDropoffRateThresholdPercent * BOUNDARY_AT_ORIGIN,
    );
    // Nothing ELSE is blocking it — both other gates are satisfied, so an
    // empty result can only mean the rate gate held.
    expect(BOUNDARY_DROPPED_ONE_BELOW).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);
    expect(BOUNDARY_AT_ORIGIN).toBeGreaterThanOrEqual(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    // Fail direction: UNDER-DETECT. A missed finding is recoverable; a false
    // claim burns the credibility the MVP exists to test.
    expect(result.candidates).toEqual([]);
  });

  test("should fire at exactly funnelDropoffRateThreshold", () => {
    const rules = ruleSetV1();
    // ONE session more than the previous test drops. Set-aside CONVERTERS
    // this time: if FR-7 leaked, the rate would be diluted below the gate and
    // this candidate would vanish.
    const corpus = rateBoundaryCorpus({
      dropped: BOUNDARY_DROPPED_AT_THRESHOLD,
      setAsidePaths: [ORIGIN, DESTINATION],
    });

    expect(corpus.basis.kept).toBe(BOUNDARY_AT_ORIGIN);
    expect(BOUNDARY_DROPPED_AT_THRESHOLD).toBe(BOUNDARY_DROPPED_ONE_BELOW + 1);

    // D-6: the boundary is INCLUSIVE, and it is EXACT — 10 * 100 === 40 * 25,
    // with no rounding on either side. `10 / 25 >= 0.4` is the comparison this
    // test exists to keep out of the implementation.
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

    // "Regardless of rate": 18 of 19 is 94.7% — far over the rate gate — and
    // the absolute drop-off floor is cleared too. ONLY the origin floor is
    // holding, and it must hold on its own.
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

    // (a) THE TYPE-LEVEL GUARANTEE, ASSERTED AT RUNTIME. `changed_mind` is not
    // a member of `DetectorProposedClass`, so this cannot happen today — which
    // is exactly why it is asserted: a later widening of the union would
    // otherwise reopen the door silently.
    expect(detectorProposedClassSchema.options).not.toContain("changed_mind");

    // (b) OVER THE FIXTURE CORPUS. `changed_mind`'s proof is satisfied by the
    // ABSENCE of everything, so a deterministic detector proposing it for a
    // clean drop-off would tell a founder "this user changed their mind" when
    // the product broke under them (D-9, ESC-5).
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

    // (a) STATIC. A-5 came back FAILED-TO-PIN, so a detector keyed on a
    // page-view event name would be built on an unpinned assumption. No
    // vendor-reserved literal may survive outside the comments.
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

    // (b) RUNTIME. The static scan cannot see a name read from a variable, so
    // this is the half that actually holds: rename EVERY event in the corpus
    // and the output must not move by a single field.
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
      // O-003's CR-1 was a silent truncation that read as "no more events".
      // The limitation travels WITH the claim, not beside it in a log.
      expect(candidate.coverage.truncated).toBe(true);
      expect(candidate.coverage).toEqual(result.coverage);
    }
  });
});

// ===========================================================================
// PL RULING 31 — `struggle.attempts` (Wave 7, task 6.7)
//
// THE GAP THIS CLOSES. Not one fixture above visits an origin surface more than
// once, so the `struggle` / `repeated_attempt` producer was entirely unasserted
// — and it is the ONLY producer of `confusing` proof in the whole sprint.
// `funnel_dropoff` proposes `confusing` and nothing else (PL ruling 13), so
// this signal is the single path by which this product ever ships a PASSING
// finding. Left untested, a refactor could silence it while every suite stayed
// green and the product went permanently, invisibly quiet.
//
// WHAT RULING 31 SAYS, exactly: `attempts` is the GREATEST number of separate
// visits to the origin surface made by ANY ONE kept session that reached it —
// a per-session maximum, never a sum across sessions. The rule set's own
// comment ("two visits to a path is navigation; three is a pattern") is a
// statement about one person's session, not about a cohort.
//
// LANE: every id and path below is `t1str`-prefixed and collides with nothing
// above. Fixture time still descends from `FIRST_SESSION_STARTED_AT` via
// `cohortStart`; no `Date.now()` is introduced (ADD §6.5).
// ===========================================================================

const STRUGGLE_ORIGIN = "/t1str/pricing";
const STRUGGLE_DESTINATION = "/t1str/checkout";
/** A DIFFERENT path, needed only so that two visits ARE two visits: `pathWalk`
 * collapses consecutive repeats, so `[O, O]` is one visit and `[O, X, O]` is
 * two. This is what "separate visits" means. */
const STRUGGLE_DETOUR = "/t1str/help";

/** 12 converters + 8 droppers = 20 sessions at the origin — exactly
 * `funnelMinSessionsAtOrigin` — and 8 of 20 is exactly the 40% rate gate. Every
 * gate EXCEPT the struggle magnitude is therefore satisfied by construction, so
 * an absent struggle signal can only ever mean the struggle magnitude held. */
const STRUGGLE_CONVERTED = 12;
const STRUGGLE_DROPPED = 8;

/** The back-navigation fixture (ruling 18). 12 + 8 + 14 = 34 at the origin,
 * 14 of 34 is 41.2% — over the rate gate, so the candidate fires and the
 * subkind assertion is not vacuous. */
const BACKTRACK_CONVERTED = 12;
const BACKTRACK_RETURNERS = 8;
const BACKTRACK_DROPPED = 14;

type RevisitCohort = {
  readonly count: number;
  /** Separate visits to `STRUGGLE_ORIGIN` each session in this cohort makes. */
  readonly visits: number;
  /** The path walked BETWEEN two visits. `STRUGGLE_DETOUR` keeps the session a
   * dropper; `STRUGGLE_DESTINATION` makes it a genuine back-navigator. */
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

/** The exactly-at-the-boundary corpus, named because two tests need it. */
function struggleAtMinimumCorpus(rules: ThresholdRuleSet): DetectorCorpus {
  return struggleCorpus({
    converted: STRUGGLE_CONVERTED,
    revisits: [
      {
        count: STRUGGLE_DROPPED,
        visits: rules.struggleRepeatedAttemptMin,
        detour: STRUGGLE_DETOUR,
      },
    ],
  });
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

    // Fixture self-check. Every OTHER gate is satisfied EXACTLY, so what this
    // test observes can only be the struggle magnitude.
    expect(corpus.basis.kept).toBe(STRUGGLE_CONVERTED + STRUGGLE_DROPPED);
    expect(corpus.basis.kept).toBe(rules.funnelMinSessionsAtOrigin);
    expect(STRUGGLE_DROPPED).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);
    expect(STRUGGLE_DROPPED * 100).toBe(
      rules.funnelDropoffRateThresholdPercent * corpus.basis.kept,
    );

    const result = detectFunnelDropoff(corpus, rules);
    const struggles = struggleSignalsOf(result);

    // D-6: the boundary is INCLUSIVE. It fires AT the minimum, not one above
    // it — the fail direction is carried by the magnitude, never by `>` vs `>=`.
    expect(struggles.length).toBeGreaterThan(0);
    for (const struggle of struggles) {
      expect(struggle.subkind).toBe("repeated_attempt");
      // PL ruling 14: the ORIGIN — the surface the user kept coming back to,
      // and the surface a fix would target.
      expect(struggle.surface).toBe(STRUGGLE_ORIGIN);
      expect(struggle.attempts).toBe(rules.struggleRepeatedAttemptMin);
    }

    // And it travels ON the candidate a founder reads, exactly once — this is
    // the proof `confusing` needs to survive the gate (FR-12).
    for (const candidate of result.candidates) {
      expect(candidate.claimedClass).toBe("confusing");
      expect(candidate.signals.filter((signal) => signal.kind === "struggle")).toHaveLength(1);
    }
  });

  test("should not emit a struggle signal one below struggleRepeatedAttemptMin", () => {
    const rules = ruleSetV1();
    const nearMissVisits = rules.struggleRepeatedAttemptMin - 1;
    // A near miss must still be a genuine revisit, or this test degenerates
    // into the single-visit case that proves nothing.
    expect(nearMissVisits).toBeGreaterThanOrEqual(2);

    const corpus = struggleCorpus({
      converted: STRUGGLE_CONVERTED,
      revisits: [
        { count: STRUGGLE_DROPPED - 1, visits: 1, detour: STRUGGLE_DETOUR },
        { count: 1, visits: nearMissVisits, detour: STRUGGLE_DETOUR },
      ],
    });

    expect(corpus.basis.kept).toBe(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);

    // NON-VACUITY. The drop-off itself still fires, so an absent struggle is
    // the magnitude holding — never "the fixture produced nothing at all".
    expect(result.candidates.length).toBeGreaterThan(0);

    // FR-9, fail direction UNDER-DETECT: two visits to a path is navigation,
    // and only the third makes it a pattern. The consequence is deliberate —
    // a `confusing` claim with no proof hits the FR-13B floor and is DROPPED.
    // Silence, not a softer claim (ADD trade-off 6, ESC-1).
    expect(struggleSignalsOf(result)).toEqual([]);
  });

  test("should take attempts as a per-session maximum, never a sum across sessions", () => {
    const rules = ruleSetV1();
    const perSessionVisits = rules.struggleRepeatedAttemptMin - 1;

    const corpus = struggleCorpus({
      converted: STRUGGLE_CONVERTED,
      revisits: [{ count: STRUGGLE_DROPPED, visits: perSessionVisits, detour: STRUGGLE_DETOUR }],
    });

    // EIGHT sessions visiting the origin twice each. A summing implementation
    // sees 16 and fires; ruling 31 says the greatest SINGLE session's count is
    // 2, which is below the minimum, so nothing fires. Eight people each
    // glancing at a page twice is not one person stuck on it.
    expect(STRUGGLE_DROPPED * perSessionVisits).toBeGreaterThanOrEqual(
      rules.struggleRepeatedAttemptMin,
    );
    expect(perSessionVisits).toBeLessThan(rules.struggleRepeatedAttemptMin);

    const result = detectFunnelDropoff(corpus, rules);

    // NON-VACUITY again: the candidate exists; only the struggle is absent.
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(struggleSignalsOf(result)).toEqual([]);
  });

  test("should report the greatest single session's visit count as attempts", () => {
    const rules = ruleSetV1();
    const deepestVisits = rules.struggleRepeatedAttemptMin + 1;
    const shallowVisits = rules.struggleRepeatedAttemptMin - 1;
    const deepestCount = 2;
    const shallowCount = STRUGGLE_DROPPED - deepestCount;

    const corpus = struggleCorpus({
      converted: STRUGGLE_CONVERTED,
      revisits: [
        { count: shallowCount, visits: shallowVisits, detour: STRUGGLE_DETOUR },
        { count: deepestCount, visits: deepestVisits, detour: STRUGGLE_DETOUR },
      ],
    });

    expect(corpus.basis.kept).toBe(rules.funnelMinSessionsAtOrigin);

    const result = detectFunnelDropoff(corpus, rules);
    const struggles = struggleSignalsOf(result);

    expect(struggles.length).toBeGreaterThan(0);
    for (const struggle of struggles) {
      // The MAXIMUM (4). Not the sum across sessions (6 x 2 + 2 x 4 = 20), and
      // not the mean (2.5): two people came back four times each, and four is
      // the number that reaches a founder.
      expect(struggle.attempts).toBe(deepestVisits);
      expect(struggle.attempts).not.toBe(
        shallowCount * shallowVisits + deepestCount * deepestVisits,
      );
    }
  });

  test("should never emit a backtrack struggle signal — it has no producer this sprint", () => {
    const rules = ruleSetV1();

    // A genuine BACK-NAVIGATION corpus: eight sessions walk
    // origin -> destination -> origin -> destination -> origin. If a single
    // back-navigation were admitted as `confusing` proof, this is where it
    // would fire — and it would fire on a SUPERSET of its target, because
    // users navigate back constantly. That is the D10 conflation this sprint
    // exists to prevent, and PL ruling 18 is the decision not to admit it.
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

    // Fixture self-check: the drop-off gate clears, so the corpus DOES produce
    // a candidate and the subkind assertions below are about what it emitted.
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

    // NON-VACUITY OF THE ASSERTION ABOVE. `backtrack` is still a member of the
    // union and still parses, so the loop is green because nothing PRODUCES
    // one — not because the subkind was quietly deleted (PL ruling 18: it
    // stays, typed and tested against constructed inputs, with no producer).
    expect(
      evidenceSignalSchema.parse({
        kind: "struggle",
        subkind: "backtrack",
        surface: STRUGGLE_ORIGIN,
        attempts: rules.struggleRepeatedAttemptMin,
        // Required since strugglingSessions landed: the schema rejects a bare
        // number here ("a count must be built by measuredCount(), with its
        // denominator"), which is the §10 denominator rule enforced at
        // runtime. Constructed, not produced — that is the point of this
        // assertion.
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

// ===========================================================================
// FR-22 / FR-9 — `funnelMinDropoffSessions`, the one threshold in this file
// whose fail direction no test NAME stated (Wave 7).
//
// WHY THIS TEST HANDS THE DETECTOR A RULE SET THAT IS NOT v1, AND WHY THE NEXT
// PERSON MUST NOT "SIMPLIFY" IT BACK TO v1.
//
// At v1 magnitudes this floor is STRUCTURALLY UNREACHABLE — it can never be the
// gate that decided. The floor only ever blocks a drop-off of
// `funnelMinDropoffSessions - 1` or fewer (4). But a transition is only
// considered at all once its origin holds `funnelMinSessionsAtOrigin` sessions
// (20), and it must then clear `funnelDropoffRateThresholdPercent` of that
// cohort (40% of 20 = 8) before it may fire. Every drop-off small enough for the
// floor to block is therefore ALREADY blocked by the rate gate — at every
// permitted denominator, because the rate bar only rises as the denominator
// grows. The assertion below states exactly this, in exact integer arithmetic,
// rather than leaving it as prose.
//
// That v1 redundancy is a REAL FINDING, not a fixture inconvenience: at v1 the
// floor is dead weight, and it earns its place only as a guard on FUTURE rule
// sets whose rate threshold or origin floor moves. A v1-only fixture here could
// not assert that. It could only re-assert a verdict the rate gate had already
// reached — passing identically against a detector from which the floor had been
// DELETED, which is precisely the regression FR-22 exists to make impossible.
//
// D-14 is what makes handing over a different rule set the natural move rather
// than a workaround: the rule set is a PARAMETER, never read internally, and
// `predicates.test.ts` already does the equivalent (a constructed v2 carrying a
// different proof-signal list) to prove a predicate reads its parameter. Exactly
// ONE member is varied below — the floor itself — so the corpus, the origin
// gate and the rate gate are all held fixed and the only thing that can move the
// verdict is the floor.
//
// LANE: every id and path below is `t1flr`-prefixed and collides with nothing
// above. Fixture time still descends from `FIRST_SESSION_STARTED_AT` via
// `cohortStart`; no `Date.now()` is introduced (ADD §6.5).
// ===========================================================================

const FLOOR_ORIGIN = "/t1flr/pricing";
const FLOOR_DESTINATION = "/t1flr/checkout";

/** 10 converters + 10 droppers = 20 sessions at the origin — exactly
 * `funnelMinSessionsAtOrigin` — and 10 of 20 is 50%, comfortably over the 40%
 * rate gate. Both of the other two gates are satisfied by construction, so the
 * floor is the only gate left that can speak. */
const FLOOR_AT_ORIGIN = 20;
const FLOOR_DROPPED = 10;

/** Varies exactly ONE member. `version: 2` because this is honestly not v1 —
 * v1 is a shipped, immutable decision and nothing here edits it. */
function withMinDropoffSessions(
  rules: ThresholdRuleSet,
  funnelMinDropoffSessions: number,
): ThresholdRuleSet {
  return { ...rules, version: 2, funnelMinDropoffSessions };
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

describe("detectFunnelDropoff — funnelMinDropoffSessions (FR-9, FR-22)", () => {
  test("should not fire below funnelMinDropoffSessions", () => {
    const v1 = ruleSetV1();

    // THE v1 REDUNDANCY, ASSERTED RATHER THAN CLAIMED. The largest drop-off the
    // floor can block is `funnelMinDropoffSessions - 1`; the thinnest origin
    // cohort v1 permits is `funnelMinSessionsAtOrigin`. Even paired, that
    // drop-off fails the rate gate on its own — and a larger origin cohort only
    // raises the bar. So no v1 fixture exists in which this floor is the binding
    // gate, which is why the rule set below is varied. Exact integer arithmetic
    // (PL ruling 1): no float division anywhere in this comparison.
    expect((v1.funnelMinDropoffSessions - 1) * 100).toBeLessThan(
      v1.funnelDropoffRateThresholdPercent * v1.funnelMinSessionsAtOrigin,
    );

    const corpus = floorCorpus();

    // Fixture self-check. The other two gates are satisfied, so whatever this
    // test observes can only be the floor.
    expect(corpus.basis.kept).toBe(FLOOR_AT_ORIGIN);
    expect(FLOOR_AT_ORIGIN).toBeGreaterThanOrEqual(v1.funnelMinSessionsAtOrigin);
    expect(FLOOR_DROPPED * 100).toBeGreaterThanOrEqual(
      v1.funnelDropoffRateThresholdPercent * FLOOR_AT_ORIGIN,
    );

    // NON-VACUITY, AND THE INCLUSIVE HALF OF THE BOUNDARY (D-6). The SAME
    // corpus, under a rule set whose floor sits exactly AT the drop-off, DOES
    // fire. So the silence below is this one magnitude holding — never a fixture
    // that produces nothing, and never some other gate.
    const atFloor = detectFunnelDropoff(corpus, withMinDropoffSessions(v1, FLOOR_DROPPED));
    expect(atFloor.candidates).toHaveLength(1);
    expect(
      atFloor.candidates[0].counts.some(
        (count) => count.numerator === FLOOR_DROPPED && count.denominator === FLOOR_AT_ORIGIN,
      ),
    ).toBe(true);

    // ONE SESSION BELOW THE FLOOR, everything else identical.
    const belowFloor = detectFunnelDropoff(corpus, withMinDropoffSessions(v1, FLOOR_DROPPED + 1));

    // FAIL DIRECTION: UNDER-DETECT (FR-9). An absolute floor beneath the rate,
    // so a 100% drop of a handful of sessions never fires however extreme the
    // ratio looks. A missed finding is recoverable; a false claim burns the
    // credibility the MVP exists to test.
    expect(belowFloor.candidates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PL RULING 28 — `surfaceNormalisationVersion` is unanimous-or-`null`
// ---------------------------------------------------------------------------
//
// WHY THIS BLOCK EXISTS. `surfaceNormalisationVersion` is a direct input to
// `evidence_shape`, which is a direct input to O-006's signature hash. It is
// the ONE D12 input this sprint added, and until now only its unanimous case
// was asserted (the collapsed-path test) — every fixture in this file stamps a
// single uniform version, so the disagreement and pre-versioned branches of
// `surfaceVersionOf` were reachable by no test at all.
//
// Fail direction: toward `null`. `null` means "redaction status unknown"
// (ES-14, D-15) and is the class a later §5 remediation migration must be able
// to select. Reporting ONE version when two produced the string would assert a
// redaction guarantee the run cannot make; coercing to `0` would assert a
// version nobody ever wrote.

/** The firing corpus, but the kept cohorts carry the versions given. Set-aside
 * sessions keep the default, so a detector that forgot ruling 24 and read the
 * version over ALL sessions rather than KEPT ones would report differently. */
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
  // NON-VACUITY: every assertion below is about the version ON a candidate, so
  // an empty result would pass by asserting nothing.
  expect(result.candidates).toHaveLength(1);
  return result.candidates[0].surfaceNormalisationVersion;
}

describe("detectFunnelDropoff — surfaceNormalisationVersion (PL ruling 28)", () => {
  test("should carry the version when every kept session on the surface agrees", () => {
    // The baseline the other cases are measured against: unanimity IS reported,
    // so a `null` below can only mean disagreement and not a broken fixture.
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
    // The realistic churn event: a window straddling a normaliser bump, so the
    // same surface string was produced by two different rule sets. One of them
    // may still carry a live token; the run cannot say which, so it says so.
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
    // A pre-migration row (ES-14) contaminates the whole surface: unknown is
    // not averaged away by the rows that DO know.
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

    // ES-14, stated as the two separate facts it is. `0` is a version somebody
    // could have written; `null` is "we do not know". A remediation query
    // selecting `IS NULL` must not miss these rows, and must not match rows
    // that genuinely recorded version 0.
    expect(version).toBeNull();
    expect(version).not.toBe(0);
  });

  test("should ignore set-aside sessions when deciding unanimity (ruling 24)", () => {
    // The kept sessions all agree; ONLY a set-aside session disagrees. Coverage
    // and identity both describe what was ANALYSED, and a set-aside session is
    // never analysed — so it cannot fork the surface's identity either.
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

// ---------------------------------------------------------------------------
// ESC-9 — one origin, many destinations: N candidates, ONE identity
// ---------------------------------------------------------------------------
//
// WHY THIS BLOCK EXISTS. The emission model was never asserted: every
// `toHaveLength` in this file is `1`, so nothing pinned what happens when one
// origin leaks to SEVERAL destinations above threshold. That left a real
// contract question invisible — the candidates are distinct, but their
// `evidence_shape`s are byte-identical, because the destination is computed
// and then discarded (see the ESC-9 comment at the emission site).
//
// These tests pin the CURRENT behaviour deliberately. They are not an
// endorsement of it: ESC-9 carries the decision, and whichever way it lands —
// carry the destination into a v2 shape, or aggregate to one candidate per
// origin — THESE TESTS MUST CHANGE. That is the point. A silent contract shift
// under O-005 and O-006 is what this block exists to make impossible.

const FORK_ORIGIN = "/pricing";
const FORK_DESTINATIONS = ["/checkout", "/help", "/faq"] as const;

/** 30 kept sessions all reach `/pricing`; each destination is reached by a
 * different small slice, so EVERY transition clears both the absolute floor
 * and the 40% rate gate. */
function multiDestinationCorpus(): DetectorCorpus {
  const sessions: SessionTimeline[] = [];
  let index = 0;

  const push = (paths: readonly (string | null)[], count: number): void => {
    for (let n = 0; n < count; n += 1) {
      sessions.push(
        sessionTimeline({
          sessionId: `fork-${String(index).padStart(3, "0")}`,
          startedAt: new Date(cohortStart(0).getTime() + index * SESSION_STRIDE_MS),
          paths,
          exclusionReason: "none",
          normalisationVersion: NORMALISATION_VERSION,
        }),
      );
      index += 1;
    }
  };

  // A DIFFERENT slice reaches each destination (4 / 6 / 8), so the three
  // transitions carry three DIFFERENT drop-off magnitudes (26 / 24 / 22 of
  // 30). That difference is what makes them distinct claims — and therefore
  // what makes one shared identity a collision rather than a tidy dedup.
  const REACHED = [4, 6, 8] as const;
  FORK_DESTINATIONS.forEach((destination, slot) => {
    push([FORK_ORIGIN, destination], REACHED[slot]);
  });
  // The remainder leave from the origin outright, taking the corpus to 30.
  push([FORK_ORIGIN], 30 - REACHED.reduce((sum, n) => sum + n, 0));

  return corpusOf({ sessions, connectionState: CONNECTED_RECEIVING, truncated: false });
}

describe("detectFunnelDropoff — one origin with several destinations (ESC-9)", () => {
  test("should emit one candidate per qualifying transition, all sharing the origin as surface", () => {
    const corpus = multiDestinationCorpus();
    const result = detectFunnelDropoff(corpus, ruleSetV1());

    // NON-VACUITY: the fixture must actually clear every gate, or "3" below
    // could be produced by a fixture that fires for some other reason.
    expect(corpus.basis.kept).toBe(30);
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.candidates).toHaveLength(FORK_DESTINATIONS.length);

    // Ruling 14 holds for every one of them: the surface is the ORIGIN.
    for (const candidate of result.candidates) {
      expect(candidate.surface).toBe(FORK_ORIGIN);
      expect(candidate.claimedClass).toBe("confusing");
    }

    // The candidates are genuinely DIFFERENT claims — each carries its own
    // drop-off magnitude — which is exactly why collapsing their identity is
    // the problem ESC-9 names.
    const dropped = result.candidates.map((candidate) => candidate.counts[1]?.numerator);
    expect(new Set(dropped).size).toBeGreaterThan(1);
  });

  test("should collapse every one of those candidates to a single evidence_shape (ESC-9, currently unresolved)", () => {
    const result = detectFunnelDropoff(multiDestinationCorpus(), ruleSetV1());

    const shapes = result.candidates.map((candidate) =>
      evidenceShape(
        {
          detector: candidate.detector,
          surface: candidate.surface,
          surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
          signals: candidate.signals,
          // The gate's final class; `confusing` is what this detector proposes
          // and what a passing claim keeps.
          symptomClass: "confusing",
        },
        EVIDENCE_SHAPE_VERSION,
      ),
    );

    expect(shapes).toHaveLength(FORK_DESTINATIONS.length);

    // THE COLLISION, ASSERTED. Three distinct findings, one identity. When
    // ESC-9 is resolved this assertion MUST flip to `toBe(shapes.length)` (fix
    // a) or the candidate count above must become 1 (fix b). A green suite
    // here means the question is still open — never that it is fine.
    expect(new Set(shapes).size).toBe(1);
  });
});
