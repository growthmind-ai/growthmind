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

import type { PostResult } from "../../src/delivery/poster";
import type {
  ConnectRefusalCode,
  ConnectionState,
  InternalDomainProvenance,
} from "../../src/session-source/types";
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

// ===========================================================================
// WAVE 0c ADDITIONS — steps, the privacy receipt, the Slack test post.
// ADDITIVE ONLY: nothing above this line changed.
//
// Same rules as the block above. Where the ADD declares the type outright
// (AD-19 does, in TypeScript) it is COPIED VERBATIM. Where it names a type and
// leaves its body to prose or to the UX spec's Expected-UI column, the
// derivation is CITED and any residual ambiguity is called out in a comment
// rather than resolved silently. The same honest limitation applies: the
// loader casts to these types, so a Wave 1 signature drift is not a compile
// error HERE.
//
// (`ConnectRefusalCode`, `InternalDomainProvenance` and `PostResult` are all
// SHIPPED types and are imported at the top of this file with the others —
// mirroring a type that already exists would invent drift where there is none.)
// ===========================================================================

// ---------------------------------------------------------------------------
// AD-19 — the step sequence. The union block is COPIED VERBATIM from the ADD's
// own TypeScript (docs/adds/onboarding-five-steps.md:551-563).
// ---------------------------------------------------------------------------

/** ADD AD-19, line 551 — `stepStateSchema`'s members. FR-O23: `coming-next` is
 *  a FIRST-CLASS member, so filling a stub later widens no union. */
export type StepState = "pending" | "active" | "done" | "skipped" | "coming-next";

/** ADD AD-19, line 552 — `stepIdSchema`'s members, in ordinal order. */
export type StepId = "repo" | "analytics" | "slack" | "agent" | "moment";

/**
 * One field on a work step.
 *
 * AD-19 names `FieldDescriptor` and does not declare it. Every property below
 * is forced by a normative cell of the UX First-Run Checklist, cited per line;
 * nothing here is invented to be convenient.
 *
 * UNDER-SPECIFIED, FLAGGED RATHER THAN GUESSED: the ADD gives no name for the
 * "which field is this refusal about" wire, and UX row 7 requires one (the
 * region disclosure auto-expands on `unreachable`, "because that is the field
 * the sentence is about"). Modelled as `refusalCodes` ON THE DESCRIPTOR rather
 * than as a separate lookup function, because D11's rule is that the consumer
 * deriving the value from what it already holds is the only wiring with no
 * thread to sever — the renderer already has the descriptor. The wave that
 * writes `steps.ts` may rename this; it may not delete the relationship.
 */
export type FieldDescriptor = {
  readonly id: string;
  /** Normative copy — UX rows 5 and 12 state every label in bold. */
  readonly label: string;
  /**
   * The sentence UNDER the field. UX rows 5 and 12 each give one in bold ("In
   * PostHog: Settings → Personal API keys…", "In Slack: right-click the
   * channel → …"), and those two sentences are the entire reason AD-4's
   * proper-noun allow-list exists — so the descriptor needs somewhere to
   * carry them or the copy has no home.
   */
  readonly helper: string | null;
  /** Rendered masked. UX rows 5 and 12: the personal key and the bot token. */
  readonly secret: boolean;
  /**
   * Behind the collapsed disclosure on first render. UX row 5's region field is
   * the sprint's only `true`: prefilled, correct for most, and folded so step 2
   * shows "exactly two visible fields".
   */
  readonly folded: boolean;
  /** UX rows 5 and 12 give these in bold: `12345`, `xoxb-…`, `C01AB2CD3EF`. */
  readonly placeholder: string | null;
  /**
   * UX row 5: the region is prefilled `https://us.i.posthog.com`. A VISIBLE
   * field is never prefilled — a field the product can fill in for you is a
   * field it should not have asked for (the Dumb-2026-Human forcing question 3).
   */
  readonly prefill: string | null;
  /**
   * The refusal codes this field is the subject of. UX row 6 puts focus on the
   * key field for `invalid_credentials`; UX row 7 auto-expands the region for
   * `unreachable`.
   */
  readonly refusalCodes: readonly ConnectRefusalCode[];
};

/**
 * One action on a work step. AD-19 names `ActionDescriptor` without declaring
 * it; UX row 12 gives both the labels and the ranking ("Send a test message"
 * primary, "Skip for now" secondary), and UX §6 requires them stacked with the
 * primary first on mobile — so the rank is data, not a render-time decision.
 */
export type ActionDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly rank: "primary" | "secondary";
};

