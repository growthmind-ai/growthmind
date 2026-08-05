import { describe, expect, it } from "bun:test";

import {
  type AudienceFacts,
  type AudienceRule,
  audienceRuleSchema,
  confirmedAudienceRules,
  evaluateAudience,
  evaluateAudienceRule,
  readBusinessContext,
  renderAudienceRule,
} from "../../src/index";

const ANONYMOUS: AudienceFacts = {
  identityEmailDomain: null,
  identityResolution: "absent",
  entryUrlPath: "/pricing",
};

const AT_WORK: AudienceFacts = {
  identityEmailDomain: "acme.com",
  identityResolution: "resolved",
  entryUrlPath: "/pricing",
};

const AT_GMAIL: AudienceFacts = {
  identityEmailDomain: "gmail.com",
  identityResolution: "resolved",
  entryUrlPath: "/pricing",
};

const WORK_EMAIL: AudienceRule = {
  clauses: [{ attribute: "email_domain", is: "work" }],
};

describe("evaluateAudienceRule", () => {
  it("counts a session that satisfies every clause", () => {
    expect(evaluateAudienceRule(WORK_EMAIL, AT_WORK)).toBe("counts");
  });

  it("puts a session outside when a clause it can check fails", () => {
    expect(evaluateAudienceRule(WORK_EMAIL, AT_GMAIL)).toBe("outside");
  });

  it("answers unknown, never outside, when the session carries nothing to check", () => {
    expect(evaluateAudienceRule(WORK_EMAIL, ANONYMOUS)).toBe("unknown");
  });

  it("fails the whole rule on one failed clause, even beside an uncheckable one", () => {
    const rule: AudienceRule = {
      clauses: [
        { attribute: "email_domain", is: "work" },
        { attribute: "entry_path", operator: "starts_with", value: "/docs" },
      ],
    };

    expect(evaluateAudienceRule(rule, AT_WORK)).toBe("outside");
  });

  it("leaves the rule unknown when a checkable clause passes and another cannot be read", () => {
    const rule: AudienceRule = {
      clauses: [
        { attribute: "email_domain", is: "work" },
        { attribute: "entry_path", operator: "starts_with", value: "/pricing" },
      ],
    };

    expect(evaluateAudienceRule(rule, ANONYMOUS)).toBe("unknown");
  });

  it("reads identity resolution without needing an email domain", () => {
    const rule: AudienceRule = { clauses: [{ attribute: "identity", is: "resolved" }] };

    expect(evaluateAudienceRule(rule, ANONYMOUS)).toBe("outside");
    expect(evaluateAudienceRule(rule, AT_WORK)).toBe("counts");
  });

  it("matches a domain list case- and whitespace-insensitively", () => {
    const rule = audienceRuleSchema.parse({
      clauses: [{ attribute: "email_domain_list", operator: "in", domains: ["  ACME.com "] }],
    });

    expect(evaluateAudienceRule(rule, AT_WORK)).toBe("counts");
    expect(evaluateAudienceRule(rule, AT_GMAIL)).toBe("outside");
  });
});

describe("evaluateAudience", () => {
  it("narrows nothing when no rule is confirmed", () => {
    expect(evaluateAudience([], AT_GMAIL)).toBe("counts");
  });

  it("unions rules — satisfying either one is enough", () => {
    const bySignIn: AudienceRule = { clauses: [{ attribute: "identity", is: "resolved" }] };

    expect(evaluateAudience([WORK_EMAIL, bySignIn], AT_GMAIL)).toBe("counts");
  });

  it("keeps a session no rule can be checked against out of the set-aside pile", () => {
    expect(evaluateAudience([WORK_EMAIL], ANONYMOUS)).toBe("unknown");
  });

  it("sets a session aside only when every rule positively rejects it", () => {
    const onDocs: AudienceRule = {
      clauses: [{ attribute: "entry_path", operator: "starts_with", value: "/docs" }],
    };

    expect(evaluateAudience([WORK_EMAIL, onDocs], AT_GMAIL)).toBe("outside");
  });
});

describe("confirmedAudienceRules", () => {
  const fact = (status: string) => ({
    kind: "who_counts",
    statement: "Teams shipping with coding agents.",
    provenance: { source: "stated_by_customer", at: new Date().toISOString(), citation: null },
    correctedFrom: null,
    audience: { rule: WORK_EMAIL, status, decidedAt: new Date().toISOString() },
  });

  it("returns only the rules a person confirmed", () => {
    const context = readBusinessContext({
      facts: [fact("confirmed"), fact("proposed"), fact("rejected")],
    });

    expect(confirmedAudienceRules(context)).toEqual([WORK_EMAIL]);
  });

  it("is empty for facts written before audience rules existed", () => {
    const context = readBusinessContext({
      facts: [
        {
          kind: "who_counts",
          statement: "Teams shipping with coding agents.",
          provenance: { source: "site", at: new Date().toISOString(), citation: null },
          correctedFrom: null,
          audience: null,
        },
      ],
    });

    expect(context.facts).toHaveLength(1);
    expect(confirmedAudienceRules(context)).toEqual([]);
  });
});

describe("renderAudienceRule", () => {
  it("reads as a sentence a person can check", () => {
    expect(renderAudienceRule(WORK_EMAIL)).toBe(
      "sessions where they signed in with a work email address",
    );
  });

  it("joins several clauses without a trailing comma", () => {
    const rule: AudienceRule = {
      clauses: [
        { attribute: "identity", is: "resolved" },
        { attribute: "email_domain", is: "work" },
      ],
    };

    expect(renderAudienceRule(rule)).toBe(
      "sessions where we worked out who they were and they signed in with a work email address",
    );
  });
});
