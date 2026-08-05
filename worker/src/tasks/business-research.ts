import { admitBusinessFacts } from "@growthmind/core";
import type { BusinessReadResult, FetchedPage, ReadFact, SiteFetchResult } from "@growthmind/adapters";
import type { GrowthContextRepo } from "@growthmind/db";
import { describeDriverError } from "@growthmind/db";
import type { BusinessFact, TenantContext } from "@growthmind/shared";
import { BUSINESS_FACT_LIMIT, describeError } from "@growthmind/shared";

import type { TaskLogger } from "../task-logger";

// Plain English, because a person reads these on the settings page.
export const RESEARCH_FAILURES = {
  no_domain: "No website was named, so there was nothing to read.",
  domain_unreadable: "That does not look like a website address we can open.",
  robots_disallows: "That site asks automated readers to stay out, so we did not read it.",
  nothing_readable: "We could not open any page on that site.",
  call_failed: "We could not read that site just now.",
  no_model: "No model is configured on this installation, so nothing could be read.",
  model_failed: "We read the site but could not make sense of it. Try again.",
} as const;

export type ResearchFailureCode = keyof typeof RESEARCH_FAILURES;

export interface BusinessResearcherPort {
  readBinding(pages: readonly FetchedPage[]): Promise<BusinessReadResult>;
  readShaping(pages: readonly FetchedPage[]): Promise<BusinessReadResult>;
}

export interface BusinessResearchDeps {
  readonly growthFor: (ctx: TenantContext) => GrowthContextRepo;
  readonly fetchSite: (domain: string) => Promise<SiteFetchResult>;

  // Null when no model is configured. Graceful absence: the task says so and stops rather
  // than leaving the screen on "running".
  readonly researcher: BusinessResearcherPort | null;
  readonly now: () => Date;
  readonly logger: TaskLogger;
}

export interface BusinessResearchInput {
  readonly ctx: TenantContext;
  readonly projectId: string;
}

export type BusinessResearchOutcome =
  | { readonly outcome: "researched"; readonly facts: number; readonly partial: boolean }
  | { readonly outcome: "failed"; readonly code: ResearchFailureCode };

function factsFrom(
  read: readonly ReadFact[],
  pages: readonly FetchedPage[],
  at: Date,
): readonly BusinessFact[] {
  // A citation that resolves to no page is dropped, not stored with a null. A null citation
  // renders as "you told us", so keeping one here would show a model's sentence as a
  // person's — the provenance lie this table exists to prevent.
  const rows: BusinessFact[] = read.flatMap((fact) => {
    const page = pages[fact.citationIndex];
    if (page === undefined) return [];

    return [
      {
        kind: fact.kind,
        statement: fact.statement.trim(),
        provenance: { source: "site" as const, at, citation: page.url, seen: null },
        correctedFrom: null,
        audience: null,
      },
    ];
  });

  // §5's segments-not-individuals guard and the O-021 PII seam, applied before anything is
  // persisted — not before it is displayed, which would leave the row in the table.
  return admitBusinessFacts(rows).slice(0, BUSINESS_FACT_LIMIT);
}

export async function runBusinessResearch(
  deps: BusinessResearchDeps,
  input: BusinessResearchInput,
): Promise<BusinessResearchOutcome> {
  const growth = deps.growthFor(input.ctx);

  async function fail(code: ResearchFailureCode): Promise<BusinessResearchOutcome> {
    try {
      await growth.recordResearchFailure({
        projectId: input.projectId,
        failure: RESEARCH_FAILURES[code],
      });
    } catch (error) {
      deps.logger.error(
        `business research: project ${input.projectId} failed and the failure could not be recorded — ${describeDriverError(error)}`,
      );
    }
    return { outcome: "failed", code };
  }

  const existing = await growth.readBusinessResearch(input.projectId);
  const domain = existing?.siteDomain ?? null;

  if (domain === null || domain.trim().length === 0) {
    return fail("no_domain");
  }

  if (deps.researcher === null) {
    return fail("no_model");
  }

  await growth.markResearchRunning(input.projectId);

  let fetched: SiteFetchResult;
  try {
    fetched = await deps.fetchSite(domain);
  } catch (error) {
    deps.logger.error(
      `business research: project ${input.projectId} could not read ${domain} — ${describeError(error)}`,
    );
    return fail("call_failed");
  }

  if (!fetched.ok) {
    return fail(fetched.code);
  }

  // One read failing must not cost the other its answer: the constraints are what a fix
  // spec is gated on, and losing them because the shaping call timed out is the expensive
  // half of a partial failure (D8).
  const [binding, shaping] = await Promise.all([
    deps.researcher.readBinding(fetched.pages),
    deps.researcher.readShaping(fetched.pages),
  ]);

  if (!binding.ok && !shaping.ok) {
    deps.logger.error(
      `business research: project ${input.projectId} read ${domain} but both model calls failed — ${binding.reason}`,
    );
    return fail("model_failed");
  }

  for (const [lane, result] of [
    ["what binds them", binding],
    ["how it is used", shaping],
  ] as const) {
    if (!result.ok) {
      deps.logger.error(
        `business research: project ${input.projectId} read ${domain} but the "${lane}" call failed, so that half is missing — ${result.reason}`,
      );
    }
  }

  const read = [...(binding.ok ? binding.facts : []), ...(shaping.ok ? shaping.facts : [])];
  const facts = factsFrom(read, fetched.pages, deps.now());

  await growth.recordResearch({
    projectId: input.projectId,
    facts,
    researchedAt: deps.now(),
  });

  deps.logger.info(
    `business research: project ${input.projectId} read ${String(fetched.pages.length)} pages of ${domain} ` +
      `and kept ${String(facts.length)} of ${String(read.length)} things it said`,
  );

  return { outcome: "researched", facts: facts.length, partial: !binding.ok || !shaping.ok };
}
