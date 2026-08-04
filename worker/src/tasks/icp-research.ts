import { admitIcpBeliefs } from "@growthmind/core";
import type { FetchedPage, IcpReadResult, SiteFetchResult } from "@growthmind/adapters";
import type { GrowthContextRepo } from "@growthmind/db";
import { describeDriverError } from "@growthmind/db";
import type { IcpBelief, TenantContext } from "@growthmind/shared";
import { ICP_BELIEF_LIMIT, describeError } from "@growthmind/shared";

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

export interface IcpResearcherPort {
  read(pages: readonly FetchedPage[]): Promise<IcpReadResult>;
}

export interface IcpResearchDeps {
  readonly growthFor: (ctx: TenantContext) => GrowthContextRepo;
  readonly fetchSite: (domain: string) => Promise<SiteFetchResult>;

  // Null when no model is configured. Graceful absence: the task says so and stops rather
  // than leaving the screen on "running".
  readonly researcher: IcpResearcherPort | null;
  readonly now: () => Date;
  readonly logger: TaskLogger;
}

export interface IcpResearchInput {
  readonly ctx: TenantContext;
  readonly projectId: string;
}

export type IcpResearchOutcome =
  | { readonly outcome: "researched"; readonly beliefs: number }
  | { readonly outcome: "failed"; readonly code: ResearchFailureCode };

function beliefsFrom(
  read: readonly { kind: IcpBelief["kind"]; statement: string; citationIndex: number }[],
  pages: readonly FetchedPage[],
  at: Date,
): readonly IcpBelief[] {
  // A citation that resolves to no page is dropped, not stored with a null. A null citation
  // renders as "you told us", so keeping one here would show a model's sentence as a
  // person's — the provenance lie this table exists to prevent.
  const rows: IcpBelief[] = read.flatMap((belief) => {
    const page = pages[belief.citationIndex];
    if (page === undefined) return [];

    return [
      {
        kind: belief.kind,
        statement: belief.statement.trim(),
        provenance: { source: "site" as const, at, citation: page.url },
        correctedFrom: null,
      },
    ];
  });

  // §5's segments-not-individuals guard and the O-021 PII seam, applied before anything is
  // persisted — not before it is displayed, which would leave the row in the table.
  return admitIcpBeliefs(rows).slice(0, ICP_BELIEF_LIMIT);
}

export async function runIcpResearch(
  deps: IcpResearchDeps,
  input: IcpResearchInput,
): Promise<IcpResearchOutcome> {
  const growth = deps.growthFor(input.ctx);

  async function fail(code: ResearchFailureCode): Promise<IcpResearchOutcome> {
    try {
      await growth.recordResearchFailure({
        projectId: input.projectId,
        failure: RESEARCH_FAILURES[code],
      });
    } catch (error) {
      deps.logger.error(
        `icp research: project ${input.projectId} failed and the failure could not be recorded — ${describeDriverError(error)}`,
      );
    }
    return { outcome: "failed", code };
  }

  const existing = await growth.readSiteResearch(input.projectId);
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
      `icp research: project ${input.projectId} could not read ${domain} — ${describeError(error)}`,
    );
    return fail("call_failed");
  }

  if (!fetched.ok) {
    return fail(fetched.code);
  }

  const read = await deps.researcher.read(fetched.pages);
  if (!read.ok) {
    deps.logger.error(
      `icp research: project ${input.projectId} read ${domain} but the model call failed — ${read.reason}`,
    );
    return fail("model_failed");
  }

  const beliefs = beliefsFrom(read.beliefs, fetched.pages, deps.now());

  await growth.recordResearch({
    projectId: input.projectId,
    icp: { beliefs: [...beliefs] },
    researchedAt: deps.now(),
  });

  deps.logger.info(
    `icp research: project ${input.projectId} read ${String(fetched.pages.length)} pages of ${domain} ` +
      `and kept ${String(beliefs.length)} of ${String(read.beliefs.length)} things it said`,
  );

  return { outcome: "researched", beliefs: beliefs.length };
}
