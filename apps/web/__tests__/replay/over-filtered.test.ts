import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { wayOutAction, wayOutBody } from "@growthmind/core";
import type { ReplayListRow } from "@growthmind/core";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import { REPLAY_FILTER_PARAMS, replayFiltersOf } from "@growthmind/shared";
import type { ReplayFilters } from "@growthmind/shared";

import { nextReplayUrl } from "../../components/replay/filters/filter-url";
import { readReplayScreen } from "../../lib/replay/read";
import {
  filtersOf,
  outcomeName,
  replayDeps,
  screenOf,
  seedReplayWorkspace,
  seedSessions,
} from "./helpers/screen";

// The offered action is a URL — T8, the empty-state button drops one param. Taking it means
// walking the same wire the founder's click walks: write the URL, parse it back, read again.
function takeTheAction(url: string): ReplayFilters {
  const parsed = new URL(url, "http://localhost:3000");

  return replayFiltersOf(Object.fromEntries(parsed.searchParams.entries()));
}

describe("the over-filtered state", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // AC-12 / R-4 B1. The assertion is that the button works, not that it exists: an empty state
  // offering an action that restores nothing is the /first-run dead end with a button on it.
  test("the over-filtered state's named button actually restores results", async () => {
    const workspace = await seedReplayWorkspace(db, "b1-one-culprit");

    // /pricing exists in this org — on an excluded session — so the entry value is real data
    // rather than a phantom, and relaxing the company alone still restores nothing.
    await seedSessions(db, workspace, [
      { key: "ph:b1-acme-docs", company: "acme.com", entry: "/docs" },
      { key: "ph:b1-acme-blog", company: "acme.com", entry: "/blog" },
      {
        key: "ph:b1-orbit-pricing",
        company: "orbitlabs.co.uk",
        entry: "/pricing",
        exclusionReason: "internal_domain",
      },
    ]);

    const filters = filtersOf({ company: "acme.com", entry: "/pricing" });
    const { deps } = replayDeps(db, workspace.ctx);

    const before = screenOf(await readReplayScreen(deps, workspace.ctx, filters));

    expect(outcomeName(before.outcome)).toBe("relax:entry");
    expect(before.provenance).toEqual({ replays: 0, sessions: 0 });
    expect(wayOutAction(before.outcome)).toBe("Clear the page filter");

    const url = nextReplayUrl(filters, REPLAY_FILTER_PARAMS.entry, null);
    expect(url).not.toBeNull();

    const after = screenOf(await readReplayScreen(deps, workspace.ctx, takeTheAction(url ?? "")));

    expect(after.provenance.sessions).toBeGreaterThanOrEqual(1);
    expect(outcomeName(after.outcome)).toBe("rows");
    // And it relaxed only the filter it named: the company survives the action.
    expect(after.rows.every((row: ReplayListRow) => row.companyDomain === "acme.com")).toBe(true);
  });

  // R-4 B2. Two filters each restore results alone, so naming one of them would be a guess
  // dressed up as a computation.
  test("the two-dead-filters branch renders clear all filters", async () => {
    const workspace = await seedReplayWorkspace(db, "b2-two-culprits");

    await seedSessions(db, workspace, [
      { key: "ph:b2-acme-docs", company: "acme.com", entry: "/docs" },
      { key: "ph:b2-orbit-pricing", company: "orbitlabs.co.uk", entry: "/pricing" },
    ]);

    const filters = filtersOf({ company: "acme.com", entry: "/pricing" });
    const { deps } = replayDeps(db, workspace.ctx);

    const before = screenOf(await readReplayScreen(deps, workspace.ctx, filters));

    expect(outcomeName(before.outcome)).toBe("clear_all");
    expect(wayOutAction(before.outcome)).toBe("Clear all filters");

    // Clearing all three restores rows — the branch's own claim, taken rather than described.
    const cleared = filtersOf();
    const after = screenOf(await readReplayScreen(deps, workspace.ctx, cleared));

    expect(after.provenance.sessions).toBe(2);
    expect(outcomeName(after.outcome)).toBe("rows");
  });

  // The four bodies of .ai/ux/o-050-replays-filters.md §6.2 E3, verbatim. Computed, never
  // canned: each names the values that are actually on, so the sentence is checkable.
  test("the culprit sentence names the company and the entry when both are active", () => {
    const both = filtersOf({ company: "acme.com", entry: "/pricing" });

    expect(wayOutBody({ relax: "entry" }, both)).toBe("Nobody from acme.com started at /pricing.");

    expect(wayOutBody({ relax: "entry" }, filtersOf({ entry: "/pricing", lane: "excluded" }))).toBe(
      "Nothing that started at /pricing is in this lane.",
    );

    expect(wayOutBody({ relax: "company" }, both)).toBe(
      "acme.com has nothing that started at /pricing.",
    );

    expect(
      wayOutBody(
        { relax: "lane" },
        filtersOf({ company: "acme.com", entry: "/pricing", lane: "excluded" }),
      ),
    ).toBe("Nothing in this lane matches the rest of what you picked.");

    // One button label per culprit, and the lane's is a return to the baseline rather than a
    // clear — the default lane is a stated baseline, never an applied filter (T10).
    expect(wayOutAction({ relax: "company" })).toBe("Clear the company filter");
    expect(wayOutAction({ relax: "entry" })).toBe("Clear the page filter");
    expect(wayOutAction({ relax: "lane" })).toBe("Show real people again");
  });
});
