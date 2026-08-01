// THE WAVE 0 MIRROR OF THE ONBOARDING CONTRACT.
//
// `packages/shared/src/onboarding/types.ts` is the real home for these shapes
// and ADD Wave 1 writes it. Wave 0 is tests only (AD-22), so the suites in this
// directory would otherwise have nothing to typecheck against — see
// `module-under-construction.ts` for why a static import of an absent module
// takes the whole gate down rather than producing a red.
//
// So this file mirrors the contract, and it is a MIRROR rather than an
// invention: every declaration below is copied from, or derived line-by-line
// from, a cited block of `docs/adds/onboarding-five-steps.md`. Where the ADD
// declares the type outright (AD-5 does, in TypeScript) it is copied verbatim.
// Where the ADD names a type and states its fields in prose (`StageView`,
// `FindingView`, `CounterRow`) the derivation is cited and any residual
// ambiguity is called out in a comment rather than resolved silently.
//
// WHAT THIS MIRROR CAN AND CANNOT PROVE. It gives every row a real type surface
// to be written against, and it makes the arity and shape claims statements
// about the ADD rather than about an implementation nobody has written. It
// CANNOT, on this tree, force the eventual module to conform — the loader casts
// to the mirrored type, so a signature drift in Wave 1 would not be a compile
// error HERE. That half is carried at runtime (the `.length` arity pin in
// `stage.test.ts` row 1) and by Wave 1's own typecheck against the real
// `types.ts`. Stated plainly so nobody reads more guarantee into this file than
// it carries.
//
// Types that ALREADY SHIP are imported, never re-declared — `AnalysisRunStatus`,
// `AnalysisOutcome`, `SummarySource` and `ConnectionState` are real today, and
// mirroring them would be inventing drift where there is none.

import type { ConnectionState } from "../../src/session-source/types";
import type { AnalysisOutcome, AnalysisRunStatus, SummarySource } from "../../src/summary/types";

// ---------------------------------------------------------------------------
// The finding, as this surface receives it
// ---------------------------------------------------------------------------

/**
 * One measured count as it reaches the UI.
 *
 * Derived from `MeasuredCountRow` in `packages/db/src/repositories/findings.repo.ts`,
 * NOT imported from it: `packages/shared` may not import `packages/db`
 * (ADD §2 constraint list), which is the whole reason AD-6 maps
 * `FindingRecord` → `OnboardingFinding` at the route boundary.
 *
 * `unit` is the literal `"sessions"` and never "people" — this product does not
 * stitch one person's visits together, and rendering a session count as a
 * people count claims more than was measured
 * (`packages/shared/src/summary/messages.ts:273-276`).
 */
export type OnboardingCount = {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: "sessions";
};

/**
 * The finding the stage renders, mapped from `FindingRecord` at the route
 * boundary (AD-6's "Boundary parse (D5)"). Field-for-field from the shipped
 * `findings` table columns (`packages/db/src/schema/findings.ts:188-215`),
 * narrowed to what UX Checklist row 20 says the surface renders: the class in
 * plain English, the headline, `context[]` one line each, one row per
 * `counts[]` entry, the confidence sentence, the window as two dates, and the
 * `SUMMARY_SOURCE_MESSAGES` line.
 */
export type OnboardingFinding = {
  readonly finalClass: string;
  readonly headline: string;
  /** One sentence per element — NEVER a blob to be re-split downstream. */
  readonly context: readonly string[];
  readonly counts: readonly OnboardingCount[];
  readonly surface: string;
  /** Keys `FLOOR_CONFIDENCE_TEMPLATES`. No value there contains a digit. */
  readonly confidenceBasis: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly summarySource: SummarySource;
};

// ---------------------------------------------------------------------------
// AD-5 — the stage reducer. COPIED VERBATIM from the ADD's own TypeScript.
// ---------------------------------------------------------------------------

/**
 * Why a run ended with nothing to show.
 *
 * The ADD names `EndedReason` (§5 file table, AD-5's `ended` arm) without
 * declaring its members, so this is derived from the three §9 rows that
 * constrain it: a `failed` run's reason KEYS `ANALYSIS_RUN_STATUS_MESSAGES`,
 * and the two non-finding outcomes KEY `ANALYSIS_OUTCOME_MESSAGES`. Those are
 * exactly the three members, and UX Checklist row 21 requires all three to
 * render DISTINCT sentences — they are never collapsed.
 */
export type EndedReason = "failed" | "no_candidates_passed_gate" | "no_sessions_to_analyse";

/** ADD AD-5, lines 191-199 — copied verbatim. */
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

/** ADD AD-5, lines 201-206 — copied verbatim. */
export type RenderedStageState =
  | { readonly kind: "unarmed" }
  | { readonly kind: "leg1"; readonly elapsedSeconds: number }
  | { readonly kind: "leg2"; readonly elapsedSeconds: number }
  | {
      readonly kind: "finding";
      readonly elapsedSeconds: number;
      readonly finding: OnboardingFinding;
    }
  | { readonly kind: "ended"; readonly elapsedSeconds: number; readonly reason: EndedReason };

/**
 * ADD AD-5, line 208 — copied verbatim.
 *
 * THE ARITY IS 2 AND ITS SECOND PARAMETER IS A CLOCK, NOT A LIVE SIGNAL.
 * "There is no live-signal parameter, and its absence IS the guarantee"
 * (AD-5, line 211). A third parameter is the D4 regression this whole surface
 * exists to make impossible, so `stage.test.ts` pins the arity at runtime as
 * well as declaring it here.
 */
