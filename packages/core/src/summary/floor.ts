// The deterministic floor: a gate-passed candidate turned into sentences a
// person can read, with no model anywhere in reach (O-005 §4.7, FR-F1…FR-F13).
//
// ── WHAT IS NOT TRUE OF THIS FILE, STATED FIRST ─────────────────────────────
//
// NOTHING CALLS `renderFloorSummary` IN PRODUCTION. There is no worker task in
// this repository that invokes it, no service that invokes it, and no route
// that invokes it. It is exercised by its own test suite and by nothing else.
//
// THERE IS NO MODEL CALL. Nothing in `packages/core` imports `ai` or
// `@ai-sdk/anthropic`, and nothing here reads `ANTHROPIC_API_KEY` — this
// package cannot read an environment variable at all, having no node builtin in
// reach. That is the whole point of the module rather than an omission from it.
//
// THERE IS NO PER-PROJECT CAP. No limit on written explanations exists in this
// repository, in any form, partial or otherwise. `floor_cap_exhausted` is a
// value a caller may pass in; it is not evidence that a cap is enforced
// anywhere.
//
// THERE IS NO PERSISTENCE. No findings table, no run table, no migration.
// `packages/shared/src/summary/types.ts:26-45` states the lane's run table is
// not built, and that statement is still true with this file in the tree.
//
// THERE IS NO DELIVERY. Nothing posts a summary to Slack or anywhere else. No
// sentence produced here has ever reached a customer.
//
// ── WHAT IS TRUE ────────────────────────────────────────────────────────────
//
// Every sentence is a fixed template from
// `packages/shared/src/summary/messages.ts` with values written into it. No
// sentence is composed here, so "did a model make this up" has a mechanical
// answer rather than an assurance: there is no model, and there is no free text
// either.
//
// Every fact rendered is read from state the gate already proved. The class is
// `finalClass` — the class the gate CONCLUDED, never `claimedClass` and never
// re-derived from the trace. The confidence is `ranking.confidenceBasis`. The
// magnitudes are the candidate's own `MeasuredCount`s, resolved to their
// declared roles rather than read by position. This module imports no proof
// predicate, no threshold, no gate function and no evidence shape: it renders
// judgements, it does not make them, and the import list is what makes that
// checkable instead of promised.
//
// PURE: no clock, no randomness, no I/O, no node builtin. Both ends of the
// window arrive on the candidate; nothing here asks what time it is, which is
// what lets the same candidate render identically forever.
import {
  FLOOR_CONFIDENCE_TEMPLATES,
  FLOOR_COUNT_TEMPLATES,
  FLOOR_NO_RATE_TEMPLATE,
  FLOOR_OBSERVATION_TEMPLATES,
  FLOOR_TIMEFRAME_TEMPLATE,
  SUMMARY_SOURCE_MESSAGES,
  isNormalisedUrlPath,
  normaliseUrlPath,
} from "@growthmind/shared";

import type { MeasuredCount } from "../counts/measured-count";
import type { CandidateFinding, ConfidenceBasis } from "../findings/candidate";
import { candidateFindingSchema } from "../findings/candidate";
import type { FindingClass } from "../rules/types";
import type { CountRole } from "./count-roles";
import { COUNT_ROLES, resolveCounts } from "./count-roles";
import { substitute } from "./substitute";
import type { FloorSummary, FloorSummarySource } from "./types";
import { floorSummarySourceSchema } from "./types";

// ---------------------------------------------------------------------------
// THE THREE COMPILE PINS (D-3).
//
// `shared` may not import `core`, so each of these tables is keyed in its own
// file by a LOCAL restatement of a union whose home is here. The annotations
// below are what reconcile the two, and they are load-bearing — do not simplify
// one to a bare `const X = Y`. A fifth finding class, a fourth confidence
// basis, or a fourth count role added in `core` WITHOUT its sentence in
// `shared` fails this assignment under `bun run typecheck`, before any test
// runs. The other direction — a key in `shared` with nothing behind it here —
// is a test failure in `__tests__/summary/floor.test.ts`. The technique is the
// one already shipped at `packages/shared/src/gate/messages.ts:21-35` and read
// by `../evidence/trace.ts:59-77`; this is its second use, not a new idea.
// ---------------------------------------------------------------------------

const OBSERVATION: Record<FindingClass, string> = FLOOR_OBSERVATION_TEMPLATES;
const CONFIDENCE: Record<ConfidenceBasis, string> = FLOOR_CONFIDENCE_TEMPLATES;
const COUNT_TEXT: Record<CountRole, string> = FLOOR_COUNT_TEMPLATES;

/** `2026-06-01` — the date part of an ISO instant. */
const ISO_DATE_LENGTH = 10;

/** A full stop followed by a space: the boundary between two sentences inside
 * one fixed string. */
const SENTENCE_BOUNDARY = ". ";
const FULL_STOP = ".";

