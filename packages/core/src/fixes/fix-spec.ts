// The minimal fix spec: a finding's structured state rendered to plain
// sentences a coding agent reads over MCP (O-009).
//
// ── WHAT IS NOT TRUE OF THIS FILE, STATED FIRST ─────────────────────────────
//
// NOTHING CALLS `renderFixSpec` IN PRODUCTION. There is no MCP server in this
// repository that invokes it, no worker task, no route, and no dispatch path.
// It is exercised by its own test suite and by nothing else. No fix spec
// produced here has ever reached a coding agent, or anyone.
//
// THERE IS NO MODEL. Nothing in `packages/core` imports `ai` or
// `@ai-sdk/anthropic`, and this package cannot read an environment variable at
// all, having no node builtin in reach. Every sentence below is a fixed
// template with values written into it, so "did a model make this up" has a
// mechanical answer rather than an assurance.
//
// THERE IS NO DISPATCH, NO VERIFICATION, AND NO EXPERIMENT. This module
// produces a value. Nothing sends it anywhere, nothing acts on it, and nothing
// measures what happened afterwards.
//
// ── THE ONE THING THIS MODULE EXISTS TO GUARANTEE: NO CODE ──────────────────
//
// The product decision (product-decisions §10, and the wedge in
// `.claude/VALUES.md`) is that we dispatch a SPEC, not a PATCH. A fix spec says
// what is wrong and what the evidence is, and leaves the fix to the agent
// reading it. So no output of this module may contain a code fence, a diff
// hunk, a patch header, a file path with a line number, or an instruction
// phrased as an edit.
//
// THAT IS ENFORCED STRUCTURALLY, NOT BY REVIEW, AND THE ARGUMENT IS THIS:
//
//   1. NO SENTENCE IS COMPOSED HERE. Every sentence is a fixed template — from
//      `@growthmind/shared`'s already-audited floor vocabulary, or from the two
//      tables this module declares below — with values written into it by
//      `../summary/substitute`, which is the ONE seam in this package where a
//      value is written into a template and which REFUSES any placeholder it
//      cannot resolve.
//
//   2. EVERY TEMPLATE PASSES A CODE GATE BEFORE IT IS USED. `templateOrRefuse`
//      runs `isCodeShaped` over the template on every render — not once at
//      module load, and not in a test only — so a table edit that introduced a
//      backtick, an operator, a filename, or an edit instruction throws instead
//      of shipping.
//
//   3. THE SUBSTITUTED VALUES ARE DRAWN FROM EXACTLY FOUR BOUNDED SOURCES: a
//      `surface` already proved to be in normalised form by the module that
//      OWNS normalisation, integers from a branded `MeasuredCount`, the literal
//      string `"sessions"`, and the date part of an ISO instant. None of the
//      four can carry a fence, a hunk header, or an imperative.
//
//   The stated bound on (3), because an unqualified "the output contains no
//   code" would be a claim wider than the mechanism supports: a customer's own
//   normalised `url_path` is rendered VERBATIM, and `normaliseUrlPath` strips a
//   query and a fragment but does not police punctuation. A page really named
//   ``/`` with a backtick in it renders with that backtick. That is correct
//   behaviour and not a hole — see the composed-input note below — and what
//   this module guarantees precisely is that no code marker IT AUTHORED can
//   reach the output.
//
// ── THE COMPOSED-INPUT RULE, APPLIED TWICE (edge taxonomy D10) ──────────────
//
// BOTH GUARDS IN THIS FILE SCAN THE TEMPLATE, BEFORE SUBSTITUTION — never the
// rendered sentence. That is deliberate and it is the whole of D10's
// composed-input lesson: a keyword classifier fed a document containing a
// segment it was never designed for matches boilerplate in that segment and
// flips the pipeline's behaviour.
//
// The concrete case, and it is asserted as INTENDED in
// `../delivery/slack-message.ts`: `describesPeople("/users/profile")` is TRUE.
// `/users/profile` is a customer's own page address, not a claim about human
// beings. A guard applied to the rendered sentence would fire on it, and the
// only available responses — rewriting the path, dropping the sentence,
// refusing the spec — are all worse than the thing being prevented. So the
// customer's data never reaches either guard, and a surface carrying a cohort
// noun renders verbatim. There is a named test.
//
// ── FAIL DIRECTION: REFUSE, EVERYWHERE, AND HERE IS WHY IT IS THE ONLY ONE ──
//
// `../delivery/slack-message.ts` runs two guards with DIFFERENT fail
// directions, chosen by input source: a hit on a caller-supplied LABEL (our own
// vocabulary) is refused as a caller bug, while a hit on MODEL-WRITTEN PROSE
// drops the prose and degrades the message to its numbers-only form, so a true
// finding is not withheld over one word.
//
// THIS MODULE RENDERS NO MODEL PROSE AT ALL. Every string it emits is our own
// fixed vocabulary. The degrade branch therefore has no subject here, and the
// label branch applies to every string: a violation is a bug in this file's
// tables or in the caller's candidate, never a bad draw from a generator. So
// every gate below throws.
//
// Refusing is also the right direction on the merits. A fix spec that never
// appears is a gap: a caller notices it and can handle it. A fix spec carrying
// a patch is the product doing the single thing it promised not to do, handed
// to an agent with write access to somebody's repository.
//
// PURE: no clock, no randomness, no I/O, no node builtin — the package-wide
// properties `__tests__/detect/purity.test.ts` asserts over all of `src/`. Both
// ends of the window arrive on the candidate; nothing here asks what time it
// is, which is what lets the same finding render identically forever.
import {
  FLOOR_CONFIDENCE_TEMPLATES,
  FLOOR_COUNT_TEMPLATES,
  FLOOR_NO_RATE_TEMPLATE,
  FLOOR_OBSERVATION_TEMPLATES,
  FLOOR_TIMEFRAME_TEMPLATE,
  isNormalisedUrlPath,
  normaliseUrlPath,
} from "@growthmind/shared";
import { z } from "zod";

