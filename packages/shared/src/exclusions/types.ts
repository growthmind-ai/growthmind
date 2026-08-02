import { z } from "zod";

import type { IdentityResolution } from "../session-source/types";

export const exclusionReasonSchema = z.enum([
  "none",
  "internal_domain",
  "automation_headless",
  "automation_known_agent",
  "automation_coding_agent",
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
