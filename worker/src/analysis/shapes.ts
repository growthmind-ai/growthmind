// The two boundary mappers. A candidate down-shaped for the store, and a candidate
// down-shaped for the model.
//
// Both are pure and total: no I/O, no logger, no clock, no failure mode. Given the same
// candidate they return the same value forever, which is what makes them testable with
// a plain input/output assertion and nothing else.
//
// Why these live in worker/ and not in packages/core Because of the direction of the
// dependency graph, not because of a judgement about where they belong.
// `MeasuredCountRow` is declared by `@growthmind/db` and `SummariseInput` by
// `@growthmind/adapters`; `packages/core` depends on `@growthmind/shared` and `zod`
// alone, and both of those packages depend on core. A mapper whose output type is a
// downstream package's cannot live upstream of it.
//
// That is the honest constraint. These are the lane's two adapters between the domain
// shape and the shapes its two egress points accept, and the worker is the only place
// that sees all three.
import type { CandidateFinding } from "@growthmind/core";
import type { SummariseInput } from "@growthmind/adapters";
import type { MeasuredCountRow } from "@growthmind/db";

/**
 * The branded `MeasuredCount`s, down-shaped for persistence.
 *
 * Written out field by field rather than cast. `MeasuredCount` carries a module-private
 * brand symbol that no round-trip through jsonb can recreate, and its `basis.setAside`
 * is a readonly array the repository's row shape does not accept, so this is a real
 * boundary, not a formality. Nothing is computed here: every number is copied, none is
 * derived, and no count is dropped.
 */
export function toCountRows(candidate: CandidateFinding): readonly MeasuredCountRow[] {
  return candidate.counts.map((count) => ({
    numerator: count.numerator,
    denominator: count.denominator,
    unit: count.unit,
    timeframe: { start: count.timeframe.start, end: count.timeframe.end },
    basis: {
      totalInWindow: count.basis.totalInWindow,
      kept: count.basis.kept,
      setAside: count.basis.setAside.map((row) => ({
        reason: row.reason,
        count: row.count,
        label: row.label,
      })),
    },
  }));
}

/** The gate-proven state the renderer is allowed to see, and nothing else. No raw
 * session data, no trace, no evidence shape. The port is a renderer, and what it cannot
 * read it cannot restate. */
export function summariseInputFor(candidate: CandidateFinding): SummariseInput {
  return {
    finalClass: candidate.finalClass,
    surface: candidate.surface,
    counts: candidate.counts.map((count) => ({
      numerator: count.numerator,
      denominator: count.denominator,
      unit: count.unit,
    })),
    timeframe: { start: candidate.timeframe.start, end: candidate.timeframe.end },
    // What the confidence rests on, never a confidence value. There is no numeric
    // confidence in this product and the model must not invent one.
    confidenceBasis: candidate.ranking.confidenceBasis,
  };
}
