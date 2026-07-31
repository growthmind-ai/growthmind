// Downgrade provenance — the record of every rung the gate evaluated
// (O-004 FR-14, D-19, ES-15).
//
// "A downgrade that leaves no trace is indistinguishable from a detector that
// never fired." So the trace is appended at EVERY rung, satisfied or not, and a
// PASSING claim carries its satisfied entry too — "we checked and it held" is
// never confusable with "we did not check".
//
// Two channels, deliberately separate. The MACHINE-READABLE identifiers
// (`class`, `predicate`, `predicateVersion`, `satisfied`, `reasonCode`) are
// what O-005 and O-006 read. The `reason` sentence is what a founder reads,
// and it carries no class name, no predicate identifier, and no product
// jargon.
//
// ── WHERE THE SENTENCES LIVE, AND WHY (D-19, resolved) ─────────────────────
// D-19 requires every string in `GATE_REASON_MESSAGES` to be registered in
// `packages/shared`'s `ALL_CUSTOMER_FACING_MESSAGES`, so the already-hostile
// plain-English suite at
// `packages/shared/__tests__/session-source/messages.test.ts` covers them for
// free — the audit is written by someone other than the author of the strings.
// That suite derives its expected set from the exports of `shared`'s own
// module, so the table had to be reachable from there; and the arrow is
// `core -> shared`, never the reverse, so `shared` cannot import this file.
//
// Resolution: the eight sentences are DEFINED in
// `packages/shared/src/gate/messages.ts`, re-exported through
// `shared`'s `session-source/messages.ts` (which is what the export-derived
// scan reads) and spread into `ALL_CUSTOMER_FACING_MESSAGES`. They are imported
// back here, and re-exported from this module so `GATE_REASON_MESSAGES` stays
// where every reader of the trace expects it. No cycle: one import, one way.
import { GATE_REASON_MESSAGES as REGISTERED_GATE_REASON_MESSAGES } from "@growthmind/shared";
import { z } from "zod";

import type { FindingClass } from "../rules/types";

/**
 * One reason per finding class per outcome. Eight codes, and the compile-pin
 * below binds them to `FindingClass`, so adding a fifth class without adding
 * its two sentences is a compile error rather than a missing string at
 * runtime (D9).
 */
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

/**
 * THE COMPILE-PIN. `GATE_REASON_MESSAGES` is typed by this, so the message
 * table's keys are derived from the finding-class union rather than
 * hand-listed beside it.
 */
export type GateReasonTable = Record<
  `${FindingClass}_satisfied` | `${FindingClass}_unsatisfied`,
  string
>;

/**
 * What each rung of the ladder says, in the customer's own terms (FR-14, §10).
 * The sentences themselves live in `@growthmind/shared` (see the header); this
 * is where the gate reads them from.
 *
 * THE ANNOTATION IS THE COMPILE-PIN, and it is load-bearing — do not replace it
 * with a bare re-export. `GateReasonTable`'s keys are derived from the REAL
 * `FindingClass` union, so a fifth finding class added without its two
 * sentences fails THIS assignment at compile time rather than surfacing as a
 * missing string at runtime (D9). The other direction — a ninth key added in
 * `shared` with no class behind it — is caught by the trace suite's
 * `toHaveLength(8)` over this table.
 */
export const GATE_REASON_MESSAGES: GateReasonTable = REGISTERED_GATE_REASON_MESSAGES;

/**
 * One rung of the ladder, evaluated. Appended whether or not the proof held.
 */
export type TraceEntry = {
  /** The class whose proof predicate was evaluated at this rung. */
  readonly class: FindingClass;
  /** The predicate's own name, e.g. `broken_failure_correlated`. */
  readonly predicate: string;
  /** The predicate's own version, so a v2 predicate's verdict is never read as
   * a v1 one (FR-12, FR-19). */
  readonly predicateVersion: number;
  readonly satisfied: boolean;
  /** The machine-readable key into `GATE_REASON_MESSAGES`. */
  readonly reasonCode: GateReasonCode;
  /** The plain-English sentence, from `GATE_REASON_MESSAGES`. */
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

/**
 * The ordered record of the descent. Length >= 2 on any downgrade, length 1 on
 * a claim that passed at its first rung (ES-15).
 */
export type DowngradeTrace = readonly TraceEntry[];

export const downgradeTraceSchema = z.array(traceEntrySchema).min(1);

/**
 * Builds one trace entry, so the reason sentence and its code can never drift
 * apart at a call site (D11 — one home, no wire to sever).
 *
 * BOTH CHANNELS, ON ONE ENTRY, SEPARATELY. The identifiers a machine reads
 * (`class`, `predicate`, `predicateVersion`, `satisfied`, `reasonCode`) are
 * carried verbatim; the sentence a founder reads is LOOKED UP from the
 * registered table rather than composed here, so the gate can never invent a
 * sentence of its own beside it and no call site can pair a code with the wrong
 * words.
 *
 * `predicate` and `predicateVersion` are passed IN rather than re-derived from
 * `PROOF_PREDICATES` here: the caller has already resolved the predicate it
 * evaluated, and re-looking it up would create a second path to the same fact
 * that could disagree with the verdict it is recording.
 */
export function traceEntry(input: {
  readonly class: FindingClass;
  readonly predicate: string;
  readonly predicateVersion: number;
  readonly satisfied: boolean;
}): TraceEntry {
  // Derived from the class and the verdict, never hand-passed — a code that
  // disagrees with `satisfied` is not expressible (D9).
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
