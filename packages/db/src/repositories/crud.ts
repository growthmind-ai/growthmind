import type { TenantContext } from "@growthmind/shared";
import { getTableName, type SQL } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type {
  IndexColumn,
  PgColumn,
  PgDatabase,
  PgInsertValue,
  PgTable,
  PgUpdateSetSource,
} from "drizzle-orm/pg-core";

import type * as schema from "../schema";
import { scoped, type OrgScopedTable } from "./scope";
import type { ScopedExecutor } from "./types";

export type OrgInsertValues<T extends OrgScopedTable> = Omit<PgInsertValue<T>, "organizationId">;

export type OrderTerm = PgColumn | SQL | SQL.Aliased;

export interface InsertOrFetchOptions<T extends OrgScopedTable> {
  readonly target: IndexColumn | IndexColumn[];
  readonly targetWhere?: SQL;
  readonly set?: PgUpdateSetSource<T>;
  readonly setWhere?: SQL;
  readonly fetch: readonly (SQL | undefined)[];
}

export interface ListOptions {
  readonly where?: SQL | undefined;
  readonly orderBy?: readonly OrderTerm[];
  readonly limit?: number;
}

export interface ClaimResult<Row> {
  readonly claimed: boolean;
  readonly row: Row | null;
}

export interface OrgCrud<T extends OrgScopedTable> {
  insert(values: OrgInsertValues<T>): Promise<T["$inferSelect"]>;

  claim(
    values: OrgInsertValues<T>,
    options: InsertOrFetchOptions<T>,
  ): Promise<ClaimResult<T["$inferSelect"]>>;

  insertOrFetch(
    values: OrgInsertValues<T>,
    options: InsertOrFetchOptions<T>,
  ): Promise<T["$inferSelect"]>;

  maybe(...conds: (SQL | undefined)[]): Promise<T["$inferSelect"] | null>;

  one(label: string, ...conds: (SQL | undefined)[]): Promise<T["$inferSelect"]>;

  list(options?: ListOptions): Promise<T["$inferSelect"][]>;

  update(
    set: PgUpdateSetSource<T>,
    ...conds: (SQL | undefined)[]
  ): Promise<T["$inferSelect"] | null>;
}

// Both drivers expose the byte-identical PgDatabase builder API; chains are checked
// against the node-postgres arm because the union's synthesized signatures reject
// some generic calls. The only place the union is collapsed.
type CrudExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

// The same union collapse, for the repositories whose write is two statements that must
// land together. A PgTransaction is itself a ScopedExecutor, so a repository built over the
// handed-back executor joins this transaction rather than opening its own connection.
export function inTransaction<T>(
  db: ScopedExecutor,
  run: (tx: ScopedExecutor) => Promise<T>,
): Promise<T> {
  return (db as CrudExecutor).transaction((tx) => run(tx));
}

export function orgCrud<T extends OrgScopedTable>(
  db: ScopedExecutor,
  ctx: TenantContext,
  table: T,
): OrgCrud<T> {
  type Row = T["$inferSelect"];

  const s = scoped(db, ctx);
  const exec = db as CrudExecutor;
  const name = getTableName(table);

  const stamped = (values: OrgInsertValues<T>): PgInsertValue<T> =>
    ({ ...values, ...s.stamp }) as unknown as PgInsertValue<T>;

  async function selectWhere(conds: readonly (SQL | undefined)[], limit: number): Promise<Row[]> {
    return (await exec
      .select()
      .from(table as PgTable)
      .where(s.owned(table, ...conds))
      .limit(limit)) as Row[];
  }

  async function claim(
    values: OrgInsertValues<T>,
    options: InsertOrFetchOptions<T>,
  ): Promise<ClaimResult<Row>> {
    const base = exec.insert(table).values(stamped(values));
    const conflicted = options.set
      ? base.onConflictDoUpdate({
          target: options.target,
          set: options.set,
          ...(options.targetWhere ? { targetWhere: options.targetWhere } : {}),
          ...(options.setWhere ? { setWhere: options.setWhere } : {}),
        })
      : base.onConflictDoNothing({
          target: options.target,
          ...(options.targetWhere ? { where: options.targetWhere } : {}),
        });

    const rows = (await conflicted.returning()) as Row[];
    const claimed = rows[0];

    if (claimed) {
      return { claimed: true, row: claimed };
    }

    return { claimed: false, row: s.maybe(await selectWhere(options.fetch, 1)) };
  }

  return {
    async insert(values: OrgInsertValues<T>): Promise<Row> {
      const rows = (await exec.insert(table).values(stamped(values)).returning()) as Row[];

      return s.one(rows, `${name}.insert`);
    },

    claim,

    async insertOrFetch(
      values: OrgInsertValues<T>,
      options: InsertOrFetchOptions<T>,
    ): Promise<Row> {
      const result = await claim(values, options);

      return s.one(result.row ? [result.row] : [], `${name}.insertOrFetch`);
    },

    async maybe(...conds: (SQL | undefined)[]): Promise<Row | null> {
      return s.maybe(await selectWhere(conds, 1));
    },

    async one(label: string, ...conds: (SQL | undefined)[]): Promise<Row> {
      return s.one(await selectWhere(conds, 1), `${name}.${label}`);
    },

    async list(options: ListOptions = {}): Promise<Row[]> {
      let query = exec
        .select()
        .from(table as PgTable)
        .where(s.owned(table, options.where))
        .$dynamic();

      if (options.orderBy?.length) {
        query = query.orderBy(...options.orderBy);
      }

      if (options.limit !== undefined) {
        query = query.limit(options.limit);
      }

      return (await query) as Row[];
    },

    async update(set: PgUpdateSetSource<T>, ...conds: (SQL | undefined)[]): Promise<Row | null> {
      const rows = (await exec
        .update(table)
        .set(set)
        .where(s.owned(table, ...conds))
        .returning()) as Row[];

      return s.maybe(rows);
    },
  };
}
