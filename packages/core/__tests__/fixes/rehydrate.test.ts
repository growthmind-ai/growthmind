import { describe, expect, test } from "bun:test";

import type { CountBasis, MeasuredCount } from "../../src/counts/measured-count";
import { isMeasuredCount, measuredCount } from "../../src/counts/measured-count";
import type { AnalysisWindow, DetectorCoverage } from "../../src/detect/types";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { traceEntry } from "../../src/evidence/trace";
import type { CandidateFinding } from "../../src/findings/candidate";
import { candidateFindingSchema } from "../../src/findings/candidate";
import type { FixSpecInput } from "../../src/fixes/fix-spec";
import { renderFixSpec } from "../../src/fixes/fix-spec";
import {
  FIX_SPEC_PAYLOAD_VERSION,
  UnknownFixSpecPayloadVersionError,
  rehydrateFixSpecInput,
  serialiseFixSpecInput,
  toMeasuredCount,
} from "../../src/fixes/rehydrate";

const WINDOW: AnalysisWindow = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

const CORRELATED_AT = new Date("2026-06-03T09:30:00.000Z");
const UNCORRELATED_AT = new Date("2026-06-04T11:15:00.000Z");

const SURFACE = "/t1rh/pricing";

const REACHED = 30;
const LEFT = 14;

const CLEAN_COVERAGE: DetectorCoverage = { truncated: false, eventsWithoutUrlPath: 0 };

const BASIS: CountBasis = { totalInWindow: REACHED, kept: REACHED, setAside: [], keptUnchecked: 0 };

function countOf(numerator: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: REACHED,
    unit: "sessions",
    timeframe: { start: WINDOW.start, end: WINDOW.end },
    basis: BASIS,
  });
}

function candidateOf(): CandidateFinding {
  return candidateFindingSchema.parse({
    detector: "funnel_dropoff",
    claimedClass: "confusing",
    finalClass: "confusing",
    trace: [
      traceEntry({
        class: "confusing",
        predicate: "confusing_t1rh",
        predicateVersion: 1,
        satisfied: true,
      }),
    ],
    counts: [countOf(REACHED), countOf(LEFT)],
    timeframe: WINDOW,
    claimSubject: "surface",
    surface: SURFACE,
    surfaceNormalisationVersion: 1,
    evidenceShape: "t1rh-evidence-shape",
    evidenceShapeVersion: 1,
    thresholdRuleSetVersion: 1,
    ranking: { sampleSize: countOf(REACHED), confidenceBasis: "threshold_met" },
    coverage: CLEAN_COVERAGE,
  });
}

function signalsOf(): readonly EvidenceSignal[] {
  return [
    {
      kind: "failure_correlated",
      eventName: "t1rh_exception",
      occurredAt: CORRELATED_AT,
      precedingActionName: "t1rh_save_clicked",
      correlationWindowMs: 5_000,
      correlatedSessions: countOf(6),
    },
    {
      kind: "failure_uncorrelated",
      eventName: "t1rh_exception_loose",
      occurredAt: UNCORRELATED_AT,
    },
    {
      kind: "struggle",
      subkind: "repeated_attempt",
      surface: SURFACE,
      attempts: 3,
      strugglingSessions: countOf(9),
    },
    { kind: "clean_exit", surface: SURFACE },
    {
      kind: "instrumentation_rate_drop",
      eventName: "t1rh_step_viewed",
      observed: countOf(2),
      expected: countOf(REACHED),
    },
  ];
}

function fixSpecInputOf(): FixSpecInput {
  return { candidate: candidateOf(), signals: signalsOf() };
}

function persistedPayloadOf(): unknown {
  return JSON.parse(JSON.stringify(serialiseFixSpecInput(fixSpecInputOf())));
}

const SRC_DIR = `${import.meta.dir}/../../src`.replaceAll("\\", "/");
const SIGNALS_SOURCE = `${SRC_DIR}/evidence/signals.ts`;
const REHYDRATE_SOURCE = `${SRC_DIR}/fixes/rehydrate.ts`;

const UNDECLARED_SUBKIND = "probe_only";
const OBSERVED_SUBKIND_CONTROL = "rage_click";

// TODO(O-041 D-7): replace this deferred load with static imports of struggleSubkindSchema
// and observedStruggleSubkindSchema once src/evidence/signals.ts declares them.
type SubkindEnum = { readonly options?: readonly string[] };

