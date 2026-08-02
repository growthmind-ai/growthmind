import { describe, expect, test } from "bun:test";

import {
  FLOOR_NO_RATE_TEMPLATE,
  FLOOR_OBSERVATION_TEMPLATES,
  SUMMARY_SOURCE_MESSAGES,
} from "../../src/summary/messages";
import type { SummarySource } from "../../src/summary/types";
import type { OnboardingCount, OnboardingFinding, ToFindingView } from "./contract-shapes";
import { loadUnderConstruction } from "./module-under-construction";

const loadToFindingView = (): Promise<ToFindingView> =>
  loadUnderConstruction<ToFindingView>({
    modulePath: "../../src/onboarding/finding-view",
    exportName: "toFindingView",
    ownedBy: "ADD Wave 1, task 1c.3",
  });

const WINDOW_START = new Date("2026-08-01T04:55:00.000Z");
const WINDOW_END = new Date("2026-08-01T05:07:00.000Z");

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

const FLOOR_SOURCES = (Object.keys(SUMMARY_SOURCE_MESSAGES) as readonly SummarySource[]).filter(
  (source) => source.startsWith("floor_"),
);

describe("toFindingView — FR-O20, EC-O5", () => {
  test("every count renders with its denominator", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(
      findingWith({
        counts: [COUNT, { numerator: 12, denominator: 200, unit: "sessions" }],
      }),
    );

    expect(view.counts).toHaveLength(2);

    for (const line of view.counts) {
      expect(line.sentence).toContain(String(line.numerator));
      expect(line.sentence).toContain(String(line.denominator));
      expect(line.sentence).toContain(line.unit);
      expect(line.sentence).toContain(line.surface);
      expect(line.surface).toBe(FINDING.surface);
    }
  });

  test("a count with a zero denominator renders the shipped no-rate sentence, never a division", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(
      findingWith({ counts: [{ numerator: 0, denominator: 0, unit: "sessions" }] }),
    );

    const [line] = view.counts;
    expect(line).toBeDefined();

    expect(line?.sentence).toBe(FLOOR_NO_RATE_TEMPLATE);
    expect(line?.sentence).not.toContain("NaN");
    expect(line?.sentence).not.toContain("Infinity");
    expect((line?.sentence ?? "").trim().length).toBeGreaterThan(0);
  });

  test("a floor-sourced finding renders its numbers identically to a model-rendered one", async () => {
    const toFindingView = await loadToFindingView();

    const modelled = toFindingView(findingWith({ summarySource: "model_rendered" }));
    const floored = toFindingView(findingWith({ summarySource: "floor_model_call_failed" }));

    expect(floored.sourceSentence).not.toBe(modelled.sourceSentence);
    expect(floored.sourceSentence).toBe(SUMMARY_SOURCE_MESSAGES.floor_model_call_failed);
    expect(modelled.sourceSentence).toBe(SUMMARY_SOURCE_MESSAGES.model_rendered);

    expect({ ...floored, sourceSentence: "" }).toEqual({ ...modelled, sourceSentence: "" });
  });

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

  test("each context element renders as its own line, never re-split and never joined", async () => {
    const toFindingView = await loadToFindingView();

    const three = [
      "Three people hit this in the last hour.",
      "Two of them tried again, and it failed again.",
      "It has not happened anywhere else in your product.",
    ];

    const one = toFindingView(findingWith({ context: [three[0] as string] }));
    const many = toFindingView(findingWith({ context: three }));

    expect(one.contextLines).toHaveLength(1);
    expect(many.contextLines).toHaveLength(three.length);
    expect(many.contextLines).toEqual(three);
  });

  test("a context array of one element renders one line", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(findingWith({ context: ["Only one thing is known about this."] }));

    expect(view.contextLines).toEqual(["Only one thing is known about this."]);
  });

  test("confidence renders as a statement about measurement, never a number", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(FINDING);

    expect(view.confidenceSentence).not.toMatch(/\d/);
    expect(view.confidenceSentence.trim().length).toBeGreaterThan(0);
  });

  test("the window renders as two dates", async () => {
    const toFindingView = await loadToFindingView();

    const view = toFindingView(FINDING);

    expect(view.windowStart).toEqual(WINDOW_START);
    expect(view.windowEnd).toEqual(WINDOW_END);
  });

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

    for (const line of view.counts) {
      expect(line.sentence).not.toBe(FLOOR_NO_RATE_TEMPLATE);
      expect(line.sentence).toContain("50");
      expect(line.sentence.trim().length).toBeGreaterThan(0);
    }
    expect(view.counts[0]?.numerator).toBe(0);
    expect(view.counts[1]?.numerator).toBe(50);
  });

  test("the view performs no arithmetic — numerator and denominator are carried through unaltered", async () => {
    const toFindingView = await loadToFindingView();

    const counts: readonly OnboardingCount[] = [
      COUNT,
      { numerator: 0, denominator: 50, unit: "sessions" },
      { numerator: 12, denominator: 200, unit: "sessions" },
    ];

    const view = toFindingView(findingWith({ counts }));

    expect(
      view.counts.map((line) => ({
        numerator: line.numerator,
        denominator: line.denominator,
        unit: line.unit,
      })),
    ).toEqual([...counts]);
  });

  test("the class sentence comes from FLOOR_OBSERVATION_TEMPLATES and no raw class name reaches the view", async () => {
    const toFindingView = await loadToFindingView();

    type FloorClassKey = keyof typeof FLOOR_OBSERVATION_TEMPLATES;
    const classKeys = Object.keys(FLOOR_OBSERVATION_TEMPLATES) as readonly FloorClassKey[];

    expect(classKeys).toHaveLength(4);

    const surface = "/settings";

    for (const finalClass of classKeys) {
      const view = toFindingView(findingWith({ finalClass, surface }));

      expect(view.classSentence).toBe(
        FLOOR_OBSERVATION_TEMPLATES[finalClass].replaceAll("{surface}", surface),
      );

      for (const key of classKeys) {
        expect(view.classSentence).not.toContain(key);
      }
    }
  });
});
