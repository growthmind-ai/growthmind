import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import { createTestDb, type TestDb } from "@growthmind/db/testing";
import type { ReplayFilters } from "@growthmind/shared";

import { FilterBar } from "../../components/replay/filters/FilterBar";
import { replayDescriptors } from "../../components/replay/filters/descriptors";
import { readReplayScreen } from "../../lib/replay/read";
import {
  filtersOf,
  replayDeps,
  screenOf,
  seedReplayWorkspace,
  seedSessions,
  type Workspace,
} from "./helpers/screen";

describe("the primary journey", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let workspace: Workspace;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    workspace = await seedReplayWorkspace(db, "click-path");

    await seedSessions(db, workspace, [
      { key: "ph:click-acme-pricing", company: "acme.com", entry: "/pricing" },
      { key: "ph:click-acme-docs", company: "acme.com", entry: "/docs" },
      { key: "ph:click-orbit-pricing", company: "orbitlabs.co.uk", entry: "/pricing" },
    ]);
  });

  afterAll(async () => {
    await close();
  });

  afterEach(cleanup);

  // UX §2 / V-5. A pill-open is a click, and the PRD's "2 clicks" counts it as free — grading
  // against that number would fail a sprint that met the bar. The real number is 4.
  test("a founder reaches one company at one entry page in four clicks", async () => {
    const applied: Array<readonly [string, string]> = [];
    let clicks = 0;

    async function press(element: Element): Promise<void> {
      clicks += 1;
      await userEvent.click(element);
    }

    // Each apply is a navigation, so the bar is re-rendered from the filters the URL now
    // carries — the same repaint the server performs, driven by the same descriptors.
    async function paint(filters: ReplayFilters): Promise<void> {
      cleanup();

      const { deps } = replayDeps(db, workspace.ctx);
      const view = screenOf(await readReplayScreen(deps, workspace.ctx, filters));

      render(
        createElement(
          MantineProvider,
          null,
          createElement(FilterBar, {
            descriptors: replayDescriptors(view.facets, filters),
            onApply: (param: string, value: string) => applied.push([param, value]),
          }),
        ),
      );
    }

    await paint(filtersOf());

    await press(screen.getByRole("button", { name: /all companies/i }));
    await press(screen.getByRole("option", { name: /acme\.com/ }));

    await paint(filtersOf({ company: "acme.com" }));

    await press(screen.getByRole("button", { name: /all pages/i }));
    await press(screen.getByRole("option", { name: /\/pricing/ }));

    expect(clicks).toBe(4);
    expect(applied).toEqual([
      ["company", "acme.com"],
      ["entry", "/pricing"],
    ]);

    // And the composed state is the one the fourth click bought: both pills accented, each
    // independently clearable, with nothing else applied.
    await paint(filtersOf({ company: "acme.com", entry: "/pricing" }));

    const accented = screen
      .getAllByRole("button")
      .filter((element) => element.getAttribute("data-variant") === "filled");

    expect(accented).toHaveLength(2);
    expect(screen.getByRole("button", { name: /clear the company filter/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /clear the page filter/i })).toBeDefined();
  });
});
