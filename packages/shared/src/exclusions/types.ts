import { z } from "zod";

import type { IdentityResolution } from "../session-source/types";

/**
 * The exclusion stamp (O-003 D-9). A Zod enum so a typo is a compile error
 * rather than a runtime one (D9); `packages/db`'s `sessions.exclusion_reason`
 * column is typed from this union via `satisfies`.
 *
 * `"none"` is an explicit member and the DB column is `notNull`, deliberately:
 * a nullable column makes "classified and kept" and "never classified" the
 * same value — precisely the D5/D8 failure where absence reads as a result.
 * Classification is total, by type.
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
 * Everything the classifier consumes — and everything therefore persisted on
 * the session row, so a stored stamp is reproducible with zero PostHog access
 * (FR-14 ii).
 */
export interface SessionFacts {
  /** DOMAIN ONLY, never the address (product-decisions §5). */
  readonly identityEmailDomain: string | null;
  readonly identityResolution: IdentityResolution;
  /** What the classifier saw at stamp time — the provenance of the stamp. */
  readonly internalDomain: string | null;
  readonly userAgent: string | null;
}

/**
 * A versioned rule set (FR-14 iv, D12). The version travels INSIDE the rule
 * set, so when v2 lands `EXCLUSION_RULE_SETS.get(1)` still reproduces a v1
 * stamp exactly and a rule change is a detectable, migratable event rather
 * than a silent fork of every stamp.
 */
export interface ExclusionRuleSet {
  readonly version: number;
  readonly freeMailDomains: ReadonlySet<string>;
  readonly headlessTokens: readonly string[];
  readonly knownAgentTokens: readonly string[];
  readonly codingAgentTokens: readonly string[];
}
