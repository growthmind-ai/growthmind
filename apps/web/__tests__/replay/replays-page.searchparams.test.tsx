import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";

import type { ReplayListRow } from "@growthmind/core";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import { replayFiltersOf } from "@growthmind/shared";
import type { ReplayFilters } from "@growthmind/shared";

import { FilterBar } from "../../components/replay/filters/FilterBar";
import { replayDescriptors } from "../../components/replay/filters/descriptors";
import { ReplayListBody } from "../../components/replay/ReplayListBody";
import { readReplayScreen } from "../../lib/replay/read";
import { readMarkup } from "../first-run/helpers/rendered-markup";
import {
  replayDeps,
  screenOf,
  seedReplayWorkspace,
  seedSessions,
  type ReplayScreenView,
  type Workspace,
} from "./helpers/screen";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = path.join(WEB_ROOT, "app", "(app)", "replays", "page.tsx");
const READER = path.join(WEB_ROOT, "lib", "replay", "read.ts");

const BASE = "http://localhost:3000";

// The four ways a cold load acquires a loading frame. A1 is not a timing to tune — it is the
// absence of a client render pass, so it is asserted as an absence in the page's own source.
const CLIENT_DATA_PATH = ['"use client"', "useEffect", "useState", "useSearchParams", "fetch("];

function pageSource(): string {
  return readFileSync(PAGE, "utf8");
}

function paramsOf(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, BASE).searchParams.entries());
}

// One parse, server-side, typed — D-6. Every test below starts here so the filters the bar
// paints and the filters the reader ran are the same object, not two readings of one URL.
function filtersFromUrl(url: string): ReplayFilters {
  return replayFiltersOf(paramsOf(url));
}

function pillTags(markup: string): readonly string[] {
  return [...markup.matchAll(/<button[^>]*>/g)]
    .map((match) => match[0] ?? "")
    .filter((tag) => tag.includes('aria-haspopup="dialog"'));
}

function barMarkup(screen: ReplayScreenView, filters: ReplayFilters): string {
  const { container } = render(
    createElement(
      MantineProvider,
      null,
      createElement(FilterBar, {
        descriptors: replayDescriptors(screen.facets, filters),
        onApply: () => undefined,
      }),
    ),
  );

  return container.innerHTML;
}

function bodyMarkup(screen: ReplayScreenView, filters: ReplayFilters): string {
  const { container } = render(
    createElement(MantineProvider, null, createElement(ReplayListBody, { screen, filters })),
  );

  return container.innerHTML;
}

describe("a filtered /replays URL, loaded cold", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let workspace: Workspace;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    workspace = await seedReplayWorkspace(db, "page-searchparams");

    await seedSessions(db, workspace, [
      { key: "ph:page-acme-pricing", company: "acme.com", entry: "/pricing" },
      // Counted in the denominator, absent from the rows: the provenance sentence is the only
      // place this session is visible, which is why the sentence has to be right.
      { key: "gm:page-acme-pricing-2", company: "acme.com", entry: "/pricing" },
      { key: "ph:page-orbit-docs", company: "orbitlabs.co.uk", entry: "/docs" },
      {
        key: "ph:page-orbit-excluded",
        company: "orbitlabs.co.uk",
        entry: "/docs",
        exclusionReason: "internal_domain",
      },
    ]);
  });

  afterAll(async () => {
    await close();
  });

  afterEach(cleanup);

  async function screenFor(filters: ReplayFilters): Promise<ReplayScreenView> {
    const { deps } = replayDeps(db, workspace.ctx);
    return screenOf(await readReplayScreen(deps, workspace.ctx, filters));
  }

  // AC-6 / G6 / A1 / S12 — UX First-Run row 4. The recipient of a pasted link sees what the
  // sender saw, immediately: a skeleton frame or an unfiltered flash both say the opposite.
  test("a founder can load a filtered URL cold and see the filtered rows as the first paint", async () => {
    const filters = filtersFromUrl("/replays?company=acme.com&entry=/pricing");
    const screen = await screenFor(filters);

    const markup = bodyMarkup(screen, filters);
    const text = readMarkup(markup).text;

    expect(screen.rows.map((row: ReplayListRow) => row.sessionKey)).toEqual([
      "ph:page-acme-pricing",
    ]);
    expect(text).toContain("/pricing");
    expect(text).not.toContain("/docs");
    expect([...markup.matchAll(/mantine-Skeleton-root/g)]).toHaveLength(0);

    // The page reads its own data. Nothing here can fetch on mount, so there is no frame in
    // which an unfiltered or empty list could paint.
    const source = pageSource();
    for (const marker of CLIENT_DATA_PATH) expect(source).not.toContain(marker);
    expect(source).toContain("readReplayScreen");
    expect(source).toContain("searchParams");
  });

  // T13: the pills paint already accented, because the params were present at render. The
  // baseline lane is not an applied filter, so a bare /replays accents nothing (T10).
  test("a founder sees the pills already accented for the params in the URL", async () => {
    const cases = [
      { url: "/replays", accented: 0, values: [] as readonly string[] },
      { url: "/replays?company=acme.com", accented: 1, values: ["acme.com"] },
      {
        url: "/replays?company=acme.com&entry=/pricing",
        accented: 2,
        values: ["acme.com", "/pricing"],
      },
      {
        url: "/replays?company=acme.com&entry=/pricing&who=excluded",
        accented: 3,
        values: ["acme.com", "/pricing"],
      },
    ];

    const rendered: unknown[] = [];

    for (const one of cases) {
      cleanup();
      const filters = filtersFromUrl(one.url);
      const markup = barMarkup(await screenFor(filters), filters);
      const accented = pillTags(markup).filter((tag) => tag.includes('data-variant="filled"'));

      rendered.push({
        url: one.url,
        accented: accented.length,
        named: one.values.every((value) => accented.some((tag) => tag.includes(value))),
      });
    }

    expect(rendered).toEqual(
      cases.map((one) => ({ url: one.url, accented: one.accented, named: true })),
    );
  });

  // UX First-Run row 7 / A8. The sentence and the pills are two readings of one parse; a page
  // that parsed twice could paint a pill for a filter the numbers were never computed under.
  test("a founder sees a page whose sentence and pills agree with the reader's filters", async () => {
    const filters = filtersFromUrl("/replays?company=acme.com&entry=/pricing");
    const screen = await screenFor(filters);

    const body = readMarkup(bodyMarkup(screen, filters)).text;
    expect(body).toContain("1 replay from 2 acme.com sessions that started at /pricing.");

    cleanup();

    const accented = pillTags(barMarkup(screen, filters)).filter((tag) =>
      tag.includes('data-variant="filled"'),
    );

    expect(accented.some((tag) => tag.includes("acme.com"))).toBe(true);
    expect(accented.some((tag) => tag.includes("/pricing"))).toBe(true);

    // One parse: the page reads the URL exactly once and hands the result to both halves.
    expect(pageSource().match(/replayFiltersOf\(/g) ?? []).toHaveLength(1);
  });

  // D-11. "Reading must not provision" is stated identically in two places in this tree, and
  // findings/page.tsx is the precedent that gets it wrong — copying it would create an org's
  // first project on a GET.
  test("a founder's page resolves its project without provisioning one", () => {
    const sources = [pageSource(), readFileSync(READER, "utf8")].join("\n");

    expect(sources).toContain("findFirstProjectForOrg");
    expect(sources).not.toContain("ensureProject");
  });
});
