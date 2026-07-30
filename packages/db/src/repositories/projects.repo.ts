// Repository for the `projects` table. D-B: the factory takes a
// `TenantContext` at construction — the only way to name an organization —
// and no method below accepts an organization id as a parameter. Every read
// filters on `ctx.organizationId`; every mutation is keyed on
// `(ctx.organizationId, id)` with `.returning()`, so a foreign-org id
// affects zero rows and returns `null` rather than silently succeeding.
//
// TYPED STUB (m0 scaffold): signatures and return types are final; bodies
// throw. A later wave fills in the Drizzle queries against these exact
// signatures.
import { and, eq } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

import { projects } from "../schema/projects";
import type { ScopedDb } from "./types";

export type ProjectRecord = typeof projects.$inferSelect;

export interface ProjectsRepo {
  /** Inserts a project stamped with `ctx.organizationId`. */
  create(input: { name: string }): Promise<ProjectRecord>;
  /** Every project belonging to `ctx.organizationId`. */
  list(): Promise<ProjectRecord[]>;
  /** Org-filtered lookup by id — `null` for a foreign org's project. */
  findById(id: string): Promise<ProjectRecord | null>;
  /**
   * Keyed on `(ctx.organizationId, id)` with `.returning()` — `null` (not a
   * throw, not a silent no-op) when 0 rows match, e.g. a foreign org's id.
   */
  rename(id: string, name: string): Promise<ProjectRecord | null>;
}

export function createProjectsRepo(db: ScopedDb, ctx: TenantContext): ProjectsRepo {
  return {
    async create(input: { name: string }): Promise<ProjectRecord> {
      const [row] = await db
        .insert(projects)
        .values({
          organizationId: ctx.organizationId,
          name: input.name,
        })
        .returning();

      if (!row) {
        throw new Error("createProjectsRepo.create: insert returned no row");
      }

      return row;
    },

    async list(): Promise<ProjectRecord[]> {
      return db.select().from(projects).where(eq(projects.organizationId, ctx.organizationId));
    },

    async findById(id: string): Promise<ProjectRecord | null> {
      const [row] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.id, id)));

      return row ?? null;
    },

    async rename(id: string, name: string): Promise<ProjectRecord | null> {
      const [row] = await db
        .update(projects)
        .set({ name })
        .where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.id, id)))
        .returning();

      return row ?? null;
    },
  };
}
