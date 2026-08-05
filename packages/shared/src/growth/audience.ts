import { z } from "zod";

import { FREE_MAIL_DOMAINS } from "../exclusions/free-mail";
import type { IdentityResolution } from "../session-source/types";

export const AUDIENCE_CLAUSE_MAX = 4;

export const AUDIENCE_DOMAIN_MAX = 20;

const domainSchema = z
  .string()
  .min(1)
  .max(253)
  .transform((value) => value.trim().toLowerCase());

export const audienceClauseSchema = z.discriminatedUnion("attribute", [
  z.object({
    attribute: z.literal("identity"),
    is: z.enum(["resolved", "not_resolved"]),
  }),
  z.object({
    attribute: z.literal("email_domain"),
    is: z.enum(["work", "free_mail"]),
  }),
  z.object({
    attribute: z.literal("email_domain_list"),
    operator: z.enum(["in", "not_in"]),
    domains: z.array(domainSchema).min(1).max(AUDIENCE_DOMAIN_MAX),
  }),
  z.object({
    attribute: z.literal("entry_path"),
    operator: z.literal("starts_with"),
    value: z.string().min(1).max(512),
  }),
]);

export type AudienceClause = z.infer<typeof audienceClauseSchema>;

export const audienceRuleSchema = z.object({
  clauses: z.array(audienceClauseSchema).min(1).max(AUDIENCE_CLAUSE_MAX),
});

export type AudienceRule = z.infer<typeof audienceRuleSchema>;

// No clauses means the sentence named nothing a session carries. That is the common answer
// and it is a correct one — it leaves the denominator alone rather than guessing at it.
export const audienceReductionOutputSchema = z.object({
  clauses: z.array(audienceClauseSchema).max(AUDIENCE_CLAUSE_MAX),
});

export type AudienceReductionOutput = z.infer<typeof audienceReductionOutputSchema>;

export const AUDIENCE_RULE_STATUSES = ["proposed", "confirmed", "rejected"] as const;

export type AudienceRuleStatus = (typeof AUDIENCE_RULE_STATUSES)[number];

export const audienceProposalSchema = z.object({
  rule: audienceRuleSchema,
  status: z.enum(AUDIENCE_RULE_STATUSES),
  decidedAt: z.coerce.date().nullable(),
});

export type AudienceProposal = z.infer<typeof audienceProposalSchema>;

export interface AudienceFacts {
  readonly identityEmailDomain: string | null;
  readonly identityResolution: IdentityResolution;
  readonly entryUrlPath: string | null;
}

// Three-valued on purpose. A session we cannot check is not a session that failed the
// check: most sessions carry no identity at all, so a two-valued clause would set aside
// the whole anonymous majority the moment anyone states who counts (D10).
export type AudienceVerdict = "counts" | "outside" | "unknown";

export function evaluateAudienceClause(
  clause: AudienceClause,
  facts: AudienceFacts,
): AudienceVerdict {
  switch (clause.attribute) {
    case "identity": {
      if (facts.identityResolution === "resolved") {
        return clause.is === "resolved" ? "counts" : "outside";
      }
      return clause.is === "resolved" ? "outside" : "counts";
    }

    case "email_domain": {
      const domain = normaliseDomain(facts.identityEmailDomain);
      if (domain === null) return "unknown";

      const free = FREE_MAIL_DOMAINS.has(domain);
      const wanted = clause.is === "free_mail";
      return free === wanted ? "counts" : "outside";
    }

    case "email_domain_list": {
      const domain = normaliseDomain(facts.identityEmailDomain);
      if (domain === null) return "unknown";

      const listed = clause.domains.includes(domain);
      const wanted = clause.operator === "in";
      return listed === wanted ? "counts" : "outside";
    }

    case "entry_path": {
      if (facts.entryUrlPath === null || facts.entryUrlPath.length === 0) return "unknown";

      return facts.entryUrlPath.startsWith(clause.value) ? "counts" : "outside";
    }
  }
}

// Clauses within a rule are ANDed: the rule describes one group, and every clause narrows
// it. A clause we cannot check leaves the whole rule unknown rather than failing it.
export function evaluateAudienceRule(rule: AudienceRule, facts: AudienceFacts): AudienceVerdict {
  let unknown = false;

  for (const clause of rule.clauses) {
    const verdict = evaluateAudienceClause(clause, facts);
    if (verdict === "outside") return "outside";
    if (verdict === "unknown") unknown = true;
  }

  return unknown ? "unknown" : "counts";
}

// Rules are ORed: two `who_counts` sentences name two groups that both count, not one
// group that must satisfy both. With no rules at all nothing narrows.
export function evaluateAudience(
  rules: readonly AudienceRule[],
  facts: AudienceFacts,
): AudienceVerdict {
  if (rules.length === 0) return "counts";

  let unknown = false;

  for (const rule of rules) {
    const verdict = evaluateAudienceRule(rule, facts);
    if (verdict === "counts") return "counts";
    if (verdict === "unknown") unknown = true;
  }

  return unknown ? "unknown" : "outside";
}

function normaliseDomain(value: string | null): string | null {
  const domain = value?.trim().toLowerCase() ?? "";
  return domain.length > 0 ? domain : null;
}

export function renderAudienceClause(clause: AudienceClause): string {
  switch (clause.attribute) {
    case "identity":
      return clause.is === "resolved"
        ? "we worked out who they were"
        : "we never worked out who they were";

    case "email_domain":
      return clause.is === "work"
        ? "they signed in with a work email address"
        : "they signed in with a personal email address";

    case "email_domain_list": {
      const domains = clause.domains.join(", ");
      return clause.operator === "in"
        ? `their email address is at ${domains}`
        : `their email address is not at ${domains}`;
    }

    case "entry_path":
      return `they arrived on ${clause.value}`;
  }
}

export function renderAudienceRule(rule: AudienceRule): string {
  const clauses = rule.clauses.map(renderAudienceClause);
  const joined =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;

  return `sessions where ${joined}`;
}
