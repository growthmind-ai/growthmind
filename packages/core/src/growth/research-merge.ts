import {
  BUSINESS_FACT_LIMIT,
  capFactsPerKind,
  type BusinessContext,
  type BusinessFact,
} from "@growthmind/shared";

// The merge a re-read of the site goes through, pure so the survival rules are testable
// without a database. `recordResearch` owns the contention loop and status settling; this
// owns what survives.
export function mergeResearch(
  current: BusinessContext,
  incoming: readonly BusinessFact[],
): BusinessContext {
  // What a person stated survives, and so does what a person confirmed: a confirmed
  // site-sourced sentence outranks the next crawl of the page it came from (AD-2).
  const kept = current.facts.filter(
    (fact) => fact.provenance.source !== "site" || fact.confirmation !== null,
  );

  // A person who corrected, deleted or confirmed a sentence should not be handed it back
  // by the next read of the page it came from.
  const removed = current.removed;
  const alreadyAnswered = new Set([
    ...removed,
    ...kept.flatMap((fact) =>
      fact.correctedFrom === null ? [fact.statement] : [fact.statement, fact.correctedFrom],
    ),
  ]);

  // Kept facts lead, so person-signal survives the per-kind cap.
  const facts = capFactsPerKind([
    ...kept,
    ...incoming.filter((fact) => !alreadyAnswered.has(fact.statement)),
  ]).slice(0, BUSINESS_FACT_LIMIT);

  return { facts, removed };
}
