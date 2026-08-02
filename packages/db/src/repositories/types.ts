import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";

import type * as schema from "../schema";

export type ScopedDb = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;
