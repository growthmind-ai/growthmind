// THE FINDING VIEW — FR-O20, EC-O5. ADD §9, 10 rows.
//
// This is the payoff. A founder broke something in their own product, watched
// us narrate it, and this is the card that has to survive them CHECKING IT.
//
// THE VIEW DOES NO MATHS, AND THAT IS THE WHOLE POINT. Numerator and
// denominator are carried through unaltered, `context[]` is rendered one line
// each and never re-split or joined, and the confidence is a sentence rather
// than a number. A founder checking our numbers must be checking THE
// PIPELINE'S numbers — not this module's re-derivation of them. A view that
// recomputes anything is a second place for the arithmetic to be wrong, and the
// founder cannot see which of the two they are reading.
//
// The two boundaries that produce wrong claims rather than missing ones:
//   - A ZERO DENOMINATOR takes `FLOOR_NO_RATE_TEMPLATE`, NEVER A DIVISION. The
//     division has no answer, and a blank reads as "nothing happened" — a
//     different and false claim. Never NaN, never Infinity, never empty.
//   - AN ABSENT EXPLANATION IS NEVER AN ABSENT FINDING. Every `floor_*` source
//     still renders the headline, the counts and the window; the ONLY thing
//     that changes is the `SUMMARY_SOURCE_MESSAGES` line saying so.

import { describe, expect, test } from "bun:test";

import {
  FLOOR_NO_RATE_TEMPLATE,
  FLOOR_OBSERVATION_TEMPLATES,
  SUMMARY_SOURCE_MESSAGES,
} from "../../src/summary/messages";
import type { SummarySource } from "../../src/summary/types";
import type { OnboardingCount, OnboardingFinding, ToFindingView } from "./contract-shapes";
import { loadUnderConstruction } from "./module-under-construction";

/** ADD Wave 1 (task 1c.3) creates this. */
const loadToFindingView = (): Promise<ToFindingView> =>
  loadUnderConstruction<ToFindingView>({
    modulePath: "../../src/onboarding/finding-view",
    exportName: "toFindingView",
    ownedBy: "ADD Wave 1, task 1c.3",
  });

// --- fixtures --------------------------------------------------------------

const WINDOW_START = new Date("2026-08-01T04:55:00.000Z");
const WINDOW_END = new Date("2026-08-01T05:07:00.000Z");

/** Distinct numerator and denominator, so "carries its denominator" is a real
 *  assertion rather than one number satisfying two checks. */
const COUNT: OnboardingCount = { numerator: 3, denominator: 47, unit: "sessions" };

const FINDING: OnboardingFinding = {
  finalClass: "something_is_not_working",
  headline: "Saving your workspace settings is not working.",
  context: ["Three people hit this in the last hour."],
  counts: [COUNT],
  surface: "/settings",
  confidenceBasis: "above_floor",
  windowStart: WINDOW_START,
  windowEnd: WINDOW_END,
  summarySource: "model_rendered",
};

const findingWith = (overrides: Partial<OnboardingFinding>): OnboardingFinding => ({
  ...FINDING,
  ...overrides,
});

/** Every `floor_*` member, taken from the shipped table so a new member is
 *  covered automatically rather than by somebody remembering to add it. */
const FLOOR_SOURCES = (Object.keys(SUMMARY_SOURCE_MESSAGES) as readonly SummarySource[]).filter(
  (source) => source.startsWith("floor_"),
);