type DeclaredSubkinds = {
  readonly declared: readonly string[];
  readonly observed: readonly string[];
};

async function declaredStruggleSubkinds(): Promise<DeclaredSubkinds> {
  const loaded = (await import(SIGNALS_SOURCE)) as {
    readonly struggleSubkindSchema?: SubkindEnum;
    readonly observedStruggleSubkindSchema?: SubkindEnum;
  };

  const declared = loaded.struggleSubkindSchema?.options;
  if (declared === undefined || declared.length === 0) {
    throw new Error(
      "src/evidence/signals.ts must export struggleSubkindSchema — the one declaration of the " +
        "struggle subkind union (O-041 D-7)",
    );
  }

  const observed = loaded.observedStruggleSubkindSchema?.options;
  if (observed === undefined || observed.length === 0) {
    throw new Error(
      "src/evidence/signals.ts must export observedStruggleSubkindSchema (O-041 D-7)",
    );
  }

  const outside = observed.filter((subkind) => !declared.includes(subkind));
  if (outside.length > 0) {
    throw new Error(
      `every observed subkind must be a member of struggleSubkindSchema; ` +
        `${outside.join(", ")} is not (O-041 D-7)`,
    );
  }

  return { declared, observed };
}

type PersistedPayload = {
  readonly payloadVersion: number;
  readonly candidate: unknown;
  readonly signals: readonly Record<string, unknown>[];
};

function payloadWithStruggleSubkind(subkind: string): unknown {
  const payload = persistedPayloadOf() as PersistedPayload;

  return {
    ...payload,
    signals: payload.signals.map((signal) =>
      signal.kind === "struggle" ? { ...signal, subkind } : signal,
    ),
  };
}

function rehydratedStruggleSubkinds(payload: unknown): readonly string[] {
  const { signals } = rehydrateFixSpecInput(payload);
  return signals.filter((signal) => signal.kind === "struggle").map((signal) => signal.subkind);
}

type CountSite = { readonly site: string; readonly count: MeasuredCount };

function countSitesIn(input: FixSpecInput): readonly CountSite[] {
  const sites: CountSite[] = input.candidate.counts.map((count, index) => ({
    site: `candidate.counts[${String(index)}]`,
    count,
  }));
  sites.push({ site: "candidate.ranking.sampleSize", count: input.candidate.ranking.sampleSize });

  for (const signal of input.signals) {
    if (signal.kind === "failure_correlated") {
      sites.push({
        site: "failure_correlated.correlatedSessions",
        count: signal.correlatedSessions,
      });
    }
    if (signal.kind === "struggle") {
      sites.push({ site: "struggle.strugglingSessions", count: signal.strugglingSessions });
    }
    if (signal.kind === "instrumentation_rate_drop") {
      sites.push({ site: "instrumentation_rate_drop.observed", count: signal.observed });
      sites.push({ site: "instrumentation_rate_drop.expected", count: signal.expected });
    }
  }

  return sites;
}

const EXPECTED_COUNT_SITES: readonly string[] = [
  "candidate.counts[0]",
  "candidate.counts[1]",
  "candidate.ranking.sampleSize",
  "failure_correlated.correlatedSessions",
  "struggle.strugglingSessions",
  "instrumentation_rate_drop.observed",
  "instrumentation_rate_drop.expected",
];

type DateSite = { readonly site: string; readonly value: Date };

function dateSitesIn(input: FixSpecInput): readonly DateSite[] {
  const sites: DateSite[] = [
    { site: "candidate.timeframe.start", value: input.candidate.timeframe.start },
    { site: "candidate.timeframe.end", value: input.candidate.timeframe.end },
  ];

  for (const { site, count } of countSitesIn(input)) {
    sites.push({ site: `${site}.timeframe.start`, value: count.timeframe.start });
    sites.push({ site: `${site}.timeframe.end`, value: count.timeframe.end });
  }

  for (const signal of input.signals) {
    if (signal.kind === "failure_correlated" || signal.kind === "failure_uncorrelated") {
      sites.push({ site: `${signal.kind}.occurredAt`, value: signal.occurredAt });
    }
  }

  return sites;
}

function notDates(sites: readonly DateSite[]): readonly string[] {
  return sites.filter((entry) => !(entry.value instanceof Date)).map((entry) => entry.site);
}