/**
 * Splits a fixed string into its sentences.
 *
 * SEVERAL SHIPPED CONSTANTS ARE TWO SENTENCES, not one — every `floor_*` value
 * of `SUMMARY_SOURCE_MESSAGES` states what the reader is looking at and then
 * why, in two. The output contract says each element is exactly one sentence
 * (D-1), so those strings are split rather than shortened: shortening one would
 * mean authoring a sentence here, which is the single thing this module must
 * never do, and would take the text out of the plain-English audit that only
 * covers constants declared in `shared`.
 *
 * This SPLITS a fixed string; it never writes a value into one. That remains
 * the sole job of `./substitute`.
 */
function sentencesOf(text: string): readonly string[] {
  const parts = text.split(SENTENCE_BOUNDARY);
  return parts.map((part, index) => (index === parts.length - 1 ? part : `${part}${FULL_STOP}`));
}

/**
 * Returns a sentence, or refuses.
 *
 * FAIL DIRECTION: REFUSE, and this is the last gate before a string leaves the
 * module. An element that is empty, that does not end in a full stop, or that
 * still carries a sentence boundary inside it is not a sentence — and the rule
 * about never implying two different groups of sessions are one group is judged
 * one sentence at a time, so an element that is not one sentence makes that
 * judgement a guess. Refusing here is cheaper than a checker downstream having
 * to re-split prose.
 *
 * THE MESSAGE CARRIES NO ELEMENT TEXT — the offending string holds a page path
 * and count values, and neither belongs in a log line. The position is enough
 * to find it, and the position is a fact about this code rather than about
 * somebody's product.
 */
function oneSentenceOrRefuse(element: string, position: number): string {
  const trimmed = element.trim();

  if (
    trimmed.length === 0 ||
    !trimmed.endsWith(FULL_STOP) ||
    trimmed.includes(SENTENCE_BOUNDARY)
  ) {
    throw new Error(`floor_element_not_one_sentence: ${String(position)}`);
  }

  return trimmed;
}

/**
 * One magnitude, with its denominator in the SAME sentence.
 *
 * That property is structural rather than remembered: every value of
 * `FLOOR_COUNT_TEMPLATES` carries `{numerator}`, `{denominator}` and `{unit}`
 * in one string, so there is no template here that can render a numerator
 * alone and therefore no call shape that can either.
 *
 * A zero denominator is a real, reportable state — every session in the window
 * was set aside — and it takes the no-rate sentence instead. Never a division,
 * never a blank: the division has no answer and the blank reads as nothing
 * having happened, which is a different and false claim.
 */
function magnitudeSentence(role: CountRole, count: MeasuredCount, surface: string): string {
  if (count.denominator === 0) {
    return FLOOR_NO_RATE_TEMPLATE;
  }

  return substitute(COUNT_TEXT[role], {
    numerator: String(count.numerator),
    denominator: String(count.denominator),
    unit: count.unit,
    surface,
  });
}

/**
 * Turns a gate-passed candidate into sentences, with no model involved.
 *
 * ── FAIL DIRECTION: REFUSE, at every step, for one reason ──────────────────
 *
 * A summary that never appears is a gap: somebody notices it, and a caller can
 * handle it. A summary that appears carrying the arrival count where the
 * departure count belongs, or a raw brace expression where a number belongs, or
 * a page path nobody vouched for, is a wrong claim about somebody's product
 * that nobody can see is wrong — and it is read by a person deciding what to
 * change. The whole ladder below therefore throws rather than guessing:
 *
 *  - a candidate that does not satisfy `candidateFindingSchema` (the boundary
 *    comes FIRST, so a caller cannot skip it by passing an already-typed
 *    value);
 *  - a `source` outside the five model-free causes — including
 *    `model_rendered`, which this function may never claim;
 *  - a `surface` that is not already in its normalised form (below);
 *  - a `counts` arity that disagrees with the detector's declared roles
 *    (`resolveCounts` refuses; a mislabelled number is worse than none);
 *  - a template carrying a placeholder nothing supplies (`substitute` refuses);
 *  - a rendered element that is not exactly one sentence.
 *
 * ── WHY AN UN-NORMALISED SURFACE IS REFUSED, SPECIFICALLY (D-9) ────────────
 *
 * This is the first code in the repository that puts a `surface` in front of a
 * person. A path segment can carry a live token or an address —
 * `packages/shared/src/sessions/url-path.ts:9-17` is the record of that hazard
 * and of the redaction that answers it — and `candidateFindingSchema.surface`
 * accepts any non-empty string, so the contract alone does not guarantee the
 * redaction ran. THE REFUSAL MESSAGE NAMES ONLY THE NORMALISED FORM, never the
 * value that came in: naming the input would put the very token this check
 * exists to stop into a log line, which is the same leak one step to the left.
 * Same direction, and the same discipline, as
 * `../findings/evidence-shape.ts:104-114`.
 *
 * The isolation half — one refused candidate must not abort a whole run — is
 * NOT here and is not claimed. It belongs to whatever eventually calls this,
 * and nothing does yet.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *
 * NO RATIO IS COMPUTED BETWEEN COUNTS (D-6). A funnel candidate's two counts
 * share one denominator — the kept sessions in the window — so dividing one by
 * the other does NOT produce the drop rate the detector applied its threshold
 * to. That rate has a different denominator, no `MeasuredCount` on the
 * candidate carries it, and deriving it here would be this module inventing a
 * statistic. The honest consequence is real and worth naming: a reader is shown
 * the two counts the threshold was computed from, and not the threshold's own
 * rate. Making that renderable needs a third count from the detector.
 *
 * NO NEXT STEP IS STATED. The vocabulary carries no instruction, and nothing
 * shipped can act on a finding, so a sentence implying otherwise would promise
 * work that does not exist. A reader asking what to do about it gets silence
 * from this code — a real cost, chosen over a promise nothing can keep.
 *
 * NO CLASS IS RE-DERIVED. `finalClass` is read as given. `claimedClass` and
 * `trace` are not read at all.
 */
