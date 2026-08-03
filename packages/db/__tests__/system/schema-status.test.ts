import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";

import journal from "../../drizzle/meta/_journal.json";
import {
  compareMigrationCounts,
  describeSchemaStatus,
  getSchemaStatus,
} from "../../src/schema-status";
import * as schema from "../../src/schema";
import { createTestDb, type TestDb } from "../../src/testing";

describe("compareMigrationCounts", () => {
  test("no pending when applied equals expected", () => {
    expect(compareMigrationCounts(11, 11)).toEqual({ expected: 11, applied: 11, pending: 0 });
  });

  test("counts pending when the database is behind", () => {
    expect(compareMigrationCounts(11, 10).pending).toBe(1);
  });

  test("a database ahead of the checked-out code reports zero pending, not negative", () => {
    expect(compareMigrationCounts(10, 11).pending).toBe(0);
  });

  test("a never-migrated database has everything pending", () => {
    expect(compareMigrationCounts(11, 0).pending).toBe(11);
  });
});

describe("describeSchemaStatus", () => {
  test("silent when current", () => {
    expect(describeSchemaStatus({ expected: 11, applied: 11, pending: 0 })).toBeNull();
  });

  test("names the count and the command when behind", () => {
    const detail = describeSchemaStatus({ expected: 11, applied: 10, pending: 1 });
    expect(detail).toContain("1 migration behind");
    expect(detail).toContain("bun run db:migrate");
  });
});

describe("getSchemaStatus", () => {
  let migrated: TestDb;
  let closeMigrated: () => Promise<void>;

  beforeAll(async () => {
    ({ db: migrated, close: closeMigrated } = await createTestDb());
  });

  afterAll(async () => {
    await closeMigrated();
  });

  test("a fully migrated database reports current", async () => {
    const status = await getSchemaStatus(migrated);
    expect(status.expected).toBe(journal.entries.length);
    expect(status.applied).toBe(journal.entries.length);
    expect(status.pending).toBe(0);
  });

  test("a database drizzle-kit has never touched reports everything pending", async () => {
    const client = new PGlite({ extensions: { vector } });
    const bare = drizzle(client, { schema, casing: "snake_case" });
    try {
      const status = await getSchemaStatus(bare);
      expect(status.applied).toBe(0);
      expect(status.pending).toBe(journal.entries.length);
    } finally {
      await client.close();
    }
  });
});
