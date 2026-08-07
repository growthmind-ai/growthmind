import type { BusinessFact, BusinessFactKind, FactConfirmation } from "@growthmind/shared";

export type ConfirmOutcome = "confirmed" | "already_confirmed" | "not_found";

export interface ConfirmResult {
  readonly outcome: ConfirmOutcome;
  readonly facts: readonly BusinessFact[];
}

// The mutation `confirmFact` persists, pure so idempotency is testable without a database.
// Matched by (kind, statement): the same sentence under another kind is a different belief
// and stays untouched. A second confirm changes nothing — one click, one confirmation (D3).
export function confirmInFacts(
  facts: readonly BusinessFact[],
  kind: BusinessFactKind,
  statement: string,
  confirmation: FactConfirmation,
): ConfirmResult {
  const target = facts.find((fact) => fact.kind === kind && fact.statement === statement);

  if (target === undefined) {
    return { outcome: "not_found", facts };
  }

  if (target.confirmation !== null) {
    return { outcome: "already_confirmed", facts };
  }

  return {
    outcome: "confirmed",
    facts: facts.map((fact) => (fact === target ? { ...fact, confirmation } : fact)),
  };
}
