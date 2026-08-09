import type { CandidateFinding, MeasuredCount } from "@growthmind/core";
import type { SummariseInput } from "@growthmind/adapters";
import type { MeasuredCountRow } from "@growthmind/db";

// The count unit widened to carry people, and a finding's counts are sessions: the persisted
// shape stays narrow and the narrowing happens here, loudly, rather than a finding quietly
// gaining a denominator its whole vocabulary is not written in.
function sessionsUnitOf(count: MeasuredCount): "sessions" {
  if (count.unit !== "sessions") {
    throw new Error(
      `analysis: a finding count is measured over sessions, and this one is over ${count.unit}`,
    );
  }

  return count.unit;
}

export function toCountRows(candidate: CandidateFinding): readonly MeasuredCountRow[] {
  return candidate.counts.map((count) => ({
    numerator: count.numerator,
    denominator: count.denominator,
    unit: sessionsUnitOf(count),
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
