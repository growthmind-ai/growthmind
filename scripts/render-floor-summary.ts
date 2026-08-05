#!/usr/bin/env bun

import {
  candidateFindingSchema,
  EVIDENCE_SHAPE_VERSION,
  measuredCount,
  renderFloorSummary,
  traceEntry,
} from "../packages/core/src/index";

const WINDOW = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

const BASIS = {
  totalInWindow: 260,
  kept: 240,
  keptUnchecked: 0,
  setAside: [{ reason: "internal_domain" as const, count: 20, label: "internal traffic" }],
};

const reachedSurface = measuredCount({
  numerator: 87,
  denominator: 240,
  unit: "sessions",
  timeframe: WINDOW,
  basis: BASIS,
});

const leftWithoutContinuing = measuredCount({
  numerator: 61,
  denominator: 240,
  unit: "sessions",
  timeframe: WINDOW,
  basis: BASIS,
});

const candidate = candidateFindingSchema.parse({
  detector: "funnel_dropoff",
  claimedClass: "confusing",
  finalClass: "confusing",
  trace: [
    traceEntry({
      class: "confusing",
      predicate: "confusing_struggle",
      predicateVersion: 1,
      satisfied: true,
    }),
  ],
  counts: [reachedSurface, leftWithoutContinuing],
  timeframe: WINDOW,
  claimSubject: "surface",
  surface: "/pricing",
  surfaceNormalisationVersion: 1,
  evidenceShape: "illustrative-evidence-shape",
  evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
  thresholdRuleSetVersion: 1,
  ranking: { sampleSize: reachedSurface, confidenceBasis: "threshold_met" },
  coverage: { truncated: false, eventsWithoutUrlPath: 0 },
});

const summary = renderFloorSummary({ candidate, source: "floor_no_key_configured" });

process.stdout.write(`${summary.headline}\n`);
for (const line of summary.context) {
  process.stdout.write(`${line}\n`);
}
