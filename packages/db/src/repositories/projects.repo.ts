import { and, eq } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

import { projects } from "../schema/projects";
import type { ScopedDb } from "./types";

export type ProjectRecord = typeof projects.$inferSelect;

export interface ProjectsRepo {
  create(input: { name: string }): Promise<ProjectRecord>;

  list(): Promise<ProjectRecord[]>;

  findById(id: string): Promise<ProjectRecord | null>;

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
