import type { ConnectionState, ConnectionSummary } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { detectFunnelDropoff } from "../../src/detect/funnel-dropoff";
// This import is the Wave 0 red: funnel-dropoff-cohorts.ts does not exist yet (ADD Decision 2).
import { funnelDropoffCohorts } from "../../src/detect/funnel-dropoff-cohorts";
import type { DetectorCorpus, DetectorCoverage, SessionTimeline, TimelineEvent } from "../../src/detect/types";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

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

const PROJECT_ID = "prj-t04-funnel-dropoff-cohorts";
const ORIGIN = "/pricing";
const DESTINATION = "/checkout";

const NORMALISATION_VERSION = 1;
const EVENT_NAMES: readonly string[] = ["step_a", "step_b", "step_c"];

const KEPT_AT_ORIGIN = 30;
const KEPT_DROPPED = 18;
const KEPT_CONVERTED = KEPT_AT_ORIGIN - KEPT_DROPPED;

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

function connectionSummary(): ConnectionSummary {
  return {
    id: "conn-t04-funnel-dropoff-cohorts",
    organizationId: "org-t04-funnel-dropoff-cohorts",
    projectId: PROJECT_ID,
    sourceKind: "posthog",
    host: "https://eu.posthog.invalid",
    sourceProjectId: "77004",
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
}

const CONNECTED_RECEIVING: ConnectionState = {
  status: "connected_receiving",
  connection: connectionSummary(),
};

type SessionSpec = {
  readonly sessionId: string;
  readonly startedAt: Date;
  readonly paths: readonly string[];
};

function sessionTimeline(spec: SessionSpec): SessionTimeline {
  const events: readonly TimelineEvent[] = spec.paths.map((urlPath, index) => ({
    sourceEventId: `${spec.sessionId}-e${String(index).padStart(3, "0")}`,
    name: EVENT_NAMES[index % EVENT_NAMES.length],
    occurredAt: new Date(spec.startedAt.getTime() + index * EVENT_STRIDE_MS),
    urlPath,

    urlPathNormalisationVersion: NORMALISATION_VERSION,
  }));

  return {
    sessionId: spec.sessionId,
    startedAt: spec.startedAt,
    exclusionReason: "none",
    entryUrlPath: spec.paths[0] ?? null,
    events,
  };
}

function cohort(input: {
  readonly idPrefix: string;
  readonly count: number;
  readonly paths: readonly string[];
  readonly firstStartedAt: Date;
}): readonly SessionTimeline[] {
  const sessions: SessionTimeline[] = [];
  for (let index = 0; index < input.count; index += 1) {
    sessions.push(
      sessionTimeline({
        sessionId: `${input.idPrefix}-${String(index).padStart(3, "0")}`,
        startedAt: new Date(input.firstStartedAt.getTime() + index * SESSION_STRIDE_MS),
        paths: input.paths,
      }),
    );
  }
  return sessions;
}

function coverageOf(sessions: readonly SessionTimeline[]): DetectorCoverage {
  let eventsWithoutUrlPath = 0;
  for (const session of sessions) {
    for (const event of session.events) {
      if (event.urlPath === null) eventsWithoutUrlPath += 1;
    }
  }
  return { truncated: false, eventsWithoutUrlPath };
}

// Placeholder mirroring ADD Decision 2's contract for packages/core/src/detect/funnel-dropoff-cohorts.ts
// (not built yet — this Wave 0 test's import below is expected to fail to resolve). Typing the
// call site with this shape keeps the rest of the test from cascading into `any`-inference noise.
type FunnelDropoffCohort = {
  readonly origin: string;
  readonly succeeded: readonly SessionTimeline[];
  readonly failed: readonly SessionTimeline[];
};

function firingCorpus(): DetectorCorpus {
  const sessions: readonly SessionTimeline[] = [
    ...cohort({
      idPrefix: "kept-converted",
      count: KEPT_CONVERTED,
      paths: [ORIGIN, DESTINATION],
      firstStartedAt: cohortStart(0),
    }),
    ...cohort({
      idPrefix: "kept-dropped",
      count: KEPT_DROPPED,
      paths: [ORIGIN],
      firstStartedAt: cohortStart(1),
    }),
  ];

  return {
    projectId: PROJECT_ID,
    window: { start: WINDOW_START, end: WINDOW_END },
    connectionState: CONNECTED_RECEIVING,
    sessions,
    basis: {
      totalInWindow: sessions.length,
      kept: sessions.length,
      keptUnchecked: 0,
      setAside: [],
    },
    coverage: coverageOf(sessions),
  };
}

describe("funnelDropoffCohorts", () => {
  test("returns the same candidate-qualifying surfaces as detectFunnelDropoff, with session identity preserved", () => {
    const corpus = firingCorpus();
    const rules = ruleSetV1();

    const result = detectFunnelDropoff(corpus, rules);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];

    const atOriginCount = candidate.counts.find((count) => count.numerator === KEPT_AT_ORIGIN);
    const droppedCount = candidate.counts.find((count) => count.numerator === KEPT_DROPPED);
    if (!atOriginCount || !droppedCount) {
      throw new Error("fixture must produce both an atOrigin and a dropped MeasuredCount");
    }

    const cohorts: readonly FunnelDropoffCohort[] = funnelDropoffCohorts(corpus, rules);

    expect(cohorts).toHaveLength(1);
    const cohortForOrigin = cohorts[0];

    expect(cohortForOrigin.origin).toBe(candidate.surface);

    // Cohort sizes must match detectFunnelDropoff's own atOrigin/dropped counts exactly —
    // the two must never be able to drift, per ADD Decision 2.
    expect(cohortForOrigin.succeeded.length + cohortForOrigin.failed.length).toBe(
      atOriginCount.numerator,
    );
    expect(cohortForOrigin.failed.length).toBe(droppedCount.numerator);
    expect(cohortForOrigin.succeeded.length).toBe(KEPT_CONVERTED);

    // Every session must carry its real sessionId, not just a bare url_path walk —
    // this is the exact gap: today's `sessionWalk` discards identity down to `string[]`.
    for (const session of [...cohortForOrigin.succeeded, ...cohortForOrigin.failed]) {
      expect(typeof session.sessionId).toBe("string");
      expect(session.sessionId.length).toBeGreaterThan(0);
    }

    const failedIds = new Set(cohortForOrigin.failed.map((session) => session.sessionId));
    const succeededIds = new Set(cohortForOrigin.succeeded.map((session) => session.sessionId));
    expect(failedIds.size).toBe(cohortForOrigin.failed.length);
    expect(succeededIds.size).toBe(cohortForOrigin.succeeded.length);

    for (const id of failedIds) {
      expect(id.startsWith("kept-dropped-")).toBe(true);
    }
    for (const id of succeededIds) {
      expect(id.startsWith("kept-converted-")).toBe(true);
    }
  });
});