export function renderFloorSummary(input: {
  readonly candidate: CandidateFinding;
  readonly source: FloorSummarySource;
}): FloorSummary {
  // 1. THE BOUNDARY, AND IT COMES FIRST. Both parses throw rather than falling
  //    back; there is no `??` and no default anywhere below.
  const candidate: CandidateFinding = candidateFindingSchema.parse(input.candidate);
  const source: FloorSummarySource = floorSummarySourceSchema.parse(input.source);

  // 2. The surface must already be normalised (D-9). The predicate and the form
  //    named in the refusal both come from the module that OWNS normalisation,
  //    so this file states no rule of its own about what a path may look like.
  if (!isNormalisedUrlPath(candidate.surface)) {
    // `null` means the value has no usable path in it at all, which is itself
    // not a normalised form — so there is nothing safe to name beyond that.
    const normalised = normaliseUrlPath(candidate.surface, null);
    throw new Error(`surface_not_normalised: ${normalised ?? "none"}`);
  }

  const surface = candidate.surface;

  // 3. Positions resolved to declared roles. Refuses on arity disagreement.
  const resolved = resolveCounts(candidate);
  const roles: readonly CountRole[] = COUNT_ROLES[resolved.detector];
  const countsByRole: Readonly<Record<string, MeasuredCount>> = resolved.counts;

  // 4. The observation, keyed by the class the GATE CONCLUDED.
  const observation = substitute(OBSERVATION[candidate.finalClass], { surface });

  // 5. The magnitudes, IN DECLARED ROLE ORDER — never in array order, and never
  //    by index.
  //
  //    THE ONE DEDUPLICATION IN THIS MODULE, and it is not cosmetic. Both of a
  //    funnel candidate's counts share the same denominator, so when that
  //    denominator is zero BOTH roles produce the identical no-rate sentence.
  //    Emitting it twice would state one fact about the window as though it had
  //    been measured twice, which is the same defect as rendering one count
  //    twice under two different labels. A magnitude sentence carrying its own
  //    numerator and denominator is unique per role and is never affected by
  //    this.
  const magnitudes: string[] = [];
  for (const role of roles) {
    const count = countsByRole[role];
    if (count === undefined) {
      throw new Error(`floor_unresolved_count_role: ${role}`);
    }

    const sentence = magnitudeSentence(role, count, surface);
    if (!magnitudes.includes(sentence)) {
      magnitudes.push(sentence);
    }
  }

  // 6. The window, from the candidate's own timeframe. NO CLOCK IS READ — both
  //    ends arrive on the candidate. Rendered as dates rather than as a phrase
  //    like the last seven days, which would be relative to a moment this code
  //    cannot read and would stop being true the day after it was written.
  const timeframe = substitute(FLOOR_TIMEFRAME_TEMPLATE, {
    windowStart: candidate.timeframe.start.toISOString().slice(0, ISO_DATE_LENGTH),
    windowEnd: candidate.timeframe.end.toISOString().slice(0, ISO_DATE_LENGTH),
  });

  // 7. Confidence, in words. The table carries no digit and none may be added:
  //    there is no numeric confidence in this product, and a number here would
  //    be a precision nothing computed and the most memorable thing a reader
  //    took away, precisely because it looks exact.
  const confidence = CONFIDENCE[candidate.ranking.confidenceBasis];

  // 8. How this was produced — the already-shipped, already-audited sentence
  //    for the cause the CALLER named. Not re-authored here, and not derived:
  //    this code has no env access, no model and no cap, so every cause it
  //    could infer would be a guess.
  const provenance = SUMMARY_SOURCE_MESSAGES[source];

  // The observation is ONE sentence — every value of `FLOOR_OBSERVATION_TEMPLATES`
  // is, and a table edit that made one of them two would silently turn the
  // headline into a fragment. Refused rather than truncated or joined.
  const headline = sentencesOf(observation).map((element, position) =>
    oneSentenceOrRefuse(element, position),
  );
  if (headline.length !== 1) {
    throw new Error(`floor_headline_not_one_sentence: ${candidate.finalClass}`);
  }

  const context = [...magnitudes, timeframe, confidence, provenance]
    .flatMap((element) => sentencesOf(element))
    .map((element, position) => oneSentenceOrRefuse(element, position));

  // 9. `source` is carried through exactly as it arrived.
  return { source, headline: headline[0], context };
}
