import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgliteDatabase, PgliteQueryResultHKT } from "drizzle-orm/pglite";

import type * as schema from "../schema";

export type ScopedDb = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

// PgTransaction extends PgDatabase, so this admits both databases and their
// transactions — repositories built over a tx take part in the caller's atomicity.
export type ScopedExecutor =
  PgDatabase<NodePgQueryResultHKT, typeof schema> | PgDatabase<PgliteQueryResultHKT, typeof schema>;
