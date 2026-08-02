import { describe, expect, test } from "bun:test";

import { redactSecrets, type RedactionSecrets } from "../lib/redact";
import {
  BROWSER_ORIGIN_LIBS_V1,
  CURRENT_REPRESENTATIVENESS_RULES,
  MINIMUM_BROWSER_ORIGINATED_EVENTS_V1,
  REPRESENTATIVENESS_RULES_VERSION,
  VOCABULARY_ROWS,
  buildEventNameHistogram,
  buildVocabularyReport,
  formatVerdictLine,
  isBrowserOriginated,
  judgeRepresentativeness,
  toObservedEvents,
  verdictForRow,
  type NonRepresentativeSample,
  type ObservedEvent,
  type RepresentativenessRules,
  type RowVerdict,
  type VocabularyRow,
} from "../lib/t1-vocabulary";

const T0 = new Date("2026-06-01T09:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

function observed(name: string, lib: string | null, offsetMs: number): ObservedEvent {
  return { name, lib, occurredAt: at(offsetMs) };
}

function eventsNamed(
  count: number,
  name: string,
  lib: string | null,
  firstOffsetMs: number,
): readonly ObservedEvent[] {
  return Array.from({ length: count }, (_unused, index) =>
    observed(name, lib, firstOffsetMs + index * 1_000),
  );
}

const SYNTHETIC_LIB = "gm-shape-probe";

const SYNTHETIC_CORPUS: readonly ObservedEvent[] = [
  ...eventsNamed(177, "gm_shape_probe", SYNTHETIC_LIB, 0),
  ...eventsNamed(20, "$exception", SYNTHETIC_LIB, 200_000),
  ...eventsNamed(1, "$identify", SYNTHETIC_LIB, 300_000),
  ...eventsNamed(22, "gm_spike_marker", null, 400_000),
];

const BROWSER_LIB = BROWSER_ORIGIN_LIBS_V1[0] ?? "web";

function browserCorpus(browserEventCount: number): readonly ObservedEvent[] {
  return [
    ...eventsNamed(browserEventCount, "product_viewed", BROWSER_LIB, 0),

    ...eventsNamed(5, "gm_shape_probe", SYNTHETIC_LIB, 900_000),
  ];
}

function row(id: string): VocabularyRow {
  const found = VOCABULARY_ROWS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`fixture references an unknown vocabulary row: ${id}`);
  return found;
}

type PresentVerdict = Extract<RowVerdict, { label: "PINNED — present" }>;
type AbsentVerdict = Extract<RowVerdict, { label: "PINNED — absent" }>;
type FailedVerdict = Extract<RowVerdict, { label: "FAILED-TO-PIN" }>;

function asPresent(verdict: RowVerdict): PresentVerdict {
  if (verdict.label !== "PINNED — present") {
    throw new Error(`expected PINNED — present, got ${verdict.label}`);
  }
  return verdict;
}

function asAbsent(verdict: RowVerdict): AbsentVerdict {
  if (verdict.label !== "PINNED — absent") {
    throw new Error(`expected PINNED — absent, got ${verdict.label}`);
  }
  return verdict;
}

function asFailed(verdict: RowVerdict): FailedVerdict {
  if (verdict.label !== "FAILED-TO-PIN") {
    throw new Error(`expected FAILED-TO-PIN, got ${verdict.label}`);
  }
  return verdict;
}

