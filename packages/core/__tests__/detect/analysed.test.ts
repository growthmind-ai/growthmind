// `analysedSessions` — the ONE definition of "what this run actually analysed"
// (O-004 FR-7, D-3, PL rulings 7, 16 and 24).
//
// WHY THIS FILE EXISTS. This module is the single implementation of FR-7 AND of
// ruling 24, and it exists precisely BECAUSE the two detectors diverged on the
// coverage denominator — `error_event` counted over kept sessions,
// `funnel_dropoff` over every session it was handed, and two detectors
// reporting coverage on different populations makes the number uncomparable
// across a run (a D5 defect that reads as a product problem, not a bug).
//
// Until now it was tested only THROUGH the two detectors, and it was not
// exported from the barrel — so it was structurally invisible to the FR-22
// coverage gate, which is the same shape of gap as the divergence itself. Every
// branch is asserted here directly, against the function's own contract.
//
// THE THREE RULES, and the direction each fails in:
//   - FR-7 (ruling 7): the analysed set is `exclusionReason === "none"`. A
//     set-aside session reaches no numerator and inflates no denominator. It
//     fails toward reporting LESS than was read, never more.
//   - Ruling 16: `coverage.truncated` PROPAGATES. It is a fact about the READ
//     and cannot be recomputed from the sessions — a recomputed `false` would
//     be O-003's CR-1, a silent truncation reading as "no more events".
//   - Ruling 24: `coverage.eventsWithoutUrlPath` is RECOMPUTED over the KEPT
//     sessions only. The corpus's own value is NOT trusted, so the number is
//     provably about what this run analysed.
//
// CLOCK (ADD §6.5, PL ruling 3): every instant below is a fixture constant
// passed explicitly into a helper. Nothing here reads `Date.now()`.
//
// LANE PREFIX: every id, session key, event name and path in this file is
// prefixed `t1anl` — a NEW prefix, shared with no other suite (ADD §6.5).
import type { ConnectionState, ExclusionReason } from "@growthmind/shared";
import { exclusionReasonSchema } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { CountBasis } from "../../src/counts/measured-count";
import { analysedSessions } from "../../src/detect/analysed";
import type {
  AnalysisWindow,
  DetectorCorpus,
  DetectorCoverage,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";

// ---------------------------------------------------------------------------
// Fixture time — required parameters, never a clock read
// ---------------------------------------------------------------------------

const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

/** The instant every fixture event occurs at, well inside the window. */
const T1ANL_EVENT_AT = new Date("2026-06-04T12:00:00.000Z");

/** `base` shifted FORWARD by `offsetMs`. Both are parameters. */
function after(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() + offsetMs);
}

// ---------------------------------------------------------------------------
// Fixture vocabulary — all `t1anl`-prefixed, colliding with no other suite
// ---------------------------------------------------------------------------

const T1ANL_SURFACE = "/t1anl/dashboard";
const T1ANL_EVENT_NAME = "t1anl_widget_clicked";
const T1ANL_STEP_MS = 1_000;

const T1ANL_CONNECTION_STATE: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "t1anl-connection",
    organizationId: "t1anl-org",
    projectId: "t1anl-project",
    sourceKind: "posthog",
    host: "https://t1anl.example.invalid",
    sourceProjectId: "t1anl-source-project",
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

/**
 * One session. `urlPaths` is the whole point of the builder: each entry becomes
 * one event, and a `null` entry is an event with no path — the thing ruling 24
 * counts. `baseAt` is a REQUIRED parameter (ADD §6.5).
 */
function t1anlSession(input: {
  readonly key: string;
  readonly exclusionReason: ExclusionReason;
  readonly urlPaths: readonly (string | null)[];
  readonly baseAt: Date;
}): SessionTimeline {
  const events: readonly TimelineEvent[] = input.urlPaths.map((urlPath, slot) => ({
    sourceEventId: `t1anl-${input.key}-e${slot}`,
    name: T1ANL_EVENT_NAME,
    occurredAt: after(input.baseAt, slot * T1ANL_STEP_MS),
    urlPath,
    urlPathNormalisationVersion: urlPath === null ? null : 1,
  }));

  return {
    sessionId: `t1anl-session-${input.key}`,
    startedAt: FIXTURE_WINDOW.start,
    exclusionReason: input.exclusionReason,
    entryUrlPath: input.urlPaths[0] ?? null,
    events,
  };
}

