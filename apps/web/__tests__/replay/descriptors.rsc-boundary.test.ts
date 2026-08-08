import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestDb, type TestDb } from "@growthmind/db/testing";

import { replayDescriptors } from "../../components/replay/filters/descriptors";
import { readReplayScreen } from "../../lib/replay/read";
import {
  filtersOf,
  replayDeps,
  screenOf,
  seedReplayWorkspace,
  seedSessions,
} from "./helpers/screen";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = path.join(WEB_ROOT, "app", "(app)", "replays", "page.tsx");
const SCREEN = path.join(WEB_ROOT, "components", "replay", "ReplayScreen.tsx");

// A DOM renderer never serialises anything, so every existing test of this array passes with a
// closure on it while the server throws on the same array. This walk is the only thing that sees
// the boundary React enforces: a prop reaching a client component may hold no function at all.
function functionPathsIn(value: unknown, at: string, found: string[]): void {
  if (typeof value === "function") {
    found.push(at);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      functionPathsIn(item, `${at}[${String(index)}]`, found);
    });
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, member] of Object.entries(value)) {
      functionPathsIn(member, `${at}.${key}`, found);
    }
  }
}

function functionPaths(value: unknown): readonly string[] {
  const found: string[] = [];
  functionPathsIn(value, "descriptors", found);
  return found;
}

describe("the descriptors /replays hands across the server/client boundary", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("the walk it is checked with does find a function, so a pass is not vacuous", () => {
    expect(functionPaths([{ axis: "Company", summarise: (value: string) => value }])).toEqual([
      "descriptors[0].summarise",
    ]);
    expect(functionPaths([{ options: [{ label: "acme.com", format: () => "" }] }])).toEqual([
      "descriptors[0].options[0].format",
    ]);
  });

  test("no descriptor carries a function at any depth, on any filter state", async () => {
    const workspace = await seedReplayWorkspace(db, "rsc-boundary");

    await seedSessions(db, workspace, [
      { key: "ph:rsc-acme-pricing", company: "acme.com", entry: "/pricing" },
      { key: "ph:rsc-orbit-docs", company: "orbitlabs.co.uk", entry: "/docs" },
      {
        key: "ph:rsc-orbit-excluded",
        company: "orbitlabs.co.uk",
        entry: "/docs",
        exclusionReason: "internal_domain",
      },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const states = [
      filtersOf(),
      filtersOf({ company: "acme.com" }),
      filtersOf({ entry: "/pricing" }),
      filtersOf({ lane: "excluded" }),
      filtersOf({ company: "orbitlabs.co.uk", entry: "/docs", lane: "excluded" }),
      filtersOf({ company: "nobody.example", entry: "/nowhere", lane: "simulated" }),
    ];

    const offending: Record<string, readonly string[]> = {};

    for (const filters of states) {
      const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filters));
      const descriptors = replayDescriptors(screen.facets, filters);

      offending[JSON.stringify(filters)] = functionPaths(descriptors);
    }

    expect(offending).toEqual(
      Object.fromEntries(states.map((filters) => [JSON.stringify(filters), []])),
    );
  });

  test("the array walked above is the one the page hands to a client component", () => {
    const page = readFileSync(PAGE, "utf8");

    expect(page).toContain("<ReplayScreen");
    expect(page).toContain("descriptors={replayDescriptors(screen.facets, filters)}");
    expect(readFileSync(SCREEN, "utf8").startsWith('"use client"')).toBe(true);
  });
});
