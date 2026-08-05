import type { SiteFetchResult } from "@growthmind/adapters";
import type { BusinessResearchRow, GrowthContextRepo } from "@growthmind/db";
import type { BusinessFact, TenantContext } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import {
  RESEARCH_FAILURES,
  runBusinessResearch,
  type BusinessResearchDeps,
} from "../../src/tasks/business-research";

const NOW = new Date("2026-08-05T21:00:00.000Z");
const PROJECT = "project-1";

const CTX = { organizationId: "org-1" } as unknown as TenantContext;

type Read = { ok: true; facts: readonly unknown[] } | { ok: false; reason: string };

interface Recorded {
  running: number;
  facts: readonly BusinessFact[] | null;
  failure: string | null;
}

const A_REGIME = { kind: "regime", statement: "Licensed by the Gambling Commission.", citationIndex: 0 };
const A_CADENCE = { kind: "decision_cadence", statement: "People decide weekly.", citationIndex: 0 };

function depsFor(input: {
  readonly domain?: string | null;
  readonly fetched?: SiteFetchResult;
  readonly binding?: Read;
  readonly shaping?: Read;
  readonly noResearcher?: boolean;
  readonly fetchThrows?: boolean;
}): { deps: BusinessResearchDeps; recorded: Recorded } {
  const recorded: Recorded = { running: 0, facts: null, failure: null };

  const row: BusinessResearchRow = {
    siteDomain: input.domain === undefined ? "example.com" : input.domain,
    businessContext: { facts: [], removed: [] },
    researchStatus: "never_run",
    researchedAt: null,
    researchFailure: null,
    updatedAt: NOW,
  };

  const repo = {
    readBusinessResearch: () => Promise.resolve(row),
    markResearchRunning: () => {
      recorded.running += 1;
      return Promise.resolve();
    },
    recordResearch: (saved: { facts: readonly BusinessFact[] }) => {
      recorded.facts = saved.facts;
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
                pages: [{ url: "https://example.com/", text: "18+ only. Please gamble responsibly." }],
              },
            ),
      researcher:
        input.noResearcher === true
          ? null
          : {
              readBinding: () =>
                Promise.resolve((input.binding ?? { ok: true, facts: [A_REGIME] }) as never),
              readShaping: () =>
                Promise.resolve((input.shaping ?? { ok: true, facts: [A_CADENCE] }) as never),
            },
      now: () => NOW,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    },
    recorded,
  };
}

describe("business research", () => {
  test("keeps what both reads found, with the page each came from", async () => {
    const { deps, recorded } = depsFor({});

    const outcome = await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT });

    expect(outcome).toEqual({ outcome: "researched", facts: 2, partial: false });
    expect(recorded.facts?.map((fact) => fact.kind)).toEqual(["regime", "decision_cadence"]);
    expect(recorded.facts?.[0]?.provenance).toEqual({
      source: "site",
      at: NOW,
      citation: "https://example.com/",
      // A page can never fill this. Only the sessions lane does.
      seen: null,
    });
  });

  // The constraints are what a fix spec is gated on. Losing them because the other call
  // timed out is the expensive half of a partial failure (D8).
  test("keeps what binds a business when the read of how it is used fails", async () => {
    const { deps, recorded } = depsFor({ shaping: { ok: false, reason: "overloaded" } });

    const outcome = await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT });

    expect(outcome).toEqual({ outcome: "researched", facts: 1, partial: true });
    expect(recorded.facts?.map((fact) => fact.kind)).toEqual(["regime"]);
    expect(recorded.failure).toBeNull();
  });

  test("keeps how a product is used when the read of what binds it fails", async () => {
    const { deps, recorded } = depsFor({ binding: { ok: false, reason: "overloaded" } });

    expect(await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "researched",
      facts: 1,
      partial: true,
    });
    expect(recorded.facts?.map((fact) => fact.kind)).toEqual(["decision_cadence"]);
  });

  test("records a failure only when both reads fail", async () => {
    const { deps, recorded } = depsFor({
      binding: { ok: false, reason: "overloaded" },
      shaping: { ok: false, reason: "overloaded" },
    });

    expect(await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "failed",
      code: "model_failed",
    });
    expect(recorded.failure).toBe(RESEARCH_FAILURES.model_failed);
  });

  test("drops a fact naming an individual before it is ever stored", async () => {
    // §5. The guard runs before the write, not before the render — a refused row must not
    // exist in the table at all.
    const { deps, recorded } = depsFor({
      binding: {
        ok: true,
        facts: [{ kind: "regime", statement: "— Jane Smith, CEO of Acme", citationIndex: 0 }, A_REGIME],
      },
      shaping: { ok: true, facts: [] },
    });

    const outcome = await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT });

    expect(outcome).toEqual({ outcome: "researched", facts: 1, partial: false });
    expect(recorded.facts?.map((fact) => fact.statement)).toEqual([A_REGIME.statement]);
  });

  test("refuses a citation pointing at a page it never read", async () => {
    const { deps, recorded } = depsFor({
      binding: { ok: true, facts: [{ ...A_REGIME, citationIndex: 9 }] },
      shaping: { ok: true, facts: [] },
    });

    await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT });

    // Nothing with an invented source reaches the table.
    expect(recorded.facts).toEqual([]);
  });

  test("says so plainly when no site has been named", async () => {
    const { deps, recorded } = depsFor({ domain: null });

    const outcome = await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT });

    expect(outcome).toEqual({ outcome: "failed", code: "no_domain" });
    expect(recorded.failure).toBe(RESEARCH_FAILURES.no_domain);
    expect(recorded.running).toBe(0);
  });

  test("says so when this installation has no model, rather than spinning", async () => {
    const { deps, recorded } = depsFor({ noResearcher: true });

    expect(await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "failed",
      code: "no_model",
    });
    expect(recorded.failure).toBe(RESEARCH_FAILURES.no_model);
    expect(recorded.running).toBe(0);
  });

  test("records where it got to when the site cannot be read", async () => {
    const { deps, recorded } = depsFor({ fetched: { ok: false, code: "robots_disallows" } });

    expect(await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "failed",
      code: "robots_disallows",
    });
    expect(recorded.failure).toBe(RESEARCH_FAILURES.robots_disallows);
  });

  test("records a failure when the fetch throws, so nothing sits on running", async () => {
    const { deps, recorded } = depsFor({ fetchThrows: true });

    expect(await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "failed",
      code: "call_failed",
    });
    expect(recorded.running).toBe(1);
    expect(recorded.failure).toBe(RESEARCH_FAILURES.call_failed);
  });

  test("an empty read is a finished read, not a failure", async () => {
    const { deps, recorded } = depsFor({
      binding: { ok: true, facts: [] },
      shaping: { ok: true, facts: [] },
    });

    expect(await runBusinessResearch(deps, { ctx: CTX, projectId: PROJECT })).toEqual({
      outcome: "researched",
      facts: 0,
      partial: false,
    });
    expect(recorded.facts).toEqual([]);
    expect(recorded.failure).toBeNull();
  });
});
