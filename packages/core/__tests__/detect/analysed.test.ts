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

const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

const T1ANL_EVENT_AT = new Date("2026-06-04T12:00:00.000Z");

function after(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() + offsetMs);
}

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

  const basis: CountBasis = {
    totalInWindow: sessions.length,
    kept,
    setAside,
    keptUnchecked: 0,
  };

  return {
    projectId: "t1anl-project",
    window: FIXTURE_WINDOW,
    connectionState: T1ANL_CONNECTION_STATE,
    sessions,
    basis,
    coverage,
  };
}

const HONEST_CLAIM: DetectorCoverage = { truncated: false, eventsWithoutUrlPath: 0 };

const SET_ASIDE_REASONS: readonly ExclusionReason[] = exclusionReasonSchema.options.filter(
  (reason) => reason !== "none",
);

describe("analysedSessions —, the analysed set", () => {
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

    expect(sessions.length).toBe(SET_ASIDE_REASONS.length + 2);
    expect(kept.map((session) => session.sessionId)).toEqual([
      "t1anl-session-kept-1",
      "t1anl-session-kept-2",
    ]);

    expect(kept[0]).toBe(sessions[0]);
    expect(kept.every((session) => session.exclusionReason === "none")).toBe(true);
  });

  test("should return no sessions when every session was set aside", () => {
    const sessions = SET_ASIDE_REASONS.map((reason) =>
      t1anlSession({
        key: `all-aside-${reason}`,
        exclusionReason: reason,

        urlPaths: [null, null],
        baseAt: T1ANL_EVENT_AT,
      }),
    );

    const result = analysedSessions(t1anlCorpus(sessions, HONEST_CLAIM));

    expect(sessions.length).toBeGreaterThan(0);
    expect(result.kept).toEqual([]);

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

        urlPaths: [null, null, null, null],
        baseAt: T1ANL_EVENT_AT,
      }),
    ];

    const result = analysedSessions(t1anlCorpus(sessions, HONEST_CLAIM));

    const allPathless = sessions
      .flatMap((session) => session.events)
      .filter((event) => event.urlPath === null).length;
    expect(allPathless).toBe(7);

    expect(result.coverage.eventsWithoutUrlPath).toBe(3);
    expect(result.coverage.eventsWithoutUrlPath).not.toBe(allPathless);
  });

  test("should not trust the corpus's own eventsWithoutUrlPath and recompute it instead", () => {
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

    expect(result.coverage.eventsWithoutUrlPath).toBe(0);
  });
});

describe("analysedSessions — coverage.truncated (PL ruling 16)", () => {
  test("should propagate a truncated read rather than recomputing it from the sessions", () => {
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

describe("analysedSessions — purity", () => {
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

    expect(second).toEqual(first);
    expect(first.coverage).toEqual({ truncated: true, eventsWithoutUrlPath: 1 });
  });
});
