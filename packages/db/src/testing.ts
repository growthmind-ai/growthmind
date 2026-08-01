// Test-only database harness. Not exported from src/index.ts. Reachable only via the
// "./testing" subpath (see package.json `exports`), so it can never end up in a
// production bundle.
//
// Boots an in-memory PGlite Postgres, applies the real generated migrations from
// packages/db/drizzle (the same ones `bun run db:migrate` applies in production), and
// hands back a drizzle instance built from the identical schema barrel and `casing:
// "snake_case"` option as src/client.ts, so tests exercise real SQL (constraints, FKs,
// unique indexes) instead of a mock that would prove nothing about tenant scoping.
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
  /** Shuts down the in-memory PGlite instance. Call in `afterAll`/`afterEach`. */
  close: () => Promise<void>;
}

// Migrations are checked in at packages/db/drizzle relative to this file
// (packages/db/src/testing.ts) regardless of the caller's cwd. Resolved via
// import.meta.url (portable) rather than Bun's import.meta.dir, since the latter's
// ambient type isn't reliably picked up by every package's tsc invocation in this
// workspace.
const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

/**
 * Boots a fresh in-memory PGlite Postgres and applies every migration in
 * packages/db/drizzle, including the pgvector extension migration. Pgvector itself
 * ships as a separate PGlite extension package (`@electric-sql/pglite-pgvector`) that
 * must be registered on the client before `CREATE EXTENSION vector` will succeed.
 */
export async function createTestDb(): Promise<TestDbHandle> {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle(client, { schema, casing: "snake_case" });

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    close: () => client.close(),
  };
}
