import type { ShippedCorpusKind } from "@growthmind/shared";

import type { AtPageCorpus } from "./corpus";

// Chosen by Tom: see .ai/decisions/0027-o-053-report-shipped-human-calls.md
export const SHIPPED_SPINE_ELIGIBILITY_FLOOR = 30;

// Chosen by Tom: see .ai/decisions/0027-o-053-report-shipped-human-calls.md
export const SHIPPED_RECORDED_ELIGIBILITY_FLOOR = 10;

export type ShippedClaimGate =
  { readonly kind: "claim" } | { readonly kind: "too_few"; readonly denominator: number };

export function eligibilityFloorFor(kind: ShippedCorpusKind): number {
  return kind === "page" ? SHIPPED_SPINE_ELIGIBILITY_FLOOR : SHIPPED_RECORDED_ELIGIBILITY_FLOOR;
}

// Read off the denominator: it decides whether a claim is made, never whether the number is good.
export function shippedClaimGate(corpus: AtPageCorpus): ShippedClaimGate {
  const denominator = corpus.basis.kept;

  if (denominator < eligibilityFloorFor(corpus.kind)) return { kind: "too_few", denominator };

  return { kind: "claim" };
}
