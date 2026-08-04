import type { SiteFetchResult } from "@growthmind/adapters";
import type { GrowthContextRepo, SiteResearchRow } from "@growthmind/db";
import type { IcpModel, TenantContext } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import {
  RESEARCH_FAILURES,
  runIcpResearch,
  type IcpResearchDeps,
} from "../../src/tasks/icp-research";

const NOW = new Date("2026-08-04T21:00:00.000Z");
const PROJECT = "project-1";

const CTX = { organizationId: "org-1" } as unknown as TenantContext;

interface Recorded {
  running: number;
  icp: IcpModel | null;
  failure: string | null;
}

function depsFor(input: {
  readonly domain?: string | null;
  readonly fetched?: SiteFetchResult;
  readonly read?: { ok: true; beliefs: readonly unknown[] } | { ok: false; reason: string };
  readonly noResearcher?: boolean;
  readonly fetchThrows?: boolean;
}): { deps: IcpResearchDeps; recorded: Recorded } {
  const recorded: Recorded = { running: 0, icp: null, failure: null };

  const row: SiteResearchRow = {
    siteDomain: input.domain === undefined ? "example.com" : input.domain,
    icp: { beliefs: [] },
    researchStatus: "never_run",
    researchedAt: null,
    researchFailure: null,
  };

  const repo = {
    readSiteResearch: () => Promise.resolve(row),
    markResearchRunning: () => {
      recorded.running += 1;
      return Promise.resolve();
    },
    recordResearch: (saved: { icp: IcpModel }) => {
      recorded.icp = saved.icp;
      return Promise.resolve();
    },
    recordResearchFailure: (saved: { failure: string }) => {
      recorded.failure = saved.failure;
      return Promise.resolve();
    },
  } as unknown as GrowthContextRepo;

  return {
    deps: {
      growthFor: () => repo,
      fetchSite: () =>
        input.fetchThrows === true
          ? Promise.reject(new Error("network"))
          : Promise.resolve(
              input.fetched ?? {
                ok: true,
                pages: [{ url: "https://example.com/", text: "For small agencies" }],
              },
            ),
      researcher:
        input.noResearcher === true
          ? null
          : {
              read: () =>
                Promise.resolve(
                  (input.read ?? {
                    ok: true,
                    beliefs: [
                      { kind: "who_it_is_for", statement: "Founders of small agencies", citationIndex: 0 },
                    ],
                  }) as never,
                ),
            },
      now: () => NOW,
      logger: { info: () => undefined, error: () => undefined },
    },
    recorded,
  };
}

describe("icp research", () => {
  test("keeps what it read, with the page it read it from", async () => {
    const { deps, recorded } = depsFor({});

    const outcome = await runIcpResearch(deps, { ctx: CTX, projectId: PROJECT });

    expect(outcome).toEqual({ outcome: "researched", beliefs: 1 });
    expect(recorded.icp?.beliefs[0]?.statement).toBe("Founders of small agencies");
    expect(recorded.icp?.beliefs[0]?.provenance).toEqual({
      source: "site",
      at: NOW,
      citation: "https://example.com/",
    });
  });

  test("drops a belief naming an individual before it is ever stored", async () => {
    // §5. The guard runs before the write, not before the render — a refused row must not
    // exist in the table at all.
    const { deps, recorded } = depsFor({
      read: {
        ok: true,
        beliefs: [
          { kind: "who_it_is_for", statement: "— Jane Smith, CEO of Acme", citationIndex: 0 },
          { kind: "who_it_is_for", statement: "Founders of small agencies", citationIndex: 0 },
        ],
      },
    });

    const outcome = await runIcpResearch(deps, { ctx: CTX, projectId: PROJECT });

    expect(outcome).toEqual({ outcome: "researched", beliefs: 1 });
    expect(recorded.icp?.beliefs.map((row) => row.statement)).toEqual([
      "Founders of small agencies",
    ]);
  });

  test("refuses a citation pointing at a page it never read", async () => {
    const { deps, recorded } = depsFor({
      read: {
        ok: true,
        beliefs: [{ kind: "who_it_is_for", statement: "Agencies", citationIndex: 9 }],
      },
    });

    await runIcpResearch(deps, { ctx: CTX, projectId: PROJECT });

    // The researcher drops it; nothing with an invented source reaches the table.
    expect(recorded.icp?.beliefs).toEqual([]);
  });

  test("says so plainly when no site has been named", async () => {
    const { deps, recorded } = depsFor({ domain: null });

    const outcome = await runIcpResearch(deps, { ctx: CTX, projectId: PROJECT });

    expect(outcome).toEqual({ outcome: "failed", code: "no_domain" });
    expect(recorded.failure).toBe(RESEARCH_FAILURES.no_domain);
    expect(recorded.running).toBe(0);
  });

  test("says so when this installation has no model, rather than spinning", async () => {
    const { deps, recorded } = depsFor({ noResearcher: true });

    expect(await runIcpResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "failed",
      code: "no_model",
    });
    expect(recorded.failure).toBe(RESEARCH_FAILURES.no_model);
    expect(recorded.running).toBe(0);
  });

  test("records where it got to when the site cannot be read", async () => {
    const { deps, recorded } = depsFor({ fetched: { ok: false, code: "robots_disallows" } });

    expect(await runIcpResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "failed",
      code: "robots_disallows",
    });
    expect(recorded.failure).toBe(RESEARCH_FAILURES.robots_disallows);
  });

  test("records a failure when the fetch throws, so nothing sits on running", async () => {
    const { deps, recorded } = depsFor({ fetchThrows: true });

    expect(await runIcpResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "failed",
      code: "call_failed",
    });
    expect(recorded.running).toBe(1);
    expect(recorded.failure).toBe(RESEARCH_FAILURES.call_failed);
  });

  test("records a failure when the model call fails", async () => {
    const { deps, recorded } = depsFor({ read: { ok: false, reason: "overloaded" } });

    expect(await runIcpResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "failed",
      code: "model_failed",
    });
    expect(recorded.failure).toBe(RESEARCH_FAILURES.model_failed);
  });

  test("an empty read is a finished read, not a failure", async () => {
    const { deps, recorded } = depsFor({ read: { ok: true, beliefs: [] } });

    expect(await runIcpResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "researched",
      beliefs: 0,
    });
    expect(recorded.icp).toEqual({ beliefs: [] });
    expect(recorded.failure).toBeNull();
  });
});
