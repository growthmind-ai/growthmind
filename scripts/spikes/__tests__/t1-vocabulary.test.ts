// Wave 2 red tests for the T1 event-vocabulary probe's pure core. Asserts the public
// contract of scripts/spikes/lib/t1-vocabulary.ts. Every body there throws "not
// implemented". These tests must fail until Wave 6 fills them in.
//
// Why the first test in this file is the one that matters When the probe ran, the
// project's entire history was 220 events, all synthetic: `gm_*` markers written by
// this repo's own spikes plus PostHog-reserved names our spikes deliberately captured.
// No `posthog-js` has ever touched that project. Rows … (`$rageclick`,
// `$dead_click`, `$autocapture`, `$pageview`) therefore returned zero observations.
//
// Zero observations of a browser event, in a corpus containing zero browser-originated
// events, measures our own synthetic writes, not the customer's client config. Calling
// that `PINNED — absent` would be declaring a detector unbuildable on evidence that
// says nothing at all. That is why those rows are `FAILED-TO-PIN`, and why `rage_click`
// / `dead_click` are not built this sprint rather than built on an assumption.
//
// Over-claiming absence is the failure mode this module exists to prevent.
// Over-claiming inconclusiveness costs a re-run. Every fixture below is written so a
// miss lands on the second cost, never the first.
//
// Scope, per the binding PL rulings on Wave 1:
// Ruling 8: the probe pins event names only. Nothing here asserts on
//  property keys — `$exception_list` / `$pathname` are not this
//  module's business, and a field with no consumer is a dead wire.
// Ruling 10: a read/auth failure exits 1 in the shell ("no events were
//  readable — this is not an absence result"). It never becomes a
//  `FAILED-TO-PIN` row, so no test here constructs that arm.
// Ruling 11: `BROWSER_ORIGIN_LIBS_V1` is an allow-list, an unrecognised
//  `$lib` must fail toward `FAILED-TO-PIN`, never toward a false
//  absence. Two tests below pin that direction.
// Ruling 12: `EventNameHistogram.window` is evidence, not a gate condition.
//  It is asserted as carried output only; nothing asserts it gates
//  a verdict.
//
// Fixture time is a required parameter throughout: every instant derives from the `T0`
// constant. There is no `Date.now` in this file.

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

// Fixture time, injected, never read from a clock

/** The fixture epoch. Every instant below is `T0 + offset`. */
const T0 = new Date("2026-06-01T09:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

// Fixture builders

function observed(name: string, lib: string | null, offsetMs: number): ObservedEvent {
  return { name, lib, occurredAt: at(offsetMs) };
}

/** `count` events of one name and one `$lib`, spaced 1 s apart from `firstOffsetMs`. */
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

/**
 * The `$lib` the corpus actually carried. Deliberately not on the allow-list: it is
 * this repo's own spike writing to the project.
 */
const SYNTHETIC_LIB = "gm-shape-probe";

/**
 * A stand-in for the real corpus: 220 events, every one of them ours. 177 `gm_*`
 * markers, 20 `$exception` and 1 `$identify` that our spikes deliberately captured, 22
 * further markers carrying no `$lib` at all. Zero browser-originated events. This is
 * the sample that must never license an absence claim.
 */
const SYNTHETIC_CORPUS: readonly ObservedEvent[] = [
  ...eventsNamed(177, "gm_shape_probe", SYNTHETIC_LIB, 0),
  ...eventsNamed(20, "$exception", SYNTHETIC_LIB, 200_000),
  ...eventsNamed(1, "$identify", SYNTHETIC_LIB, 300_000),
  ...eventsNamed(22, "gm_spike_marker", null, 400_000),
];

/** A real browser client's `$lib`, taken from the allow-list itself. */
const BROWSER_LIB = BROWSER_ORIGIN_LIBS_V1[0] ?? "web";

/**
 * A sample of real browser traffic that could plausibly have contained the event under
 * test, `browserEventCount` browser-originated events, none of them named by any A-row
 * we ask about here.
 */
function browserCorpus(browserEventCount: number): readonly ObservedEvent[] {
  return [
    ...eventsNamed(browserEventCount, "product_viewed", BROWSER_LIB, 0),
    // A little of our own traffic alongside it: present in the denominator, absent from
    // the browser-originated count.
    ...eventsNamed(5, "gm_shape_probe", SYNTHETIC_LIB, 900_000),
  ];
}

function row(id: string): VocabularyRow {
  const found = VOCABULARY_ROWS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`fixture references an unknown vocabulary row: ${id}`);
  return found;
}

