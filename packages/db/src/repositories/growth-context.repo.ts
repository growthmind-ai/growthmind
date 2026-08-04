import {
  growthContext as toGrowthContext,
  growthContextSchema,
  type GrowthContext,
} from "@growthmind/core";
import { logger, type TenantContext } from "@growthmind/shared";
import { eq, inArray, sql } from "drizzle-orm";

import { growthContext } from "../schema/growth-context";
import { orgCrud } from "./crud";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

export type GrowthContextRow = typeof growthContext.$inferSelect;

export interface SaveGrowthContextInput {
  readonly projectId: string;
  readonly surfaces: unknown;
  readonly confirmedChangeable: unknown;
}

export interface GrowthContextSnapshot {
  readonly context: GrowthContext;

  readonly updatedAt: Date;
}

export interface GrowthContextRepo {
  // Null is "nothing is known about this project's surfaces", which every caller answers
  // by weighing every surface the same. It is never an error.
  findForProject(projectId: string): Promise<GrowthContext | null>;

  // Absent projects are absent keys, never null values: a caller reading a missing key
  // gets undefined and weighs that project's surfaces the same, which is the same answer
  // `findForProject` gives.
  findForProjects(projectIds: readonly string[]): Promise<ReadonlyMap<string, GrowthContext>>;

  // Carries the stamp a later write can check itself against.
  snapshotForProject(projectId: string): Promise<GrowthContextSnapshot | null>;

  save(input: SaveGrowthContextInput): Promise<GrowthContextRow>;

  // The write for anything that derived its answer from a row it read earlier. `false` means
  // the row moved underneath it and nothing was written — a person confirming a role between
  // the read and the write must not have that confirmation derived away.
  saveIfUnchanged(input: SaveGrowthContextInput, since: Date | null): Promise<boolean>;
}

const notOurProject = (): Error =>
  new Error("growth context: the project named is not this organization's");

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readBack(row: GrowthContextRow): GrowthContext | null {
  try {
    return toGrowthContext(
      growthContextSchema.parse({
        surfaces: row.surfaces,
        confirmedChangeable: row.confirmedChangeable,
      }),
    );
  } catch (error) {
    logger.error("growth context: a stored row could not be read back", {
      projectId: row.projectId,
      reason: reasonOf(error),
    });
    return null;
  }
}

export function createGrowthContextRepo(db: ScopedExecutor, ctx: TenantContext): GrowthContextRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, growthContext);

  return {
    async findForProject(projectId: string): Promise<GrowthContext | null> {
      const rows = await db
        .select()
        .from(growthContext)
        .where(s.owned(growthContext, eq(growthContext.projectId, projectId)))
        .limit(1);

      const row = s.maybe(rows);

      // One unreadable row costs this project its weighting, not its delivery: the caller
      // treats null as "weigh everything the same", which is the ordering that shipped
      // before any of this existed.
      return row === null ? null : readBack(row);
    },

    async findForProjects(
      projectIds: readonly string[],
    ): Promise<ReadonlyMap<string, GrowthContext>> {
      const byProject = new Map<string, GrowthContext>();
      if (projectIds.length === 0) {
        return byProject;
      }

      const rows = await db
        .select()
        .from(growthContext)
        .where(s.owned(growthContext, inArray(growthContext.projectId, [...new Set(projectIds)])));

      for (const row of rows) {
        const read = readBack(row);
        if (read !== null) {
          byProject.set(row.projectId, read);
        }
      }

      return byProject;
    },

    async snapshotForProject(projectId: string): Promise<GrowthContextSnapshot | null> {
      const rows = await db
        .select()
        .from(growthContext)
        .where(s.owned(growthContext, eq(growthContext.projectId, projectId)))
        .limit(1);

      const row = s.maybe(rows);
      if (row === null) return null;

      const context = readBack(row);

      return context === null ? null : { context, updatedAt: row.updatedAt };
    },

    async saveIfUnchanged(input: SaveGrowthContextInput, since: Date | null): Promise<boolean> {
      const parsed = growthContextSchema.parse({
        surfaces: input.surfaces,
        confirmedChangeable: input.confirmedChangeable,
      });

      await s.assertProjectOwned(input.projectId, notOurProject);

      const claimed = await c.claim(
        {
          projectId: input.projectId,
          surfaces: parsed.surfaces,
          confirmedChangeable: parsed.confirmedChangeable,
        },
        {
          target: [growthContext.organizationId, growthContext.projectId],
          set: {
            surfaces: parsed.surfaces,
            confirmedChangeable: parsed.confirmedChangeable,
            updatedAt: new Date(),
          },
          // `since === null` means the caller read no row at all, so a row existing now is
          // one that appeared underneath it. `false` refuses the update rather than
          // overwriting whatever arrived.
          setWhere: since === null ? sql`false` : eq(growthContext.updatedAt, since),
          fetch: [eq(growthContext.projectId, input.projectId)],
        },
      );

      return claimed.claimed;
    },

    async save(input: SaveGrowthContextInput): Promise<GrowthContextRow> {
      const parsed = growthContextSchema.parse({
        surfaces: input.surfaces,
        confirmedChangeable: input.confirmedChangeable,
      });

      await s.assertProjectOwned(input.projectId, notOurProject);

      return c.insertOrFetch(
        {
          projectId: input.projectId,
          surfaces: parsed.surfaces,
          confirmedChangeable: parsed.confirmedChangeable,
        },
        {
          target: [growthContext.organizationId, growthContext.projectId],
          set: {
            surfaces: parsed.surfaces,
            confirmedChangeable: parsed.confirmedChangeable,
          },
          fetch: [eq(growthContext.projectId, input.projectId)],
        },
      );
    },
  };
}
