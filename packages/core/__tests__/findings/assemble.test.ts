// The assembler is the JOIN O-012 exists to build, so its tests drive the
// REAL detectors and the REAL gate over constructed corpora — the pure half of
// the packet's end-to-end requirement, with no fake between the pieces. The
// detector suites own the detectors' internals; what this file pins is the
// wiring: the gate's verdict is final, identity follows the conclusion, the
// declared count order survives, and a drop is named rather than vanished.
//
// House rules (STATE.md): fixture time is frozen constants — no `Date.now()`
// anywhere; the rule set is fetched BY VERSION, never "current"; no node
// builtin.
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
import { assembleCandidates } from "../../src/findings/assemble";
import { EVIDENCE_SHAPE_VERSION } from "../../src/findings/evidence-shape";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

// ---------------------------------------------------------------------------
// Frozen fixture time
// ---------------------------------------------------------------------------

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
/** No `$` prefix: the customer instrumented it, so it is a user action by the
 * rule set's own vendor-prefix split. */
const ACTION_NAME = "checkout_submitted";

function ruleSet(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(2);
  if (!rules) throw new Error("rule set version 2 must remain resolvable forever");
  return rules;
}

// ---------------------------------------------------------------------------
// Corpus fixtures — the same shapes the detector suites use, compacted
// ---------------------------------------------------------------------------

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

/** A kept session walking `paths` in order, one synthetic event per step. */
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

/** `count` sessions each walking `paths`, strided so no ids or instants
 * collide. */
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

/** A kept session whose user action is followed `gapMs` later by an exception
 * on the same surface — the `failure_correlated` producer shape. */
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

/** Every fixture session is KEPT, so `basis` derives from the list and the
 * `kept + Σ setAside === totalInWindow` identity holds by construction. */
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

/** The detour a struggling session bounces to and back from. `pathWalk`
 * collapses consecutive repeats, so a "visit" to the origin means LEAVING and
 * RETURNING — `[O, O, O]` is one visit, `[O, /faq, O]` is two. */
const DETOUR = "/faq";

/**
 * The funnel fixture the pass tests share, built against the detector's REAL
 * walk semantics (D-2a/D-2b, `funnel-dropoff.ts`):
 *
 * - a DROPPED session's walk ENDS at its first visit to the origin — so
 *   dropped sessions are single-event `[O]` walks, and the dropped and
 *   struggling cohorts are structurally disjoint (D-2a's own consequence);
 * - a STRUGGLING session alternates `O → /faq → O → …` — `struggleVisits`
 *   separate visits to the origin — and therefore CONTINUES (it reaches
 *   `/faq`, a member of the origin's own destination set);
 * - the detour cohort at `/faq` stays far below `funnelMinSessionsAtOrigin`,
 *   so only the origin emits a candidate.
 *
 * 30 sessions reach the origin, of which 12 drop — exactly 40%, the inclusive
 * rate boundary, over both funnel floors. Both struggle magnitudes are
 * exactly controllable against the v2 minimums (3 and 3).
 */
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