describe("verdictForRow", () => {
  test("should return FAILED-TO-PIN when the sample contains zero browser-originated events", () => {
    expect(SYNTHETIC_CORPUS).toHaveLength(220);

    const histogram = buildEventNameHistogram(SYNTHETIC_CORPUS);
    const gate = judgeRepresentativeness(SYNTHETIC_CORPUS, CURRENT_REPRESENTATIVENESS_RULES);

    expect(gate.kind).toBe("not_representative");
    const verdict = asFailed(verdictForRow(row("A-2"), histogram, gate));
    expect(verdict.basis.reason).toBe("no_browser_originated_events");
    expect(verdict.basis.reason).not.toBe("below_minimum_browser_denominator");

    expect(verdict.denominator).toBe(220);
    expect(verdict.basis.basis.totalEvents).toBe(220);
    expect(verdict.basis.basis.browserOriginatedEvents).toBe(0);
    expect(verdict.basis.basis.minimumBrowserOriginatedEvents).toBe(
      MINIMUM_BROWSER_ORIGINATED_EVENTS_V1,
    );

    for (const id of ["A-3", "A-4", "A-5"]) {
      expect(verdictForRow(row(id), histogram, gate).label).toBe("FAILED-TO-PIN");
    }

    const thinBrowserSample = browserCorpus(3);
    const thinGate = judgeRepresentativeness(thinBrowserSample, CURRENT_REPRESENTATIVENESS_RULES);
    const thinVerdict = asFailed(
      verdictForRow(row("A-2"), buildEventNameHistogram(thinBrowserSample), thinGate),
    );
    expect(thinVerdict.basis.reason).toBe("below_minimum_browser_denominator");

    const nonRepresentativeIsNotAnAbsentBasis: NonRepresentativeSample extends AbsentVerdict["basis"]
      ? false
      : true = true;
    expect(nonRepresentativeIsNotAnAbsentBasis).toBe(true);
  });

  test("should return PINNED — absent only when a representative browser-traffic denominator is met", () => {
    const onBar = browserCorpus(MINIMUM_BROWSER_ORIGINATED_EVENTS_V1);
    const onBarGate = judgeRepresentativeness(onBar, CURRENT_REPRESENTATIVENESS_RULES);
    expect(onBarGate.kind).toBe("representative");
    if (onBarGate.kind !== "representative") {
      throw new Error(`expected a representative sample, got ${onBarGate.reason}`);
    }
    expect(onBarGate.basis.browserOriginatedEvents).toBe(MINIMUM_BROWSER_ORIGINATED_EVENTS_V1);

    const absentBasis: AbsentVerdict["basis"] = onBarGate;
    expect(absentBasis.kind).toBe("representative");

    const absent = asAbsent(verdictForRow(row("A-2"), buildEventNameHistogram(onBar), onBarGate));
    expect(absent.basis.kind).toBe("representative");
    expect(absent.denominator).toBe(onBar.length);

    const belowBar = browserCorpus(MINIMUM_BROWSER_ORIGINATED_EVENTS_V1 - 1);
    const belowBarGate = judgeRepresentativeness(belowBar, CURRENT_REPRESENTATIVENESS_RULES);
    expect(belowBarGate.kind).toBe("not_representative");
    const failed = asFailed(
      verdictForRow(row("A-2"), buildEventNameHistogram(belowBar), belowBarGate),
    );
    expect(failed.basis.reason).toBe("below_minimum_browser_denominator");
  });

  test("should return PINNED — present with the exact observed literal", () => {
    const sample: readonly ObservedEvent[] = [
      ...SYNTHETIC_CORPUS,
      ...eventsNamed(3, "$rageclick", BROWSER_LIB, 500_000),
    ];
    const histogram = buildEventNameHistogram(sample);
    const gate = judgeRepresentativeness(sample, CURRENT_REPRESENTATIVENESS_RULES);
    expect(gate.kind).toBe("not_representative");

    const present = asPresent(verdictForRow(row("A-2"), histogram, gate));

    expect(present.observed).toEqual([{ name: "$rageclick", count: 3 }]);
    expect(present.denominator).toBe(223);
  });

  test("should carry only the observed literal when a row names a family of event names", () => {
    const a3 = row("A-3");
    expect(a3.eventNames).toContain("$dead_click");
    expect(a3.eventNames).toContain("$dead_swipe");

    const sample: readonly ObservedEvent[] = [
      ...browserCorpus(MINIMUM_BROWSER_ORIGINATED_EVENTS_V1),
      ...eventsNamed(2, "$dead_swipe", BROWSER_LIB, 600_000),
    ];
    const gate = judgeRepresentativeness(sample, CURRENT_REPRESENTATIVENESS_RULES);
    const present = asPresent(verdictForRow(a3, buildEventNameHistogram(sample), gate));

    expect(present.observed).toEqual([{ name: "$dead_swipe", count: 2 }]);
    expect(present.observed.map((entry) => entry.name)).not.toContain("$dead_click");
  });
});

describe("isBrowserOriginated", () => {
  test("should not count an unrecognised or absent $lib as browser-originated", () => {
    const rules = CURRENT_REPRESENTATIVENESS_RULES;

    for (const lib of BROWSER_ORIGIN_LIBS_V1) {
      expect(isBrowserOriginated(observed("$pageview", lib, 0), rules)).toBe(true);
    }
    for (const lib of [SYNTHETIC_LIB, "posthog-node", "posthog-python", "web-next", ""]) {
      expect(isBrowserOriginated(observed("$pageview", lib, 0), rules)).toBe(false);
    }
    expect(isBrowserOriginated(observed("$pageview", null, 0), rules)).toBe(false);
  });
});

