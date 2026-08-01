import { createDb, type Db } from "@growthmind/db";
import { parseServerEnv } from "@growthmind/shared";

// One pool per process. The global stash survives Next.js dev-server hot reloads, which
// would otherwise leak a pool per file change.
//
// The stash is also a test seam, so do not remove it as dead code:
// `apps/web/__tests__/mcp/wiring.test.ts` installs a PGlite handle into
// `globalThis.__growthmindDb` to drive the mounted `/api/mcp` route against a real
// database without patching the module registry.
const globalForDb = globalThis as unknown as { __growthmindDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__growthmindDb) {
    const env = parseServerEnv(process.env);
    globalForDb.__growthmindDb = createDb(env.DATABASE_URL);
  }
  return globalForDb.__growthmindDb;
}
