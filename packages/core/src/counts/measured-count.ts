import type { ExclusionReason } from "@growthmind/shared";
import { exclusionReasonSchema } from "@growthmind/shared";
import { z } from "zod";

const MEASURED: unique symbol = Symbol("growthmind.measured-count");

export type SetAsideBasis = {
  readonly reason: ExclusionReason;
  readonly count: number;

  readonly label: string;
};

export type CountBasis = {
  readonly totalInWindow: number;

  readonly kept: number;
  readonly setAside: readonly SetAsideBasis[];

  // Of `kept`, how many no confirmed `who_counts` rule could be checked against — a session
  // carrying no identity cannot be shown to be outside an audience, so it is counted. The
  // number travels with the denominator it qualifies, because a denominator narrowed on
  // some rows and not others means nothing without it.
  readonly keptUnchecked: number;
};

export type MeasuredCount = {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: "sessions";
  readonly timeframe: { readonly start: Date; readonly end: Date };
  readonly basis: CountBasis;
  readonly [MEASURED]: true;
};

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

  // Absent from every count persisted before who_counts could narrow anything (D5).
  keptUnchecked: z.number().int().nonnegative().default(0),
});

export const measuredCountInputSchema = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  unit: z.literal("sessions"),
  timeframe: z.object({ start: z.date(), end: z.date() }),
  basis: countBasisSchema,
});

export function isMeasuredCount(value: unknown): value is MeasuredCount {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [MEASURED]?: unknown })[MEASURED] === true
  );
}

export const measuredCountSchema = z.custom<MeasuredCount>((value) => isMeasuredCount(value), {
  message: "a count must be built by measuredCount(), with its denominator",
});

const consistentMeasuredCountInputSchema = measuredCountInputSchema.superRefine((value, ctx) => {
  if (value.basis !== undefined && Array.isArray(value.basis.setAside)) {
    const setAsideTotal = value.basis.setAside.reduce((sum, row) => sum + row.count, 0);
    if (value.basis.kept + setAsideTotal !== value.basis.totalInWindow) {
      ctx.addIssue({
        code: "custom",
        path: ["basis"],
        message: `a basis must account for every session in the window: kept (${value.basis.kept}) + set aside (${setAsideTotal}) is not totalInWindow (${value.basis.totalInWindow})`,
      });
    }

    if (value.basis.keptUnchecked > value.basis.kept) {
      ctx.addIssue({
        code: "custom",
        path: ["basis", "keptUnchecked"],
        message: `sessions kept unchecked are a subset of those kept: ${String(value.basis.keptUnchecked)} is more than ${value.basis.kept}`,
      });
    }

    if (value.denominator !== value.basis.kept) {
      ctx.addIssue({
        code: "custom",
        path: ["denominator"],
        message: `a denominator must be the basis's kept sessions: ${String(value.denominator)} is not ${value.basis.kept}`,
      });
    }
  }

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
      keptUnchecked: parsed.basis.keptUnchecked,
      setAside: parsed.basis.setAside.map((row) => ({
        reason: row.reason,
        count: row.count,
        label: row.label,
      })),
    },
    [MEASURED]: true,
  };
}

export type Rate =
  | { readonly kind: "rate"; readonly value: number }
  | { readonly kind: "no_rate"; readonly reason: "zero_denominator" };

export function rateOf(count: MeasuredCount): Rate {
  if (count.denominator === 0) {
    return { kind: "no_rate", reason: "zero_denominator" };
  }

  return { kind: "rate", value: count.numerator / count.denominator };
}