// ---------------------------------------------------------------------------

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

    // The gate's verdict, verbatim: funnel proposes `confusing`, struggle
    // proves it, and the last trace entry records the SATISFIED predicate
    // (ES-15 — "we checked and it held" is never "we did not check").
    expect(candidate.detector).toBe("funnel_dropoff");
    expect(candidate.claimedClass).toBe("confusing");
    expect(candidate.finalClass).toBe("confusing");
    expect(candidate.trace.at(-1)?.satisfied).toBe(true);
    expect(candidate.surface).toBe(ORIGIN);

    // The derivations, each pinned to its cited rule:
    // PL ruling 15 — [0] is the reached-the-surface count the ranking rests on.
    expect(candidate.ranking.sampleSize).toBe(candidate.counts[0]);
    // The version a candidate names is the version of the SAME object that
    // gated it.
    expect(candidate.thresholdRuleSetVersion).toBe(rules.version);
    expect(candidate.evidenceShapeVersion).toBe(EVIDENCE_SHAPE_VERSION);
    // Identity carries the gate's conclusion.
    expect(candidate.evidenceShape).toContain('"symptomClass":"confusing"');
  });

  test("reports at_threshold when every proving magnitude sits exactly at its inclusive boundary", () => {
    const rules = ruleSet();
    // Exactly 3 strugglers making exactly 3 visits: both struggle magnitudes
    // at their v2 minimums — the D-6 case `confidenceBasisSchema` names.
    const result = detectFunnelDropoff(funnelCorpus({ strugglers: 3, struggleVisits: 3 }), rules);
    const assembled = assembleCandidates([result], rules);

    expect(assembled.candidates[0]?.ranking.confidenceBasis).toBe("at_threshold");
  });

  test("reports threshold_met the moment a proving signal clears its magnitudes with room", () => {
    const rules = ruleSet();
    // 4 strugglers × 4 visits: both magnitudes strictly above their minimums.
    const result = detectFunnelDropoff(funnelCorpus({ strugglers: 4, struggleVisits: 4 }), rules);
    const assembled = assembleCandidates([result], rules);

    expect(assembled.candidates[0]?.ranking.confidenceBasis).toBe("threshold_met");
  });

  test("a gate-dropped candidate is named in rejected and never becomes a finding", () => {
    const rules = ruleSet();
    // Every drop is a single visit: the rate fires the detector, but no
    // session struggled — `confusing`'s only proof is absent, and `confusing`
    // downgrades to "drop" (FR-13B), never to the class that blames the user.
    const result = detectFunnelDropoff(funnelCorpus({ strugglers: 0, struggleVisits: 0 }), rules);
    expect(result.candidates.length).toBe(1);

    const assembled = assembleCandidates([result], rules);

    expect(assembled.candidates).toEqual([]);
    expect(assembled.rejected.length).toBe(1);
    const rejection = assembled.rejected[0];
    if (rejection === undefined) throw new Error("asserted one rejection above");
    expect(rejection.detector).toBe("funnel_dropoff");
    expect(rejection.surface).toBe(ORIGIN);
    // The trace records the UNSATISFIED rung, so a drop is debuggable rather
    // than a silent vanish (D5: zero passing candidates is a named outcome).
    expect(rejection.trace.some((entry) => !entry.satisfied)).toBe(true);
  });

  test("two detectors firing on one surface assemble into ONE flat candidate list (D3)", () => {
    const rules = ruleSet();
    // One corpus in which BOTH T1 detectors have something to say about the
    // same surface: the funnel struggle cohort plus three sessions whose user
    // action is followed 1s later by the rule set's exception event.
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

    // One lane, N candidates — never two lanes: the caller states
    // `sessionsConsidered` once per project, so the assembler must hand back
    // one flat list.
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

    // A constructed claim of `broken` whose correlated cohort is one below the
    // v2 minimum, over struggle proof that clears `confusing` with room. The
    // ladder must descend broken → confusing and pass there.
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
    // THE LOAD-BEARING ASSERTION: the shape string serialises what the gate
    // CONCLUDED. Serialising the ambition would fork the signature of every
    // downgraded finding (D12).
    expect(candidate.evidenceShape).toContain('"symptomClass":"confusing"');
    expect(candidate.evidenceShape).not.toContain('"symptomClass":"broken"');
    // The descent is on the record: an unsatisfied broken rung, then a
    // satisfied confusing one.
    expect(candidate.trace.length).toBe(2);
    expect(candidate.trace[0]?.satisfied).toBe(false);
    expect(candidate.trace.at(-1)?.satisfied).toBe(true);
  });

  test("empty detector results assemble to nothing, loudly typed rather than crashed", () => {
    const rules = ruleSet();
    // ES-1: an empty candidates array is a real answer. Zero results and zero
    // candidates must both degrade to the empty assembly, never a throw.
    expect(assembleCandidates([], rules)).toEqual({ candidates: [], rejected: [] });

    const empty = detectFunnelDropoff(corpusOf([]), rules);
    expect(assembleCandidates([empty], rules)).toEqual({ candidates: [], rejected: [] });
  });
});
