import { findingContextSchema, reviewFindingText, type FindingText } from "@growthmind/core";
import type { ResidualPiiKind } from "@growthmind/shared";

export { findingContextSchema, joinScanned, trimScanned } from "@growthmind/core";
export type { FindingText, ScannedText } from "@growthmind/core";

export type HeldFindingText = Extract<FindingText, { held: true }>;

export interface HoldDescription {
  readonly reason: HeldFindingText["why"];
  readonly kind: ResidualPiiKind | null;
}

export interface FindingTextRow {
  readonly headline: string;
  readonly context: unknown;
}

export function readFindingText(row: FindingTextRow): FindingText {
  try {
    const context = findingContextSchema.safeParse(row.context);
    if (!context.success) {
      return { held: true, why: "unreadable" };
    }

    return reviewFindingText({ headline: row.headline, context: context.data });
  } catch {
    return { held: true, why: "unreadable" };
  }
}

// The two log fields every seam that drops a held row writes, and the only two the verdict
// can carry: `describeDriverError`'s discipline applied to a hold.
export function describeHold(text: HeldFindingText): HoldDescription {
  return { reason: text.why, kind: text.why === "residual_pii" ? text.kind : null };
}
