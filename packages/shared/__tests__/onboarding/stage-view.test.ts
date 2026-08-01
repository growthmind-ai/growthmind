// THE STAGE VIEW — AD-5, FR-O18, ruling R1b. ADD §9, 6 rows.
//
// R-LATENCY BINDS HERE HARDEST, and it is a settled ruling that is never
// re-opened: PostHog's ~24 s p90 is ACCEPTED; our poll leg and the hourly cron
// are the defect. The internal design target of ~25-35 s sizes the build and
// the acceptance run, AND IT APPEARS IN NO RENDERED STRING. No countdown, no
// promised number, no progress bar implying a known duration, no ETA, no ring.
//
// The one time value this surface may carry is ELAPSED, counting UP from a
// persisted origin — permitted precisely because it states what has ALREADY
// happened rather than what is about to. That is also why `StageView` carries
// `elapsedSeconds` and each log line's stamp as NUMBERS rather than
// pre-formatted strings: a committed duration cannot hide inside a number that
// is defined as "now minus armedAt". The authored copy is where a promise
// could hide, and the authored copy is what row 3 walks.
//
// The whole design is one idea: every log line is PAST TENSE and carries its
// own stamp, so nothing on screen is forward-looking and therefore nothing can
// be read as a promise. FR-O18 stops being a rule somebody must remember and
// becomes a property of the shape.

import { describe, expect, test } from "bun:test";

import type {
  OnboardingFinding,
  RenderStageView,
  RenderedStageState,
  StageView,
} from "./contract-shapes";
import { loadUnderConstruction } from "./module-under-construction";

/** ADD Wave 1 (task 1c.2) creates this. */
const loadRenderStageView = (): Promise<RenderStageView> =>
  loadUnderConstruction<RenderStageView>({
    modulePath: "../../src/onboarding/stage-view",
    exportName: "renderStageView",
    ownedBy: "ADD Wave 1, task 1c.2",
  });

// --- the bans, as regexes -------------------------------------------------

/**
 * A committed duration. The ADD names this pattern directly (§9): a digit
 * followed by a time unit, plus the three hedges that promise a duration
 * without printing one.
 */
