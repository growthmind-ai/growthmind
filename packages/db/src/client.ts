import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

/**
 * One pool per process. Callers own the lifecycle — construct it once at
 * startup (web: lib/db.ts singleton; worker: main.ts) rather than per request.
 */
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema, casing: "snake_case" });
}

/**
 * Connectivity probe for health endpoints. Lives here so consumers never
 * write raw SQL — the db package is the only place queries are built.
 * Throws on an unreachable database; the caller decides how to report it.
 */
export async function ping(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
