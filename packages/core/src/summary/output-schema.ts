// The model lane's output shape, its sentence join, and the SAC runtime guard
// (O-011 AD-6, AD-7, AD-8, FR-M3, FR-M4).
//
// WHY THREE CONCERNS IN ONE FILE, STATED FIRST. This is the ONE addition
// permitted to a directory O-005 shipped and froze. The three things below are
// the three things the model lane needs from `core` and they are inseparable in
// use: the shape a model result must satisfy, the join between the floor's
// pre-split sentences and the port's single string, and the per-sentence
// judgement that decides whether generated text may be shown at all. Splitting
// them across three modules would add two more files to a frozen directory to
// buy nothing.
//
// WHY THE SCANNERS ARE RE-EXPRESSED HERE. `__tests__/summary/guards.test.ts`
// pins four mechanical scanners, each proven non-vacuous by a planted offender.
// A test file is not an import surface, so production cannot call them. The
// duplication is accepted on one condition, and the condition is enforced:
// `__tests__/summary/output-schema.test.ts` replays those same planted
// offenders — copied verbatim, not paraphrased — against `guardModelText`. A
// scanner that stops biting in one home fails a named test in the other.
//
// FAIL DIRECTION: WITHHOLD, EVERYWHERE (edge taxonomy D10). Prose that cannot
// be segmented into single sentences is a REJECTION, never a publish-unchecked:
// the per-sentence rows below are judged one sentence at a time, so text no
// honest segmentation exists for cannot be judged, and unjudged text does not
// reach a customer. The caller's answer to a rejection is the floor, under
// `floor_model_text_rejected`.
//
// AN OFFENCE NAMES THE ROW AND THE POSITION, NEVER THE TEXT (AD-7). The
// offending element carries a customer's page path and their counts. The rule
// id plus the element index is enough to find it, and both are facts about this
// code rather than about somebody's product — the same discipline as
// `./floor.ts:124-128` and `../findings/evidence-shape.ts:104-114`.
//
// PURE: no clock, no randomness, no I/O, no node builtin — the package-wide
// property `__tests__/detect/purity.test.ts` asserts over all of `src/`.
import { z } from "zod";

import { PROOF_PREDICATES } from "../evidence/predicates";
import type { CandidateFinding } from "../findings/candidate";
import { confidenceBasisSchema } from "../findings/candidate";
import { detectorNameSchema, findingClassSchema } from "../rules/types";

// ---------------------------------------------------------------------------
// 1. THE OUTPUT SHAPE (FR-M3)
// ---------------------------------------------------------------------------

/**
 * What a model may return, and nothing else.
 *
 * `z.strictObject` is LOAD-BEARING rather than tidy. An undeclared key is a
 * REFUSAL, not a silent drop: a silent drop would let a model emit a number, a
 * class name, or a confidence and leave no trace that it tried, and the caller
 * would persist a summary whose provenance said the model behaved. There is no
 * field here for a count, a class, a confidence, a surface, or a timeframe —
 * every one of those is already on the candidate, and a second copy authored by
 * a model is a second claim nobody proved.
 *
 * `packages/shared/src/summary/types.ts:188-191` said FR-8 rested on a comment
 * alone until this schema existed. This is what makes it structural.
 *
 * Both fields are REQUIRED and non-empty. An empty headline is a shape failure
 * — `floor_model_output_invalid` — and not text for the guard to judge.
 */
export const modelSummaryOutputSchema = z.strictObject({
  /** The observation, in one sentence. */
  headline: z.string().min(1),
  /** The rest, as prose. Segmented by `splitSentences` before it is judged. */
  context: z.string().min(1),
});
export type ModelSummaryOutput = z.infer<typeof modelSummaryOutputSchema>;

// ---------------------------------------------------------------------------
// 2. THE JOIN (AD-6)
// ---------------------------------------------------------------------------

const SPACE = " ";
/** A terminator that ends a sentence — or that does not, which is the whole
 * problem `splitSentences` refuses rather than guesses about. */
const TERMINATORS = [".", "!", "?"] as const;

function isTerminator(character: string | undefined): boolean {
  return character !== undefined && TERMINATORS.some((mark) => mark === character);
}

