import type { TenantContext } from "@growthmind/shared";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { projects } from "../schema/projects";
import type { ScopedExecutor } from "./types";

// A table without an `organization_id` column fails to compile at `org`/`owned` rather than
// silently matching every row, which is what a hand-written filter on a missing column does.
export type OrgScopedTable = PgTable & { organizationId: PgColumn };

export interface Scope {
  readonly stamp: { readonly organizationId: string };

  org(table: OrgScopedTable): SQL;

  // For the tables whose tenant key is not a column named `organizationId` — `organization.id`
  // is the org, and `member` is reached through it.
  orgId(column: PgColumn): SQL;

  owned(table: OrgScopedTable, ...conditions: (SQL | undefined)[]): SQL | undefined;

  one<R>(rows: readonly R[], label: string): R;

  maybe<R>(rows: readonly R[]): R | null;

  assertProjectOwned(projectId: string, onNotOurs: () => Error): Promise<void>;

  ownedProjectIds(candidates: readonly string[]): Promise<Set<string>>;
}

export function scoped(db: ScopedExecutor, ctx: TenantContext): Scope {
  function org(table: OrgScopedTable): SQL {
    return eq(table.organizationId, ctx.organizationId);
  }

  return {
    stamp: { organizationId: ctx.organizationId },

    org,

    orgId(column: PgColumn): SQL {
      return eq(column, ctx.organizationId);
    },

    owned(table: OrgScopedTable, ...conditions: (SQL | undefined)[]): SQL | undefined {
      return and(org(table), ...conditions);
    },

    one<R>(rows: readonly R[], label: string): R {
      const [row] = rows;

      if (!row) {
        throw new Error(`${label}: expected a row, got none`);
      }

      return row;
    },

    maybe<R>(rows: readonly R[]): R | null {
      return rows[0] ?? null;
    },

    async assertProjectOwned(projectId: string, onNotOurs: () => Error): Promise<void> {
      const [owned] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(org(projects), eq(projects.id, projectId)))
        .limit(1);

      if (!owned) {
        throw onNotOurs();
      }
    },

    async ownedProjectIds(candidates: readonly string[]): Promise<Set<string>> {
      if (candidates.length === 0) {
        return new Set();
      }

      const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(org(projects), inArray(projects.id, [...new Set(candidates)])));

      return new Set(rows.map((row) => row.id));
    },
  };
}
