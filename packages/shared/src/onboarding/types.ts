// THE DECLARED SHAPES BOTH SIDES OF THE FIRST-RUN WIRE AGREE ON (O-008, AD-2).
//
// WHY THESE LIVE IN `shared` AND NOT IN `apps/web/lib`. The status route and
// the components that consume it sit on opposite sides of a serialization
// boundary. A shape declared on one side of that boundary is a D11 wire waiting
// to be severed — the producer computes a field, the consumer reads a field
// with the same name off a differently-shaped object, and nothing fails. There
// is one declaration and both sides import it.
//
// `packages/shared` may not import `packages/db` or `packages/core`, which is
// exactly what forces this module to be honest: `OnboardingFinding` is a plain
// declared shape that `FindingRecord` is MAPPED INTO at the route boundary
// (AD-6's "boundary parse"), not a re-export of a repository row. The UI never
// re-casts and never re-parses — the discipline
// `packages/db/src/repositories/findings.repo.ts:165-172` establishes one layer
// out, applied one layer in.
//
// ###########################################################################
// # AD-18 / B5 — `FirstRunStatus.finding` IS A SINGLE NULLABLE OBJECT.
// #
// # NEVER `readonly OnboardingFinding[]`, never `Array<OnboardingFinding>`.
// # Deviation 1 ("the first-run surface is never linkable back to and holds no
// # history") does not die by somebody designing a history page. It dies by a
// # well-meaning later edit turning a one-row renderer into a list, because a
// # list is what every other product does. Typing the field as ONE nullable
// # object makes that edit a TYPE ERROR AT THE ROUTE, in a file whose reviewer
// # is looking at the deviation, instead of a quiet change to a `.map(`.
// #
// # `apps/web/__tests__/first-run/first-run-constraints.test.ts` scans this
// # file's source for the declaration below and for the array spelling. Both
// # halves are load-bearing.
// ###########################################################################
//
// ── A SETTLEMENT WAVE 1a HAD TO MAKE, RECORDED RATHER THAN SMUGGLED ─────────
//
// `OnboardingCounterView` and `CounterRow` (AD-3) are declared HERE rather than
// in `onboarding/counter-view.ts`, and `counter-view.ts` re-exports them beside
// `toOnboardingCounterView`. The reason is a dependency direction, not a
// preference: `FirstRunStatus` is the one shape the poll consumes and it CARRIES
// the narrowed counter, so `types.ts` would have to import from `counter-view.ts`
// — and `counter-view.ts` is a later wave that imports `types.ts`. One of the two
// edges has to go, and the type has no dependencies while the function does.
//
// AD-3's actual requirement is untouched and is discharged below: the view is
// written by EXPLICIT FIELD ENUMERATION, never `Omit<EventsSeenCounter,
// "expectedLag">`. An `Omit` silently re-admits the next duration-bearing field
// somebody adds to the shipped counter; an enumeration refuses it by default and
// forces the addition to be a deliberate edit to this file.

import { z } from "zod";

import type { ConnectionState } from "../session-source/types";
import type { AnalysisOutcome, AnalysisRunStatus } from "../summary/types";
import { summarySourceSchema } from "../summary/types";

// ---------------------------------------------------------------------------
// The finding, as this surface receives it
// ---------------------------------------------------------------------------

/**
 * One measured count as it reaches the screen.
 *
 * `unit` is the literal `"sessions"` and never `"people"` — this product does
 * not stitch one person's visits together, and rendering a session count as a
 * people count claims more than was measured
 * (`packages/shared/src/summary/messages.ts:273-276`).
 *
 * The count carries NO role. The persisted row it is mapped from
 * (`measuredCountRowSchema`, `findings.repo.ts:62-79`) carries none either, and
 * inventing one here would let a sentence assert which behaviour was measured
 * on evidence that never recorded it. See `finding-view.ts` for how the single
 * role that IS licensed is chosen.
 */
export const onboardingCountSchema = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  unit: z.literal("sessions"),
});
export type OnboardingCount = z.infer<typeof onboardingCountSchema>;

/**
 * The finding the stage renders.
 *
 * `windowStart` and `windowEnd` are COERCED rather than declared `z.date()`,
 * for the reason `measuredCountRowSchema` already records: JSON has no `Date`,
 * so these two fields leave the route as `Date` and arrive at the client as ISO
 * strings. One schema guards both directions (D5).
 *
 * `finalClass` and `confidenceBasis` are `string` rather than unions on
 * purpose. Their home unions live in `packages/core`, which `shared` may not
 * import, and a THIRD literal restatement of either is the drift the one-home
 * rule exists to stop. Both are KEYS into shipped tables and neither may ever
 * reach a reader raw — `finding-view.ts` is where that is enforced, and it
 * degrades to a plain sentence rather than to a machine word when a value falls
 * outside the table it keys.
 */
