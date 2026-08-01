// The five named tests for the count-role resolver.
//
// What this file is for, in one sentence: `CandidateFinding.counts` is a positional
// array whose roles live only in prose at two emission sites, and this suite is what
// stops the table that describes those sites from drifting away from them.
//
// The load-bearing test is the first one. It runs the real detectors over firing
// corpora and compares each produced candidate's arity against the declared arity. A
// table checked only against itself would agree with itself forever; this one disagrees
// with the code the moment either detector's emission changes, without anybody having
// to remember to edit it.
//
// House rules honoured here:
// Fixture time is a constant. Nothing in this file reads a clock; every
//  instant descends from `FIXTURE_WINDOW`.
// The rule set is fetched by version (`THRESHOLD_RULE_SETS.get`), never
//  as "whatever is current", and every fixture magnitude is derived from it
//  rather than hand-tuned — so a v2 threshold change cannot silently turn a
//  firing corpus into a silent one and make the arity claims vacuous.
// Every helper is declared at module scope, never inside a `test`
//  callback (`unicorn/consistent-function-scoping`). A green `bun test` is
//  not a green build.
// No node builtin. This file reads no source text and needs none.
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

// Frozen fixture time and vocabulary. All `t1cr`-prefixed, colliding with no other
// suite

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

/** Sessions above the origin floor, so the fixture is not sitting on a boundary this
 * suite is not about. */
const FUNNEL_HEADROOM_SESSIONS = 10;
/** One session past the inclusive rate gate, for the same reason: the boundary's
 * inclusivity is `funnel-dropoff.test.ts`'s subject, not this file's, and a fixture
 * sitting exactly on it would make these arity claims hostage to a decision they do not
 * test. */
const FUNNEL_RATE_HEADROOM_SESSIONS = 1;
/** Sessions above the affected-sessions floor, same reason. */
const ERROR_HEADROOM_SESSIONS = 2;

const FUNNEL_ORIGIN = "/t1cr/pricing";
const FUNNEL_DESTINATION = "/t1cr/checkout";
const FUNNEL_EVENT_NAME = "t1cr_step_viewed";

const ERROR_SURFACE = "/t1cr/settings";
const ERROR_ACTION = "t1cr_save_clicked";

/** The v1 rule set, fetched by version. */
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

// Corpus builders. Every fixture session is kept, so `basis.kept` is the whole corpus
// and nothing in this file turns on the set-aside rule.

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

/**
 * A corpus the funnel detector fires on, sized from the rule set rather than
 * hand-tuned: enough sessions at the origin to clear `funnelMinSessionsAtOrigin` with
 * headroom, and enough of them ending there to clear both `funnelMinDropoffSessions`
 * and the inclusive rate gate.
 *
 * Deliberately asymmetric, strictly more sessions reach the origin than leave it
 * without continuing, so a resolver that swapped the two roles would be caught by an
 * assertion rather than hidden by equal numbers.
 */
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
  // Well inside `errorCorrelationWindowMs`, so the exception correlates to the action
  // that preceded it and the fixture is the ordinary firing case.
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

/** A corpus the error detector fires on, sized from the rule set. */
function firingErrorCorpus(ruleSet: ThresholdRuleSet): DetectorCorpus {
  const affected = ruleSet.errorMinAffectedSessions + ERROR_HEADROOM_SESSIONS;
  const sessions: SessionTimeline[] = [];
  for (let index = 0; index < affected; index += 1) {
    sessions.push(errorSession(index, ruleSet));
  }
  return corpusOf(sessions);
}

// Real detector output, and the candidate contract built from it

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

/**
 * A `CandidateFinding` built from real detector output and parsed through
 * `candidateFindingSchema`, so the fixture cannot drift from the contract and its
 * counts are genuine branded `MeasuredCount`s rather than hand-built shapes the
 * resolver would never see in life.
 *
 * `counts` may be overridden. That is the only way to express the arity disagreement
 * the refusal test needs, since neither detector can produce one.
 *
 * The trace, the evidence shape and the ranking are here only because the contract
 * requires them. `resolveCounts` reads none of them; it reads `detector` and `counts`
 * and nothing else.
 */
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
    // The claim passed at its first rung, so the final class is the claimed one.
    // Reachable by identity, which is what `candidateFindingSchema` refines on.
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

/** Every digit run in a string, so an error message can be audited for values it must
 * not carry rather than eyeballed. */
function digitRunsIn(text: string): readonly string[] {
  return text.match(/\d+/g) ?? [];
}