/**
 * `basis` is built from the sessions so the identity
 * `kept + Σ setAside === totalInWindow` holds, and `coverage` is a REQUIRED
 * parameter rather than a default — every test states what the corpus CLAIMS,
 * because whether that claim is trusted is exactly what is under test.
 */
function t1anlCorpus(
  sessions: readonly SessionTimeline[],
  coverage: DetectorCoverage,
): DetectorCorpus {
  const kept = sessions.filter((session) => session.exclusionReason === "none").length;
  const setAside = [...new Set(sessions.map((session) => session.exclusionReason))]
    .filter((reason): reason is Exclude<ExclusionReason, "none"> => reason !== "none")
    .map((reason) => ({
      reason,
      count: sessions.filter((session) => session.exclusionReason === reason).length,
      label: `t1anl-${reason}`,
    }));

  const basis: CountBasis = { totalInWindow: sessions.length, kept, setAside };

  return {
    projectId: "t1anl-project",
    window: FIXTURE_WINDOW,
    connectionState: T1ANL_CONNECTION_STATE,
    sessions,
    basis,
    coverage,
  };
}

/** The corpus coverage claim used wherever it is not itself under test. */
const HONEST_CLAIM: DetectorCoverage = { truncated: false, eventsWithoutUrlPath: 0 };

/** Every exclusion reason that is NOT `"none"`, enumerated from the schema
 * rather than hand-listed — a sixth reason is in scope the moment it is added,
 * which is how FR-7 stays total. */
const SET_ASIDE_REASONS: readonly ExclusionReason[] = exclusionReasonSchema.options.filter(
  (reason) => reason !== "none",
);

// ---------------------------------------------------------------------------

