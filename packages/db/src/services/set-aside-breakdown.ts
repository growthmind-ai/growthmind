// The set-aside breakdown, built in one place for the two hand-written aggregations
// that report one: `events-counter.service.ts` and `detector-corpus.service.ts`.
//
// What this owns: the customer-facing label and the deterministic order. Both must be
// identical everywhere a set-aside gap is rendered, because the whole point is that
// renders one vocabulary and not two. A customer who reads "Your own team" on one
// screen and something else on another concludes the product is broken, not that two
// services disagree.
//
// What this deliberately does not own: the counting. That is where the two callers
// genuinely differ, and collapsing it would entrench a confusion rather than remove
// one. See `SetAsideUnit` below.
import type { ExclusionReason, SetAsideBreakdown } from "@growthmind/shared";
import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";

/**
 * What was counted, and the two callers do not share an answer.
 *
 * `events-counter.service.ts` tallies **events** (events joined to their session's
 * `exclusion_reason`). `detector-corpus.service.ts` tallies **sessions**. Same field
 * name (`setAside`), same customer-facing labels, different unit. A denominator hazard
 * for anything that renders both.
 *
 * So the unit is a required input, stated at each call site, even though this function
 * never branches on it: labels and order must not vary by unit (one vocabulary), but
 * the reader of either call site must be able to see which unit that site is counting
 * without leaving the line. A comment could have said the same thing and drifted; this
 * cannot.
 */
export type SetAsideUnit = "events" | "sessions";

export interface SetAsideTally {
  /** What the caller counted. See {@link SetAsideUnit}. */
  readonly unit: SetAsideUnit;
  /**
   * The non-kept totals, already tallied by the caller, one entry per reason.
   *
   * `"none"` never appears here: it means classified and kept, it is the kept total,
   * and a reason counted as both kept and set aside would break each caller's
   * denominator identity silently. Reasons are distinct, both callers tally into a
   * `group by` or a `Map`, so this function sums nothing.
   */
  readonly countsByReason: Iterable<readonly [ExclusionReason, number]>;
}

/**
 * Attaches the customer's own terms and puts the rows in a stable order: largest gap
 * first, ties broken by reason, so the same data never renders in two different orders
 * between reads.
 */
export function buildSetAsideBreakdown(tally: SetAsideTally): SetAsideBreakdown[] {
  return [...tally.countsByReason]
    .map(([reason, count]) => ({
      reason,
      count,
      // The customer's own terms, on the same screen as the number. An unexplained gap
      // reads as a broken product: "the counter says 3 but my analytics says 8".
      label: EXCLUSION_REASON_LABELS[reason],
    }))
    .toSorted((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
