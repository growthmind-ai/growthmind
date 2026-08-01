// THE PAYOFF, RENDERED (O-008, FR-O20, EC-O5).
//
// A founder broke something in their own product, watched us narrate it, and
// this is the card that has to survive them CHECKING IT.
//
// ###########################################################################
// # THE VIEW DOES NO MATHS, AND THAT IS THE WHOLE POINT.
// #
// # Numerator and denominator are carried through unaltered, `context[]` is
// # rendered one line each and never re-split or joined, and the confidence is
// # a sentence rather than a number. A founder checking our numbers must be
// # checking THE PIPELINE'S numbers — not this module's re-derivation of them.
// # A view that recomputes anything is a second place for the arithmetic to be
// # wrong, and the founder cannot see which of the two they are reading (D11).
// ###########################################################################
//
// The two boundaries that produce WRONG claims rather than missing ones:
//
//   - A ZERO DENOMINATOR takes `FLOOR_NO_RATE_TEMPLATE`, never a division. The
//     division has no answer, and a blank reads as "nothing happened" — a
//     different and false claim. Never NaN, never Infinity, never empty.
//   - A RAW MACHINE KEY must never reach the screen. `finalClass` is the
//     persisted `findings.final_class` value and `confidenceBasis` is the
//     persisted basis; both are KEYS into shipped tables, and a view that
//     forwarded either would render "changed_mind" or "at_threshold" at a
//     founder on the one screen this MVP exists for.
//
// ── ONE HOME FOR THE SENTENCES, AND IT IS NOT THIS FILE ─────────────────────
//
// `FLOOR_OBSERVATION_TEMPLATES`, `FLOOR_COUNT_TEMPLATES`,
// `FLOOR_CONFIDENCE_TEMPLATES`, `FLOOR_NO_RATE_TEMPLATE` and
// `SUMMARY_SOURCE_MESSAGES` all ship, each row carrying the comment that names
// the proof licensing its sentence, and all of them are already inside the
// summary lane's plain-English audit. A second table keyed by the same names in
// `onboarding/messages.ts` would be the D11 fork AD-4 spends a whole decision
// avoiding, and the two would disagree the first time a threshold moved. This
// file SELECTS and SUBSTITUTES. It authors nothing.
//
// ── THE ROLE SOURCE, SETTLED ────────────────────────────────────────────────
//
// `FLOOR_COUNT_TEMPLATES` has three roles and nothing on this wire says which
// one a given count takes: `measuredCountRowSchema`
// (`packages/db/src/repositories/findings.repo.ts:62-79`) carries a numerator,
// a denominator, a unit, a timeframe and a basis — and NO role. So the role is
// not "unstated in the ADD"; it is ABSENT FROM THE EVIDENCE.
//
// `affected_sessions` is therefore the only one this surface may use. The other
// two each assert a specific behaviour — that these sessions ARRIVED at the
// page, or that they LEFT it without going anywhere they could have gone — and
// neither is established by a row that records neither. `affected_sessions`
// says only that these sessions were affected there, which is exactly what the
// finding existing establishes and no more. That is the same discipline
// `summary/messages.ts:202-215` records: a sentence keyed by an outcome is
// emitted on every path to that outcome, so it may assert only what the
// WEAKEST such path proves. When a role does reach this wire, this is the one
// line that changes.

import {
  FLOOR_CONFIDENCE_TEMPLATES,
  FLOOR_COUNT_TEMPLATES,
  FLOOR_NO_RATE_TEMPLATE,
  FLOOR_OBSERVATION_TEMPLATES,
  SUMMARY_SOURCE_MESSAGES,
} from "../summary/messages";
import { FINDING_CLASS_UNKNOWN_TEMPLATE, FINDING_CONFIDENCE_UNKNOWN } from "./messages";
import type { OnboardingCount, OnboardingFinding } from "./types";

/**
 * One count, rendered.
 *
 * The four values are repeated beside `sentence` rather than only inside it, so
 * a consumer can lay them out without re-parsing prose — and so a test can
 * prove the sentence carries what the row measured rather than a rounding of it.
 */
export type FindingCountLine = {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: "sessions";
  readonly surface: string;
  /** Numerator, denominator, unit and the page, in ONE string. */
  readonly sentence: string;
};

