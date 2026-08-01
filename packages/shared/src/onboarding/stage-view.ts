// WHAT THE STAGE PUTS ON SCREEN (O-008, AD-5, FR-O18, ruling R1b).
//
// The whole surface is one idea: EVERY LOG LINE IS PAST TENSE AND CARRIES ITS
// OWN STAMP. Nothing on screen reaches into the future, so nothing on screen
// can be read as a promise — FR-O18 stops being a rule somebody must remember
// and becomes a property of the shape.
//
// ###########################################################################
// # R-LATENCY BINDS HERE HARDEST, AND IT IS SETTLED, NOT REOPENED.
// #
// # The internal design target of ~25-35 s sizes the build and the acceptance
// # run. IT APPEARS IN NO RENDERED STRING. No countdown, no promised number,
// # no progress bar implying a known duration, no ETA, no ring, no percentage.
// #
// # The ONE time value this surface may carry is ELAPSED, counting UP from a
// # persisted origin, because it states what has ALREADY happened rather than
// # what is about to. That is also why `elapsedSeconds` and every line's stamp
// # are NUMBERS rather than pre-formatted strings: a committed duration cannot
// # hide inside a number defined as "now minus armedAt". A promise can only
// # hide in a sentence, and every sentence here is imported from the copy home.
// ###########################################################################
//
// A NOTE ON THE STAMPS, BECAUSE IT IS THE ONE THING THIS FILE CANNOT INVENT.
// A line's `atSeconds` is a MEASUREMENT of when a persisted milestone was
// reached, carried here on the reduced state (see the superset note in
// `stage.ts`'s header). Where a milestone's stamp is absent, the line is
// OMITTED rather than stamped with a guess — a fabricated timestamp on the one
// screen whose whole promise is evidence is worse than a line that has not
// appeared yet, and "which line has not appeared yet" is how FR-O29 tells the
// founder which leg is slow, with no forward-looking word anywhere.

import { ANALYSIS_OUTCOME_MESSAGES, ANALYSIS_RUN_STATUS_MESSAGES } from "../summary/messages";
import {
  STAGE_ENDED_HINT,
  STAGE_FOUND_HEADING,
  STAGE_FOUND_HINT,
  STAGE_LOG_ARMED,
  STAGE_LOG_READING,
  STAGE_LOG_RETRIEVED,
  STAGE_READING_HEADING,
  STAGE_READING_HINT,
  STAGE_UNARMED_HEADING,
  STAGE_UNARMED_HINT,
  STAGE_WATCHING_HEADING,
  STAGE_WATCHING_HINT,
} from "./messages";
import type { RenderedStageState } from "./stage";
import type { EndedReason } from "./types";

/**
 * One line of the wait log, rendered as `+Ns` beside a past-tense fact.
 *
 * The stamp is its own field rather than baked into `text` so APPEND-ONLY is
 * checkable: a later state may append lines, but an existing line's text AND
 * stamp must both be byte-identical to what came before. Re-wording or
 * re-stamping a line already on screen is rewriting history in front of the
 * person who watched it happen.
 */
export type StageLogLine = {
  /** Seconds after arming. Never negative, always whole. */
  readonly atSeconds: number;
  /** Past tense. Nothing forward-looking, so nothing reads as a promise. */
  readonly text: string;
};

/**
 * What the stage renders.
 *
 * The field list is the ban. There is no `remainingSeconds`, no
 * `targetSeconds`, no `percentComplete`, no `etaSeconds` and no
 * `expectedAnything` — the same structural refusal AD-3 applies to
 * `expectedLag` on the counter, applied here by enumeration so the NEXT such
 * field is refused by default too.
 */
export type StageView = {
  readonly heading: string;
  readonly hint: string;
  readonly lines: readonly StageLogLine[];
  readonly elapsedSeconds: number;
};

/**
 * The ending's heading is the SHIPPED sentence for that reason, never one
 * authored here (B3). All three read distinctly and always will: "we have not
 * looked yet", "we looked and your product was quiet" and "the check itself
 * broke" are three different facts, and collapsing any pair tells a founder
 * something untrue about their own product (UX Checklist row 21).
 */
