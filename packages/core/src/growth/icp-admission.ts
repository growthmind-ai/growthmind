import { ICP_STATEMENT_MAX, type IcpBelief } from "@growthmind/shared";

import { scanResidualPii } from "../delivery/residual-pii";

export const ICP_REFUSALS = [
  "carries_personal_data",
  "names_an_individual",
  "too_long",
  "empty",
] as const;

export type IcpRefusal = (typeof ICP_REFUSALS)[number];

export type IcpAdmission =
  { readonly admitted: true } | { readonly admitted: false; readonly refusal: IcpRefusal };

// §5 binds this table to segments. A model handed a customer's marketing site will find
// names on it — a founder's, a testimonial's — and the difference between "founders of
// small agencies" and a named person is the difference between a segment and a dossier.
const NAMES_AN_INDIVIDUAL: readonly RegExp[] = [
  // A quoted or attributed person: `— Jane Smith`, `says Jane Smith`, `Jane Smith, CEO`.
  /(?:^|[—–-]\s*|\bsays\s+|\bby\s+)[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s*,\s*(?:CEO|CTO|COO|founder|co-founder|head of|director|VP)\b)?/,
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+\s*,\s*(?:CEO|CTO|COO|founder|co-founder|head of|director|VP)\b/i,
  // No leading `\b`: `@` is not a word character, so a boundary before it can never match
  // after a space — which is exactly where a handle appears.
  /(?:^|\s)@[A-Za-z0-9_]{2,}/,
];

export function admitIcpStatement(statement: string): IcpAdmission {
  const trimmed = statement.trim();

  if (trimmed.length === 0) {
    return { admitted: false, refusal: "empty" };
  }

  if (trimmed.length > ICP_STATEMENT_MAX) {
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

// Refused rows are dropped, never repaired: editing a model's sentence to make it pass
// would put words in the table that nothing said and nothing can be held to.
export function admitIcpBeliefs(beliefs: readonly IcpBelief[]): readonly IcpBelief[] {
  return beliefs.filter((belief) => admitIcpStatement(belief.statement).admitted);
}