import type { MeasuredCount } from "../counts/measured-count";
import { rateOf } from "../counts/measured-count";
import { describesPeople } from "../delivery/slack-message";
import type { DetectorCoverage } from "../detect/types";
import type { EvidenceSignal, EvidenceSignalKind } from "../evidence/signals";
import { evidenceSignalSchema } from "../evidence/signals";
import type { CandidateFinding, ConfidenceBasis } from "../findings/candidate";
import { candidateFindingSchema } from "../findings/candidate";
import type { FindingClass } from "../rules/types";
import type { CountRole } from "../summary/count-roles";
import { COUNT_ROLES, resolveCounts } from "../summary/count-roles";
import type { FloorToken } from "../summary/substitute";
import { placeholdersIn, substitute } from "../summary/substitute";

// ---------------------------------------------------------------------------
// THE REUSED VOCABULARY, AND THE COMPILE PINS THAT HOLD IT (D-3).
//
// Four of the five sentence kinds a fix spec renders already exist, already
// audited, in `packages/shared/src/summary/messages.ts`: the symptom keyed by
// finding class, the magnitude keyed by count role, the no-rate sentence, and
// the window. Re-authoring them here would be a second vocabulary for the same
// facts — the exact drift `../counts/measured-count.ts:30` refuses when it
// reuses `EXCLUSION_REASON_LABELS` rather than restating it. So they are
// imported, and the annotations below are the same load-bearing compile pins
// `../summary/floor.ts:83-85` carries: a fifth finding class, a fourth
// confidence basis, or a fourth count role added in `core` WITHOUT its sentence
// in `shared` fails these assignments under `bun run typecheck`.
// ---------------------------------------------------------------------------

const SYMPTOM: Record<FindingClass, string> = FLOOR_OBSERVATION_TEMPLATES;
const CONFIDENCE: Record<ConfidenceBasis, string> = FLOOR_CONFIDENCE_TEMPLATES;
const COUNT_TEXT: Record<CountRole, string> = FLOOR_COUNT_TEMPLATES;

/**
 * What kind of thing was seen, one sentence per evidence signal kind.
 *
 * `Record<EvidenceSignalKind, string>` is the compile pin: a sixth member added
 * to `EvidenceSignal` without a sentence here is a `bun run typecheck` failure,
 * not an `undefined` rendered into a spec an agent then acts on (D9).
 *
 * THE PAGE IS THE SUBJECT OF EVERY ONE OF THEM, and no sentence says "people".
 * A signal is ONE observation; the magnitude that would license a plural human
 * subject lives on the predicate that consumed the signal, not on the signal
 * itself. `packages/shared/src/gate/messages.ts:58-85` is the record of what
 * happens when a sentence keyed by a state asserts more than the WEAKEST path
 * to that state established — `broken_unsatisfied` shipped reading "We saw
 * people struggling here" on paths where nobody had struggled. Keying these by
 * signal kind is the same mechanism, so they claim only what one signal is.
 *
 * NO EVENT NAME IS RENDERED, and that is a real cost chosen deliberately. A
 * coding agent would plainly find `checkout_submit_failed` more actionable than
 * "an action taken there". But an event name is un-normalised, un-redacted
 * external text from a customer's own instrumentation, and rendering it would
 * either put it through a code gate designed for our vocabulary — the exact
 * composed-input mistake the header refuses — or past no gate at all. Naming
 * the event needs a redaction rule for event names, which does not exist in
 * this repository. Until it does, the spec states the SHAPE of the evidence and
 * says so out loud in its own boundary sentences.
 */
