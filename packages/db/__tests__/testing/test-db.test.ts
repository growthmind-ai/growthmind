import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestDb, type TestDb } from "../../src/testing";
import * as schema from "../../src/schema";

describe("createTestDb", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("createTestDb boots pglite and applies every migration in packages/db/drizzle", async () => {
    // Every table the generated auth schema defines must be queryable. Proof the real
    // migrations (0000_enable-pgvector, 0001_auth-tables) applied cleanly against
    // PGlite, not a mock.
    expect(await db.select().from(schema.organization)).toEqual([]);
    expect(await db.select().from(schema.member)).toEqual([]);
    expect(await db.select().from(schema.invitation)).toEqual([]);
    expect(await db.select().from(schema.user)).toEqual([]);
    expect(await db.select().from(schema.session)).toEqual([]);
  });
});

// ===========================================================================
// The isolation guarantee — what the shared migration template may NOT share
// ===========================================================================

/**
 * `createTestDb` replays the migrations once per process and clones the result
 * (see the header on `src/testing.ts`). That makes ONE thing shared between every
 * database this repo's tests use, and this suite exists to hold the line on which
 * one: the schema, never a row.
 *
 * The failure it guards against is silent and catastrophic — a shared client, or
 * a template that accumulated writes, would leave suites seeing each other's
 * fixtures. Tests would pass locally in the order the author ran them and fail in
 * CI, or worse, pass everywhere while asserting against a neighbour's data.
 */
describe("createTestDb isolation", () => {
  test("a row written to one database is invisible to every database made after it", async () => {
    const first = await createTestDb();
    const second = await createTestDb();

    try {
      await first.db.insert(schema.organization).values({
        id: "org-isolation-probe",
        name: "Isolation Probe",
        slug: "isolation-probe",
        createdAt: new Date(),
      });

      // The writer sees its own row...
      expect(await first.db.select().from(schema.organization)).toHaveLength(1);

      // ...a sibling created BEFORE the write does not (no shared connection)...
      expect(await second.db.select().from(schema.organization)).toEqual([]);

      // ...and one created AFTER it does not either, which is the stronger claim:
      // the write never reached the template, so the template cannot drift into a
      // dirty baseline as a run proceeds.
      const third = await createTestDb();
      try {
        expect(await third.db.select().from(schema.organization)).toEqual([]);
      } finally {
        await third.close();
      }
    } finally {
      await first.close();
      await second.close();
    }
  });

  test("closing one database leaves the others usable", async () => {
    // `PGlite is closed` was one of the errors the old slow fixture produced when a
    // hook timed out mid-boot. Independent instances mean one close cannot reach
    // another — if this ever fails, something has been made shared.
    const first = await createTestDb();
    const second = await createTestDb();

    await first.close();

    try {
      expect(await second.db.select().from(schema.user)).toEqual([]);
    } finally {
      await second.close();
    }
  });
});
