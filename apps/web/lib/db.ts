import { createDb, type Db } from "@growthmind/db";
import { parseBaseEnv } from "@growthmind/shared";

const globalForDb = globalThis as unknown as { __growthmindDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__growthmindDb) {
    const env = parseBaseEnv(process.env);
    globalForDb.__growthmindDb = createDb(env.DATABASE_URL);
  }
  return globalForDb.__growthmindDb;
}