export const FIX_SPEC_EVIDENCE_TEMPLATES: Record<EvidenceSignalKind, string> = {
  /** `failure_correlated`: an exception tied to the action that preceded it. */
  failure_correlated: "An error is being thrown on {surface} straight after an action taken there.",

  /**
   * `failure_uncorrelated` (ES-13): recorded honestly as UNCORRELATED rather
   * than laundered into a correlated one, so the sentence must not imply the
   * error follows from anything. It is deliberately not admissible as proof of
   * `broken`, and this sentence claims no more than its own absence of a link.
   */
  failure_uncorrelated:
    "Errors are being thrown on {surface}, and nothing ties them to an action taken there.",

  /**
   * `struggle`: repetition is the whole claim. The sentence names no leaving,
   * so it can never be read together with a magnitude sentence about sessions
   * that left as though the two described one group (SAC-11).
   */
  struggle: "{surface} is being returned to repeatedly inside a single visit.",

  /** `clean_exit`: the page is left, and nothing observed went wrong on it. */
  clean_exit: "{surface} is being left with nothing going wrong on it.",

  /**
   * `instrumentation_rate_drop`: the wording the gate already uses for this
   * same predicate (`packages/shared/src/gate/messages.ts:97`). It stops at the
   * observation — whether the cause is the tracking or the product is a SECOND
   * claim, and nothing measured settles it.
   */
  instrumentation_rate_drop:
    "One kind of activity we normally see on {surface} has almost stopped arriving.",
};

/**
 * What is said when a finding carries no evidence signals at all.
 *
 * NOT AN EMPTY SECTION AND NOT A CRASH. A candidate can legitimately reach a
 * renderer with an empty `signals` array — `CandidateFinding` does not carry
 * signals at all, so a caller assembling one from a persisted row may simply
 * have none to hand — and the honest output is a spec that says so and then
 * stands on its counts, which are present and complete either way. A blank
 * section reads as "we did not look", which is a different and false claim.
 */
export const FIX_SPEC_NO_EVIDENCE_TEMPLATE: string =
  "No individual observations were recorded alongside this, so what follows rests on the counts.";

/**
 * What this spec is NOT — the "no code" product decision, stated in the output
 * rather than only in this comment.
 *
 * These three ship on EVERY spec, unconditionally. A reader who has to infer
 * that we did not look at their source is a reader who may reasonably assume we
 * did, and an agent that assumes a spec is a review of its code will look for
 * the change we are supposedly pointing at. Saying it costs three sentences.
 *
 * NO NEXT STEP IS STATED, for the same reason `../summary/floor.ts:216-220`
 * states none: nothing shipped can act on a finding, so a sentence implying
 * otherwise would promise work that does not exist.
 */
export const FIX_SPEC_BOUNDARY_TEMPLATES: readonly string[] = [
  "This describes what was measured on one page, not how that page is built.",
  "No source file was read to produce this, and nothing here points at a line in one.",
  "Deciding what to do about this is not something these numbers settle.",
];

/**
 * The limitation the evidence section carries, stated only when there IS an
 * evidence section to qualify.
 *
 * Each evidence sentence is qualitative by design (see
 * `FIX_SPEC_EVIDENCE_TEMPLATES`): a signal's own cohort magnitude —
 * `correlatedSessions`, `strugglingSessions` — is a DIFFERENT population from
 * the candidate's counts, and standing the two next to each other invites
 * exactly the reading SAC-11 forbids, where one group is handed the other's
 * behaviour. Rather than compose that carefully, the spec renders one
 * population's magnitudes and says plainly that the evidence lines carry none.
 */
export const FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE: string =
  "Each observation above says what kind of thing was seen on this page, not how much of it.";

/**
 * What the run could not see, travelling with what it did (D-3, ES-4).
 *
 * `DetectorCoverage` is carried onto every candidate precisely so a limitation
 * is never silently dropped, and a fix spec that hid a truncated read would
 * hand an agent a floor while presenting it as a total. Both sentences are
 * QUALITATIVE: `eventsWithoutUrlPath` is a bare number with no denominator —
 * legitimately so, being a statement about the RUN rather than a claim about
 * the product — and rendering a bare number in front of a reader is the one
 * thing `MeasuredCount` exists to prevent.
 */
export const FIX_SPEC_COVERAGE_TEMPLATES = {
  truncated:
    "Only part of the activity in this window was looked at, so every number above is a floor rather than a total.",
  eventsWithoutUrlPath:
    "Some activity in this window arrived with no page address on it and was left out of this picture.",
} as const;