describe("toFindingView — FR-O20, EC-O5", () => {
  // Row 1
  test("every count renders with its denominator", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(
      findingWith({
        counts: [COUNT, { numerator: 12, denominator: 200, unit: "sessions" }],
      }),
    );

    expect(view.counts).toHaveLength(2);

    for (const line of view.counts) {
      // NUMERATOR, DENOMINATOR, UNIT AND SURFACE, IN ONE LINE. A bare number in
      // front of a founder is a claim whose size cannot be judged, and a
      // denominator in a different sentence is a denominator nobody joins up.
      expect(line.sentence).toContain(String(line.numerator));
      expect(line.sentence).toContain(String(line.denominator));
      expect(line.sentence).toContain(line.unit);
      expect(line.sentence).toContain(line.surface);
      expect(line.surface).toBe(FINDING.surface);
    }
  });

  // Row 2 — EC-O5.
  test("a count with a zero denominator renders the shipped no-rate sentence, never a division", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(
      findingWith({ counts: [{ numerator: 0, denominator: 0, unit: "sessions" }] }),
    );

    const [line] = view.counts;
    expect(line).toBeDefined();

    // Every session in the window was set aside, leaving no share to report.
    // That is a real, reportable state and it is stated IN WORDS.
    expect(line?.sentence).toBe(FLOOR_NO_RATE_TEMPLATE);
    expect(line?.sentence).not.toContain("NaN");
    expect(line?.sentence).not.toContain("Infinity");
    expect((line?.sentence ?? "").trim().length).toBeGreaterThan(0);
  });

  // Row 3
  test("a floor-sourced finding renders its numbers identically to a model-rendered one", async () => {
    const toFindingView = await loadToFindingView();

    const modelled = toFindingView(findingWith({ summarySource: "model_rendered" }));
    const floored = toFindingView(findingWith({ summarySource: "floor_model_call_failed" }));

    // THE TWO VIEWS DIFFER ONLY BY THE SOURCE LINE. The finding is identical
    // whichever member applies — the floor sentence states that a written
    // explanation is missing and why, never anything about the finding itself.
    expect(floored.sourceSentence).not.toBe(modelled.sourceSentence);
    expect(floored.sourceSentence).toBe(SUMMARY_SOURCE_MESSAGES.floor_model_call_failed);
    expect(modelled.sourceSentence).toBe(SUMMARY_SOURCE_MESSAGES.model_rendered);

    expect({ ...floored, sourceSentence: "" }).toEqual({ ...modelled, sourceSentence: "" });
  });

  // Row 4
  test("an absent explanation is never an absent finding", async () => {
    const toFindingView = await loadToFindingView();

    for (const summarySource of FLOOR_SOURCES) {
      const view = toFindingView(findingWith({ summarySource }));

      expect(view.headline).toBe(FINDING.headline);
      expect(view.counts).toHaveLength(FINDING.counts.length);
      expect(view.windowStart).toEqual(WINDOW_START);
      expect(view.windowEnd).toEqual(WINDOW_END);
      expect(view.classSentence.trim().length).toBeGreaterThan(0);
      expect(view.sourceSentence).toBe(SUMMARY_SOURCE_MESSAGES[summarySource]);
    }
  });

  // Row 5
  test("each context element renders as its own line, never re-split and never joined", async () => {
    const toFindingView = await loadToFindingView();

    const three = [
      "Three people hit this in the last hour.",
      "Two of them tried again, and it failed again.",
      "It has not happened anywhere else in your product.",
    ];

    const one = toFindingView(findingWith({ context: [three[0] as string] }));
    const many = toFindingView(findingWith({ context: three }));

    // ONE LINE IN, ONE LINE OUT. A sentence containing a full stop must not be
    // re-split into two lines, and three sentences must not be joined into one
    // paragraph: the pipeline decided where the sentence boundaries are, and
    // the consumer renders what it is handed (D11).
    expect(one.contextLines).toHaveLength(1);
    expect(many.contextLines).toHaveLength(three.length);
    expect(many.contextLines).toEqual(three);
  });

  // Row 6 — EC-O5 boundary.
  test("a context array of one element renders one line", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(findingWith({ context: ["Only one thing is known about this."] }));

    expect(view.contextLines).toEqual(["Only one thing is known about this."]);
  });

  // Row 7
  test("confidence renders as a statement about measurement, never a number", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(FINDING);

    // NO DIGIT, EVER. There is no numeric confidence anywhere in this product,
    // and inventing one here — a percentage, a score — would be a claim about
    // certainty that nothing measured.
    expect(view.confidenceSentence).not.toMatch(/\d/);
    expect(view.confidenceSentence.trim().length).toBeGreaterThan(0);
  });

  // Row 8
  test("the window renders as two dates", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(FINDING);

    // A count with an unstated window is a count nobody can act on.
    expect(view.windowStart).toEqual(WINDOW_START);
    expect(view.windowEnd).toEqual(WINDOW_END);
  });

  // Row 9 — EC-O5 boundaries.
  test("a 0 percent and a 100 percent rate each render", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(
      findingWith({
        counts: [
          { numerator: 0, denominator: 50, unit: "sessions" },
          { numerator: 50, denominator: 50, unit: "sessions" },
        ],
      }),
    );

    expect(view.counts).toHaveLength(2);

    // Neither boundary collapses into the no-rate sentence: both have a real
    // denominator, so both state a real share. Zero-of-fifty is an answer.
    for (const line of view.counts) {
      expect(line.sentence).not.toBe(FLOOR_NO_RATE_TEMPLATE);
      expect(line.sentence).toContain("50");
      expect(line.sentence.trim().length).toBeGreaterThan(0);
    }
    expect(view.counts[0]?.numerator).toBe(0);
    expect(view.counts[1]?.numerator).toBe(50);
  });

  // Row 10
  test("the view performs no arithmetic — numerator and denominator are carried through unaltered", async () => {
    const toFindingView = await loadToFindingView();

    const counts: readonly OnboardingCount[] = [
      COUNT,
      { numerator: 0, denominator: 50, unit: "sessions" },
      { numerator: 12, denominator: 200, unit: "sessions" },
    ];

    const view = toFindingView(findingWith({ counts }));

    // DEEP-EQUAL TO THE INPUT. No rounding, no percentage, no re-derivation —
    // whatever the pipeline measured is exactly what the founder reads.
    expect(
      view.counts.map((line) => ({
        numerator: line.numerator,
        denominator: line.denominator,
        unit: line.unit,
      })),
    ).toEqual([...counts]);
  });

  // Row 11 — AUTHORISED CROSS-WAVE ADDITION (Wave 0e), closing the hole Wave 0d
  // found in row 4 above.
  //
  // Row 4 asserts only `view.classSentence.trim().length > 0`, and A RAW
  // PASS-THROUGH OF `finalClass` SATISFIES THAT. `finalClass` is the persisted
  // `findings.final_class` column, whose four values are the machine keys
  // `broken` / `confusing` / `changed_mind` / `instrumentation` — so a view that
  // simply forwards it renders the literal string "changed_mind" or
  // "instrumentation" at a founder, on the ONE SCREEN THIS MVP EXISTS FOR, and
  // every row in this file stays green. That is a product-decisions §10 breach
  // (plain English in every customer-facing string) shipped behind a passing
  // suite, which is precisely the class of miss the §9 standing rules exist for.
  //
  // A FIXTURE PER KEY, NOT ONE FIXTURE. Driving a single class would let three
  // of the four pass through unrendered behind one correct branch; the loop is
  // what makes "no class can reach the view raw" a statement about the whole
  // union rather than about the one member somebody happened to test.
  //
  // The surface is deliberately neutral (`/settings`): a surface literal
  // containing one of the four key names would make the negative assertion below
  // fail for a reason that has nothing to do with the view.
  test("the class sentence comes from FLOOR_OBSERVATION_TEMPLATES and no raw class name reaches the view", async () => {
    const toFindingView = await loadToFindingView();

    type FloorClassKey = keyof typeof FLOOR_OBSERVATION_TEMPLATES;
    const classKeys = Object.keys(FLOOR_OBSERVATION_TEMPLATES) as readonly FloorClassKey[];

    // The four keys are the shipped table's own, read off it rather than
    // re-listed here — a fifth class added to the union is covered the day it
    // lands instead of the day somebody remembers this file.
    expect(classKeys).toHaveLength(4);

    const surface = "/settings";

    for (const finalClass of classKeys) {
      const view = toFindingView(findingWith({ finalClass, surface }));

      // THE SENTENCE IS THE SHIPPED TEMPLATE WITH `{surface}` SUBSTITUTED, and
      // nothing else. Not a paraphrase, not a prefix, not a title-cased key —
      // the copy has one home (FR-O22) and this is the assertion that keeps it
      // there. `{surface}` is the closed token vocabulary's own placeholder
      // (`messages.ts:133`), so a view that forgot to substitute renders a
      // literal brace at the founder and fails here too.
      expect(view.classSentence).toBe(
        FLOOR_OBSERVATION_TEMPLATES[finalClass].replaceAll("{surface}", surface),
      );

      // AND NO RAW KEY SURVIVES ANYWHERE IN IT. Checked against ALL FOUR keys
      // for EVERY class, so the row also refuses a view that renders one class
      // correctly while leaking another's key into the same sentence.
      for (const key of classKeys) {
        expect(view.classSentence).not.toContain(key);
      }
    }
  });
});
