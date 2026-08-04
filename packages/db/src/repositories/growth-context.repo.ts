import {
  growthContext as toGrowthContext,
  growthContextSchema,
  type GrowthContext,
} from "@growthmind/core";
import { logger, type TenantContext } from "@growthmind/shared";
import { eq, inArray } from "drizzle-orm";

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

export interface GrowthContextRepo {
  // Null is "nothing is known about this project's surfaces", which every caller answers
  // by weighing every surface the same. It is never an error.
  findForProject(projectId: string): Promise<GrowthContext | null>;

  // Absent projects are absent keys, never null values: a caller reading a missing key
  // gets undefined and weighs that project's surfaces the same, which is the same answer
  // `findForProject` gives.
  findForProjects(projectIds: readonly string[]): Promise<ReadonlyMap<string, GrowthContext>>;

  save(input: SaveGrowthContextInput): Promise<GrowthContextRow>;
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
