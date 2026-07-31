// The evidence signal union and the versioned proof-signal lists (O-004 D-11,
// FR-12, FR-19).
//
// Evidence is a CLOSED union rather than a bag of booleans, so adding a fifth
// detector adds a variant and a rule-set entry and changes neither the gate,
// nor `MeasuredCount`, nor the output contract. Each proof predicate then
// becomes a set-membership check over a versioned constant, which is what
// makes FR-19's "one-line change when BS-1(b) lands" true rather than claimed.
//
// Implemented in Wave 3/4 against this scaffold's final signatures.
import { z } from "zod";

import type { MeasuredCount } from "../counts/measured-count";
import { measuredCountSchema } from "../counts/measured-count";

/**
 * Every kind of evidence this product can hold.
 *
 * `failure_correlated` vs `failure_uncorrelated` is the load-bearing split
 * (ES-13): an exception that cannot be tied to a preceding action within the
 * window is recorded HONESTLY as uncorrelated rather than dropped or, worse,
 * laundered into a correlated one. It is then deliberately not admissible as
 * proof of `broken` — see `BROKEN_PROOF_SIGNALS_V1`.
 */
export type EvidenceSignal =
  | {
      readonly kind: "failure_correlated";
      readonly eventName: string;
      readonly occurredAt: Date;
      readonly precedingActionName: string;
      readonly correlationWindowMs: number;
      /**
       * The COHORT this proof covers: how many kept sessions had an exception
       * actually CORRELATED to a preceding action, over `basis.kept`.
       *
       * It exists for the same reason `struggle.strugglingSessions` does
       * (ruling 31), on the higher-stakes class. Without it, one correlated
       * session satisfied `broken` while the candidate's count reported the
       * all-exceptions cohort — so the gate said "we could prove the thing
       * they were trying to do failed on them" over a count of three when it
       * was proven for one. The number a founder reads and the number the
       * verdict rests on must describe the SAME population.
       */
      readonly correlatedSessions: MeasuredCount;
    }
  | {
      readonly kind: "failure_uncorrelated";
      readonly eventName: string;
      readonly occurredAt: Date;
    }
  | {
      readonly kind: "struggle";
      readonly subkind: "repeated_attempt" | "backtrack";
      readonly surface: string;
      /**
       * The PER-SESSION magnitude: the greatest number of separate visits to
       * `surface` made by any ONE kept session (PL ruling 31). It is what the
       * rule-set comment "two visits is navigation; three is a pattern" is a
       * statement about, and it is the number a founder reads.
       *
       * On its own it says NOTHING about how many people struggled — a maximum
       * over an unbounded cohort is monotonically increasing in corpus size, so
       * at `DETECTOR_CORPUS_MAX_SESSIONS` one outlier session would carry the
       * whole surface. `strugglingSessions` carries that half, and the proof
       * predicate gates on IT.
       */
      readonly attempts: number;
      /**
       * The COHORT magnitude: how many kept sessions at `surface` individually
       * reached `struggleRepeatedAttemptMin`, over `basis.kept`.
       *
       * A `MeasuredCount` and not a bare number, deliberately (D-7,
       * product-decisions §10): this is the number the gate's only reachable
       * pass this sprint turns on, so it is the LAST number that may travel
       * without its denominator. `attempts` above escapes `MeasuredCount` only
       * because it is not a count of sessions at all — it is one session's
       * visit depth — and it is no longer the thing that decides.
       */
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

/** The discriminant, on its own, for the rule set's proof-signal lists. */
export type EvidenceSignalKind = EvidenceSignal["kind"];

export const evidenceSignalKindSchema = z.enum([
  "failure_correlated",
  "failure_uncorrelated",
  "struggle",
  "clean_exit",
  "instrumentation_rate_drop",
]);

/**
 * The runtime mirror of the union. The gate parses its input with this
 * (ES-12), so a signal shape the gate has no predicate for is REJECTED at the
 * boundary rather than defaulted.
 */
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
    subkind: z.enum(["repeated_attempt", "backtrack"]),
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

// FR-19. Which signal kinds count as proof of `broken`. Versioned, so
// admitting a new one when BS-1(b) lands is a one-line addition plus a version
// bump — never a rewrite of the gate.
//
// KNOWN BLIND SPOT (BS-1a), and it is not an oversight: the ABSENT request —
// the silent no-op save where nothing throws and no event fires — is
// undetectable over the current `events` schema. There is no `properties`
// column, no status code, and no network-request property (A-6). Nothing in
// this schema lifts it; it needs first-party capture (packages/sdk-js, M5) or
// recording network capture (cut by mvp.md §4). Recorded in the ADD's
// Escalations section as ESC-1, not only here.
//
// `failure_uncorrelated` is deliberately NOT a member (ES-13). That is what
// stops an exception unrelated to the user's action laundering into a `broken`
// claim — the over-permissive predicate the PRD names as a High risk.
export const BROKEN_PROOF_SIGNALS_V1: readonly EvidenceSignalKind[] = ["failure_correlated"];

/** FR-12. Which signal kinds count as proof of `confusing`. */
export const CONFUSING_PROOF_SIGNALS_V1: readonly EvidenceSignalKind[] = ["struggle"];

/**
 * FR-12. Which signal kinds count as proof of `changed_mind` — PLUS an
 * ABSENCE requirement (no failure signal, no struggle signal) that is enforced
 * in the predicate, never in this list. A list can only say what must be
 * present; this class's proof is mostly about what must not be.
 */
export const CHANGED_MIND_PROOF_SIGNALS_V1: readonly EvidenceSignalKind[] = ["clean_exit"];

/** FR-15. Which signal kinds count as proof of `instrumentation`. */
export const INSTRUMENTATION_PROOF_SIGNALS_V1: readonly EvidenceSignalKind[] = [
  "instrumentation_rate_drop",
];
