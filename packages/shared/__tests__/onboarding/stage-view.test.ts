import { describe, expect, test } from "bun:test";

import type {
  OnboardingFinding,
  RenderStageView,
  RenderedStageState,
  StageView,
} from "./contract-shapes";
import { loadUnderConstruction } from "./module-under-construction";

const loadRenderStageView = (): Promise<RenderStageView> =>
  loadUnderConstruction<RenderStageView>({
    modulePath: "../../src/onboarding/stage-view",
    exportName: "renderStageView",
    ownedBy: "ADD Wave 1, task 1c.2",
  });

const DURATION = /\d+\s*(s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/i;
const HEDGE = /\babout\b|\busually\b|\btypically\b|\bapprox|~/i;

const FORWARD_LOOKING =
  /\bwill\b|\bsoon\b|\bshortly\b|\bnext\b|\bexpect\w*\b|\bshould\b|\bgoing to\b|\bany moment\b|\bin a few\b|\bwaiting for\b|\bremaining\b/i;

const PROMISE_SHAPED_KEY =
  /remaining|target|percent|progress|eta|countdown|ceiling|deadline|estimate|expected/i;

const FINDING: OnboardingFinding = {
  finalClass: "something_is_not_working",
  headline: "Saving your workspace settings is not working.",
  context: ["Three people hit this in the last hour."],
  counts: [{ numerator: 3, denominator: 3, unit: "sessions" }],
  surface: "/settings",
  confidenceBasis: "above_floor",
  windowStart: new Date("2026-08-01T09:55:00.000Z"),
  windowEnd: new Date("2026-08-01T10:07:00.000Z"),
  summarySource: "model_rendered",
};

const LEG1: RenderedStageState = { kind: "leg1", elapsedSeconds: 12 };
const LEG2: RenderedStageState = { kind: "leg2", elapsedSeconds: 33 };

const EVERY_STATE: readonly RenderedStageState[] = [
  { kind: "unarmed" },
  LEG1,
  LEG2,
  { kind: "finding", elapsedSeconds: 37, finding: FINDING },
  { kind: "ended", elapsedSeconds: 37, reason: "failed" },
  { kind: "ended", elapsedSeconds: 37, reason: "no_candidates_passed_gate" },
  { kind: "ended", elapsedSeconds: 37, reason: "no_sessions_to_analyse" },
];

const stringsOf = (view: StageView): readonly string[] => [
  view.heading,
  view.hint,
  ...view.lines.map((line) => line.text),
];

describe("renderStageView — AD-5, FR-O18, R1b", () => {
  test("the waiting state names what it is waiting on", async () => {
    const renderStageView = await loadRenderStageView();

    const leg1 = renderStageView(LEG1);
    const leg2 = renderStageView(LEG2);

    expect(leg1.heading).toContain("Watching for what you just did");
    expect(leg2.heading).toContain("Reading what came back");

    expect(leg2.heading).not.toBe(leg1.heading);

    expect(leg1.hint).toContain("come back to this tab");
  });

  test("the waiting state shows elapsed time, which is a measurement, not a countdown", async () => {
    const renderStageView = await loadRenderStageView();

    expect(renderStageView({ kind: "leg1", elapsedSeconds: 0 }).elapsedSeconds).toBe(0);
    expect(renderStageView({ kind: "leg1", elapsedSeconds: 12 }).elapsedSeconds).toBe(12);
    expect(renderStageView({ kind: "leg2", elapsedSeconds: 90 }).elapsedSeconds).toBe(90);

    for (const state of EVERY_STATE) {
      for (const key of Object.keys(renderStageView(state))) {
        expect(key).not.toMatch(PROMISE_SHAPED_KEY);
      }
    }
  });

  test("no waiting string contains a countdown or a committed duration", async () => {
    const renderStageView = await loadRenderStageView();

    for (const state of EVERY_STATE) {
      for (const value of stringsOf(renderStageView(state))) {
        expect(value).not.toMatch(DURATION);
        expect(value).not.toMatch(HEDGE);
      }
    }
  });

  test("every log line is past tense and carries its own stamp", async () => {
    const renderStageView = await loadRenderStageView();

    for (const state of EVERY_STATE) {
      for (const line of renderStageView(state).lines) {
        expect(Number.isInteger(line.atSeconds)).toBe(true);
        expect(line.atSeconds).toBeGreaterThanOrEqual(0);

        expect(line.text).not.toMatch(FORWARD_LOOKING);
        expect(line.text.length).toBeGreaterThan(0);
      }
    }
  });

  test("log lines are append-only — an existing line's text and stamp never change between states", async () => {
    const renderStageView = await loadRenderStageView();

    const leg1 = renderStageView(LEG1).lines;
    const leg2 = renderStageView(LEG2).lines;

    expect(leg2.length).toBeGreaterThanOrEqual(leg1.length);
    expect(leg2.slice(0, leg1.length)).toEqual([...leg1]);
  });

  test("which leg is slow is legible from which line has not appeared yet", async () => {
    const renderStageView = await loadRenderStageView();

    const leg1 = renderStageView(LEG1);
    const leg2 = renderStageView(LEG2);

    expect(leg2.lines.length).toBeGreaterThan(leg1.lines.length);

    const appended = leg2.lines.slice(leg1.lines.length);
    expect(appended.length).toBeGreaterThan(0);
    for (const line of appended) {
      expect(line.text).not.toMatch(FORWARD_LOOKING);
    }
  });
});
