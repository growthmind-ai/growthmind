import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "../schema";

export interface DriverQueryFailure {
  readonly sql: string;
  readonly params: readonly unknown[];

  readonly driverMessage: string;
}

// What a query failure really looks like: the statement and its bound parameters are in
// `message`, and the driver's own message is only reachable through `cause`. A fixture
// hand-built from `Object.assign(new Error(safe), { query })` asserts against a shape the
// runtime never produces, and passes while the real error leaks.
export function driverQueryError(failure: DriverQueryFailure): DrizzleQueryError {
  return new DrizzleQueryError(failure.sql, [...failure.params], new Error(failure.driverMessage));
}

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDbHandle {
  db: TestDb;

  close: () => Promise<void>;
}

const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "drizzle",
);

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