describe("analysedSessions — FR-7, the analysed set", () => {
  // Non-vacuity for the sweep below: the enumeration must not be empty, or
  // every "no set-aside session survives" claim in this file is about nothing.
  test("should enumerate at least one set-aside reason to filter", () => {
    expect(SET_ASIDE_REASONS.length).toBeGreaterThan(0);
    expect(SET_ASIDE_REASONS).not.toContain("none");
  });

  test("should keep only exclusion_reason 'none' and drop every other reason", () => {
    const sessions = [
      t1anlSession({
        key: "kept-1",
        exclusionReason: "none",
        urlPaths: [T1ANL_SURFACE],
        baseAt: T1ANL_EVENT_AT,
      }),
      ...SET_ASIDE_REASONS.map((reason) =>
        t1anlSession({
          key: `aside-${reason}`,
          exclusionReason: reason,
          urlPaths: [T1ANL_SURFACE],
          baseAt: T1ANL_EVENT_AT,
        }),
      ),
      t1anlSession({
        key: "kept-2",
        exclusionReason: "none",
        urlPaths: [T1ANL_SURFACE],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];

    const { kept } = analysedSessions(t1anlCorpus(sessions, HONEST_CLAIM));

    // NON-VACUITY: the corpus really did carry every set-aside reason, so an
    // empty `kept` would not be an acceptable way to pass this.
    expect(sessions.length).toBe(SET_ASIDE_REASONS.length + 2);
    expect(kept.map((session) => session.sessionId)).toEqual([
      "t1anl-session-kept-1",
      "t1anl-session-kept-2",
    ]);
    // Order is preserved, and the objects are the corpus's own — nothing is
    // rebuilt, so nothing can be quietly reshaped on the way through.
    expect(kept[0]).toBe(sessions[0]);
    expect(kept.every((session) => session.exclusionReason === "none")).toBe(true);
  });

  test("should return no sessions when every session was set aside", () => {
    const sessions = SET_ASIDE_REASONS.map((reason) =>
      t1anlSession({
        key: `all-aside-${reason}`,
        exclusionReason: reason,
        // Null paths, so the coverage assertion below is not vacuously zero:
        // these events WOULD be counted if the filter leaked.
        urlPaths: [null, null],
        baseAt: T1ANL_EVENT_AT,
      }),
    );

    const result = analysedSessions(t1anlCorpus(sessions, HONEST_CLAIM));

    expect(sessions.length).toBeGreaterThan(0);
    expect(result.kept).toEqual([]);
    // A corpus with nothing analysable reports coverage OF NOTHING — never the
    // set-aside sessions' events wearing the analysed population's name.
    expect(result.coverage.eventsWithoutUrlPath).toBe(0);
  });

  test("should return an empty analysed set for an empty corpus rather than throwing", () => {
    const result = analysedSessions(t1anlCorpus([], HONEST_CLAIM));

    expect(result.kept).toEqual([]);
    expect(result.coverage).toEqual({ truncated: false, eventsWithoutUrlPath: 0 });
  });

  test("should keep a session that carries no events at all", () => {
    const sessions = [
      t1anlSession({
        key: "eventless",
        exclusionReason: "none",
        urlPaths: [],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];

    const result = analysedSessions(t1anlCorpus(sessions, HONEST_CLAIM));

    // ES-1's shape one level down: a session with nothing in it was still
    // analysed, and dropping it would understate the population.
    expect(result.kept.map((session) => session.sessionId)).toEqual(["t1anl-session-eventless"]);
    expect(result.coverage.eventsWithoutUrlPath).toBe(0);
  });
});

describe("analysedSessions — coverage.eventsWithoutUrlPath (PL ruling 24)", () => {
  test("should count path-less events over the kept sessions only, never the set-aside ones", () => {
    const sessions = [
      t1anlSession({
        key: "kept-mixed",
        exclusionReason: "none",
        urlPaths: [T1ANL_SURFACE, null, T1ANL_SURFACE],
        baseAt: T1ANL_EVENT_AT,
      }),
      t1anlSession({
        key: "kept-blind",
        exclusionReason: "none",
        urlPaths: [null, null],
        baseAt: T1ANL_EVENT_AT,
      }),
      t1anlSession({
        key: "aside-blind",
        exclusionReason: "internal_domain",
        // FOUR path-less events that must NOT be counted. Without them the
        // assertion below would hold for a function that ignored the filter.
        urlPaths: [null, null, null, null],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];

    const result = analysedSessions(t1anlCorpus(sessions, HONEST_CLAIM));

    // NON-VACUITY, both ways: the set-aside session really does carry more
    // path-less events than the kept ones do, so counting over everything
    // handed in would give 7 rather than 3.
    const allPathless = sessions
      .flatMap((session) => session.events)
      .filter((event) => event.urlPath === null).length;
    expect(allPathless).toBe(7);

    expect(result.coverage.eventsWithoutUrlPath).toBe(3);
    expect(result.coverage.eventsWithoutUrlPath).not.toBe(allPathless);
  });

  test("should not trust the corpus's own eventsWithoutUrlPath and recompute it instead", () => {
    // THE ruling-24 assertion. The corpus CLAIMS a number the sessions do not
    // support; a propagating implementation reports the claim, a recomputing
    // one reports the truth. This is what makes the value provably about what
    // was actually analysed rather than about what someone upstream believed.
    const sessions = [
      t1anlSession({
        key: "recompute-1",
        exclusionReason: "none",
        urlPaths: [null, T1ANL_SURFACE],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];
    const LIE = 99;

    const result = analysedSessions(
      t1anlCorpus(sessions, { truncated: false, eventsWithoutUrlPath: LIE }),
    );

    expect(result.coverage.eventsWithoutUrlPath).toBe(1);
    expect(result.coverage.eventsWithoutUrlPath).not.toBe(LIE);
  });

  test("should count every kept event when no event carries a path at all", () => {
    const sessions = [
      t1anlSession({
        key: "blind-1",
        exclusionReason: "none",
        urlPaths: [null, null, null],
        baseAt: T1ANL_EVENT_AT,
      }),
      t1anlSession({
        key: "blind-2",
        exclusionReason: "none",
        urlPaths: [null],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];

    const result = analysedSessions(t1anlCorpus(sessions, HONEST_CLAIM));

    // The boundary case at 100%: total blindness is REPORTED, not rendered as
    // "nothing to report" (ES-4, BS-4).
    expect(result.coverage.eventsWithoutUrlPath).toBe(4);
    expect(result.kept.flatMap((session) => session.events).length).toBe(4);
  });

  test("should report zero when every kept event carries a path", () => {
    const sessions = [
      t1anlSession({
        key: "sighted-1",
        exclusionReason: "none",
        urlPaths: [T1ANL_SURFACE, T1ANL_SURFACE],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];

    const result = analysedSessions(
      t1anlCorpus(sessions, { truncated: false, eventsWithoutUrlPath: 5 }),
    );

    // The other boundary, and the control for the recompute test above: a
    // corpus over-claiming coverage loss must not make the analysed set look
    // blind either.
    expect(result.coverage.eventsWithoutUrlPath).toBe(0);
  });
});

describe("analysedSessions — coverage.truncated (PL ruling 16)", () => {
  test("should propagate a truncated read rather than recomputing it from the sessions", () => {
    // Truncation is a fact about the READ. Nothing in `sessions` records it, so
    // a recomputed value could only ever be `false` — and a silent truncation
    // reading as "no more events" was O-003's CR-1.
    const sessions = [
      t1anlSession({
        key: "truncated-1",
        exclusionReason: "none",
        urlPaths: [T1ANL_SURFACE],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];

    const result = analysedSessions(
      t1anlCorpus(sessions, { truncated: true, eventsWithoutUrlPath: 0 }),
    );

    expect(result.coverage.truncated).toBe(true);
  });

  test("should propagate an untruncated read, so truncated is a fact and not a constant", () => {
    const sessions = [
      t1anlSession({
        key: "untruncated-1",
        exclusionReason: "none",
        urlPaths: [T1ANL_SURFACE],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];

    const result = analysedSessions(
      t1anlCorpus(sessions, { truncated: false, eventsWithoutUrlPath: 0 }),
    );

    expect(result.coverage.truncated).toBe(false);
  });

  test("should propagate truncated even when every session was set aside", () => {
    // The interaction the two rules could get wrong together: an empty analysed
    // set must not erase the fact that the read was capped.
    const sessions = [
      t1anlSession({
        key: "truncated-aside",
        exclusionReason: "automation_headless",
        urlPaths: [T1ANL_SURFACE],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];

    const result = analysedSessions(
      t1anlCorpus(sessions, { truncated: true, eventsWithoutUrlPath: 0 }),
    );

    expect(result.kept).toEqual([]);
    expect(result.coverage).toEqual({ truncated: true, eventsWithoutUrlPath: 0 });
  });
});

describe("analysedSessions — purity (FR-5)", () => {
  test("should not mutate the corpus it was handed", () => {
    const sessions = [
      t1anlSession({
        key: "pure-kept",
        exclusionReason: "none",
        urlPaths: [T1ANL_SURFACE, null],
        baseAt: T1ANL_EVENT_AT,
      }),
      t1anlSession({
        key: "pure-aside",
        exclusionReason: "automation_known_agent",
        urlPaths: [null],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];
    const corpus = t1anlCorpus(sessions, { truncated: true, eventsWithoutUrlPath: 42 });
    const before = structuredClone(corpus);

    const first = analysedSessions(corpus);
    const second = analysedSessions(corpus);

    expect(corpus).toEqual(before);
    // Deterministic: same input, same answer, every time.
    expect(second).toEqual(first);
    expect(first.coverage).toEqual({ truncated: true, eventsWithoutUrlPath: 1 });
  });
});
