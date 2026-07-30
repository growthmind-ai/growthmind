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
    // Every table the generated auth schema defines must be queryable —
    // proof the real migrations (0000_enable-pgvector, 0001_auth-tables)
    // applied cleanly against PGlite, not a mock.
    expect(await db.select().from(schema.organization)).toEqual([]);
    expect(await db.select().from(schema.member)).toEqual([]);
    expect(await db.select().from(schema.invitation)).toEqual([]);
    expect(await db.select().from(schema.user)).toEqual([]);
    expect(await db.select().from(schema.session)).toEqual([]);
  });
});