export const onboardingFindingSchema = z.object({
  /** Keys `FLOOR_OBSERVATION_TEMPLATES`. NEVER rendered raw. */
  finalClass: z.string(),
  headline: z.string(),
  /** One sentence per element — NEVER a blob to be re-split downstream. */
  context: z.array(z.string()),
  counts: z.array(onboardingCountSchema),
  surface: z.string(),
  /** Keys `FLOOR_CONFIDENCE_TEMPLATES`. No value there contains a digit. */
  confidenceBasis: z.string(),
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  summarySource: summarySourceSchema,
});
export type OnboardingFinding = z.infer<typeof onboardingFindingSchema>;

// ---------------------------------------------------------------------------
// Why a run ended with nothing to show
// ---------------------------------------------------------------------------

/**
 * The three endings, kept distinct FOREVER (UX Checklist row 21).
 *
 * A failed run, "we looked and your product was quiet", and "there has not been
 * enough activity to look at" are three different answers, and two of them are
 * different answers to the same zero. Collapsing any pair tells a founder
 * something untrue about their own product.
 *
 * Each member is a KEY into a shipped table, never a sentence authored here:
 * `failed` keys `ANALYSIS_RUN_STATUS_MESSAGES`, the other two key
 * `ANALYSIS_OUTCOME_MESSAGES`.
 */
export const endedReasonSchema = z.enum([
  "failed",
  "no_candidates_passed_gate",
  "no_sessions_to_analyse",
]);
export type EndedReason = z.infer<typeof endedReasonSchema>;

// ---------------------------------------------------------------------------
// AD-3 — the narrowed counter. See the settlement note in this file's header.
// ---------------------------------------------------------------------------

/** One rendered counter row: the shipped label beside its number. */
export type CounterRow = {
  readonly label: string;
  readonly value: number;
};

/**
 * What the counter renders, and NOTHING ELSE.
 *
 * WRITTEN BY EXPLICIT FIELD ENUMERATION, NEVER `Omit<EventsSeenCounter,
 * "expectedLag">` (AD-3). `describeExpectedLag` computes
 * `pollIntervalSeconds + 25` and `+ 220`, so with the shipped column default of
 * 60 an `Omit` would put "85 seconds… 280 seconds" in front of a customer —
 * FR-O18 and FR-O22 failed in one line. `expectedLag` is not a property in
 * scope inside any component on this surface: rendering it is a compile error,
 * not a discipline.
 *
 * The enumeration also refuses the NEXT duration-bearing field somebody adds to
 * the shipped counter. That is the whole point of writing it out.
 */
export type OnboardingCounterView = {
  readonly state: ConnectionState;
  /** Labels from `COUNTER_LABELS`; none is authored in this package's onboarding module. */
  readonly rows: readonly CounterRow[];
  /** One per breakdown entry, labelled from `EXCLUSION_REASON_LABELS`. */
  readonly setAside: readonly CounterRow[];
  /** Its own row. NEVER folded into `kept`. */
  readonly identityUnverified: CounterRow;
  /** Never blank, and never "now". */
  readonly asOfStatement: string;
  readonly windowStatement: string;
  readonly completenessStatement: string;
};

// ---------------------------------------------------------------------------
// The one shape the poll consumes
// ---------------------------------------------------------------------------

/**
 * What `GET /api/first-run/status` returns.
 *
 * The milestone fields are the reducer's inputs, each supplied from a real
 * persisted row by AD-6's milestone table — nothing here is minted and nothing
 * is hand-passed. `channelId` is read from the `slack_connections` row and is
 * never accepted from a payload (FR-O13).
 *
 * `finding` is the field AD-18 makes structural. Read the header.
 */
export type FirstRunStatus = {
  /** AD-18 / B5. A SINGLE NULLABLE OBJECT. */
  readonly finding: OnboardingFinding | null;
  readonly armedAt: Date | null;
  /** A poll run persisted events after arming. */
  readonly retrievedAt: Date | null;
  /** An analysis run opened after arming. */
  readonly readingAt: Date | null;
  readonly endedAt: Date | null;
  readonly runStatus: AnalysisRunStatus | null;
  readonly runOutcome: AnalysisOutcome | null;
  /** AD-3's narrowed view. `expectedLag` is not a property in scope. */
  readonly counter: OnboardingCounterView;
  /** FR-O13: read from the connection row, never accepted from a payload. */
  readonly channelId: string | null;
};
