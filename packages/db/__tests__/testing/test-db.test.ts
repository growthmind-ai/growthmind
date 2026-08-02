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
    expect(await db.select().from(schema.organization)).toEqual([]);
    expect(await db.select().from(schema.member)).toEqual([]);
    expect(await db.select().from(schema.invitation)).toEqual([]);
    expect(await db.select().from(schema.user)).toEqual([]);
    expect(await db.select().from(schema.session)).toEqual([]);
  });
});

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

      expect(await first.db.select().from(schema.organization)).toHaveLength(1);

      expect(await second.db.select().from(schema.organization)).toEqual([]);

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
