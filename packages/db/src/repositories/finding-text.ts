import { reviewFindingText, type FindingText } from "@growthmind/core";
import { z } from "zod";

export type { FindingText, ScannedText } from "@growthmind/core";

export const findingContextSchema = z.array(z.string());

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