function isUpperCase(character: string | undefined): boolean {
  return (
    character !== undefined && character !== character.toLowerCase() && /^[A-Za-z]$/.test(character)
  );
}

/**
 * Prose to single sentences, or `null`.
 *
 * `null` IS THE POINT, and it is the fail direction FR-M4 rests on. A
 * terminator followed by whitespace and a capital is a sentence boundary; a
 * terminator at the very end of the text is one too. ANYTHING ELSE — an
 * abbreviation, a decimal, an initial, a terminator mid-clause — is ambiguous,
 * and a segmenter that guessed there would hand the per-sentence rows below a
 * clause bled across two elements and call the result a judgement. Prose with
 * no terminator at all is one unbounded run-on and is refused for the same
 * reason.
 *
 * The floor never reaches this function: its elements arrive already split, by
 * construction, from fixed templates. This exists for text a model wrote, where
 * splitting is exactly the step that stops being reliable.
 */
export function splitSentences(text: string): readonly string[] | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (!isTerminator(trimmed[trimmed.length - 1])) return null;

  const sentences: string[] = [];
  let start = 0;

  for (let index = 0; index < trimmed.length; index += 1) {
    if (!isTerminator(trimmed[index])) continue;

    const atEnd = index === trimmed.length - 1;
    if (atEnd) {
      sentences.push(trimmed.slice(start, index + 1).trim());
      break;
    }

    // A terminator run (`?!`) belongs to the sentence it closes.
    if (isTerminator(trimmed[index + 1])) continue;

    const next = trimmed[index + 1];
    if (next !== SPACE && next !== "\n" && next !== "\t") return null;

    let scan = index + 1;
    while (scan < trimmed.length && trimmed[scan] === SPACE) scan += 1;
    if (!isUpperCase(trimmed[scan])) return null;

    sentences.push(trimmed.slice(start, index + 1).trim());
    start = scan;
  }

  if (sentences.length === 0) return null;
  if (sentences.some((sentence) => sentence.length === 0)) return null;
  return sentences;
}

/**
 * Sentences back to one string — the other half of the join between the floor's
 * `context: readonly string[]` and the port's `context: string`.
 *
 * One space, no reflow, no re-punctuation: this function must never author or
 * alter a sentence, only place already-judged ones beside each other.
 */
export function joinSentences(sentences: readonly string[]): string {
  return sentences.join(SPACE);
}

// ---------------------------------------------------------------------------
// 3. THE SAC RUNTIME GUARD (AD-6, AD-7, AD-8)
// ---------------------------------------------------------------------------

/**
 * The rows this guard judges. A LOCAL union rather than an import: the contract
 * module in `shared` is not barrel-exported, and the rows enforced at RUNTIME
 * over generated text are a subset of the contract, not the whole of it —
 * SAC-1, SAC-6 and SAC-9 are structural or belong to other lanes.
 */
export type GuardedSacId =
  | "SAC-2"
  | "SAC-3"
  | "SAC-4"
  | "SAC-5"
  | "SAC-7"
  | "SAC-8"
  | "SAC-11"
  | "SAC-12";

/**
 * One rule broken at one position.
 *
 * TWO FIELDS, AND NEVER A THIRD. The offending string carries a page path and
 * count values; neither belongs in a log line, a metric label, or a Slack
 * message. `element` is `0` for the headline and `1..n` for the context
 * sentences in order.
 *
 * `sac` READS AS A STRING and is WRITTEN as a `GuardedSacId`. The pin lives at
 * the construction site — `offencesInElement` can only record a row this guard
 * declares — while the field stays comparable against a row id read from the
 * contract module or from a persisted row, neither of which is this union.
 */
export type SacOffence = {
  readonly sac: string;
  readonly element: number;
};

/** Why the guard refused, when it did. */
export type GuardRefusal = "candidate_invalid" | "not_segmentable" | "sac_offences";

export type GuardVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly refusal: GuardRefusal;
      readonly offences: readonly SacOffence[];
    };

// --- the scanners, re-expressed from `__tests__/summary/guards.test.ts` -----