describe("judgeRepresentativeness", () => {
  test("should fail toward FAILED-TO-PIN when an unrecognised $lib carries most of the sample", () => {
    const rules: RepresentativenessRules = {
      version: CURRENT_REPRESENTATIVENESS_RULES.version,
      browserOriginLibs: CURRENT_REPRESENTATIVENESS_RULES.browserOriginLibs,

      minimumBrowserOriginatedEvents: 10,
    };
    const sample: readonly ObservedEvent[] = [
      ...eventsNamed(55, "checkout_started", "posthog-js-lite-next", 0),
      ...eventsNamed(5, "product_viewed", BROWSER_LIB, 700_000),
    ];

    const gate = judgeRepresentativeness(sample, rules);
    expect(gate.kind).toBe("not_representative");
    if (gate.kind !== "not_representative") throw new Error("expected a non-representative sample");
    expect(gate.reason).toBe("below_minimum_browser_denominator");
    expect(gate.basis.totalEvents).toBe(60);
    expect(gate.basis.browserOriginatedEvents).toBe(5);
    expect(gate.basis.minimumBrowserOriginatedEvents).toBe(10);

    expect(gate.basis.observedLibs).toContain("posthog-js-lite-next");
    expect(gate.basis.observedLibs).toContain(BROWSER_LIB);

    expect(verdictForRow(row("A-2"), buildEventNameHistogram(sample), gate).label).toBe(
      "FAILED-TO-PIN",
    );
  });

  test("should report an absent $lib in observedLibs rather than omitting the event", () => {
    const sample: readonly ObservedEvent[] = [
      ...eventsNamed(4, "gm_spike_marker", null, 0),
      ...eventsNamed(2, "gm_shape_probe", SYNTHETIC_LIB, 100_000),
    ];
    const gate = judgeRepresentativeness(sample, CURRENT_REPRESENTATIVENESS_RULES);

    expect(gate.kind).toBe("not_representative");
    expect(gate.basis.totalEvents).toBe(6);
    expect(gate.basis.browserOriginatedEvents).toBe(0);
    expect(gate.basis.observedLibs).toEqual(["(absent)", SYNTHETIC_LIB]);
  });
});

describe("buildEventNameHistogram", () => {
  test("should build an event-name histogram with its denominator", () => {
    const sample: readonly ObservedEvent[] = [
      observed("$pageview", BROWSER_LIB, 5_000),
      observed("$autocapture", BROWSER_LIB, 3_000),
      observed("$exception", BROWSER_LIB, 2_000),
      observed("gm_spike_marker", null, 4_000),
      observed("$pageview", BROWSER_LIB, 1_000),
      observed("$exception", BROWSER_LIB, 6_000),
      observed("$autocapture", BROWSER_LIB, 7_000),
      observed("$pageview", BROWSER_LIB, 9_000),
      { name: "gm_spike_marker", lib: null, occurredAt: null },
    ];

    const histogram = buildEventNameHistogram(sample);

    expect(histogram.denominator).toBe(9);
    const total = histogram.counts.reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBe(histogram.denominator);

    expect(histogram.counts).toEqual([
      { name: "$pageview", count: 3 },
      { name: "$autocapture", count: 2 },
      { name: "$exception", count: 2 },
      { name: "gm_spike_marker", count: 2 },
    ]);

    const span = histogram.window;
    if (span === null) throw new Error("expected a window over a sample carrying timestamps");
    expect(span.earliest.toISOString()).toBe(at(1_000).toISOString());
    expect(span.latest.toISOString()).toBe(at(9_000).toISOString());
  });

  test("should return a zero denominator and no window for an empty sample", () => {
    const histogram = buildEventNameHistogram([]);
    expect(histogram.denominator).toBe(0);
    expect(histogram.counts).toEqual([]);
    expect(histogram.window).toBeNull();
  });
});

describe("toObservedEvents", () => {
  test("should drop a raw item with no string event name rather than defaulting it", () => {
    const rawItems: readonly unknown[] = [
      { event: "$pageview", properties: { $lib: BROWSER_LIB }, timestamp: at(1_000).toISOString() },
      { event: "$rageclick", properties: {}, timestamp: "not-a-timestamp" },
      { properties: { $lib: BROWSER_LIB }, timestamp: at(2_000).toISOString() },
      { event: 42, properties: { $lib: BROWSER_LIB } },
      { event: null },
      "not an object at all",
      null,
    ];

    const sample = toObservedEvents(rawItems);

    expect(sample.map((event) => event.name)).toEqual(["$pageview", "$rageclick"]);

    const first = sample[0];
    if (first === undefined) throw new Error("expected the first retained event");
    expect(first.lib).toBe(BROWSER_LIB);
    expect(first.occurredAt?.toISOString()).toBe(at(1_000).toISOString());

    const second = sample[1];
    if (second === undefined) throw new Error("expected the second retained event");
    expect(second.lib).toBeNull();
    expect(second.occurredAt).toBeNull();

    expect(buildEventNameHistogram(sample).denominator).toBe(2);
  });
});