const ENDED_HEADINGS: Record<EndedReason, string> = {
  failed: ANALYSIS_RUN_STATUS_MESSAGES.failed,
  no_candidates_passed_gate: ANALYSIS_OUTCOME_MESSAGES.no_candidates_passed_gate,
  no_sessions_to_analyse: ANALYSIS_OUTCOME_MESSAGES.no_sessions_to_analyse,
};

/**
 * A stamp we are willing to print, or nothing.
 *
 * Deliberately tolerant of `undefined` as well as `null`: a hand-constructed
 * `RenderedStageState` — a fixture, a future caller composing one by hand —
 * carries no milestones, and the honest answer to "when did that happen" is
 * then silence rather than a number nobody measured.
 */
function stampOf(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;
}

const line = (atSeconds: number, text: string): StageLogLine => ({ atSeconds, text });

/**
 * The log for a state that has an origin.
 *
 * `armed` is always first and always `+0s` — arming IS the origin, so that
 * stamp is true by construction and never moves. The two milestone lines follow
 * in the order they can occur, each only when its stamp is known.
 *
 * `readingAssured` is set for `leg2` alone. That arm exists if and only if an
 * analysis run opened (`readingAt !== null` is what produces it), so the line
 * is certainly true even when the caller withheld the stamp; the render falls
 * back to the elapsed reading, which is the moment we can prove it had happened
 * by. Every other arm omits the line rather than assume it.
 */
function logFor(
  elapsedSeconds: number,
  retrievedAtSeconds: number | null | undefined,
  readingAtSeconds: number | null | undefined,
  readingAssured: boolean,
): readonly StageLogLine[] {
  const lines: StageLogLine[] = [line(0, STAGE_LOG_ARMED)];

  const retrieved = stampOf(retrievedAtSeconds);
  if (retrieved !== null) {
    lines.push(line(retrieved, STAGE_LOG_RETRIEVED));
  }

  const reading = stampOf(readingAtSeconds);
  if (reading !== null) {
    lines.push(line(reading, STAGE_LOG_READING));
  } else if (readingAssured) {
    lines.push(line(Math.max(0, Math.round(elapsedSeconds)), STAGE_LOG_READING));
  }

  return lines;
}

/**
 * The reduced state, rendered.
 *
 * Every string comes from the copy home; this function chooses between them and
 * carries numbers through. It authors nothing.
 */
export function renderStageView(state: RenderedStageState): StageView {
  switch (state.kind) {
    case "unarmed":
      // No origin, so no log: there is nothing that has already happened to
      // state in the past tense. An empty log is honest here; a `+0s` line
      // would claim a wait that was never started.
      return {
        heading: STAGE_UNARMED_HEADING,
        hint: STAGE_UNARMED_HINT,
        lines: [],
        elapsedSeconds: 0,
      };

    case "leg1":
      return {
        heading: STAGE_WATCHING_HEADING,
        hint: STAGE_WATCHING_HINT,
        lines: logFor(
          state.elapsedSeconds,
          state.retrievedAtSeconds,
          state.readingAtSeconds,
          false,
        ),
        elapsedSeconds: state.elapsedSeconds,
      };

    case "leg2":
      // The two legs are NAMED DIFFERENTLY. One "working…" heading across both
      // would erase the only signal that says which leg is slow.
      return {
        heading: STAGE_READING_HEADING,
        hint: STAGE_READING_HINT,
        lines: logFor(state.elapsedSeconds, state.retrievedAtSeconds, state.readingAtSeconds, true),
        elapsedSeconds: state.elapsedSeconds,
      };

    case "finding":
      // The log and the elapsed STAY ON SCREEN under the finding. The evidence
      // of the wait is what makes the arrival read as an arrival rather than as
      // a page swap.
      return {
        heading: STAGE_FOUND_HEADING,
        hint: STAGE_FOUND_HINT,
        lines: logFor(
          state.elapsedSeconds,
          state.retrievedAtSeconds,
          state.readingAtSeconds,
          false,
        ),
        elapsedSeconds: state.elapsedSeconds,
      };

    case "ended":
      return {
        heading: ENDED_HEADINGS[state.reason],
        hint: STAGE_ENDED_HINT,
        lines: logFor(
          state.elapsedSeconds,
          state.retrievedAtSeconds,
          state.readingAtSeconds,
          false,
        ),
        elapsedSeconds: state.elapsedSeconds,
      };
  }
}
