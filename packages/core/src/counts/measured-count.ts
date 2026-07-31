// `MeasuredCount` — the only shape a count in this product may travel in
// (O-004 D-8, FR-10, FR-7, BS-3).
//
// A count without a denominator is not a weaker claim, it is an unactionable
// one: "3 sessions dropped off" is noise, "3 of 28 sessions (12 set aside: 9
// automated, 3 internal)" is a sentence a founder can act on. Every field
// below is REQUIRED and non-optional, so a count without its denominator is a
// COMPILE error, and the brand makes `x as MeasuredCount` and object-literal
// shortcuts unavailable so "impossible to construct without a denominator" is
// literal rather than aspirational.
//
// Implemented in Wave 3 against this scaffold's final signatures.
import type { ExclusionReason } from "@growthmind/shared";
import { exclusionReasonSchema } from "@growthmind/shared";
import { z } from "zod";

/**
 * The brand key. A module-private `unique symbol`, so the only code that can
 * produce a value carrying it is `measuredCount` below — in this file. It is
 * deliberately NOT exported: a consumer in another package can hold a
 * `MeasuredCount` and read every field, and cannot fabricate one.
 */
const MEASURED: unique symbol = Symbol("growthmind.measured-count");

/**
 * One row of the denominator's composition (D-7). An array rather than a keyed
 * record so `kept + Σ setAside.count === totalInWindow` is a sum over a list —
 * the identity a test asserts directly. Mirrors `SetAsideBreakdown` in
 * `@growthmind/shared`'s counter, and reuses `EXCLUSION_REASON_LABELS` for the
 * customer-facing wording, so O-007 renders ONE vocabulary rather than two.
 */
export type SetAsideBasis = {
  readonly reason: ExclusionReason;
  readonly count: number;
  /** From `EXCLUSION_REASON_LABELS` in `@growthmind/shared`. */
  readonly label: string;
};

/**
 * The denominator's composition, shipped with every count (D-7, FR-7).
 *
 * `kept` IS the denominator. An excluded session never reaches a numerator and
 * never inflates a denominator — a bot never had the opportunity to convert,
 * so counting it understates every rate and makes the claim un-actionable
 * (product-decisions §4).
 *
 * ES-7: every session excluded ⇒ `kept = 0` ⇒ an explicit no-rate (see
 * `rateOf`), with `totalInWindow` still stating how many there were. That is
 * distinguishable from ES-1 (`totalInWindow = 0`, nothing to analyse) by
 * construction rather than by convention.
 */
export type CountBasis = {
  /** Every session selected into the corpus window, kept or not. */
  readonly totalInWindow: number;
  /** The denominator: sessions with `exclusion_reason = 'none'`. */
  readonly kept: number;
  readonly setAside: readonly SetAsideBasis[];
};

/**
 * A count that cannot exist without its denominator (FR-10, D-8).
 *
 * `unit` is the LITERAL type `"sessions"`, never `"people"` (BS-3). Identity
 * stitching does not exist in this product — `sessions.identity_key` is a
 * project-salted hash and `packages/db/src/schema/sessions.ts` states the
 * `identities` table does not exist — so "3 of 40" means 3 of 40 SESSIONS.
 * O-007 must be UNABLE to render a session count as a people count, and the
 * type is what makes that unable rather than unlikely.
 */
export type MeasuredCount = {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: "sessions";
  readonly timeframe: { readonly start: Date; readonly end: Date };
  readonly basis: CountBasis;
  readonly [MEASURED]: true;
};

/** Everything `measuredCount` requires. All five, all non-optional. */
export type MeasuredCountInput = {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: "sessions";
  readonly timeframe: { readonly start: Date; readonly end: Date };
  readonly basis: CountBasis;
};

export const setAsideBasisSchema = z.object({
  reason: exclusionReasonSchema,
  count: z.number().int().nonnegative(),
  label: z.string().min(1),
});

export const countBasisSchema = z.object({
  totalInWindow: z.number().int().nonnegative(),
  kept: z.number().int().nonnegative(),
  setAside: z.array(setAsideBasisSchema),
});

/**
 * The runtime mirror of `MeasuredCountInput` (FR-10). The compile-level
 * required fields are the primary guard; this is what makes the same rejection
 * observable from a test and from an untyped caller.
 *
 * `unit` is `z.literal("sessions")` — a runtime refusal of `"people"` beside
 * the compile-time one.
 */
export const measuredCountInputSchema = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  unit: z.literal("sessions"),
  timeframe: z.object({ start: z.date(), end: z.date() }),
  basis: countBasisSchema,
});

/**
 * True only for a value this module constructed. The brand check is the whole
 * point: a structurally identical object literal is NOT a `MeasuredCount`.
 */
export function isMeasuredCount(value: unknown): value is MeasuredCount {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [MEASURED]?: unknown })[MEASURED] === true
  );
}

/**
 * The schema every downstream shape (the candidate contract, the evidence
 * signals) uses to accept a count. `z.custom` rather than `z.object` because
 * the brand cannot be re-created by parsing — which is exactly the property
 * FR-10 asks for.
 */
