// Shared database-parameter type for every repository factory in this
// directory.
//
// `packages/db/src/client.ts`'s `Db` (`ReturnType<typeof createDb>`) is a
// `NodePgDatabase<typeof schema>` — the production node-postgres driver.
// `packages/db/src/testing.ts`'s `createTestDb()` returns a `TestDb`
// (`ReturnType<typeof drizzle<typeof schema>>` from `drizzle-orm/pglite`) —
// a `PgliteDatabase<typeof schema>`. Both extend drizzle's `PgDatabase` but
// are parameterized on different query-result HKTs (`NodePgQueryResultHKT`
// vs `PgliteQueryResultHKT`), so `NodePgDatabase` and `PgliteDatabase` are
// NOT assignable to one another — a repository factory typed strictly as
// `Db` fails to compile against the PGlite instance every repository test
// constructs via `createTestDb()`.
//
// `ScopedDb` is the union of both concrete database types (rather than a
// cast at the call site, and rather than `any`/`unknown`) so repositories
// compile against the real production driver AND the real test harness
// without weakening the type at either call site. Every method available on
// both drivers (select/insert/update/delete/transaction, the query builder)
// is still fully typed — only the driver-specific `$client` shape is
// excluded, which no repository in this package touches.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";

import type * as schema from "../schema";

export type ScopedDb = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;
