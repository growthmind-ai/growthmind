// THE ONE DERIVATION OF WHAT THE STAGE IS SHOWING (O-008, AD-5).
//
// Written as the sibling of `deriveConnectionState`
// (`packages/db/src/services/connection-state.ts:51-81`), and for the same
// reason its header gives: a SECOND COPY OF A BRANCH ORDER IS A D11 WIRE
// WAITING TO BE SEVERED. Two surfaces answer "what is this wait doing" — the
// status route and the component that polls it — and if each carried its own
// order they would disagree on exactly the cases that matter, and nothing would
// fail.
//
// The function is PURE: no I/O, no ambient clock, no randomness. Every fact it
// consumes is read by the caller from a persisted row, and the clock is passed
// in. Given the same facts and the same `nowMs` it always returns the same
// state, and it never mutates its input.
//
// ###########################################################################
// # THERE IS NO LIVE-SIGNAL PARAMETER, AND ITS ABSENCE IS THE GUARANTEE.
// #
// # `reduceStage` takes persisted facts and a clock. That is all. A customer
// # who lands after the work finished — a hard reload, a fresh incognito
// # window, a tab reopened tomorrow — cannot be shown a loading state, because
// # there is no transient signal for this function to be missing. The arity is
// # 2 and a test pins it at runtime, precisely so somebody cannot add the
// # parameter back and keep every behavioural row green (D4).
// ###########################################################################
//
// ###########################################################################
// # BRANCH ORDER, LOAD-BEARING. IT LOOKS CORRECT WHEN IT IS WRONG.
// #
// #   1. finding !== null                            -> "finding"
// #   2. armedAt === null                            -> "unarmed"
// #   3. terminal AND cannot still produce a finding -> "ended"
// #        runStatus === "failed"                                  -> ended("failed")
// #        runStatus === "completed" && a non-finding outcome      -> ended(outcome)
// #   4. readingAt !== null                          -> "leg2"
// #   5. otherwise                                   -> "leg1"
// #
// # WHAT 1-BEFORE-2 BUYS. Branch 1 never consults `armedAt`, so a finding that
// # was persisted before the user landed renders immediately on first paint.
// #
// # WHAT BRANCH 3'S GUARD BUYS — AND THIS IS THE WHOLE POINT OF THE FILE. A
// # run can reach `completed` with `produced_findings` MICROSECONDS BEFORE the
// # finding row is readable by the next poll. `completed + produced_findings +
// # finding === null` therefore falls through to `leg2`: STILL READING, NOT
// # FINISHED. Falling to `ended` there would print "nothing was found" over a
// # finding that is already written — the worst possible render on the one
// # screen this MVP exists for. The state is transient by construction and the
// # next poll resolves it into branch 1.
// #
// # THE PLAYABLE STORYBOARD HAS THIS WRONG, IN TWO WAYS.
// # `.ai/ux/onboarding-five-steps.interaction.html:515-521` checks `armedAt`
// # FIRST, ahead of the finding, and collapses "a finding exists" and "the
// # run's outcome" into one field, so it has no out-of-order guard at all. An
// # implementer reading the prototype's source WILL find the wrong order. The
// # spec's order is the contract; the prototype is stale by its own spec's
// # header rule, and `stage.test.ts` runs the prototype's order through two
// # fixtures to prove they discriminate.
// ###########################################################################
//
// ── ONE DELIBERATE SUPERSET OF AD-5'S DECLARED UNION, RECORDED HERE ─────────
//
// The four non-`unarmed` arms carry `retrievedAtSeconds` and `readingAtSeconds`
// alongside `elapsedSeconds`. AD-5's block does not declare them, and they are
// added for one reason: UX Checklist row 22 requires the wait log to be
// "rebuilt from persisted stamps", and `renderStageView(state)` receives only
// the reduced state. Without these two numbers the view has no source for a
// milestone stamp and would have to FABRICATE one — a timestamp shown to a
// founder that no row supports, on the screen whose whole promise is evidence.
//
// D11's rule is that the consumer deriving a value from what it already holds
// is the wiring with no thread to sever; here the consumer holds nothing, so
// the producer must carry it, and the reducer's output is the single wire that
// already exists. Both fields are `null` when the milestone has not happened,
// and every added field is a widening: no existing consumer breaks.

import type { AnalysisOutcome, AnalysisRunStatus } from "../summary/types";
import type { EndedReason, OnboardingFinding } from "./types";

/**
 * Everything the stage is derived FROM, and every member is a persisted row's
 * value. Nothing here is observed by the current request.
 */
export type StagePersistedFacts = {
  readonly armedAt: Date | null;
  /** A poll run persisted events after arming. */
  readonly retrievedAt: Date | null;
  /** An analysis run opened after arming. */
  readonly readingAt: Date | null;
  readonly endedAt: Date | null;
  readonly runStatus: AnalysisRunStatus | null;
  readonly runOutcome: AnalysisOutcome | null;
  readonly finding: OnboardingFinding | null;
};

/**
 * Seconds after `armedAt` at which a milestone was reached, or `null` when it
 * has not been. See the superset note in this file's header for why these
 * travel on the reduced state rather than being re-derived downstream.
 */
type StageMilestones = {
  readonly retrievedAtSeconds: number | null;
  readonly readingAtSeconds: number | null;
};