/** Every digit run in `text` that is not in `allowed` (SAC-2). */
function bareDigitOffenders(text: string, allowed: ReadonlySet<string>): readonly string[] {
  return (text.match(/\d+/g) ?? []).filter((run) => !allowed.has(run));
}

/** A numerator rendered without the denominator that scopes it (SAC-3). */
function isDenominatorless(
  sentence: string,
  counts: readonly { readonly numerator: number; readonly denominator: number }[],
): boolean {
  const runs = new Set(sentence.match(/\d+/g) ?? []);
  return counts.some(
    (count) => runs.has(String(count.numerator)) && !runs.has(String(count.denominator)),
  );
}

/** Words that describe repeated visiting — the STRUGGLING cohort. */
const STRUGGLE_TOKENS = ["coming back", "over and over", "repeatedly", "again", "revisit"] as const;
/** Words that describe leaving — the DROPPED cohort. */
const DROP_TOKENS = ["left", "dropped", "without going anywhere", "gave up"] as const;

/**
 * One sentence carrying BOTH vocabularies (SAC-11).
 *
 * A summary may legitimately contain a struggle sentence AND a drop sentence —
 * that is the permitted composition. What it may never do is put both in one
 * sentence, where a reader parses them as one cohort. The two cohorts are
 * structurally disjoint, so two individually true clauses compose into one
 * false claim.
 *
 * Deliberately STRONGER than the row needs: it fires on any sentence carrying
 * both vocabularies, whatever its counts. Withhold is the safe direction.
 */
function isCohortConflation(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return (
    STRUGGLE_TOKENS.some((token) => lower.includes(token)) &&
    DROP_TOKENS.some((token) => lower.includes(token))
  );
}

/** Every machine identifier that must never reach a reader (SAC-8). Built from
 * the real tables, never hand-listed — a fifth class or a renamed predicate
 * joins the denylist without anybody remembering to edit it. */
const MACHINE_IDENTIFIERS: readonly string[] = [
  ...findingClassSchema.options,
  ...confidenceBasisSchema.options,
  ...detectorNameSchema.options,
  ...Object.values(PROOF_PREDICATES).map((predicate) => predicate.name),
  "evidence_shape",
];

function hasMachineIdentifier(text: string): boolean {
  const lower = text.toLowerCase();
  if (MACHINE_IDENTIFIERS.some((identifier) => lower.includes(identifier.toLowerCase()))) {
    return true;
  }
  // A version-looking token is an identifier too — `v1`, `1.0`, `2.1.3`.
  return /\bv\d+\b|\b\d+\.\d+(?:\.\d+)?\b/.test(text);
}

/** Connectives that assert one claim caused another (SAC-7). */
const CAUSAL_CONNECTIVES = [
  "because",
  "caused",
  "due to",
  "so that",
  "which is why",
  "therefore",
] as const;

function hasCausalConnective(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return CAUSAL_CONNECTIVES.some((connective) => lower.includes(connective));
}

/** Phrases that name a time the candidate did not (SAC-5). A window is a fact
 * on the candidate; a relative phrase is true only on the day it was written. */
const RELATIVE_TIME_PHRASES = [
  "recently",
  "today",
  "yesterday",
  "this week",
  "last week",
  "currently",
  "right now",
  "these days",
] as const;

function hasRelativeTime(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return RELATIVE_TIME_PHRASES.some((phrase) => lower.includes(phrase));
}

/** Path-looking tokens, so a surface nobody vouched for can be named (SAC-4). */
const PATH_TOKEN = /\/[^\s,;:!?]*[^\s,;:!?.]/g;

function hasForeignSurface(sentence: string, surface: string): boolean {
  return (sentence.match(PATH_TOKEN) ?? []).some((token) => token !== surface);
}

/** A confidence stated as a figure (SAC-12). There is no numeric confidence in
 * this product, so any digit beside the word is a precision nothing computed. */
function hasNumericConfidence(sentence: string): boolean {
  return sentence.toLowerCase().includes("confiden") && /\d/.test(sentence);
}

