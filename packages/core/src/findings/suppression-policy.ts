import type { SuppressionReasonCode } from "@growthmind/shared";

export type LedgerRowState = {
  readonly deliveredAt: Date | null;
  readonly dismissedAt: Date | null;
};

export type ResolvedLedgerState =
  | { readonly resolution: "resolved"; readonly row: LedgerRowState | null }
  | { readonly resolution: "unresolvable_ancestry" }
  | { readonly resolution: "unknown_shape_version" };

export type SuppressionDecision =
  | { readonly decision: "suppress"; readonly reason: SuppressionReasonCode }
  | { readonly decision: "deliver"; readonly reason: SuppressionReasonCode };

export const SUPPRESSION_POLICY_VERSION = 1;

export type SuppressionPolicy = (state: ResolvedLedgerState) => SuppressionDecision;

export const SUPPRESSION_POLICIES: ReadonlyMap<number, SuppressionPolicy> = new Map([
  [1, policyV1],
]);

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
