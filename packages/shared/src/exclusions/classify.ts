import {
  CODING_AGENT_TOKENS,
  HEADLESS_TOKENS,
  KNOWN_AGENT_TOKENS,
  matchesToken,
} from "./automation";
import { FREE_MAIL_DOMAINS } from "./free-mail";
import type { ExclusionReason, ExclusionRuleSet, SessionFacts } from "./types";

export const EXCLUSION_RULE_SET_VERSION = 1;

const RULE_SET_V1: ExclusionRuleSet = {
  version: 1,
  freeMailDomains: FREE_MAIL_DOMAINS,
  headlessTokens: HEADLESS_TOKENS,
  knownAgentTokens: KNOWN_AGENT_TOKENS,
  codingAgentTokens: CODING_AGENT_TOKENS,
};

export const EXCLUSION_RULE_SETS: ReadonlyMap<number, ExclusionRuleSet> = new Map([
  [1, RULE_SET_V1],
]);

export const CURRENT_EXCLUSION_RULE_SET: ExclusionRuleSet = RULE_SET_V1;

export function classifyExclusion(facts: SessionFacts, rules: ExclusionRuleSet): ExclusionReason {
  const userAgent = facts.userAgent?.trim() ?? "";

  if (userAgent.length > 0) {
    if (firesAny(userAgent, rules.headlessTokens)) return "automation_headless";

    if (firesAny(userAgent, rules.knownAgentTokens)) return "automation_known_agent";

    if (firesAny(userAgent, rules.codingAgentTokens)) return "automation_coding_agent";
  }

  const internalDomain = facts.internalDomain?.trim().toLowerCase() ?? "";
  const identityEmailDomain = facts.identityEmailDomain?.trim().toLowerCase() ?? "";
  if (
    internalDomain.length > 0 &&
    identityEmailDomain.length > 0 &&
    identityEmailDomain === internalDomain
  ) {
    return "internal_domain";
  }

  return "none";
}

function firesAny(userAgent: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => matchesToken(userAgent, token));
}
