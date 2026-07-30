import { createDb, type Db } from "@growthmind/db";
import { parseServerEnv } from "@growthmind/shared";

// One pool per process. The global stash survives Next.js dev-server hot
// reloads, which would otherwise leak a pool per file change.
const globalForDb = globalThis as unknown as { __growthmindDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__growthmindDb) {
    const env = parseServerEnv(process.env);
    globalForDb.__growthmindDb = createDb(env.DATABASE_URL);
  }
  return globalForDb.__growthmindDb;
}
