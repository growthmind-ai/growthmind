import { GATE_REASON_MESSAGES as REGISTERED_GATE_REASON_MESSAGES } from "@growthmind/shared";
import { z } from "zod";

import type { FindingClass } from "../rules/types";

export const gateReasonCodeSchema = z.enum([
  "broken_satisfied",
  "broken_unsatisfied",
  "confusing_satisfied",
  "confusing_unsatisfied",
  "changed_mind_satisfied",
  "changed_mind_unsatisfied",
  "instrumentation_satisfied",
  "instrumentation_unsatisfied",
]);
export type GateReasonCode = z.infer<typeof gateReasonCodeSchema>;

export type GateReasonTable = Record<
  `${FindingClass}_satisfied` | `${FindingClass}_unsatisfied`,
  string
>;

export const GATE_REASON_MESSAGES: GateReasonTable = REGISTERED_GATE_REASON_MESSAGES;

export type TraceEntry = {
  readonly class: FindingClass;

  readonly predicate: string;

  readonly predicateVersion: number;
  readonly satisfied: boolean;

  readonly reasonCode: GateReasonCode;

  readonly reason: string;
};

export const traceEntrySchema = z.object({
  class: z.enum(["broken", "confusing", "changed_mind", "instrumentation"]),
  predicate: z.string().min(1),
  predicateVersion: z.number().int().positive(),
  satisfied: z.boolean(),
  reasonCode: gateReasonCodeSchema,
  reason: z.string().min(1),
});

export type DowngradeTrace = readonly TraceEntry[];

export const downgradeTraceSchema = z.array(traceEntrySchema).min(1);

export function traceEntry(input: {
  readonly class: FindingClass;
  readonly predicate: string;
  readonly predicateVersion: number;
  readonly satisfied: boolean;
}): TraceEntry {
  const reasonCode: GateReasonCode = input.satisfied
    ? `${input.class}_satisfied`
    : `${input.class}_unsatisfied`;

  return {
    class: input.class,
    predicate: input.predicate,
    predicateVersion: input.predicateVersion,
    satisfied: input.satisfied,
    reasonCode,
    reason: GATE_REASON_MESSAGES[reasonCode],
  };
}