/**
 * What a step confirms IN PLACE once it succeeds (UX §5: "success is always
 * shown in place, adjacent to its cause"). Left as a `string` rather than
 * enumerated: the PRD fixes the count for step 2 ("two confirmations — counter,
 * then receipt") but no source names the identifiers, and inventing three
 * literals here would pin a vocabulary nobody has chosen.
 */
export type ConfirmationId = string;

/** ADD AD-19, lines 554-563 — COPIED VERBATIM, with the three types above
 *  supplied as declared just so this file typechecks standalone. */
export type StepDescriptor =
  | {
      readonly kind: "coming-next";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
      readonly whatItWillDo: string;
      readonly filler: string;
    }
  //   ^ no `fields`, no `actions`, no `confirmations`. There is nothing to
  //     render as a control. This absence IS the FR-O3/FR-O15 contract.
  | {
      readonly kind: "work";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
      readonly helper: string;
      readonly fields: readonly FieldDescriptor[];
      readonly actions: readonly ActionDescriptor[];
      readonly confirmations: readonly ConfirmationId[];
      readonly skippable: boolean;
    }
  | {
      readonly kind: "stage";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
    };

/**
 * The persisted facts the sequence is derived FROM.
 *
 * UX §3's data table is explicit that step states are "derived from persisted
 * connection rows + the skip/dismiss facts — NEVER a stored per-step status
 * column", so every member below is a persisted fact and none is a step state.
 *
 * UNDER-SPECIFIED, FLAGGED: `reopenedReadOnly` is the one member that is not a
 * persisted row. UX row 25's re-open disclosure is client state ("toggle, not
 * navigation — the URL never changes"), and no source says how it reaches the
 * derivation. It is carried here because the row's assertion — every step at
 * its resolved state, none re-activated — has to be checkable somewhere, and
 * the sequence engine is the only place that knows what "resolved state" is.
 * The wave that writes `deriveStepStates` may move it to a second parameter;
 * it may not make read-only a renderer's private decision, because then no
 * test can reach it (AD-1: there is no DOM runner).
 */
export type StepSequenceFacts = {
  /** `null` when no connection row exists at all. */
  readonly connectionStatus: ConnectionState["status"] | null;
  readonly slackConnected: boolean;
  /** FR-O14: derived from the persisted absence of a connection, never a flag. */
  readonly slackSkipped: boolean;
  /** Flow D: a failed test post leaves step 3 active and NOT done. */
  readonly slackTestPostFailed: boolean;
  readonly armedAt: Date | null;
  /** UX row 25. See the flag above. */
  readonly reopenedReadOnly: boolean;
};

/**
 * One step as the sequence resolves it.
 *
 * `state` and `ordinal` are forced by ADD §9's first two rows. `open` and
 * `interactive` are derived from the UX Checklist and are the only way the two
 * orphan rows this file carries can be asserted without a DOM:
 *   - `open` — UX row 8: step 2 "flips to done AND STAYS OPEN", step 3 "opens
 *     beneath without a click". Done-and-open is a different render from
 *     done-and-collapsed, and the difference is the whole confirmation.
 *   - `interactive` — UX row 25: on re-open "no step re-activates, no form
 *     re-opens".
 */
export type StepView = {
  readonly id: StepId;
  readonly ordinal: number;
  readonly state: StepState;
  /** The body renders. */
  readonly open: boolean;
  /** The body's controls accept input. False for every step when re-opened. */
  readonly interactive: boolean;
};

export type DeriveStepStates = (facts: StepSequenceFacts) => readonly StepView[];

// ---------------------------------------------------------------------------
// The privacy receipt (AD-2, FR-O8, PRD ruling R2)
// ---------------------------------------------------------------------------

/**
 * ONE LINE OF THE RECEIPT, AND IT IS A STRING.
 *
 * ADD §9 states the type outright: "the receipt is `readonly ReceiptLine[]` of
 * strings by type". That is not a stylistic choice — it is the whole mechanism
 * behind `the receipt exposes no editable control`. A string cannot carry a
 * field, a toggle, an action or a default value, so the row is true BY TYPE
 * rather than by anybody's discipline, and a later edit that wants a control
 * has to change this alias first, in the open.
 */
export type ReceiptLine = string;

/** ADD §5's Wave 1 table, line 691 — `buildPrivacyReceipt({ inferredInternalDomain, provenance })`. */
export type PrivacyReceiptInput = {
  readonly inferredInternalDomain: string | null;
  readonly provenance: InternalDomainProvenance | null;
};