const DURATION = /\d+\s*(s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/i;
const HEDGE = /\babout\b|\busually\b|\btypically\b|\bapprox|~/i;

/**
 * Forward-looking tokens. A log line that reaches into the future is a promise
 * however carefully it is worded, and this surface makes none.
 */
const FORWARD_LOOKING =
  /\bwill\b|\bsoon\b|\bshortly\b|\bnext\b|\bexpect\w*\b|\bshould\b|\bgoing to\b|\bany moment\b|\bin a few\b|\bwaiting for\b|\bremaining\b/i;

/**
 * Field names that would smuggle a duration promise back in through the shape
 * rather than through the copy. Enumerated for the same reason AD-3 enumerates
 * `OnboardingCounterView`'s fields instead of reaching for `Omit`: a ban by
 * enumeration refuses the NEXT such field by default.
 */
const PROMISE_SHAPED_KEY =
  /remaining|target|percent|progress|eta|countdown|ceiling|deadline|estimate|expected/i;

// --- fixtures --------------------------------------------------------------

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

/** Every state the stage can be in, so a walk over "every string in every
 *  StageView" is TOTAL rather than best-effort. */
const EVERY_STATE: readonly RenderedStageState[] = [
  { kind: "unarmed" },
  LEG1,
  LEG2,
  { kind: "finding", elapsedSeconds: 37, finding: FINDING },
  { kind: "ended", elapsedSeconds: 37, reason: "failed" },
  { kind: "ended", elapsedSeconds: 37, reason: "no_candidates_passed_gate" },
  { kind: "ended", elapsedSeconds: 37, reason: "no_sessions_to_analyse" },
];

/** Every authored string a view carries. The numeric fields are deliberately
 *  NOT included: they are measurements of what already happened, which is the
 *  one time value R-LATENCY permits. */
const stringsOf = (view: StageView): readonly string[] => [
  view.heading,
  view.hint,
  ...view.lines.map((line) => line.text),
];

describe("renderStageView — AD-5, FR-O18, R1b", () => {
  // Row 1
  test("the waiting state names what it is waiting on", async () => {
    const renderStageView = await loadRenderStageView();

    const leg1 = renderStageView(LEG1);
    const leg2 = renderStageView(LEG2);

    // Normative copy from the UX spec (Checklist row 18 and the phase-B states
    // table). Asserted as a CONTAINMENT rather than an equality because the
    // spec itself renders the sentence with and without its full stop in
    // different places — the sentence is normative, the punctuation is not
    // settled. Flagged for the copy wave rather than guessed at here.
    expect(leg1.heading).toContain("Watching for what you just did");
    expect(leg2.heading).toContain("Reading what came back");

    // The two legs are NAMED DIFFERENTLY. A single "working…" heading across
    // both would erase the only signal that says which leg is slow.
    expect(leg2.heading).not.toBe(leg1.heading);

    // And the wait says what the founder should go and do.
    expect(leg1.hint).toContain("come back to this tab");
  });

  // Row 2
  test("the waiting state shows elapsed time, which is a measurement, not a countdown", async () => {
    const renderStageView = await loadRenderStageView();

    // Counts UP, from zero, carried straight through from the reduced state.
    expect(renderStageView({ kind: "leg1", elapsedSeconds: 0 }).elapsedSeconds).toBe(0);
    expect(renderStageView({ kind: "leg1", elapsedSeconds: 12 }).elapsedSeconds).toBe(12);
    expect(renderStageView({ kind: "leg2", elapsedSeconds: 90 }).elapsedSeconds).toBe(90);

    // NO FIELD IS A REMAINING, A TARGET OR A PERCENTAGE — in any state. A
    // progress bar needs a denominator, and this wait has none that is honest.
    for (const state of EVERY_STATE) {
      for (const key of Object.keys(renderStageView(state))) {
        expect(key).not.toMatch(PROMISE_SHAPED_KEY);
      }
    }
  });

  // Row 3
  test("no waiting string contains a countdown or a committed duration", async () => {
    const renderStageView = await loadRenderStageView();

    for (const state of EVERY_STATE) {
      for (const value of stringsOf(renderStageView(state))) {
        expect(value).not.toMatch(DURATION);
        expect(value).not.toMatch(HEDGE);
      }
    }
  });

  // Row 4
  test("every log line is past tense and carries its own stamp", async () => {
    const renderStageView = await loadRenderStageView();

    for (const state of EVERY_STATE) {
      for (const line of renderStageView(state).lines) {
        // Its own stamp: seconds after arming, renderable as `+Ns`.
        expect(Number.isInteger(line.atSeconds)).toBe(true);
        expect(line.atSeconds).toBeGreaterThanOrEqual(0);

        // And nothing reaching into the future.
        expect(line.text).not.toMatch(FORWARD_LOOKING);
        expect(line.text.length).toBeGreaterThan(0);
      }
    }
  });

  // Row 5
  test("log lines are append-only — an existing line's text and stamp never change between states", async () => {
    const renderStageView = await loadRenderStageView();

    const leg1 = renderStageView(LEG1).lines;
    const leg2 = renderStageView(LEG2).lines;

    // leg1's lines are a PREFIX of leg2's. A line that is already on screen has
    // stated a fact that already happened, so re-wording it or re-stamping it
    // would be rewriting history in front of the person who watched it.
    expect(leg2.length).toBeGreaterThanOrEqual(leg1.length);
    expect(leg2.slice(0, leg1.length)).toEqual([...leg1]);
  });

  // Row 6 — FR-O29, achieved with NO forward-looking word.
  test("which leg is slow is legible from which line has not appeared yet", async () => {
    const renderStageView = await loadRenderStageView();

    const leg1 = renderStageView(LEG1);
    const leg2 = renderStageView(LEG2);

    // leg1 has no retrieval line; leg2 does. That difference IS the two-leg
    // detail: a founder sitting on leg1 for a while can see that what they did
    // has not reached us yet, and nothing had to promise them anything to say
    // so.
    expect(leg2.lines.length).toBeGreaterThan(leg1.lines.length);

    // The new line is the one that appeared, and it too is past tense.
    const appended = leg2.lines.slice(leg1.lines.length);
    expect(appended.length).toBeGreaterThan(0);
    for (const line of appended) {
      expect(line.text).not.toMatch(FORWARD_LOOKING);
    }
  });
});