/** What the finding card renders, in the order UX Checklist row 20 gives. */
export type FindingView = {
  readonly classSentence: string;
  readonly headline: string;
  /** `context[]`, one line each. Never re-split, never joined, never padded. */
  readonly contextLines: readonly string[];
  readonly counts: readonly FindingCountLine[];
  /** In words. Never a number — `FLOOR_CONFIDENCE_TEMPLATES` holds no digit. */
  readonly confidenceSentence: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  /** Verbatim from `SUMMARY_SOURCE_MESSAGES`. */
  readonly sourceSentence: string;
};

/**
 * The shipped tables, read through a total index signature.
 *
 * `finalClass` and `confidenceBasis` arrive as `string` — their home unions
 * live in `packages/core`, which `shared` may not import. Widening the lookup
 * here rather than casting the key is what forces the `undefined` branch to be
 * written, and that branch is the whole D5 guard: prod contains every shape
 * ever written, including a class this table has not heard of.
 */
const OBSERVATION_BY_CLASS: Readonly<Record<string, string | undefined>> =
  FLOOR_OBSERVATION_TEMPLATES;
const CONFIDENCE_BY_BASIS: Readonly<Record<string, string | undefined>> =
  FLOOR_CONFIDENCE_TEMPLATES;

/**
 * The count sentence. See the role note in this file's header for why this is
 * the one template a finding-level count may take.
 */
const COUNT_TEMPLATE = FLOOR_COUNT_TEMPLATES.affected_sessions;

function substitute(template: string, tokens: Readonly<Record<string, string>>): string {
  let rendered = template;
  for (const [token, value] of Object.entries(tokens)) {
    rendered = rendered.replaceAll(`{${token}}`, value);
  }
  return rendered;
}

/**
 * The class, in plain English.
 *
 * A class the shipped table knows renders ITS sentence with the page
 * substituted, and nothing else — not a paraphrase, not a prefix, not a
 * title-cased key. A class it does not know renders a sentence that claims only
 * what is still true, and never echoes the key: "instrumentation" in front of a
 * founder is a product-decisions §10 breach whether or not any test named it.
 */
function classSentenceFor(finalClass: string, surface: string): string {
  const shipped = OBSERVATION_BY_CLASS[finalClass];
  return shipped === undefined
    ? substitute(FINDING_CLASS_UNKNOWN_TEMPLATE, { page: surface })
    : substitute(shipped, { surface });
}

/**
 * How much weight the evidence carries, IN WORDS.
 *
 * NO DIGIT, EVER, on either branch. There is no numeric confidence anywhere in
 * this product; inventing one here would put a precision in front of a reader
 * that nothing computed, and it would be their most memorable takeaway
 * precisely because it looks exact.
 */
function confidenceSentenceFor(confidenceBasis: string): string {
  return CONFIDENCE_BY_BASIS[confidenceBasis] ?? FINDING_CONFIDENCE_UNKNOWN;
}

/**
 * One count line.
 *
 * A zero denominator is a REAL, REPORTABLE STATE — every session in the window
 * was set aside, leaving no share to report — and it is stated in words. It is
 * not a division that produced nothing, and it is not a blank.
 */
function toCountLine(count: OnboardingCount, surface: string): FindingCountLine {
  const sentence =
    count.denominator === 0
      ? FLOOR_NO_RATE_TEMPLATE
      : substitute(COUNT_TEMPLATE, {
          numerator: String(count.numerator),
          denominator: String(count.denominator),
          unit: count.unit,
          surface,
        });

  return {
    numerator: count.numerator,
    denominator: count.denominator,
    unit: count.unit,
    surface,
    sentence,
  };
}

/**
 * The finding, rendered.
 *
 * AN ABSENT EXPLANATION IS NEVER AN ABSENT FINDING. Every `floor_*` source
 * still renders the headline, the counts and the window; the ONLY thing that
 * changes is the `SUMMARY_SOURCE_MESSAGES` line saying a written explanation is
 * missing and why.
 */
export function toFindingView(finding: OnboardingFinding): FindingView {
  return {
    classSentence: classSentenceFor(finding.finalClass, finding.surface),
    headline: finding.headline,
    // ONE LINE IN, ONE LINE OUT. The pipeline decided where the sentence
    // boundaries are; the consumer renders what it is handed.
    contextLines: [...finding.context],
    counts: finding.counts.map((count) => toCountLine(count, finding.surface)),
    confidenceSentence: confidenceSentenceFor(finding.confidenceBasis),
    windowStart: finding.windowStart,
    windowEnd: finding.windowEnd,
    sourceSentence: SUMMARY_SOURCE_MESSAGES[finding.summarySource],
  };
}
