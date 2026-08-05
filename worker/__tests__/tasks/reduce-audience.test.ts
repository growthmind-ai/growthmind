import { describe, expect, it } from "bun:test";

import type { AudienceRule } from "@growthmind/shared";

import type { BusinessResearcherPort } from "../../src/tasks/business-research";
import { runReduceAudience, type ReduceAudienceDeps } from "../../src/tasks/reduce-audience";

const WORK_EMAIL: AudienceRule = { clauses: [{ attribute: "email_domain", is: "work" }] };

const CTX = {
  userId: "system:reduce-audience",
  organizationId: "org-1",
  organizationName: "Acme",
  role: "system",
} as never;

const INPUT = {
  ctx: CTX,
  projectId: "project-1",
  statement: "Real businesses, not people on personal email.",
};

function harness(input: {
  readonly researcher: BusinessResearcherPort | null;
}): { deps: ReduceAudienceDeps; proposals: unknown[]; warnings: string[] } {
  const proposals: unknown[] = [];
  const warnings: string[] = [];

  return {
    proposals,
    warnings,
    deps: {
      researcher: input.researcher,
      growthFor: () =>
        ({
          proposeAudience: (proposal: unknown) => {
            proposals.push(proposal);
            return Promise.resolve();
          },
        }) as never,
      logger: {
        info: () => undefined,
        warn: (message: string) => warnings.push(message),
        error: () => undefined,
      } as never,
    },
  };
}

function researcherReturning(answer: unknown): BusinessResearcherPort {
  return {
    readBinding: () => Promise.resolve({ ok: true, facts: [] }),
    readShaping: () => Promise.resolve({ ok: true, facts: [] }),
    reduceAudience: () => Promise.resolve(answer as never),
  };
}

describe("runReduceAudience", () => {
  it("writes the rule the model returned", async () => {
    const { deps, proposals } = harness({
      researcher: researcherReturning({ ok: true, rule: WORK_EMAIL }),
    });

    expect(await runReduceAudience(deps, INPUT)).toBe("proposed");
    expect(proposals).toEqual([
      { projectId: "project-1", statement: INPUT.statement, rule: WORK_EMAIL },
    ]);
  });

  // Without writing the null, every re-read asks the model the same question about the same
  // sentence and gets the same nothing.
  it("records a null answer rather than dropping it", async () => {
    const { deps, proposals } = harness({
      researcher: researcherReturning({ ok: true, rule: null }),
    });

    expect(await runReduceAudience(deps, INPUT)).toBe("nothing_to_propose");
    expect(proposals).toEqual([
      { projectId: "project-1", statement: INPUT.statement, rule: null },
    ]);
  });

  it("writes nothing and says so when the model call fails", async () => {
    const { deps, proposals, warnings } = harness({
      researcher: researcherReturning({ ok: false, reason: "timeout" }),
    });

    expect(await runReduceAudience(deps, INPUT)).toBe("failed");
    expect(proposals).toEqual([]);
    expect(warnings[0]).toContain("timeout");
  });

  it("stops cleanly on an installation with no model configured", async () => {
    const { deps, proposals } = harness({ researcher: null });

    expect(await runReduceAudience(deps, INPUT)).toBe("no_model");
    expect(proposals).toEqual([]);
  });
});