export type BuildPrivacyReceipt = (input: PrivacyReceiptInput) => readonly ReceiptLine[];

// ---------------------------------------------------------------------------
// The Slack test post (FR-O11)
// ---------------------------------------------------------------------------

/**
 * CONTRADICTION IN THE SOURCES, RESOLVED IN THE OPEN RATHER THAN GUESSED.
 *
 * ADD §5 line 695 declares `describeTestPostOutcome(PostResult)`. ADD §9's
 * fifth row requires `a successful post marks the step done AND NAMES THE
 * CHANNEL`, and UX row 15's normative copy is "A test message just landed in
 * #channel." `PostResult` (`packages/shared/src/delivery/poster.ts:66-77`)
 * carries `messageRef` and nothing else on its success arm — THERE IS NO
 * CHANNEL ON IT.
 *
 * So the input is mirrored as an object carrying both. The alternative —
 * substituting the channel at the call site — would put a customer-facing
 * sentence outside `packages/shared`, which FR-O22 forbids and which
 * `render-purity.test.ts`'s "no component authors a customer-facing sentence
 * inline" row would then fail. Wave 1 must settle the exact parameter shape;
 * it may not settle it by dropping the channel.
 */
export type TestPostInput = {
  readonly result: PostResult;
  /** FR-O13: read from the `slack_connections` row, never from a payload. */
  readonly channelId: string;
};

/** ADD §5 line 695 and §9's six rows — the three fields, verbatim. */
export type TestPostOutcome = {
  readonly sentence: string;
  readonly retryable: boolean;
  readonly marksStepDone: boolean;
};

export type DescribeTestPostOutcome = (input: TestPostInput) => TestPostOutcome;

// ===========================================================================
// WAVE 0g ADDITIONS — the one shape deviation 1 rests on.
// ADDITIVE ONLY: nothing above this line changed.
//
// Wave 0g's four suites are SOURCE SCANS (AD-1), so almost none of them needs
// a type at all — they read text and assert about it. `FirstRunStatus` is the
// exception, and it earns its place here for one reason: it is the shape
// **AD-18 makes structural**, and the whole of deviation 1 hangs off one field
// of it.
// ===========================================================================

/**
 * What `GET /api/first-run/status` returns — the one shape the poll consumes.
 *
 * **THE ONE MEMBER THAT IS PINNED RATHER THAN DERIVED IS `finding`.** AD-18
 * states it outright: *"`FirstRunStatus.finding` is `OnboardingFinding | null`
 * — A SINGLE NULLABLE OBJECT, NOT AN ARRAY"*, and B5 says why. The most likely
 * way deviation 1 ("the first-run surface is never linkable back to and holds
 * no history") dies is not a designer adding a history page — it is a
 * well-meaning later edit turning a one-row renderer into a list, because a
 * list is what every other product does. Typing the field as a single nullable
 * object makes that edit a TYPE ERROR AT THE ROUTE, in a file whose reviewer is
 * looking at the deviation, instead of a quiet change to a `.map(`.
 *
 * The remaining members are the reducer's inputs (AD-6's milestone table
 * supplies each one from a real row) plus the two things the strip renders
 * (AD-3's narrowed counter, and the channel read from the `slack_connections`
 * row per FR-O13). They are carried here so the shape is legible, not because
 * this file can pin them.
 *
 * **UNDER-SPECIFIED, FLAGGED RATHER THAN GUESSED.** No source enumerates this
 * object's full member list in one place — AD-3, AD-6, AD-18 and the UX spec's
 * phase-B data table each name a part. Wave 1a settles it. What Wave 0g asserts
 * about it is NOT this declaration (the mirror cannot bind an implementation
 * nobody has written — see this file's header): it is a source scan of the real
 * `packages/shared/src/onboarding/types.ts`, which is the only thing that can.
 * The type-level check in `first-run-constraints.test.ts` pins THIS MIRROR, and
 * says so out loud.
 */
export type FirstRunStatus = {
  /** AD-18 / B5. NEVER `readonly OnboardingFinding[]`. */
  readonly finding: OnboardingFinding | null;
  readonly armedAt: Date | null;
  readonly retrievedAt: Date | null;
  readonly readingAt: Date | null;
  readonly endedAt: Date | null;
  readonly runStatus: AnalysisRunStatus | null;
  readonly runOutcome: AnalysisOutcome | null;
  /** AD-3 — the narrowed view. `expectedLag` is not a property in scope. */
  readonly counter: OnboardingCounterView;
  /** FR-O13: read from the connection row, never accepted from a payload. */
  readonly channelId: string | null;
};