/** The message a call threw, or `null` if it did not throw. */
function refusalMessageOf(call: () => unknown): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("count roles", () => {
  // The sprint's one real wire to the detectors, and the only test here that is
  // behavioural rather than a statement about the table. Everything else in this file
  // could pass against a table that describes detectors that do not exist; this one
  // cannot.
  test("every detector's declared count roles match the arity its detector actually produces", () => {
    const ruleSet = ruleSetV1();

    const results: readonly DetectorResult[] = [
      detectFunnelDropoff(firingFunnelCorpus(ruleSet), ruleSet),
      detectErrorEvent(firingErrorCorpus(ruleSet), ruleSet),
    ];

    // -- non-vacuity, before any arity claim An empty corpus makes "every produced
    // candidate has the declared arity" trivially true, which is the exact way this
    // test would rot into theatre.
    for (const result of results) {
      expect(result.candidates.length).toBeGreaterThan(0);
    }

    // ...and both detectors are exercised, not one of them twice. Derived from the
    // schema, so a third detector added without a corpus here fails rather than
    // escaping the check.
    expect(results.map((result) => result.detector).toSorted()).toEqual(
      [...detectorNameSchema.options].toSorted(),
    );

    // -- the actual assertion
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

    // The two declared arities differ, so the check above cannot be satisfied by a
    // table that happens to state one number everywhere.
    expect(COUNT_ROLES.funnel_dropoff.length).not.toBe(COUNT_ROLES.error_event.length);
  });

  // Fail direction: refuse.
  test("a candidate whose counts arity disagrees with its detector's declared roles is refused", () => {
    const ruleSet = ruleSetV1();
    const funnelSource = funnelDetectorCandidate(ruleSet);
    const errorSource = errorDetectorCandidate(ruleSet);

    // Too many: an error candidate carrying a second count it has no role for. Neither
    // detector can produce this, which is why the fixture builds it.
    const [errorCount] = errorSource.counts;
    if (!errorCount) throw new Error("the error fixture must produce a count");
    const tooMany = candidateFindingFrom({
      source: errorSource,
      ruleSet,
      counts: [errorCount, errorCount],
    });

    // Too few: a funnel candidate carrying only the first of its two counts.
    const [funnelFirst] = funnelSource.counts;
    if (!funnelFirst) throw new Error("the funnel fixture must produce a count");
    const tooFew = candidateFindingFrom({
      source: funnelSource,
      ruleSet,
      counts: [funnelFirst],
    });

    expect(() => resolveCounts(tooMany)).toThrow();
    expect(() => resolveCounts(tooFew)).toThrow();

    // It refuses rather than truncating or padding: no partial map is returned on
    // either side of the declared arity.
    const tooManyMessage = refusalMessageOf(() => resolveCounts(tooMany));
    const tooFewMessage = refusalMessageOf(() => resolveCounts(tooFew));
    expect(tooManyMessage).not.toBeNull();
    expect(tooFewMessage).not.toBeNull();

    // The message names the detector and both arities...
    expect(tooManyMessage).toContain("error_event");
    expect(digitRunsIn(tooManyMessage ?? "").toSorted()).toEqual(["1", "2"]);
    expect(tooFewMessage).toContain("funnel_dropoff");
    expect(digitRunsIn(tooFewMessage ?? "").toSorted()).toEqual(["1", "2"]);

    // ...And no count value. Nothing about somebody's product reaches a log line. The
    // precondition is asserted first, so this is not satisfied by a fixture whose
    // numbers happen to be the arities.
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

  // Funnel arm. The hazard, named: `counts[0]` is the arrival count and `counts[1]` is
  // the departure count, and only the emission site said so.
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

    // `toBe`, not `toEqual`: the resolved role must hold the very count object at that
    // position, so a resolver that rebuilt a lookalike would fail.
    expect(resolved.counts.reached_surface).toBe(candidate.counts[0]);
    expect(resolved.counts.left_without_continuing).toBe(candidate.counts[1]);

    // The map carries exactly the declared roles. No extra key, none missing.
    expect(Object.keys(resolved.counts).toSorted()).toEqual(
      [...COUNT_ROLES.funnel_dropoff].toSorted(),
    );

    // ...and the two roles are not interchangeable. The fixture is built so strictly
    // more sessions reached the origin than left it without continuing, so a resolver
    // that swapped the roles fails here rather than passing on two equal numbers.
    expect(resolved.counts.reached_surface).not.toBe(resolved.counts.left_without_continuing);
    expect(resolved.counts.reached_surface.numerator).toBeGreaterThan(
      resolved.counts.left_without_continuing.numerator,
    );
  });

  // Error arm. The arity the positional read gets wrong in the other direction:
  // `counts[1]` is `undefined` for every candidate this detector produces, so there is
  // no second role to reach for.
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

  // The compile pin is `satisfies Record<DetectorName,...>`; this is its runtime
  // observation, in both directions. A detector with no row, and a row naming no
  // detector.
  test("COUNT_ROLES has an entry for every detector name", () => {
    const declared: readonly string[] = Object.keys(COUNT_ROLES).toSorted();
    const known: readonly string[] = [...detectorNameSchema.options].toSorted();

    // Non-vacuity: two empty lists are equal and would prove nothing.
    expect(declared.length).toBeGreaterThan(0);
    expect(known.length).toBeGreaterThan(0);

    expect(declared).toEqual(known);

    // Stated in both directions explicitly, so a reader does not have to derive that a
    // sorted equality is the conjunction of the two containments.
    for (const name of known) expect(declared).toContain(name);
    for (const name of declared) expect(known).toContain(name);

    // Every row declares at least one role, and no row names a role twice. A duplicate
    // would pass the resolver's arity check and then silently drop a magnitude the
    // resolved type promises.
    for (const detector of detectorNameSchema.options) {
      const roles: readonly string[] = COUNT_ROLES[detector];
      expect(roles.length).toBeGreaterThan(0);
      expect(new Set(roles).size).toBe(roles.length);
    }
  });
});
