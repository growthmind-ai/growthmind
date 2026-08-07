import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestDb, type TestDb } from "@growthmind/db/testing";

import { readReplayScreen } from "../../lib/replay/read";
import {
  filtersOf,
  replayDeps,
  screenOf,
  seedReplayWorkspace,
  seedSessions,
} from "./helpers/screen";

describe("readReplayScreen — composition", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // AC-4 / G4: the intersection is asserted through the reader, because a producer test plus
  // a consumer test never proves the wire between them (D11).
  test("should return the intersection when company and entry are both applied", async () => {
    const workspace = await seedReplayWorkspace(db, "intersection");

    await seedSessions(db, workspace, [
      { key: "ph:acme-pricing", company: "acme.com", entry: "/pricing" },
      { key: "ph:acme-docs", company: "acme.com", entry: "/docs" },
      { key: "ph:orbit-pricing", company: "orbitlabs.co.uk", entry: "/pricing" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(
        deps,
        workspace.ctx,
        filtersOf({ company: "acme.com", entry: "/pricing" }),
      ),
    );

    expect(screen.rows.map((row) => row.sessionKey)).toEqual(["ph:acme-pricing"]);
  });

  test("should derive the rows and the provenance sentence from one read", async () => {
    const workspace = await seedReplayWorkspace(db, "one-read");

    await seedSessions(db, workspace, [
      { key: "ph:acme-pricing-1", company: "acme.com", entry: "/pricing" },
      { key: "ph:acme-pricing-2", company: "acme.com", entry: "/pricing" },
      // Counted in the denominator, absent from the rows: no recording id comes off this key.
      { key: "gm:acme-pricing-3", company: "acme.com", entry: "/pricing" },
      { key: "ph:acme-docs", company: "acme.com", entry: "/docs" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(
        deps,
        workspace.ctx,
        filtersOf({ company: "acme.com", entry: "/pricing" }),
      ),
    );

    expect(screen.provenance).toEqual({ replays: 2, sessions: 3 });
    expect(screen.rows).toHaveLength(screen.provenance.replays);
  });

  // AC-14 behavioural: free-mail skipping is a property of groupSessionsByDomain, so a
  // gmail.com fixture producing no option proves the helper is the production caller
  // without grepping for its name.
  test("should call groupSessionsByDomain for the company facet", async () => {
    const workspace = await seedReplayWorkspace(db, "free-mail");

    await seedSessions(db, workspace, [
      { key: "ph:work-1", company: "acme.com", entry: "/pricing" },
      { key: "ph:free-1", company: "gmail.com", entry: "/pricing" },
      { key: "ph:free-2", company: "gmail.com", entry: "/pricing" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(screen.facets.company.filter((option) => option.value === "gmail.com")).toHaveLength(0);
    expect(screen.facets.company).toHaveLength(1);
    // The free-mail sessions are still listed — skipped as a company, never dropped from the list.
    expect(screen.rows).toHaveLength(3);
  });
});