// Verdict narrowing, the union is the contract, so narrow explicitly

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

// verdictForRow, the lesson, and the asymmetry between present and absent

describe("verdictForRow", () => {
  test("should return FAILED-TO-PIN when the sample contains zero browser-originated events", () => {
    // the corpus, reproduced: 220 events, all ours, no browser client.
    expect(SYNTHETIC_CORPUS).toHaveLength(220);

    const histogram = buildEventNameHistogram(SYNTHETIC_CORPUS);
    const gate = judgeRepresentativeness(SYNTHETIC_CORPUS, CURRENT_REPRESENTATIVENESS_RULES);

    // The sample cannot carry an absence claim, and it says which of the two reasons
    // applies: nothing browser-originated at all, as distinct from some real browser
    // traffic that merely fell under the bar.
    expect(gate.kind).toBe("not_representative");
    const verdict = asFailed(verdictForRow(row("A-2"), histogram, gate));
    expect(verdict.basis.reason).toBe("no_browser_originated_events");
    expect(verdict.basis.reason).not.toBe("below_minimum_browser_denominator");

    // The evidence travels with the verdict: 0 of 220, with the bar it was judged
    // against, so the line reads as a ratio rather than as a zero.
    expect(verdict.denominator).toBe(220);
    expect(verdict.basis.basis.totalEvents).toBe(220);
    expect(verdict.basis.basis.browserOriginatedEvents).toBe(0);
    expect(verdict.basis.basis.minimumBrowserOriginatedEvents).toBe(
      MINIMUM_BROWSER_ORIGINATED_EVENTS_V1,
    );

    // Every A-row that asks about browser-only vocabulary lands the same way against
    // this sample. This is the whole reason rage_click/dead_click are not built rather
    // than built on an assumption.
    for (const id of ["A-3", "A-4", "A-5"]) {
      expect(verdictForRow(row(id), histogram, gate).label).toBe("FAILED-TO-PIN");
    }

    // The near-miss the reason has to be distinguishable from: a project with some
    // genuine browser traffic, just not enough of it.
    const thinBrowserSample = browserCorpus(3);
    const thinGate = judgeRepresentativeness(thinBrowserSample, CURRENT_REPRESENTATIVENESS_RULES);
    const thinVerdict = asFailed(
      verdictForRow(row("A-2"), buildEventNameHistogram(thinBrowserSample), thinGate),
    );
    expect(thinVerdict.basis.reason).toBe("below_minimum_browser_denominator");

    // The compile-time half of the same rule: a NonRepresentativeSample is not
    // assignable to the absent arm's `basis`, so `PINNED — absent` cannot be
    // constructed from a sample like this one at all. This stops compiling the day
    // someone widens that arm.
    const nonRepresentativeIsNotAnAbsentBasis: NonRepresentativeSample extends AbsentVerdict["basis"]
      ? false
      : true = true;
    expect(nonRepresentativeIsNotAnAbsentBasis).toBe(true);
  });

  test("should return PINNED — absent only when a representative browser-traffic denominator is met", () => {
    // Exactly on the bar: every boundary in this sprint is inclusive, so a sample
    // sitting on the minimum passes; the fail direction is carried by the magnitude of
    // the bar, never by the strictness of the comparison.
    const onBar = browserCorpus(MINIMUM_BROWSER_ORIGINATED_EVENTS_V1);
    const onBarGate = judgeRepresentativeness(onBar, CURRENT_REPRESENTATIVENESS_RULES);
    expect(onBarGate.kind).toBe("representative");
    if (onBarGate.kind !== "representative") {
      throw new Error(`expected a representative sample, got ${onBarGate.reason}`);
    }
    expect(onBarGate.basis.browserOriginatedEvents).toBe(MINIMUM_BROWSER_ORIGINATED_EVENTS_V1);

    // The runtime behaviour must match the type: the absent arm's basis accepts only a
    // RepresentativeSample, and this assignment is that proof in code.
    const absentBasis: AbsentVerdict["basis"] = onBarGate;
    expect(absentBasis.kind).toBe("representative");

    const absent = asAbsent(verdictForRow(row("A-2"), buildEventNameHistogram(onBar), onBarGate));
    expect(absent.basis.kind).toBe("representative");
    expect(absent.denominator).toBe(onBar.length);

    // One below the bar is the mirror: the same zero observations, no absence claim.
    // Without this half the test name means nothing.
    const belowBar = browserCorpus(MINIMUM_BROWSER_ORIGINATED_EVENTS_V1 - 1);
    const belowBarGate = judgeRepresentativeness(belowBar, CURRENT_REPRESENTATIVENESS_RULES);
    expect(belowBarGate.kind).toBe("not_representative");
    const failed = asFailed(
      verdictForRow(row("A-2"), buildEventNameHistogram(belowBar), belowBarGate),
    );
    expect(failed.basis.reason).toBe("below_minimum_browser_denominator");
  });

  test("should return PINNED — present with the exact observed literal", () => {
    // Presence is deliberately asymmetric: one sighting settles a row, and the gate is
    // not consulted at all. The sample here is not representative. The verdict must
    // still be present.
    const sample: readonly ObservedEvent[] = [
      ...SYNTHETIC_CORPUS,
      ...eventsNamed(3, "$rageclick", BROWSER_LIB, 500_000),
    ];
    const histogram = buildEventNameHistogram(sample);
    const gate = judgeRepresentativeness(sample, CURRENT_REPRESENTATIVENESS_RULES);
    expect(gate.kind).toBe("not_representative");

    const present = asPresent(verdictForRow(row("A-2"), histogram, gate));
    // The exact observed literal, verbatim, with its count and denominator.
    expect(present.observed).toEqual([{ name: "$rageclick", count: 3 }]);
    expect(present.denominator).toBe(223);
  });

  test("should carry only the observed literal when a row names a family of event names", () => {
    //  asks about `$dead_click` and `$dead_swipe`. Only one was observed, so only
    // one may appear. A verdict must never report a literal it did not see.
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

// judgeRepresentativeness / isBrowserOriginated, the allow-list's fail direction

describe("isBrowserOriginated", () => {
  test("should not count an unrecognised or absent $lib as browser-originated", () => {
    // Ruling 11: BROWSER_ORIGIN_LIBS_V1 is an allow-list. Anything it has not learned
    // (including a future posthog-js `$lib` value) is not browser traffic, which
    // withholds an absence claim rather than manufacturing one.
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
    // The dangerous shape: plenty of events, but the bulk of them from a `$lib` the
    // allow-list does not know. Counting those as browser traffic would let a false
    // absence through; not counting them costs a re-run.
    const rules: RepresentativenessRules = {
      version: CURRENT_REPRESENTATIVENESS_RULES.version,
      browserOriginLibs: CURRENT_REPRESENTATIVENESS_RULES.browserOriginLibs,
      // Bar moved deliberately: the rules arrive as a parameter, so a test can move
      // them. A gate that read a module constant internally could only be agreed with.
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

    // The unrecognised lib is reported, not silently dropped. That line is what tells a
    // re-runner the allow-list needs a new entry (ruling 11).
    expect(gate.basis.observedLibs).toContain("posthog-js-lite-next");
    expect(gate.basis.observedLibs).toContain(BROWSER_LIB);

    // And the verdict it licenses is inconclusive, never absent.
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

// buildEventNameHistogram, a count is only a count with its denominator

describe("buildEventNameHistogram", () => {
  test("should build an event-name histogram with its denominator", () => {
    // Offsets deliberately out of order so the window cannot be read off the first and
    // last elements. One event carries no timestamp at all.
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

    // The denominator every count is over. The whole point of the shape.
    expect(histogram.denominator).toBe(9);
    const total = histogram.counts.reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBe(histogram.denominator);

    // Count descending, ties broken by name ascending (code-unit order).
    expect(histogram.counts).toEqual([
      { name: "$pageview", count: 3 },
      { name: "$autocapture", count: 2 },
      { name: "$exception", count: 2 },
      { name: "gm_spike_marker", count: 2 },
    ]);

    // The window is evidence the sample carries, spanning the earliest and latest
    // usable timestamps, never the first and last array positions, and (ruling 12)
    // never a condition on any verdict.
    const span = histogram.window;
    if (span === null) throw new Error("expected a window over a sample carrying timestamps");
    expect(span.earliest.toISOString()).toBe(at(1_000).toISOString());
    expect(span.latest.toISOString()).toBe(at(9_000).toISOString());
  });

  test("should return a zero denominator and no window for an empty sample", () => {
    // Never a throw, and never a fabricated zero-count row for a name nobody observed.
    // An invented row would read as an observation.
    const histogram = buildEventNameHistogram([]);
    expect(histogram.denominator).toBe(0);
    expect(histogram.counts).toEqual([]);
    expect(histogram.window).toBeNull();
  });
});

// toObservedEvents, every drop shrinks the denominator, i.e. fails safe

describe("toObservedEvents", () => {
  test("should drop a raw item with no string event name rather than defaulting it", () => {
    // A live project holds every payload shape ever written to it, so nothing here
    // trusts a declared type. A dropped item shrinks the denominator, which pushes the
    // sample further from "representative". Away from an absence claim we cannot
    // support.
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

    // A missing `$lib` and an unparseable timestamp become null. Only the name is
    // required, and neither absence removes the event from the denominator.
    const second = sample[1];
    if (second === undefined) throw new Error("expected the second retained event");
    expect(second.lib).toBeNull();
    expect(second.occurredAt).toBeNull();

    expect(buildEventNameHistogram(sample).denominator).toBe(2);
  });
});

// buildVocabularyReport, the gate is judged once for the sample

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

    // Representativeness is a property of the sample, not of a row: re-deriving it per
    // row is how the two drift apart.
    expect(report.representativeness).toEqual(
      judgeRepresentativeness(SYNTHETIC_CORPUS, CURRENT_REPRESENTATIVENESS_RULES),
    );

    // One verdict per row, in the rows' own order, each carrying the same denominator,
    // so no verdict can be read without the number behind it.
    expect(report.verdicts.map((verdict) => verdict.row.id)).toEqual(
      VOCABULARY_ROWS.map((vocabularyRow) => vocabularyRow.id),
    );
    for (const verdict of report.verdicts) {
      expect(verdict.denominator).toBe(report.histogram.denominator);
    }

    //  is present in this corpus (our spikes captured 20 `$exception`); … are
    // inconclusive, which is exactly the published table.
    const a1 = report.verdicts.find((verdict) => verdict.row.id === "A-1");
    if (a1 === undefined) throw new Error("expected a verdict for row A-1");
    expect(asPresent(a1).observed).toEqual([{ name: "$exception", count: 20 }]);
  });
});

// formatVerdictLine, every printed byte passes through redaction first

/**
 * Fake credential material. These are fixtures, not secrets: this repo is public and no
 * real key may ever appear in it.
 */
const FIXTURE_SECRETS: RedactionSecrets = {
  personalApiKey: "phx_fixtureFIXTUREfixture0123456789",
  projectApiKey: "phc_fixtureFIXTUREfixture0123456789",
  projectId: "9174233",
};

/** A key shape this process never held. The pattern arm, not the exact arm. */
const CUSTOMER_KEY_SHAPED_EVENT = "checkout_phs_A1b2C3d4E5f6G7h8I9j0K1l2";
/** A customer event name that happens to embed the project id. */
const CUSTOMER_PROJECT_ID_EVENT = `signup_${FIXTURE_SECRETS.projectId}_step2`;

describe("formatVerdictLine", () => {
  test("should redact identifier-shaped values from every printed line", () => {
    // Event names are customer-authored text. `formatVerdictLine` is pure and prints
    // the literals it was given; it is not trusted to be safe on its own, which is why
    // the entrypoint pipes every line through `lib/redact.ts` before stdout or disk.
    // This test asserts that composition, over every line, including the failed-to-pin
    // arm.
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

    // Precondition: the unredacted line does carry the customer literal, so the
    // assertions below are testing redaction rather than an accidental omission.
    expect(rawLines.some((line) => line.includes(CUSTOMER_KEY_SHAPED_EVENT))).toBe(true);
    expect(rawLines.some((line) => line.includes(CUSTOMER_PROJECT_ID_EVENT))).toBe(true);

    for (const line of rawLines.map((raw) => redactSecrets(raw, FIXTURE_SECRETS))) {
      // Any PostHog-shaped key token, including one we never configured.
      expect(line).not.toMatch(/\bph[a-z]_[A-Za-z0-9_-]{16,}/);
      expect(line).not.toContain(FIXTURE_SECRETS.projectId);
      expect(line).not.toContain(FIXTURE_SECRETS.personalApiKey);
      expect(line).not.toContain(FIXTURE_SECRETS.projectApiKey);
    }

    // Over-redaction is the accepted fail direction, but it must not erase the evidence
    // the line exists to carry: the row id, the label, and the denominator survive.
    const printed = rawLines.map((raw) => redactSecrets(raw, FIXTURE_SECRETS));
    expect(printed.some((line) => line.includes("R-1"))).toBe(true);
    expect(printed.some((line) => line.includes("FAILED-TO-PIN"))).toBe(true);
    for (const line of printed) expect(line).toMatch(/\b9\b/);
  });
});