describe("buildVocabularyReport", () => {
  test("should judge representativeness once and hold every verdict to that one judgement", () => {
    const report = buildVocabularyReport(
      SYNTHETIC_CORPUS,
      VOCABULARY_ROWS,
      CURRENT_REPRESENTATIVENESS_RULES,
    );

    expect(report.probe).toBe("t1-event-vocabulary");
    expect(report.rulesVersion).toBe(REPRESENTATIVENESS_RULES_VERSION);
    expect(report.histogram.denominator).toBe(SYNTHETIC_CORPUS.length);

    expect(report.representativeness).toEqual(
      judgeRepresentativeness(SYNTHETIC_CORPUS, CURRENT_REPRESENTATIVENESS_RULES),
    );

    expect(report.verdicts.map((verdict) => verdict.row.id)).toEqual(
      VOCABULARY_ROWS.map((vocabularyRow) => vocabularyRow.id),
    );
    for (const verdict of report.verdicts) {
      expect(verdict.denominator).toBe(report.histogram.denominator);
    }

    const a1 = report.verdicts.find((verdict) => verdict.row.id === "A-1");
    if (a1 === undefined) throw new Error("expected a verdict for row A-1");
    expect(asPresent(a1).observed).toEqual([{ name: "$exception", count: 20 }]);
  });
});

const FIXTURE_SECRETS: RedactionSecrets = {
  personalApiKey: "phx_fixtureFIXTUREfixture0123456789",
  projectApiKey: "phc_fixtureFIXTUREfixture0123456789",
  projectId: "9174233",
};

const CUSTOMER_KEY_SHAPED_EVENT = "checkout_phs_A1b2C3d4E5f6G7h8I9j0K1l2";

const CUSTOMER_PROJECT_ID_EVENT = `signup_${FIXTURE_SECRETS.projectId}_step2`;

describe("formatVerdictLine", () => {
  test("should redact identifier-shaped values from every printed line", () => {
    const rows: readonly VocabularyRow[] = [
      {
        id: "R-1",
        claim: "a customer event whose name embeds a key-shaped token",
        eventNames: [CUSTOMER_KEY_SHAPED_EVENT],
      },
      {
        id: "R-2",
        claim: "a customer event whose name embeds the project id",
        eventNames: [CUSTOMER_PROJECT_ID_EVENT],
      },
      row("A-2"),
    ];
    const sample: readonly ObservedEvent[] = [
      ...eventsNamed(2, CUSTOMER_KEY_SHAPED_EVENT, BROWSER_LIB, 0),
      ...eventsNamed(3, CUSTOMER_PROJECT_ID_EVENT, BROWSER_LIB, 100_000),
      ...eventsNamed(4, "gm_shape_probe", SYNTHETIC_LIB, 200_000),
    ];

    const report = buildVocabularyReport(sample, rows, CURRENT_REPRESENTATIVENESS_RULES);
    const rawLines = report.verdicts.map(formatVerdictLine);
    expect(rawLines).toHaveLength(3);

    expect(rawLines.some((line) => line.includes(CUSTOMER_KEY_SHAPED_EVENT))).toBe(true);
    expect(rawLines.some((line) => line.includes(CUSTOMER_PROJECT_ID_EVENT))).toBe(true);

    for (const line of rawLines.map((raw) => redactSecrets(raw, FIXTURE_SECRETS))) {
      expect(line).not.toMatch(/\bph[a-z]_[A-Za-z0-9_-]{16,}/);
      expect(line).not.toContain(FIXTURE_SECRETS.projectId);
      expect(line).not.toContain(FIXTURE_SECRETS.personalApiKey);
      expect(line).not.toContain(FIXTURE_SECRETS.projectApiKey);
    }

    const printed = rawLines.map((raw) => redactSecrets(raw, FIXTURE_SECRETS));
    expect(printed.some((line) => line.includes("R-1"))).toBe(true);
    expect(printed.some((line) => line.includes("FAILED-TO-PIN"))).toBe(true);
    for (const line of printed) expect(line).toMatch(/\b9\b/);
  });
});
