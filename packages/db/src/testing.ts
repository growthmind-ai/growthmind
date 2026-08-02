// Test-only database harness. Not exported from src/index.ts. Reachable only via the
// "./testing" subpath (see package.json `exports`), so it can never end up in a
// production bundle.
//
// Boots an in-memory PGlite Postgres, applies the real generated migrations from
// packages/db/drizzle (the same ones `bun run db:migrate` applies in production), and
// hands back a drizzle instance built from the identical schema barrel and `casing:
// "snake_case"` option as src/client.ts, so tests exercise real SQL (constraints, FKs,
// unique indexes) instead of a mock that would prove nothing about tenant scoping.
//
// ###########################################################################
// # MIGRATIONS RUN ONCE PER PROCESS, NOT ONCE PER CALL — AND THAT IS A
// # FLAKINESS FIX, NOT AN OPTIMISATION.
// #
// # This function used to boot PGlite and replay every migration on each call:
// # ~4.2 SECONDS, against bun's DEFAULT 5000 ms hook timeout. Every
// # `beforeAll(async () => { handle = await createTestDb() })` in the repo was
// # therefore running about 800 ms from the ceiling, and any load on the machine
// # — a second suite, a parallel session, a background build — pushed one over.
// #
// # The failure was never legible as a timeout. A timed-out `beforeAll` leaves
// # `handle` UNASSIGNED, so `afterAll` then throws `undefined is not an object
// # (evaluating 'handle.close')`, and any test that ran anyway hit a half-built
// # or already-closed instance — surfacing as `PGlite is closed`, duplicate-key
// # violations, and hook timeouts scattered across unrelated suites. Identical
// # runs of unmodified code returned anywhere from 0 to 8 failures, which reads
// # as "the tenancy tests are broken" rather than "the fixture is too slow".
// #
// # So: pay the migrations ONCE, snapshot the migrated data directory, and clone
// # it per call. ~4.2 s -> ~1.0 s, which puts every hook a comfortable 5x inside
// # the timeout instead of a coin-flip outside it. Across the 82 boot calls in
// # this repo that is also ~4.5 minutes off every full run and every CI run.
// #
// # ISOLATION IS UNCHANGED, AND THAT IS THE PART TO NOT BREAK. Each call still
// # gets its OWN PGlite instance, restored from a byte-identical post-migration
// # snapshot — never a shared connection and never a reset-between-tests scheme.
// # `__tests__/testing/test-db.test.ts` pins that: a row written through one
// # handle must be invisible to every handle made after it, so the shared thing
// # can only ever be the migrations, never the data.
// ###########################################################################
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

const drizzleFor = (client: PGlite): TestDb => drizzle(client, { schema, casing: "snake_case" });

/**
 * The migrated data directory, dumped once and cloned by every later call.
 *
 * Held as the PROMISE, not the resolved value, and assigned with `??=` before the
 * first `await`. Two concurrent `createTestDb()` calls therefore share one build
 * instead of racing into two — the check-then-assign a plain `if (!template)`
 * would compile to is exactly the interleaving that produces both.
 */
let migratedTemplate: Promise<Blob | File> | null = null;

/**
 * Boot one throwaway PGlite, replay every migration, and dump the result.
 *
 * Uncompressed (`"none"`): this snapshot is restored 80+ times per full run and
 * never leaves memory, so gzip would buy nothing and cost on every clone.
 */
async function buildMigratedTemplate(): Promise<Blob | File> {
  const client = new PGlite({ extensions: { vector } });

  await migrate(drizzleFor(client), { migrationsFolder: MIGRATIONS_FOLDER });

  const dump = await client.dumpDataDir("none");
  await client.close();

  return dump;
}

/**
 * Boots a fresh in-memory PGlite Postgres carrying every migration in
 * packages/db/drizzle, including the pgvector extension migration. Pgvector itself
 * ships as a separate PGlite extension package (`@electric-sql/pglite-pgvector`) that
 * must be registered on the client before `CREATE EXTENSION vector` will succeed —
 * and must be registered on the RESTORING client too, not only the one that ran the
 * migration, or the restored instance cannot resolve the `vector` type.
 *
 * Every call returns an independent database. The migrations are what is shared, not
 * the data.
 */
export async function createTestDb(): Promise<TestDbHandle> {
  migratedTemplate ??= buildMigratedTemplate();

  const client = new PGlite({ extensions: { vector }, loadDataDir: await migratedTemplate });

  return {
    db: drizzleFor(client),
    close: () => client.close(),
  };
}
