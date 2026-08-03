import { eq } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

import { projects } from "../schema/projects";
import { orgCrud } from "./crud";
import type { ScopedExecutor } from "./types";

export type ProjectRecord = typeof projects.$inferSelect;

export interface ProjectsRepo {
  create(input: { name: string }): Promise<ProjectRecord>;

  list(): Promise<ProjectRecord[]>;

  findById(id: string): Promise<ProjectRecord | null>;

  rename(id: string, name: string): Promise<ProjectRecord | null>;
}

export function createProjectsRepo(db: ScopedExecutor, ctx: TenantContext): ProjectsRepo {
  const c = orgCrud(db, ctx, projects);

  return {
    async create(input: { name: string }): Promise<ProjectRecord> {
      return c.insert({ name: input.name });
    },

    async list(): Promise<ProjectRecord[]> {
      return c.list();
    },

    async findById(id: string): Promise<ProjectRecord | null> {
      return c.maybe(eq(projects.id, id));
    },

    async rename(id: string, name: string): Promise<ProjectRecord | null> {
      return c.update({ name }, eq(projects.id, id));
    },
  };
}
