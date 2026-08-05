import type { CandidateFinding } from "@growthmind/core";
import type { SummariseInput } from "@growthmind/adapters";
import type { MeasuredCountRow } from "@growthmind/db";

export function toCountRows(candidate: CandidateFinding): readonly MeasuredCountRow[] {
  return candidate.counts.map((count) => ({
    numerator: count.numerator,
    denominator: count.denominator,
    unit: count.unit,
    timeframe: { start: count.timeframe.start, end: count.timeframe.end },
    basis: {
      totalInWindow: count.basis.totalInWindow,
      kept: count.basis.kept,
      keptUnchecked: count.basis.keptUnchecked,
      setAside: count.basis.setAside.map((row) => ({
        reason: row.reason,
        count: row.count,
        label: row.label,
      })),
    },
  }));
}

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

    confidenceBasis: candidate.ranking.confidenceBasis,
  };
}