/**
 * Every fixed string THIS module authors, in one array, so the plain-English
 * audit over it is TOTAL rather than best-effort.
 *
 * Derived from the tables above rather than re-listed, so a sentence cannot
 * escape review by being added in one place and not the other — the same rule
 * `packages/shared/src/signatures/messages.ts:79-81` follows for the same
 * reason. The vocabulary reused from `@growthmind/shared` is NOT here: it is
 * already covered by that package's own audit, and the rendered-output scan in
 * `__tests__/fixes/fix-spec.test.ts` covers it again in situ.
 */
export const FIX_SPEC_ALL_TEMPLATES: readonly string[] = [
  ...Object.values(FIX_SPEC_EVIDENCE_TEMPLATES),
  FIX_SPEC_NO_EVIDENCE_TEMPLATE,
  ...FIX_SPEC_BOUNDARY_TEMPLATES,
  FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE,
  ...Object.values(FIX_SPEC_COVERAGE_TEMPLATES),
];

// ---------------------------------------------------------------------------
// THE CODE GATE
// ---------------------------------------------------------------------------

/**
 * One way a string can read as code, as DATA.
 *
 * A table rather than one fused regular expression so a refusal can NAME the
 * marker it tripped, and so a test can enumerate the real list instead of a
 * copy of it — the same reason `COHORT_NOUNS` is exported from
 * `../delivery/slack-message.ts:142`.
 */
export type CodeShapedMarker = {
  readonly name: string;
  readonly pattern: RegExp;
};

/**
 * The markers a fix-spec template may not contain.
 *
 * DELIBERATELY BROADER THAN PROSE NEEDS, because of what it is pointed at. It
 * scans OUR OWN vocabulary and nothing else (see the composed-input rule in the
 * header), and our vocabulary is a few dozen hand-written sentences that have
 * no legitimate use for a parenthesis, an angle bracket, an operator, or a
 * file extension. Strictness against a closed, authored corpus is free; the
 * same strictness pointed at a customer's data would be the D10 failure.
 *
 * NO PATTERN CARRIES THE `g` FLAG. A global regular expression is stateful
 * across `.test()` calls, so the same template would match on one render and
 * not the next — a determinism bug inside the guard that exists to make the
 * output deterministic.
 *
 * The brace pair is NOT banned: `{surface}` is the placeholder syntax
 * `../summary/substitute.ts` reads, and `substitute` already refuses any
 * placeholder it cannot resolve, so an unresolved brace never survives to the
 * output.
 */
export const CODE_SHAPED_MARKERS: readonly CodeShapedMarker[] = [
  { name: "fenced_code", pattern: /```|~~~/ },
  { name: "inline_code", pattern: /`/ },
  { name: "diff_hunk_header", pattern: /@@/ },
  { name: "diff_file_header", pattern: /^\s*(?:\+\+\+|---)/m },
  { name: "markup_bracket", pattern: /[<>]/ },
  { name: "index_bracket", pattern: /[[\]]/ },
  { name: "call_parenthesis", pattern: /[()]/ },
  { name: "operator", pattern: /=>|===|!==|&&|\|\||\+=|::/ },
  { name: "path_with_line_number", pattern: /:\d+/ },
  { name: "line_reference", pattern: /\bline\s+\d+/i },
  {
    name: "source_file_extension",
    pattern:
      /\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|sql|py|rb|go|rs|java|php|yml|yaml|toml|sh|md)\b/i,
  },
  { name: "shell_invocation", pattern: /\b(?:npm|bun|bunx|npx|yarn|pnpm|git|curl|sudo|cd)\s/i },
  { name: "version_control_verb", pattern: /\b(?:diff|patch|commit|rebase|stash|merge)\b/i },
  {
    name: "language_keyword",
    pattern:
      /\b(?:const|let|var|function|return|import|export|await|async|typeof|instanceof|class|interface|enum|null|undefined)\b/,
  },
  {
    // "change the retry limit to 5", "replace the handler with a guard" — an
    // instruction phrased as an edit.
    //
    // THE OBJECT IS ONE TO FOUR WORDS, not exactly one: a real instruction
    // names its object in a phrase, and a pattern that only saw "change X to Y"
    // would step over the shape people actually write.
    //
    // NO WORD OF THE OBJECT MAY CARRY A COMMA OR A FULL STOP, which is what
    // keeps the shipped "was set aside, leaving no share to report" — whose
    // first three words are `set`, `aside,`, `leaving` — from reading as one.
    // The clause boundary is where an instruction stops being an instruction.
    name: "edit_instruction",
    pattern:
      /\b(?:change|replace|set|update|rename|move|delete|remove|add|wrap|swap)\s+(?:[^\s,.]+\s+){1,4}(?:to|with|into|from|in)\b/i,
  },
  {
    name: "imperative_opener",
    pattern:
      /^\s*(?:apply|run|edit|patch|open|create|install|copy|paste|write|implement|refactor)\b/i,
  },
];

