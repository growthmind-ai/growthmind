import { summarySourceSchema } from "@growthmind/shared";
import type { z } from "zod";

export const floorSummarySourceSchema = summarySourceSchema.exclude(["model_rendered"]);
export type FloorSummarySource = z.infer<typeof floorSummarySourceSchema>;

export type FloorSummary = {
  readonly source: FloorSummarySource;

  readonly headline: string;

  readonly context: readonly string[];
};