describe("the fix-spec payload boundary", () => {
  test("rejects a JSON round-tripped candidate before the count is re-minted", () => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(candidateOf()));

    const counts = (roundTripped as { readonly counts: readonly unknown[] }).counts;
    expect(counts).toHaveLength(2);
    expect(isMeasuredCount(counts[0])).toBe(false);

    const parsed = candidateFindingSchema.safeParse(roundTripped);

    expect(parsed.success).toBe(false);

    const issues = parsed.success ? [] : parsed.error.issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.path).toEqual(["counts", 0]);
  });

  test("re-mints a persisted count so renderFixSpec accepts it", () => {
    const persistedCount: unknown = JSON.parse(JSON.stringify(countOf(LEFT)));
    expect(isMeasuredCount(persistedCount)).toBe(false);
    expect(isMeasuredCount(toMeasuredCount(persistedCount))).toBe(true);

    const input = fixSpecInputOf();
    const rehydrated = rehydrateFixSpecInput(persistedPayloadOf());

    expect(renderFixSpec(rehydrated).sentences).toEqual(renderFixSpec(input).sentences);
  });

  test("coerces every persisted date inside a fix-spec payload", () => {
    const rehydrated = rehydrateFixSpecInput(persistedPayloadOf());
    const sites = dateSitesIn(rehydrated);
    const named = sites.map((entry) => entry.site);

    expect(named).toContain("candidate.timeframe.start");
    expect(named).toContain("candidate.counts[0].timeframe.end");
    expect(named).toContain("failure_correlated.occurredAt");
    expect(named).toContain("failure_uncorrelated.occurredAt");

    expect(notDates(sites)).toEqual([]);
    expect(sites.filter((entry) => Number.isNaN(entry.value.getTime())).map((e) => e.site)).toEqual(
      [],
    );

    expect(rehydrated.candidate.timeframe.start).toEqual(WINDOW.start);
    expect(sites.find((entry) => entry.site === "failure_correlated.occurredAt")?.value).toEqual(
      CORRELATED_AT,
    );
    expect(sites.find((entry) => entry.site === "failure_uncorrelated.occurredAt")?.value).toEqual(
      UNCORRELATED_AT,
    );
  });

  test("re-mints every measured count inside a fix-spec payload", () => {
    const rehydrated = rehydrateFixSpecInput(persistedPayloadOf());
    const sites = countSitesIn(rehydrated);

    expect(sites.map((entry) => entry.site)).toEqual([...EXPECTED_COUNT_SITES]);

    const unbranded = sites
      .filter((entry) => !isMeasuredCount(entry.count))
      .map((entry) => entry.site);
    expect(unbranded).toEqual([]);
  });

  test("refuses a payload written under an unknown version rather than reinterpreting it", () => {
    const persisted = persistedPayloadOf() as {
      readonly candidate: unknown;
      readonly signals: readonly unknown[];
    };
    const unknownVersion = FIX_SPEC_PAYLOAD_VERSION + 1;

    let thrown: unknown = null;
    try {
      rehydrateFixSpecInput({
        payloadVersion: unknownVersion,
        candidate: persisted.candidate,
        signals: persisted.signals,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnknownFixSpecPayloadVersionError);

    const refusal = thrown as UnknownFixSpecPayloadVersionError;
    expect(refusal.payloadVersion).toBe(unknownVersion);
    expect(refusal.message).toBe(new UnknownFixSpecPayloadVersionError(unknownVersion).message);
  });
});

describe("the struggle subkind persistence boundary", () => {
  test("should rehydrate a struggle signal of every declared subkind", async () => {
    const { declared } = await declaredStruggleSubkinds();

    const roundTripped = declared.map((subkind) =>
      rehydratedStruggleSubkinds(payloadWithStruggleSubkind(subkind)),
    );

    expect(roundTripped).toEqual(declared.map((subkind) => [subkind]));
  });

  test("should reject a persisted struggle signal whose subkind is not declared", () => {
    expect(() => rehydrateFixSpecInput(payloadWithStruggleSubkind(UNDECLARED_SUBKIND))).toThrow();

    expect(
      rehydratedStruggleSubkinds(payloadWithStruggleSubkind(OBSERVED_SUBKIND_CONTROL)),
    ).toEqual([OBSERVED_SUBKIND_CONTROL]);
  });

  test("should not re-declare the struggle subkind list outside signals.ts", async () => {
    const source = await Bun.file(REHYDRATE_SOURCE).text();

    expect(source).toContain("persistedSignalSchema");
    expect(source).toContain("struggleSubkindSchema");
    expect(source).not.toContain("repeated_attempt");
  });
});
