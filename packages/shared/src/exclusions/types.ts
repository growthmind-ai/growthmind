import { z } from "zod";

import type { IdentityResolution } from "../session-source/types";

// What ingest can decide from the session alone, and the only values a session row ever
// carries.
export const stampedExclusionReasonSchema = z.enum([
  "none",
  "internal_domain",
  "automation_headless",
  "automation_known_agent",
  "automation_coding_agent",
]);

export type StampedExclusionReason = z.infer<typeof stampedExclusionReasonSchema>;

// What a count can say, which is more. A `who_counts` rule can be confirmed long after a
// session was ingested, so it is applied at count time against the rule in force then —
// stamping it would freeze every old session against an older answer (D2).
export const exclusionReasonSchema = z.enum([
  ...stampedExclusionReasonSchema.options,
  "outside_who_counts",
]);

export type ExclusionReason = z.infer<typeof exclusionReasonSchema>;

export interface SessionFacts {
  readonly identityEmailDomain: string | null;
  readonly identityResolution: IdentityResolution;

  readonly internalDomain: string | null;
  readonly userAgent: string | null;
}

export interface ExclusionRuleSet {
  readonly version: number;
  readonly freeMailDomains: ReadonlySet<string>;
  readonly headlessTokens: readonly string[];
  readonly knownAgentTokens: readonly string[];
  readonly codingAgentTokens: readonly string[];
}
