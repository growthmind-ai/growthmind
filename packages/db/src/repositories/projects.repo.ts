import { eq } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

import { projects } from "../schema/projects";
import { scoped } from "./scope";
import type { ScopedDb } from "./types";

export type ProjectRecord = typeof projects.$inferSelect;

export interface ProjectsRepo {
  create(input: { name: string }): Promise<ProjectRecord>;

  list(): Promise<ProjectRecord[]>;

  findById(id: string): Promise<ProjectRecord | null>;

  rename(id: string, name: string): Promise<ProjectRecord | null>;
}

export function createProjectsRepo(db: ScopedDb, ctx: TenantContext): ProjectsRepo {
  const s = scoped(db, ctx);

  return {
    async create(input: { name: string }): Promise<ProjectRecord> {
      const rows = await db
        .insert(projects)
        .values({ ...s.stamp, name: input.name })
        .returning();

      return s.one(rows, "createProjectsRepo.create");
    },

    async list(): Promise<ProjectRecord[]> {
      return db.select().from(projects).where(s.org(projects));
    },

    async findById(id: string): Promise<ProjectRecord | null> {
      return s.maybe(
        await db
          .select()
          .from(projects)
          .where(s.owned(projects, eq(projects.id, id))),
      );
    },

    async rename(id: string, name: string): Promise<ProjectRecord | null> {
      return s.maybe(
        await db
          .update(projects)
          .set({ name })
          .where(s.owned(projects, eq(projects.id, id)))
          .returning(),
      );
    },
  };
}
