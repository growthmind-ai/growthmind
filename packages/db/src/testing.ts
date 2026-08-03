import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "./schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDbHandle {
  db: TestDb;

  close: () => Promise<void>;
}

const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

const drizzleFor = (client: PGlite): TestDb => drizzle(client, { schema, casing: "snake_case" });

let migratedTemplate: Promise<Blob | File> | null = null;

async function buildMigratedTemplate(): Promise<Blob | File> {
  const client = new PGlite({ extensions: { vector } });

  await migrate(drizzleFor(client), { migrationsFolder: MIGRATIONS_FOLDER });

  const dump = await client.dumpDataDir("none");
  await client.close();

  return dump;
}

export async function createTestDb(): Promise<TestDbHandle> {
  migratedTemplate ??= buildMigratedTemplate();

  const client = new PGlite({ extensions: { vector }, loadDataDir: await migratedTemplate });

  return {
    db: drizzleFor(client),
    close: () => client.close(),
  };
}

// No migrations applied: for tests exercising the never-migrated / schema-behind paths.
export async function createBareTestDb(): Promise<TestDbHandle> {
  const client = new PGlite({ extensions: { vector } });

  return {
    db: drizzleFor(client),
    close: () => client.close(),
  };
}
