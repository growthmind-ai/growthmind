import { FINDING_EVIDENCE_MAX_ITEMS } from "@growthmind/shared";
import type { FindingEvidence } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { CountBasis, MeasuredCount } from "../../src/counts/measured-count";
import { measuredCount } from "../../src/counts/measured-count";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { evidenceSignalKindSchema, evidenceSignalSchema } from "../../src/evidence/signals";
import { toFindingEvidence } from "../../src/fixes/finding-evidence";

const WINDOW = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
} as const;

const KEPT = 20;

const BASIS: CountBasis = { totalInWindow: KEPT, kept: KEPT, setAside: [], keptUnchecked: 0 };

const CORRELATED_EVENT = "t1fe_exception_correlated";
const UNCORRELATED_EVENT = "t1fe_exception_loose";
const RATE_DROP_EVENT = "t1fe_step_viewed";

const STRUGGLE_SURFACE = "/t1fe/checkout";
const CLEAN_EXIT_SURFACE = "/t1fe/pricing";

function countOf(numerator: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: KEPT,
    unit: "sessions",
    timeframe: { start: WINDOW.start, end: WINDOW.end },
    basis: BASIS,
  });
}

function oneSignalOfEveryKind(): readonly EvidenceSignal[] {
  return [
    {
      kind: "failure_correlated",
      eventName: CORRELATED_EVENT,
      occurredAt: WINDOW.start,
      precedingActionName: "t1fe_save_clicked",
      correlationWindowMs: 5_000,
      correlatedSessions: countOf(4),
    },
    { kind: "failure_uncorrelated", eventName: UNCORRELATED_EVENT, occurredAt: WINDOW.start },
    {
      kind: "struggle",
      subkind: "repeated_attempt",
      surface: STRUGGLE_SURFACE,
      attempts: 3,
      strugglingSessions: countOf(5),
    },
    { kind: "clean_exit", surface: CLEAN_EXIT_SURFACE },
    {
      kind: "instrumentation_rate_drop",
      eventName: RATE_DROP_EVENT,
      observed: countOf(1),
      expected: countOf(KEPT),
    },
  ];
}

const EVERY_ARM_MAPPED: readonly FindingEvidence[] = [
  { kind: "event", label: CORRELATED_EVENT, url: null },
  { kind: "event", label: UNCORRELATED_EVENT, url: null },
  { kind: "funnel_step", label: STRUGGLE_SURFACE, url: null },
  { kind: "funnel_step", label: CLEAN_EXIT_SURFACE, url: null },
  { kind: "event", label: RATE_DROP_EVENT, url: null },
];

const OBSERVED_STRUGGLE_SURFACE = "/t1fe/signup";
const OBSERVED_SUBKIND = "rage_click";

// TODO(O-041 D-7): drop the `unknown` shape once struggleSubkindSchema covers the observed
// subkinds; evidenceSignalSchema is the boundary that has to accept one.
function observedStruggleSignal(): unknown {
  return {
    kind: "struggle",
    subkind: OBSERVED_SUBKIND,
    surface: OBSERVED_STRUGGLE_SURFACE,
    attempts: 4,
    strugglingSessions: countOf(6),
  };
}

function distinctCleanExits(howMany: number): readonly EvidenceSignal[] {
  return Array.from({ length: howMany }, (_unused, index): EvidenceSignal => {
    return { kind: "clean_exit", surface: `/t1fe/step-${String(index).padStart(3, "0")}` };
  });
}

describe("toFindingEvidence", () => {
  test("derives one evidence row per distinct observation", () => {
    const signals = oneSignalOfEveryKind();

    expect(signals.map((signal) => signal.kind).toSorted()).toEqual(
      [...evidenceSignalKindSchema.options].toSorted(),
    );

    expect(toFindingEvidence(signals)).toEqual([...EVERY_ARM_MAPPED]);

    expect(toFindingEvidence([...signals, ...signals])).toEqual([...EVERY_ARM_MAPPED]);

    const overflowing = distinctCleanExits(FINDING_EVIDENCE_MAX_ITEMS + 4);
    expect(toFindingEvidence(overflowing)).toHaveLength(FINDING_EVIDENCE_MAX_ITEMS);
  });

  test("derives no evidence from a finding with no signals", () => {
    expect(toFindingEvidence([])).toEqual([]);
  });

  test("should build fix-spec evidence for an observed struggle signal without throwing", () => {
    const signal: EvidenceSignal = evidenceSignalSchema.parse(observedStruggleSignal());

    expect(toFindingEvidence([signal])).toEqual([
      { kind: "funnel_step", label: OBSERVED_STRUGGLE_SURFACE, url: null },
    ]);
  });
});