/**
 * What the screen is showing.
 *
 * `elapsedSeconds` is the ONLY time value any arm carries, and it counts UP
 * from a persisted origin — permitted precisely because it states what has
 * ALREADY happened. There is deliberately no `remainingSeconds`, no
 * `targetSeconds`, no `percentComplete` and no `etaSeconds`: this wait has no
 * denominator that would be honest (ruling R1b).
 */
export type RenderedStageState =
  | { readonly kind: "unarmed" }
  | ({ readonly kind: "leg1"; readonly elapsedSeconds: number } & StageMilestones)
  | ({ readonly kind: "leg2"; readonly elapsedSeconds: number } & StageMilestones)
  | ({
      readonly kind: "finding";
      readonly elapsedSeconds: number;
      readonly finding: OnboardingFinding;
    } & StageMilestones)
  | ({
      readonly kind: "ended";
      readonly elapsedSeconds: number;
      readonly reason: EndedReason;
    } & StageMilestones);

/**
 * Whole seconds between an origin and a moment, never negative.
 *
 * Clamped at zero because the two legs are written by two different processes
 * into two different tables and neither orders the other: the hourly cron can
 * open a run for reasons unrelated to the user's trigger, so a milestone can
 * legitimately precede `armedAt`. A negative stamp on a log line would render
 * as `+-4s`, which reads as a bug rather than as the ordinary race it is.
 */
function wholeSecondsBetween(originMs: number, atMs: number): number {
  return Math.max(0, Math.round((atMs - originMs) / 1000));
}

function offsetOf(moment: Date | null, originMs: number): number | null {
  return moment === null ? null : wholeSecondsBetween(originMs, moment.getTime());
}

/**
 * A run that has stopped AND cannot still produce a finding.
 *
 * The second half is the whole guard. `completed` with `produced_findings` is
 * NOT terminal for this surface: the run finished by writing a finding, and the
 * finding row simply is not readable by this poll yet.
 *
 * `completed` with NO recorded outcome is also treated as not-yet-terminal, and
 * that is a decision rather than an oversight (D5, D10). The three `EndedReason`
 * members are the only endings this surface can name, and every one of them
 * asserts something specific about the customer's product. With no outcome on
 * the row there is nothing true to say, so the safe direction is to keep
 * narrating the wait and let the next poll read the column — never to pick one
 * of three sentences and hope. A run that stays `completed` with a null outcome
 * forever would leave the wait running; that is a defect in whatever wrote the
 * row, and it is visible as one, rather than being papered over with a claim
 * about the founder's product that nothing measured.
 */
function endedReasonFor(
  runStatus: AnalysisRunStatus | null,
  runOutcome: AnalysisOutcome | null,
): EndedReason | null {
  if (runStatus === "failed") {
    return "failed";
  }

  if (runStatus === "completed" && runOutcome !== null && runOutcome !== "produced_findings") {
    return runOutcome;
  }

  return null;
}

/**
 * The stage's state, from persisted facts and a clock.
 *
 * ARITY IS 2. Read the header before adding a third parameter.
 */
export function reduceStage(facts: StagePersistedFacts, nowMs: number): RenderedStageState {
  const armedMs = facts.armedAt === null ? null : facts.armedAt.getTime();

  // A null origin must never leak a NaN into a rendered clock (D5). Branch 1
  // does not consult `armedAt`, so a finding can legitimately render with no
  // arming to measure from — and it renders zero, not "NaN seconds elapsed".
  const milestones: StageMilestones =
    armedMs === null
      ? { retrievedAtSeconds: null, readingAtSeconds: null }
      : {
          retrievedAtSeconds: offsetOf(facts.retrievedAt, armedMs),
          readingAtSeconds: offsetOf(facts.readingAt, armedMs),
        };

  // Two clocks, and which one applies is decided by the BRANCH rather than by
  // the facts. A wait that is still running counts up from the persisted origin
  // on every render, so a backgrounded tab, a slow frame and a hard reload all
  // come back with the right number. A wait that has TERMINATED freezes at
  // `endedAt` — a counter that never stops is not an ending (UX row 21).
  const waitingElapsed = armedMs === null ? 0 : wholeSecondsBetween(armedMs, nowMs);
  const terminalElapsed =
    armedMs === null
      ? 0
      : wholeSecondsBetween(armedMs, facts.endedAt === null ? nowMs : facts.endedAt.getTime());

  // 1 — the payoff, ahead of every waiting branch and ahead of `armedAt`.
  if (facts.finding !== null) {
    return {
      kind: "finding",
      elapsedSeconds: terminalElapsed,
      finding: facts.finding,
      ...milestones,
    };
  }

  // 2 — nothing was ever started here. A surface the user never armed must not
  // report an ending, which is why this precedes branch 3.
  if (armedMs === null) {
    return { kind: "unarmed" };
  }

  // 3 — stopped, and unable to still produce a finding.
  const reason = endedReasonFor(facts.runStatus, facts.runOutcome);
  if (reason !== null) {
    return { kind: "ended", elapsedSeconds: terminalElapsed, reason, ...milestones };
  }

  // 4 — a run opened. `retrievedAt` is deliberately not consulted: it can be
  // null here (the cron opens runs for reasons unrelated to the user's
  // trigger), and that is a designed state rather than a crash.
  if (facts.readingAt !== null) {
    return { kind: "leg2", elapsedSeconds: waitingElapsed, ...milestones };
  }

  // 5 — armed, and nothing has come back yet.
  return { kind: "leg1", elapsedSeconds: waitingElapsed, ...milestones };
}
