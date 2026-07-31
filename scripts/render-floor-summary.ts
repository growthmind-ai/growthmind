#!/usr/bin/env bun
/**
 * Prints one floor summary so a human can read what this product will actually
 * say (O-005 FR-F14).
 *
 * THE CANDIDATE BELOW IS HAND-BUILT FOR ILLUSTRATION. It is NOT detector
 * output, it did not come from a real project, and none of its numbers were
 * measured — they are chosen to be legible. What is real is everything after
 * it: the sentences are produced by the same `renderFloorSummary` the product
 * calls, from the same fixed templates, with no model involved.
 *
 * WHY THIS SCRIPT EXISTS. Every other check on this vocabulary is mechanical —
 * a scanner, a denylist, a compile pin. None of them can tell you whether the
 * result reads like something a person would write. That judgement is a human's
 * and it needs the text in front of them, which is what this prints.
 *
 * NO DB, NO NETWORK, NO ENV VAR, NO MODEL. This reads nothing and calls
 * nothing outside `@growthmind/core`.
 *
 * Usage:
 *   bun scripts/render-floor-summary.ts
 */
// Imported by RELATIVE PATH, not by package specifier: the repo root does not
// depend on `@growthmind/core`, and adding a root dependency to print a
// sentence would be a real change to the dependency graph for a dry-run tool.
// This resolves the same barrel the package's own consumers import.
import {
  candidateFindingSchema,
  EVIDENCE_SHAPE_VERSION,
  measuredCount,
  renderFloorSummary,
  traceEntry,
} from "../packages/core/src/index";

/** A fixed window, stated as dates. Nothing here reads a clock — the same
 * invocation prints the same text forever. */
const WINDOW = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

/** 260 sessions arrived, 20 were set aside as internal traffic, so every count
 * below is out of the 240 that were kept. */
const BASIS = {
  totalInWindow: 260,
  kept: 240,
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

// Parsed through the real contract, so this illustration cannot drift into a
// shape the renderer would never be handed.
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