/**
 * The digits a candidate vouches for, plus the ones its own surface and window
 * legitimately carry.
 *
 * DERIVED FROM THE CANDIDATE, NEVER FROM THE TEXT. An allow-list read off the
 * rendered string would make every invented number allowed by construction —
 * which is the precise failure this row exists to catch.
 */
function allowedDigitRuns(candidate: CandidateFinding): ReadonlySet<string> {
  const allowed = new Set<string>();
  for (const count of candidate.counts) {
    allowed.add(String(count.numerator));
    allowed.add(String(count.denominator));
  }
  return allowed;
}

const ISO_DATE_LENGTH = 10;

/** The surface and both window dates blanked out — each carries digits the
 * candidate supplied, and none of them is an invented statistic. Blanked with
 * `split`/`join` rather than a replace: writing a value into a string is
 * `./substitute`'s sole job, and this writes nothing into anything. */
function maskCandidateDigits(text: string, candidate: CandidateFinding): string {
  const masked = [
    candidate.surface,
    candidate.timeframe.start.toISOString().slice(0, ISO_DATE_LENGTH),
    candidate.timeframe.end.toISOString().slice(0, ISO_DATE_LENGTH),
  ].reduce((carried, token) => carried.split(token).join(SPACE), text);
  return masked;
}

/** Every row broken by ONE element, judged as one sentence. */
function offencesInElement(
  element: string,
  index: number,
  candidate: CandidateFinding,
  allowed: ReadonlySet<string>,
): readonly SacOffence[] {
  const offences: SacOffence[] = [];
  const push = (sac: GuardedSacId): void => {
    offences.push({ sac, element: index });
  };

  if (bareDigitOffenders(maskCandidateDigits(element, candidate), allowed).length > 0) {
    push("SAC-2");
  }
  if (isDenominatorless(element, candidate.counts)) push("SAC-3");
  if (hasForeignSurface(element, candidate.surface)) push("SAC-4");
  if (hasRelativeTime(element)) push("SAC-5");
  if (hasCausalConnective(element)) push("SAC-7");
  if (hasMachineIdentifier(element)) push("SAC-8");
  if (isCohortConflation(element)) push("SAC-11");
  if (hasNumericConfidence(element)) push("SAC-12");

  return offences;
}

/**
 * The last gate before generated text may be shown to a person.
 *
 * THE HEADLINE IS NOT SEGMENTED. It is one sentence by contract and may
 * legitimately carry no terminator at all, so it is judged as a single element
 * — but a headline carrying an INTERNAL terminator is two sentences wearing one
 * field's name, and that is refused rather than split.
 *
 * THE CONTEXT IS SEGMENTED OR REFUSED. `splitSentences` returning `null` is
 * itself a rejection: the rows above are per-sentence judgements, and prose no
 * honest segmentation exists for cannot be judged at all. It falls to the floor
 * under `floor_model_text_rejected` rather than reaching a customer unjudged.
 *
 * THE CANDIDATE IS THE ONLY SOURCE OF TRUTH the guard consults. Every number,
 * every path, and every window it will accept comes off the candidate — nothing
 * is read back out of the text being judged.
 */
export function guardModelText(input: {
  readonly candidate: CandidateFinding;
  readonly headline: string;
  readonly context: string;
}): GuardVerdict {
  const { candidate } = input;
  if (candidate.counts.length === 0) {
    return { ok: false, refusal: "candidate_invalid", offences: [] };
  }

  const headline = input.headline.trim();
  if (headline.length === 0) {
    return { ok: false, refusal: "not_segmentable", offences: [] };
  }
  for (let index = 0; index < headline.length - 1; index += 1) {
    if (isTerminator(headline[index])) {
      return { ok: false, refusal: "not_segmentable", offences: [] };
    }
  }

  const sentences = splitSentences(input.context);
  if (sentences === null) {
    return { ok: false, refusal: "not_segmentable", offences: [] };
  }

  const allowed = allowedDigitRuns(candidate);
  const elements = [headline, ...sentences];
  const offences = elements.flatMap((element, index) =>
    offencesInElement(element, index, candidate, allowed),
  );

  if (offences.length > 0) {
    return { ok: false, refusal: "sac_offences", offences };
  }
  return { ok: true };
}
