// The list read was covered only on its two empty arms, where a tenant boundary cannot be
// crossed because there is nothing to cross with. These are the populated ones, plus the
// distinction the page's three empties exist for: a counter we could not read is not an
// answer about the workspace.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestDb, seedConnection, type TestDb } from "@growthmind/db/testing";

import { readOpenFixes } from "../../lib/fixes/read";
import { parkTable } from "../helpers/parked-table";
import { openFixIn, seedFixOrg, seedOpenFix } from "./helpers/open-fix";

const NOW = new Date("2026-08-05T00:00:00.000Z");

describe("the open-fixes list, read as one organization", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("a populated list carries this organization's fixes and none of the other's", async () => {
    const mine = await seedOpenFix(db, "list-mine");
    const second = await openFixIn(db, mine, "list-mine-two");
    const theirs = await seedOpenFix(db, "list-theirs");

    const view = await readOpenFixes(db, mine.org.ctx, mine.projectId, NOW);
    if (view.kind !== "rows") throw new Error(`expected rows, got ${view.kind}`);

    const ids = view.rows.map((row) => row.fixId);

    expect(ids).toContain(mine.fixId);
    expect(ids).toContain(second.fixId);
    expect(ids).not.toContain(theirs.fixId);
    expect(view.totalOpen).toBe(2);
  });

  test("naming another organization's project does not reach its fixes", async () => {
    const mine = await seedOpenFix(db, "borrow-mine");
    const theirs = await seedOpenFix(db, "borrow-theirs");

    const borrowed = await readOpenFixes(db, mine.org.ctx, theirs.projectId, NOW);

    expect(borrowed.kind).not.toBe("rows");
  });

  test("a list we could not read is not an empty list, and offers nothing to press", async () => {
    const mine = await seedOpenFix(db, "list-unread");

    const unread = await parkTable(db, "fixes", () =>
      readOpenFixes(db, mine.org.ctx, mine.projectId, NOW),
    );
    const populated = await readOpenFixes(db, mine.org.ctx, mine.projectId, NOW);

    expect(unread).toEqual({ kind: "unavailable" });
    expect(populated.kind).toBe("rows");
  });

  test("a counter we could not read says so, rather than picking one of the two empties", async () => {
    const measuring = await seedFixOrg(db, "counter-attached");
    await seedConnection(db, {
      organizationId: measuring.org.organizationId,
      projectId: measuring.projectId,
    });

    const attached = await readOpenFixes(db, measuring.org.ctx, measuring.projectId, NOW);
    const unchecked = await parkTable(db, "project_connections", () =>
      readOpenFixes(db, measuring.org.ctx, measuring.projectId, NOW),
    );

    expect(attached).toEqual({ kind: "nothing_opened" });
    expect(unchecked).toEqual({ kind: "nothing_opened_unchecked" });
    expect(unchecked).not.toEqual(attached);
  });
});
