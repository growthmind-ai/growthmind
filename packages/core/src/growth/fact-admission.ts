import { STATEMENT_MAX, capFactsPerKind, type BusinessFact } from "@growthmind/shared";

import { scanResidualPii } from "../delivery/residual-pii";

export const FACT_REFUSALS = [
  "carries_personal_data",
  "names_an_individual",
  "too_long",
  "empty",
] as const;

export type FactRefusal = (typeof FACT_REFUSALS)[number];

export type FactAdmission =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly refusal: FactRefusal };

// §5 binds this table to segments and rules, never to people. A model handed a customer's
// marketing site will find names on it — a founder's, a testimonial's — and the difference
// between "founders of small agencies" and a named person is a segment versus a dossier.
const NAMES_AN_INDIVIDUAL: readonly RegExp[] = [
  // A quoted or attributed person: `— Jane Smith`, `says Jane Smith`, `Jane Smith, CEO`.
  /(?:^|[—–-]\s*|\bsays\s+|\bby\s+)[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s*,\s*(?:CEO|CTO|COO|founder|co-founder|head of|director|VP)\b)?/,
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+\s*,\s*(?:CEO|CTO|COO|founder|co-founder|head of|director|VP)\b/i,
  // No leading `\b`: `@` is not a word character, so a boundary before it can never match
  // after a space — which is exactly where a handle appears.
  /(?:^|\s)@[A-Za-z0-9_]{2,}/,
];

export function admitStatement(statement: string): FactAdmission {
  const trimmed = statement.trim();

  if (trimmed.length === 0) {
    return { admitted: false, refusal: "empty" };
  }

  if (trimmed.length > STATEMENT_MAX) {
    return { admitted: false, refusal: "too_long" };
  }

  // The O-021 seam, not a second scanner: model text reaching a customer passes the same
  // check the Slack lane runs, so there is one place to strengthen when it misses.
  if (!scanResidualPii(trimmed).clean) {
    return { admitted: false, refusal: "carries_personal_data" };
  }

  if (NAMES_AN_INDIVIDUAL.some((pattern) => pattern.test(trimmed))) {
    return { admitted: false, refusal: "names_an_individual" };
  }

  return { admitted: true };
}

// Refused rows are dropped, never repaired: editing a model's sentence to make it pass would
// put words in the table that nothing said and nothing can be held to.
export function admitBusinessFacts(facts: readonly BusinessFact[]): readonly BusinessFact[] {
  return capFactsPerKind(facts.filter((fact) => admitStatement(fact.statement).admitted));
}
