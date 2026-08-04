import {
  FIX_CONFLICT_TARGET,
  type FixConflictColumn,
  type TenantContext,
} from "@growthmind/shared";
import { and, eq, sql } from "drizzle-orm";
import type { IndexColumn } from "drizzle-orm/pg-core";

import { fixes } from "../schema/fixes";
import { orgCrud, type ClaimResult } from "./crud";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

export type FixRow = typeof fixes.$inferSelect;

export interface ClaimFixInput {
  readonly projectId: string;
  readonly findingId: string;
  readonly openedAt: Date;
  readonly openedBy: string;
  readonly resultsBy: Date;
  readonly resultsByRuleVersion: number;
}

export interface CountOpenFixesOptions {
  readonly projectId: string | null;
}

export interface FixesRepo {
  claimFor(input: ClaimFixInput): Promise<ClaimResult<FixRow>>;

  findById(fixId: string): Promise<FixRow | null>;

  findForFinding(findingId: string): Promise<FixRow | null>;

  countOpen(options: CountOpenFixesOptions): Promise<number>;
}

// `packages/shared` names the identity's columns; this is the same list as Drizzle columns,
// so a name added there fails to compile until the column beside it is named.
const CONFLICT_COLUMN = {
  organization_id: fixes.organizationId,
  finding_id: fixes.findingId,
} satisfies Record<FixConflictColumn, IndexColumn>;

export const FIX_CONFLICT_COLUMNS: IndexColumn[] = FIX_CONFLICT_TARGET.map(
  (name) => CONFLICT_COLUMN[name],
);

export const OPEN_FIX_STATUS = "open";

function byFinding(findingId: string) {
  return eq(fixes.findingId, findingId);
}

export function openFixesIn(projectId: string | null) {
  return projectId === null
    ? eq(fixes.status, OPEN_FIX_STATUS)
    : and(eq(fixes.status, OPEN_FIX_STATUS), eq(fixes.projectId, projectId));
}

export function createFixesRepo(db: ScopedExecutor, ctx: TenantContext): FixesRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, fixes);

  return {
    async claimFor(input: ClaimFixInput): Promise<ClaimResult<FixRow>> {
      // No `set`, so the conflict is `onConflictDoNothing` and a second press reads back
      // the row the first press wrote. Never check-then-create.
      return c.claim(
        {
          projectId: input.projectId,
          findingId: input.findingId,
          status: OPEN_FIX_STATUS,
          attempt: 1,
          alreadyLanded: [],
          resultsBy: input.resultsBy,
          resultsByRuleVersion: input.resultsByRuleVersion,
          openedAt: input.openedAt,
          openedBy: input.openedBy,
        },
        { target: FIX_CONFLICT_COLUMNS, fetch: [byFinding(input.findingId)] },
      );
    },

    async findById(fixId: string): Promise<FixRow | null> {
      return c.maybe(eq(fixes.id, fixId));
    },

    async findForFinding(findingId: string): Promise<FixRow | null> {
      return c.maybe(byFinding(findingId));
    },

    async countOpen(options: CountOpenFixesOptions): Promise<number> {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(fixes)
        .where(s.owned(fixes, openFixesIn(options.projectId)));

      return Number(row?.count ?? 0);
    },
  };
}