export const measuredCountSchema = z.custom<MeasuredCount>((value) => isMeasuredCount(value), {
  message: "a count must be built by measuredCount(), with its denominator",
});

/**
 * `measuredCountInputSchema` plus the two cross-field assertions D-7 requires.
 *
 * Module-private, and deliberately NOT folded into the exported input schema:
 * that schema is the per-field runtime mirror of `MeasuredCountInput`, and
 * widening its meaning would change an exported contract other modules already
 * parse against. The identity lives with the constructor, where the ADD put it.
 *
 * Both assertions are reported as Zod issues at the offending path rather than
 * as bare throws, so a caller — a test, a parsed payload, an untyped consumer —
 * gets the same machine-readable refusal for a violated identity as it does for
 * a negative numerator.
 */
const consistentMeasuredCountInputSchema = measuredCountInputSchema.superRefine((value, ctx) => {
  // Both fields are guarded: `superRefine` still runs when a field-level check
  // has already failed, so `basis` can legitimately be absent here.
  if (value.basis !== undefined && Array.isArray(value.basis.setAside)) {
    const setAsideTotal = value.basis.setAside.reduce((sum, row) => sum + row.count, 0);
    if (value.basis.kept + setAsideTotal !== value.basis.totalInWindow) {
      ctx.addIssue({
        code: "custom",
        path: ["basis"],
        message: `a basis must account for every session in the window: kept (${value.basis.kept}) + set aside (${setAsideTotal}) is not totalInWindow (${value.basis.totalInWindow})`,
      });
    }

    if (value.denominator !== value.basis.kept) {
      // FR-7: the denominator IS kept sessions. A count may never quote a
      // denominator its own basis does not account for.
      ctx.addIssue({
        code: "custom",
        path: ["denominator"],
        message: `a denominator must be the basis's kept sessions: ${String(value.denominator)} is not ${value.basis.kept}`,
      });
    }
  }

  // THE ARITHMETIC IDENTITY. Every count in this package is "sessions that did
  // X, out of the kept sessions in the window" — a SUBSET count. A numerator
  // above its denominator is therefore not a large rate, it is a broken claim:
  // "35 of 28 sessions" is unrenderable in Slack (§10) and `rateOf` would
  // return 1.25, contradicting `Rate`'s own documented [0, 1] range.
  //
  // Guarded here rather than trusted because there are TWO independent paths to
  // the same fact: `analysedSessions` RECOMPUTES kept from `corpus.sessions`,
  // while both detectors take the denominator from `corpus.basis.kept`. The
  // real `detector-corpus.service` keeps them equal; a hand-built, cached, or
  // rolled-up corpus from O-005/O-006/O-007 need not, and this is the
  // constructor whose stated ambition (D-8) is that an invalid count be
  // literally unconstructible.
  //
  // FAIL DIRECTION: refuse. An impossible count is a caller bug, and silently
  // admitting one puts a number a founder acts on beyond the reach of every
  // downstream check.
  if (
    typeof value.numerator === "number" &&
    typeof value.denominator === "number" &&
    value.numerator > value.denominator
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["numerator"],
      message: `a numerator may never exceed its denominator: ${String(value.numerator)} of ${String(value.denominator)} is not a subset of the sessions measured`,
    });
  }
});

/**
 * THE ONLY constructor. Validates with `measuredCountInputSchema`, asserts the
 * D-7 basis identity `kept + Σ setAside.count === totalInWindow`, asserts
 * `denominator === basis.kept`, and stamps the brand.
 *
 * FAIL DIRECTION: refuse. A malformed count is a caller bug, and a count is
 * the thing a founder acts on — so this throws rather than coercing, and never
 * invents a denominator.
 */
export function measuredCount(input: MeasuredCountInput): MeasuredCount {
  const parsed = consistentMeasuredCountInputSchema.parse(input);

  return {
    numerator: parsed.numerator,
    denominator: parsed.denominator,
    unit: parsed.unit,
    timeframe: { start: parsed.timeframe.start, end: parsed.timeframe.end },
    basis: {
      totalInWindow: parsed.basis.totalInWindow,
      kept: parsed.basis.kept,
      setAside: parsed.basis.setAside.map((row) => ({
        reason: row.reason,
        count: row.count,
        label: row.label,
      })),
    },
    [MEASURED]: true,
  };
}

/**
 * A rate is a discriminated union, never a number (D-8, ES-6).
 *
 * `value` is the ratio `numerator / denominator` in the range [0, 1].
 */
export type Rate =
  | { readonly kind: "rate"; readonly value: number }
  | { readonly kind: "no_rate"; readonly reason: "zero_denominator" };

/**
 * The ONLY division in this package (D-8). Returns `no_rate` at a zero
 * denominator and never `NaN`, never `Infinity`, and never a throw — ES-6.
 *
 * A zero denominator is a real, reportable state ("everything in the window
 * was set aside"), not an error, and it must reach the customer as that
 * sentence rather than as a number nobody can read.
 */
export function rateOf(count: MeasuredCount): Rate {
  if (count.denominator === 0) {
    return { kind: "no_rate", reason: "zero_denominator" };
  }

  return { kind: "rate", value: count.numerator / count.denominator };
}
