import { z } from "zod";

import type { MeasuredCount } from "../counts/measured-count";
import { measuredCountSchema } from "../counts/measured-count";

export const inferredStruggleSubkindSchema = z.enum(["repeated_attempt", "backtrack"]);

export const observedStruggleSubkindSchema = z.enum([
  "rage_click",
  "dead_click",
  "field_abandoned",
  "field_refocus",
  "scroll_back",
]);

export const struggleSubkindSchema = z.enum([
  ...inferredStruggleSubkindSchema.options,
  ...observedStruggleSubkindSchema.options,
]);

export type InferredStruggleSubkind = z.infer<typeof inferredStruggleSubkindSchema>;

export type ObservedStruggleSubkind = z.infer<typeof observedStruggleSubkindSchema>;

export type StruggleSubkind = z.infer<typeof struggleSubkindSchema>;

export type EvidenceSignal =
  | {
      readonly kind: "failure_correlated";
      readonly eventName: string;
      readonly occurredAt: Date;
      readonly precedingActionName: string;
      readonly correlationWindowMs: number;

      readonly correlatedSessions: MeasuredCount;
    }
  | {
      readonly kind: "failure_uncorrelated";
      readonly eventName: string;
      readonly occurredAt: Date;
    }
  | {
      readonly kind: "struggle";
      readonly subkind: StruggleSubkind;
      readonly surface: string;

      readonly attempts: number;

      readonly strugglingSessions: MeasuredCount;
    }
  | {
      readonly kind: "clean_exit";
      readonly surface: string;
    }
  | {
      readonly kind: "instrumentation_rate_drop";
      readonly eventName: string;
      readonly observed: MeasuredCount;
      readonly expected: MeasuredCount;
    };

export type EvidenceSignalKind = EvidenceSignal["kind"];

export const evidenceSignalKindSchema = z.enum([
  "failure_correlated",
  "failure_uncorrelated",
  "struggle",
  "clean_exit",
  "instrumentation_rate_drop",
]);

export const evidenceSignalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("failure_correlated"),
    eventName: z.string().min(1),
    occurredAt: z.date(),
    precedingActionName: z.string().min(1),
    correlationWindowMs: z.number().int().nonnegative(),
    correlatedSessions: measuredCountSchema,
  }),
  z.object({
    kind: z.literal("failure_uncorrelated"),
    eventName: z.string().min(1),
    occurredAt: z.date(),
  }),
  z.object({
    kind: z.literal("struggle"),
    subkind: struggleSubkindSchema,
    surface: z.string().min(1),
    attempts: z.number().int().nonnegative(),
    strugglingSessions: measuredCountSchema,
  }),
  z.object({
    kind: z.literal("clean_exit"),
    surface: z.string().min(1),
  }),
  z.object({
    kind: z.literal("instrumentation_rate_drop"),
    eventName: z.string().min(1),
    observed: measuredCountSchema,
    expected: measuredCountSchema,
  }),
]);

export const BROKEN_PROOF_SIGNALS_V1: readonly EvidenceSignalKind[] = ["failure_correlated"];

export const CONFUSING_PROOF_SIGNALS_V1: readonly EvidenceSignalKind[] = ["struggle"];

export const CHANGED_MIND_PROOF_SIGNALS_V1: readonly EvidenceSignalKind[] = ["clean_exit"];

export const INSTRUMENTATION_PROOF_SIGNALS_V1: readonly EvidenceSignalKind[] = [
  "instrumentation_rate_drop",
];
