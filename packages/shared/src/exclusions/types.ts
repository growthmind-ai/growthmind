import { z } from "zod";

import type { IdentityResolution } from "../session-source/types";

/**
 * The exclusion stamp. A Zod enum so a typo is a compile error rather than a runtime
 * one; `packages/db`'s `sessions.exclusion_reason` column is typed from this union via
 * `satisfies`.
 *
 * `"none"` is an explicit member and the DB column is `notNull`, deliberately: a
 * nullable column makes "classified and kept" and "never classified" the same value.
 * Precisely the / failure where absence reads as a result. Classification is total, by
 * type.
 */
export const exclusionReasonSchema = z.enum([
  "none",
  "internal_domain",
  "automation_headless",
  "automation_known_agent",
  "automation_coding_agent",
]);

export type ExclusionReason = z.infer<typeof exclusionReasonSchema>;

/**
 * Everything the classifier consumes, and everything therefore persisted on the session
 * row, so a stored stamp is reproducible with zero PostHog access.
 */
export interface SessionFacts {
  /** Domain only, never the address (product-decisions). */
  readonly identityEmailDomain: string | null;
  readonly identityResolution: IdentityResolution;
  /** What the classifier saw at stamp time. The provenance of the stamp. */
  readonly internalDomain: string | null;
  readonly userAgent: string | null;
}

/**
 * A versioned rule set. The version travels inside the rule set, so when v2
 * lands `EXCLUSION_RULE_SETS.get` still reproduces a v1 stamp exactly and a rule
 * change is a detectable, migratable event rather than a silent fork of every stamp.
 */
export interface ExclusionRuleSet {
  readonly version: number;
  readonly freeMailDomains: ReadonlySet<string>;
  readonly headlessTokens: readonly string[];
  readonly knownAgentTokens: readonly string[];
  readonly codingAgentTokens: readonly string[];
}
