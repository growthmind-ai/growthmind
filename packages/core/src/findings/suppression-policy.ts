// The pure, versioned suppression policy. The ledger's judgement of whether a candidate
// delivers or is withheld, and why.
//
// Fail direction: Suppress on doubt. This inverts `architecture.md:118-121`'s T1/T2
// fail-toward-including convention. The two doubt states this policy can be handed,
// `unresolvable_ancestry` (the ancestry forward-walk hit a cycle or its hop cap) and
// `unknown_shape_version` (the candidate's evidence-shape version has no registered
// serialiser in this build). Both resolve to `{ decision: "suppress" }` rather than `{
// decision: "deliver" }`. The justification, stated here because a future reader must
// see a decision, not an inconsistency, and must not "fix" it back toward
// include-on-doubt: a suppressed real finding surfaces again on the next distinct
// occurrence, or on a human's next look. Silence is recoverable. A duplicate finding
// delivered to a founder cannot be un-sent. A duplicate is not recoverable. The T1/T2
// convention exists to protect against under-reporting a real problem; this policy
// exists to protect against over-reporting the same one, which is the opposite failure
// shape and correctly gets the opposite fail direction.
//
// A second, distinct fail direction governs the *policy version* itself: an unknown
// `version` passed to `suppressionDecision` throws rather than suppressing. A policy
// version is chosen by our own code, never read from external data,
// `SUPPRESSION_POLICIES.get` throwing cannot deliver a duplicate, because it
// delivers nothing at all. A silent fallback to "current" would rewrite a v1 decision
// under v2 rules, which is exactly the `evidence-shape.ts:164-176` failure this policy
// must not repeat. Do not read the throw here as a violation of the suppress-on-doubt
// rule above. They answer two different questions ("what do we know about this
// candidate?" vs. "which rules should judge it?").
//
// Pure: no clock, no I/O, no randomness. `ResolvedLedgerState` is declared here, in
// `packages/core`, as primitives and `Date | null` only (never a drizzle row
// (`$inferSelect`)) so the policy is testable with a literal and `core -> db` stays
// forbidden.
import type { SuppressionReasonCode } from "@growthmind/shared";

/**
 * The two fields of a ledger row this policy needs to decide anything. Primitives and
 * `Date | null` only, never a `$inferSelect` row.
 */
export type LedgerRowState = {
  readonly deliveredAt: Date | null;
  readonly dismissedAt: Date | null;
};

/**
 * What the caller was able to resolve before asking the policy to decide. The two doubt
 * branches (`unresolvable_ancestry`, `unknown_shape_version`) are states derived from
 * persisted rows or from a version this build does not recognise. They are handed to
 * the policy as their own resolution variants precisely so the policy never has to
 * reach behind them to find out why there is no `row` to consult.
 */
export type ResolvedLedgerState =
  | { readonly resolution: "resolved"; readonly row: LedgerRowState | null }
  | { readonly resolution: "unresolvable_ancestry" }
  | { readonly resolution: "unknown_shape_version" };

/**
 * Never a bare boolean. A decision without a reason is not inspectable, and an
 * inspectable doubt path is what keeps this policy's suppress-on-doubt inversion from
 * becoming `event-transparency.md`'s stuck, unexplained state. The reason-code enum is
 * `packages/shared`'s (created in the previous wave,
 * `packages/shared/src/signatures/types.ts`). Imported, not redefined, so the wire
 * shape has exactly one source of truth.
 */
export type SuppressionDecision =
  | { readonly decision: "suppress"; readonly reason: SuppressionReasonCode }
  | { readonly decision: "deliver"; readonly reason: SuppressionReasonCode };

/** The version new policies are evaluated under. */
export const SUPPRESSION_POLICY_VERSION = 1;

/** One version's policy function. */
export type SuppressionPolicy = (state: ResolvedLedgerState) => SuppressionDecision;

/**
 * Every policy ever shipped, keyed by version, the same versioned-map pattern as
 * `SIGNATURE_TUPLE_SERIALISERS`, `EVIDENCE_SHAPE_SERIALISERS`, `THRESHOLD_RULE_SETS`,
 * and `PROOF_PREDICATES`.
 */
export const SUPPRESSION_POLICIES: ReadonlyMap<number, SuppressionPolicy> = new Map([
  [1, policyV1],
]);

/**
 * v1. Branch order is fixed and tested. A later reordering is a behaviour change, not a
 * refactor:
 *
 * 1. `resolution === "unresolvable_ancestry"` → suppress / unresolvable_ancestry
 * 2. `resolution === "unknown_shape_version"` → suppress / unknown_shape_version
 * 3. `row !== null && row.dismissedAt !== null` → suppress / dismissed
 * 4. `row !== null && row.deliveredAt !== null` → suppress / already_delivered
 * 5. `row !== null` → deliver / seen_not_delivered
 * 6. `row === null` → deliver / not_seen_before
 *
 * `dismissed` is checked before `already_delivered` because a row that was delivered
 * and then dismissed must report the permanent reason. That is the reason the
 * customer-facing string keys on, and reporting `already_delivered` for a dismissed
 * signature would let a future "resurface after N days" policy un-suppress a
 * dismissal it must never touch.
 */
function policyV1(state: ResolvedLedgerState): SuppressionDecision {
  if (state.resolution === "unresolvable_ancestry") {
    return { decision: "suppress", reason: "unresolvable_ancestry" };
  }
  if (state.resolution === "unknown_shape_version") {
    return { decision: "suppress", reason: "unknown_shape_version" };
  }

  const { row } = state;

  if (row !== null) {
    if (row.dismissedAt !== null) {
      return { decision: "suppress", reason: "dismissed" };
    }
    if (row.deliveredAt !== null) {
      return { decision: "suppress", reason: "already_delivered" };
    }
    return { decision: "deliver", reason: "seen_not_delivered" };
  }

  return { decision: "deliver", reason: "not_seen_before" };
}

/**
 * Decides whether a candidate at `state` delivers or is suppressed, under
 * suppression-policy `version`.
 *
 * Dispatch is by version, through the map, rather than by "whatever is current". See
 * the header for why an unknown version throws rather than falling back.
 */
export function suppressionDecision(
  state: ResolvedLedgerState,
  version: number,
): SuppressionDecision {
  const policy = SUPPRESSION_POLICIES.get(version);
  if (policy === undefined) {
    throw new Error(
      `suppressionDecision has no policy registered for version ${String(version)}: a decision ` +
        `can only be produced by the exact policy version chosen for this build. Falling back to ` +
        `the current version would judge a v${String(version)} candidate under different rules ` +
        `than the ones in force when it was recorded, silently rewriting its history.`,
    );
  }

  return policy(state);
}