export type ReduceStage = (facts: StagePersistedFacts, nowMs: number) => RenderedStageState;

// ---------------------------------------------------------------------------
// The stage view
// ---------------------------------------------------------------------------

/**
 * One line of the wait log. Derived from ADD §5's `stage-view.ts` row ("log
 * lines (past tense, stamped, append-only)") and the UX spec's phase-B mock
 * (`.ai/ux/onboarding-five-steps.md:307-310`), which renders each line as a
 * `+Ns` stamp beside a past-tense fact.
 *
 * The stamp is kept as its own field rather than baked into `text` so
 * "append-only" is checkable: a later state may append lines, but an existing
 * line's text AND stamp must both be byte-identical to what came before.
 */
export type StageLogLine = {
  /** Seconds after `armedAt`. Renders as `+Ns`. */
  readonly atSeconds: number;
  /** Past tense. Nothing forward-looking, so nothing reads as a promise. */
  readonly text: string;
};

/**
 * What the stage renders. Derived from ADD §5's `stage-view.ts` row —
 * "heading, log lines (past tense, stamped, append-only), elapsed, hint".
 *
 * `elapsedSeconds` COUNTS UP from a persisted origin and is the only time
 * value the surface may carry (ruling R-LATENCY): it states what has ALREADY
 * happened. There is deliberately no `remainingSeconds`, no `targetSeconds`,
 * no `percentComplete` and no `etaSeconds` — the same structural refusal AD-3
 * applies to `expectedLag` on the counter, applied here by enumeration.
 */
export type StageView = {
  readonly heading: string;
  readonly hint: string;
  readonly lines: readonly StageLogLine[];
  readonly elapsedSeconds: number;
};

export type RenderStageView = (state: RenderedStageState) => StageView;

// ---------------------------------------------------------------------------
// AD-3 — the counter view. COPIED VERBATIM from the ADD's own TypeScript.
// ---------------------------------------------------------------------------

/**
 * One rendered counter row. The ADD names `CounterRow` in the AD-3 block
 * without declaring it; the comments there ("label + value, from
 * `COUNTER_LABELS`") give both fields, and UX Checklist row 9 requires each
 * row to carry its shipped label beside its number.
 */
export type CounterRow = {
  readonly label: string;
  readonly value: number;
};

/**
 * ADD AD-3, lines 137-145 — copied verbatim.
 *
 * WRITTEN BY EXPLICIT FIELD ENUMERATION, NEVER `Omit<EventsSeenCounter,
 * "expectedLag">`. An `Omit` silently re-admits the next duration-bearing
 * field somebody adds to the shipped counter; an enumeration refuses it by
 * default and forces the addition to be a deliberate edit (AD-3, line 152).
 * That is not a style preference: `describeExpectedLag` computes
 * `pollIntervalSeconds + 25` and `+ 220`, so with the shipped column default
 * of 60 an `Omit` would put "85 seconds… 280 seconds" in front of a customer.
 */
export type OnboardingCounterView = {
  readonly state: ConnectionState;
  readonly rows: readonly CounterRow[];
  readonly setAside: readonly CounterRow[];
  readonly identityUnverified: CounterRow;
  readonly asOfStatement: string;
  readonly windowStatement: string;
  readonly completenessStatement: string;
};

// ---------------------------------------------------------------------------
// The finding view
// ---------------------------------------------------------------------------

/**
 * One count, rendered. Derived from ADD §5's `finding-view.ts` row — "one row
 * per count carrying numerator + denominator + unit + surface".
 *
 * `sentence` is the "one line" those four values arrive in. The shipped
 * precedent is `magnitudeSentence` in `packages/core/src/summary/floor.ts:153`:
 * a zero denominator takes `FLOOR_NO_RATE_TEMPLATE`, and every other case
 * substitutes into a template that carries all four tokens in ONE string.
 *
 * UNDER-SPECIFIED, FLAGGED RATHER THAN GUESSED: nothing in the ADD or on the
 * persisted `counts` jsonb says WHICH of the three `FLOOR_COUNT_TEMPLATES`
 * roles a given count takes. The rows in `finding-view.test.ts` are therefore
 * written template-agnostically — they assert all four values are present in
 * the one sentence, never that a particular template was chosen. The wave that
 * writes `finding-view.ts` has to settle the role source.
 */
export type FindingCountLine = {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: "sessions";
  readonly surface: string;
  readonly sentence: string;
};

/**
 * What the finding card renders. Derived from ADD §5's `finding-view.ts` row
 * and UX Checklist row 20, which enumerate the same seven parts in the same
 * order.
 *
 * THE VIEW DOES NO MATHS. `contextLines` is `context[]` one line each, never
 * re-split and never joined; `counts` are carried through unaltered. A founder
 * checking our numbers must be checking the pipeline's numbers, not this
 * module's re-derivation of them.
 */
export type FindingView = {
  readonly classSentence: string;
  readonly headline: string;
  readonly contextLines: readonly string[];
  readonly counts: readonly FindingCountLine[];
  /** In words. Never a number — `FLOOR_CONFIDENCE_TEMPLATES` holds no digit. */
  readonly confidenceSentence: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  /** Verbatim from `SUMMARY_SOURCE_MESSAGES`. */
  readonly sourceSentence: string;
};

export type ToFindingView = (finding: OnboardingFinding) => FindingView;