/**
 * True when a string reads as code, a diff, or an instruction to edit one.
 *
 * POINT THIS AT OUR OWN VOCABULARY ONLY. It is a deterministic keyword gate and
 * D10 therefore applies to it exactly as it applies to `describesPeople`: it
 * will miss phrasings, and — more importantly — it fires on perfectly ordinary
 * customer data. `/api/users(1)` is a real page address containing a
 * parenthesis, `/docs/readme.md` ends in a file extension, and neither is a
 * patch. Every caller in this module runs it over a template BEFORE a value is
 * written in, which is what makes the strictness above safe.
 *
 * MISS DIRECTION, NAMED: an unmatched phrasing renders. This gate is the cheap
 * mechanical last catch over a closed corpus a human wrote; it is not the
 * primary control, and it is not a claim to recognise every possible code
 * shape. The primary control is that no sentence is composed here at all.
 */
export function isCodeShaped(text: string): boolean {
  return codeMarkerIn(text) !== null;
}

/** The name of the first marker a string trips, or `null`. Module-private: the
 * refusal message is the only consumer, and a second public predicate would be
 * a second thing to keep in step with `isCodeShaped`. */
function codeMarkerIn(text: string): string | null {
  for (const marker of CODE_SHAPED_MARKERS) {
    if (marker.pattern.test(text)) return marker.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// THE OUTPUT CONTRACT
// ---------------------------------------------------------------------------

/**
 * A finding's structured state, as sentences.
 *
 * FOUR NAMED SECTIONS PLUS ONE FLATTENING, and the flattening is not a
 * convenience. `sentences` is what an audit scans and what a caller with no
 * layout of its own renders; keeping it a DERIVED field rather than a
 * separately-assembled one means a section cannot be added to the spec and
 * quietly omitted from the scan.
 *
 * EVERY ARRAY IS NON-EMPTY BY CONSTRUCTION. `evidence` falls back to the
 * no-evidence sentence, `measurement` always carries the window and the
 * confidence, and `boundary` always carries its three fixed sentences. There is
 * no input for which a section is blank, so no consumer needs an empty-state
 * branch that would never be exercised.
 */
export type FixSpec = {
  /** The customer's own normalised `url_path`, VERBATIM. Never rewritten. */
  readonly surface: string;
  /** What is wrong, in one sentence, keyed by the class the gate CONCLUDED. */
  readonly symptom: string;
  /** What kind of thing was seen. At least one sentence, always. */
  readonly evidence: readonly string[];
  /** The counts with their denominators, the window, and the confidence. */
  readonly measurement: readonly string[];
  /** What this spec is not, and what the run could not see. */
  readonly boundary: readonly string[];
  /** `symptom`, then `evidence`, then `measurement`, then `boundary`. */
  readonly sentences: readonly string[];
};

/**
 * The runtime mirror of `FixSpec` — the shape that crosses the MCP wire.
 *
 * Declared beside the hand-written type rather than inferred from it, so the
 * `readonly` the type carries is not lost; the two are held together by a named
 * test that parses a real rendered spec through this schema. Every string is
 * `.min(1)` and every array `.min(1)`: an empty sentence and an empty section
 * are both unrenderable states that would reach a reader as a gap.
 */
export const fixSpecSchema = z.object({
  surface: z.string().min(1),
  symptom: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  measurement: z.array(z.string().min(1)).min(1),
  boundary: z.array(z.string().min(1)).min(1),
  sentences: z.array(z.string().min(1)).min(1),
});

/**
 * Everything `renderFixSpec` reads.
 *
 * `signals` is a SEPARATE parameter rather than a field on the candidate
 * because `CandidateFinding` genuinely does not carry one:
 * `../findings/candidate.ts` holds the gate's conclusion and its magnitudes,
 * while `EvidenceSignal[]` lives on the detector's own `DetectorCandidate`. The
 * two are joined by the caller, and an empty array is a legitimate join result
 * rather than an error — see `FIX_SPEC_NO_EVIDENCE_TEMPLATE`.
 */
export type FixSpecInput = {
  readonly candidate: CandidateFinding;
  readonly signals: readonly EvidenceSignal[];
};

/**
 * The boundary. Both halves are parsed by the schema that OWNS them, so this
 * module states no rule of its own about what a candidate or a signal is.
 */
export const fixSpecInputSchema = z.object({
  candidate: candidateFindingSchema,
  signals: z.array(evidenceSignalSchema),
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** `2026-06-01` — the date part of an ISO instant. */
const ISO_DATE_LENGTH = 10;

/** A full stop followed by a space: the boundary between two sentences inside
 * one fixed string. */
const SENTENCE_BOUNDARY = ". ";
const FULL_STOP = ".";

/**
 * The placeholders whose presence makes a template a COUNT sentence.
 *
 * Typed `readonly FloorToken[]` so a token renamed in
 * `../summary/substitute.ts` fails this assignment rather than silently
 * exempting every count sentence from the people guard below.
 */
const COUNT_TOKENS: readonly FloorToken[] = ["numerator", "denominator", "unit"];

function carriesACount(template: string): boolean {
  const placeholders: readonly string[] = placeholdersIn(template);
  return COUNT_TOKENS.some((token) => placeholders.includes(token));
}

/**
 * Returns a template fit to render, or refuses.
 *
 * THE LAST GATE BEFORE OUR VOCABULARY BECOMES A SENTENCE, and it runs on every
 * render rather than once at module load, so a table edited in a later sprint
 * is checked by the code that uses it and not by a reviewer's memory. Three
 * refusals:
 *
 *  - NOT EXACTLY ONE SENTENCE. Every element of a `FixSpec` section is one
 *    sentence, so a table edit that welded two together — or dropped a full
 *    stop — would silently change the output contract. Refused rather than
 *    split, because splitting would mean authoring a sentence boundary, which
 *    is the one thing this module must never do.
 *
 *  - CODE-SHAPED. The product decision, mechanised. See the header.
 *
 *  - A COUNT SENTENCE THAT DESCRIBES PEOPLE. This is
 *    `../counts/measured-count.ts:60-69` enforced at the rendering seam rather
 *    than restated: identity stitching does not exist in this product — there
 *    is no `identities` table — so "12 of 25" means 12 of 25 SESSIONS, and a
 *    sentence pairing that pair with a cohort noun makes a claim about human
 *    beings that nothing measured. The check is CONDITIONAL on the template
 *    carrying a count, and that is the precise rule rather than a softened one:
 *    a count-free sentence may name people where a cohort magnitude licenses it
 *    (`FLOOR_OBSERVATION_TEMPLATES.broken` does, licensed by
 *    `errorMinAffectedSessions`), and a blanket ban would refuse the shipped,
 *    audited symptom vocabulary this module reuses.
 *
 *    `describesPeople` is imported from `../delivery/slack-message.ts` rather
 *    than reimplemented: one cohort matcher for the product, so a noun added
 *    there is caught here for free. It is a keyword gate and it MISSES (D10) —
 *    it cannot see a role word, a name, or a paraphrase. It is the cheap last
 *    catch over a closed corpus, not the primary control.
 *
 * THE MESSAGE NAMES THE SLOT AND THE MARKER, AND NO TEMPLATE TEXT. A slot name
 * and a marker name are facts about this codebase and are safe in a log line; a
 * rendered sentence carries a page path and count values, and neither is a fact
 * about this codebase. Same discipline as `../summary/substitute.ts:84-88`.
 */
function templateOrRefuse(template: string, slot: string): string {
  const trimmed = template.trim();

  if (trimmed.length === 0 || !trimmed.endsWith(FULL_STOP) || trimmed.includes(SENTENCE_BOUNDARY)) {
    throw new Error(`fix_spec_not_one_sentence: ${slot}`);
  }

  const marker = codeMarkerIn(trimmed);
  if (marker !== null) {
    throw new Error(`fix_spec_code_shaped: ${slot}: ${marker}`);
  }

  if (carriesACount(trimmed) && describesPeople(trimmed)) {
    throw new Error(`fix_spec_count_describes_people: ${slot}`);
  }

  return trimmed;
}

/**
 * Gate the template, then write the values in. IN THAT ORDER, ALWAYS — the
 * guards scan our vocabulary and never the customer's data (see the header),
 * and this function is the only place the two steps are sequenced, so there is
 * no call site that can get the order wrong.
 */
function write(
  template: string,
  slot: string,
  values: Partial<Record<FloorToken, string>>,
): string {
  return substitute(templateOrRefuse(template, slot), values);
}

/**
 * Returns the surface, or refuses.
 *
 * A path segment can carry a live token or an address —
 * `packages/shared/src/sessions/url-path.ts:105-110` is the record of that
 * hazard — and `candidateFindingSchema.surface` accepts any non-empty string,
 * so the contract alone does not guarantee the redaction ran. A fix spec is
 * handed to an agent that may log it, so an unredacted path reaching one is the
 * same leak one step further out than the incident that motivated redaction.
 *
 * THE REFUSAL NAMES ONLY THE NORMALISED FORM, never the value that came in:
 * naming the input would put the very token this check exists to stop into a
 * log line. Same discipline as `../summary/floor.ts:189-199`.
 *
 * Applied to EVERY surface rendered, including the one a `struggle` or
 * `clean_exit` signal carries of its own — a signal's surface is a different
 * field from the candidate's and nothing guarantees the two agree.
 */
function normalisedSurfaceOrRefuse(surface: string): string {
  if (!isNormalisedUrlPath(surface)) {
    const normalised = normaliseUrlPath(surface, null);
    throw new Error(`fix_spec_surface_not_normalised: ${normalised ?? "none"}`);
  }
  return surface;
}

/** The page a signal is about: its own where it has one, the candidate's
 * otherwise. Two of the five variants carry a `surface`; the other three are
 * about an event and inherit the page the claim is about. */
function surfaceOfSignal(signal: EvidenceSignal, fallback: string): string {
  return signal.kind === "struggle" || signal.kind === "clean_exit" ? signal.surface : fallback;
}

/**
 * One magnitude, with its denominator in the SAME sentence.
 *
 * Structural rather than remembered: every value of `FLOOR_COUNT_TEMPLATES`
 * carries `{numerator}`, `{denominator}` and `{unit}` in one string, so there
 * is no template here that can render a numerator alone and therefore no call
 * shape that can either.
 *
 * `rateOf` IS THE SWITCH, AND ITS RESULT IS NEVER PRINTED. A zero denominator —
 * every session in the window set aside — is a real, reportable state, and it
 * takes the explicit no-rate sentence. Never a division (there is no answer),
 * never a blank (which reads as nothing having happened), never `0%` and never
 * `NaN`. On the other branch `rate.value` is deliberately left unread: it is a
 * float, this product renders no numeric precision anywhere
 * (`FLOOR_CONFIDENCE_TEMPLATES` carries no digit at all, on purpose), and the
 * numerator and the denominator ARE the claim — a percentage beside them would
 * be the most memorable thing a reader took away precisely because it looks
 * exact.
 */
function magnitudeSentence(role: CountRole, count: MeasuredCount, surface: string): string {
  const rate = rateOf(count);

  if (rate.kind === "no_rate") {
    return write(FLOOR_NO_RATE_TEMPLATE, `measurement.${role}.no_rate`, {});
  }

  return write(COUNT_TEXT[role], `measurement.${role}`, {
    numerator: String(count.numerator),
    denominator: String(count.denominator),
    unit: count.unit,
    surface,
  });
}

/** What the run could not see. Order is fixed, so two runs over one coverage
 * render byte-identically. */
function coverageSentences(coverage: DetectorCoverage): readonly string[] {
  const sentences: string[] = [];

  if (coverage.truncated) {
    sentences.push(write(FIX_SPEC_COVERAGE_TEMPLATES.truncated, "boundary.truncated", {}));
  }
  if (coverage.eventsWithoutUrlPath > 0) {
    sentences.push(
      write(FIX_SPEC_COVERAGE_TEMPLATES.eventsWithoutUrlPath, "boundary.no_page_address", {}),
    );
  }

  return sentences;
}

/**
 * Turns a finding's structured state into the sentences a coding agent reads.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *
 * NO CODE, NO DIFF, NO EDIT. The whole point; see the header for the
 * structural argument and for the one stated bound on it.
 *
 * NO RATIO IS COMPUTED BETWEEN COUNTS. A funnel finding's two counts share one
 * denominator — the kept sessions in the window — so dividing one by the other
 * does NOT produce the drop rate the detector applied its threshold to. That
 * rate has a different denominator, no `MeasuredCount` carries it, and deriving
 * it here would be this module inventing a statistic. The honest consequence:
 * an agent is shown the two counts the threshold was computed from, not the
 * threshold's own rate.
 *
 * NO CLASS IS RE-DERIVED. `finalClass` — the class the gate CONCLUDED — is read
 * as given. `claimedClass` and `trace` are not read at all.
 *
 * NO SIGNAL MAGNITUDE IS RENDERED. See `FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE`; the
 * spec says so itself.
 *
 * NO CLOCK IS READ. Both ends of the window arrive on the candidate, rendered
 * as dates rather than as a phrase like "the last seven days", which would be
 * relative to a moment this code cannot read and would stop being true the day
 * after it was written — in a spec an agent may open long after it was made.
 *
 * ── FAIL DIRECTION: REFUSE, at every step ──────────────────────────────────
 *
 *  - a candidate or a signal that does not satisfy `fixSpecInputSchema` (the
 *    boundary comes FIRST, so a caller cannot skip it by passing an
 *    already-typed value);
 *  - a `surface` — the candidate's or a signal's own — that is not already in
 *    its normalised form;
 *  - a `counts` arity that disagrees with the detector's declared roles
 *    (`resolveCounts` refuses; a mislabelled number is worse than none);
 *  - a template that is not one sentence, that reads as code, or that pairs a
 *    count with a cohort noun (`templateOrRefuse`);
 *  - a template carrying a placeholder nothing supplies (`substitute` refuses).
 *
 * The isolation half — one refused finding must not abort a whole run — is NOT
 * here and is not claimed. It belongs to whatever eventually calls this, and
 * nothing does yet.
 */
export function renderFixSpec(input: FixSpecInput): FixSpec {
  // 1. THE BOUNDARY, AND IT COMES FIRST. No `??`, no default, no fallback
  //    anywhere below.
  const parsed = fixSpecInputSchema.parse(input);
  const candidate: CandidateFinding = parsed.candidate;
  const signals: readonly EvidenceSignal[] = parsed.signals;

  // 2. The customer's page address, proved redacted, then carried VERBATIM.
  const surface = normalisedSurfaceOrRefuse(candidate.surface);

  // 3. The symptom, keyed by the class the GATE CONCLUDED.
  const symptom = write(SYMPTOM[candidate.finalClass], "symptom", { surface });

  // 4. The evidence.
  //
  //    DEDUPLICATED, AND IT IS NOT COSMETIC (edge taxonomy D3). Four struggle
  //    signals on one page produce four IDENTICAL sentences, because these
  //    sentences are qualitative and carry no per-signal magnitude. Emitting
  //    the same sentence four times would state one observation as though it
  //    had been made four separate ways, which is the multiplicity failure
  //    dressed as prose. First-occurrence order is preserved, so the result is
  //    a function of the input order and nothing else.
  const evidence: string[] = [];
  for (const signal of signals) {
    const sentence = write(FIX_SPEC_EVIDENCE_TEMPLATES[signal.kind], `evidence.${signal.kind}`, {
      surface: normalisedSurfaceOrRefuse(surfaceOfSignal(signal, surface)),
    });
    if (!evidence.includes(sentence)) evidence.push(sentence);
  }
  if (evidence.length === 0) {
    evidence.push(write(FIX_SPEC_NO_EVIDENCE_TEMPLATE, "evidence.none", {}));
  }

  // 5. The magnitudes, IN DECLARED ROLE ORDER — never in array order, and never
  //    by index. `resolveCounts` is what stands between a reader and the
  //    arrival count sitting under the departure sentence.
  //
  //    THE ONE DEDUPLICATION HERE: both of a funnel finding's counts share one
  //    denominator, so at a zero denominator BOTH roles produce the identical
  //    no-rate sentence. Emitting it twice would state one fact about the
  //    window as though it had been measured twice.
  const resolved = resolveCounts(candidate);
  const roles: readonly CountRole[] = COUNT_ROLES[resolved.detector];
  const countsByRole: Readonly<Record<string, MeasuredCount>> = resolved.counts;

  const measurement: string[] = [];
  for (const role of roles) {
    const count = countsByRole[role];
    if (count === undefined) {
      throw new Error(`fix_spec_unresolved_count_role: ${role}`);
    }
    const sentence = magnitudeSentence(role, count, surface);
    if (!measurement.includes(sentence)) measurement.push(sentence);
  }

  measurement.push(
    write(FLOOR_TIMEFRAME_TEMPLATE, "measurement.window", {
      windowStart: candidate.timeframe.start.toISOString().slice(0, ISO_DATE_LENGTH),
      windowEnd: candidate.timeframe.end.toISOString().slice(0, ISO_DATE_LENGTH),
    }),
  );

  // Confidence, in words. The table carries no digit and none may be added.
  measurement.push(
    write(CONFIDENCE[candidate.ranking.confidenceBasis], "measurement.confidence", {}),
  );

  // 6. What this spec is not, then what the run could not see.
  const boundary: string[] = FIX_SPEC_BOUNDARY_TEMPLATES.map((template, position) =>
    write(template, `boundary.${String(position)}`, {}),
  );
  if (signals.length > 0) {
    boundary.push(write(FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE, "boundary.evidence_limit", {}));
  }
  boundary.push(...coverageSentences(candidate.coverage));

  return {
    surface,
    symptom,
    evidence,
    measurement,
    boundary,
    // DERIVED, never separately assembled — a section added above cannot be
    // omitted from the flattening a caller and an audit both read.
    sentences: [symptom, ...evidence, ...measurement, ...boundary],
  };
}
