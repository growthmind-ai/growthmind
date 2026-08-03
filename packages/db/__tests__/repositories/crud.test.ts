import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { orgCrud } from "../../src/repositories/crud";
import { firstRunState } from "../../src/schema/first-run-state";
import { projects } from "../../src/schema/projects";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner, seedProject, type SeededOrgWithOwner } from "../../src/testing";

describe("orgCrud", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let orgA: SeededOrgWithOwner;
  let orgB: SeededOrgWithOwner;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    orgA = await seedOrgWithOwner(db, {
      orgName: "Crud Org A",
      userName: "Crud Owner A",
      email: "crud-owner-a@example.com",
    });
    orgB = await seedOrgWithOwner(db, {
      orgName: "Crud Org B",
      userName: "Crud Owner B",
      email: "crud-owner-b@example.com",
    });
  });

  afterAll(async () => {
    await close();
  });

  test("insert stamps the constructing context's organization id", async () => {
    const c = orgCrud(db, orgA.ctx, projects);

    const row = await c.insert({ name: "Stamped" });

    expect(row.organizationId).toBe(orgA.organizationId);
    expect(row.name).toBe("Stamped");
  });

  test("maybe finds an owned row and returns null for a foreign org's row", async () => {
    const cA = orgCrud(db, orgA.ctx, projects);
    const cB = orgCrud(db, orgB.ctx, projects);

    const mine = await cA.insert({ name: "Findable" });

    const found = await cA.maybe(eq(projects.id, mine.id));
    expect(found?.id).toBe(mine.id);

    const foreign = await cB.maybe(eq(projects.id, mine.id));
    expect(foreign).toBeNull();
  });

  test("one throws a labelled error when no owned row matches", async () => {
    const cB = orgCrud(db, orgB.ctx, projects);
    const mine = await orgCrud(db, orgA.ctx, projects).insert({ name: "Not yours" });

    expect(cB.one("byId", eq(projects.id, mine.id))).rejects.toThrow("projects.byId");
  });

  test("list is org-filtered and honours orderBy and limit", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "Crud List Org",
      userName: "Crud List Owner",
      email: "crud-list-owner@example.com",
    });
    const c = orgCrud(db, org.ctx, projects);

    await c.insert({ name: "b-second" });
    await c.insert({ name: "a-first" });

    const all = await c.list({ orderBy: [projects.name] });
    expect(all.map((p) => p.name)).toEqual(["a-first", "b-second"]);
    expect(all.every((p) => p.organizationId === org.organizationId)).toBe(true);

    const limited = await c.list({ orderBy: [projects.name], limit: 1 });
    expect(limited.map((p) => p.name)).toEqual(["a-first"]);
  });

  test("update affects only owned rows and returns null across the tenant boundary", async () => {
    const cA = orgCrud(db, orgA.ctx, projects);
    const cB = orgCrud(db, orgB.ctx, projects);

    const mine = await cA.insert({ name: "Before" });

    const hijack = await cB.update({ name: "Hijacked" }, eq(projects.id, mine.id));
    expect(hijack).toBeNull();

    const renamed = await cA.update({ name: "After" }, eq(projects.id, mine.id));
    expect(renamed?.name).toBe("After");
  });

  test("insertOrFetch without set inserts once, then serves the existing row on conflict", async () => {
    const project = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "Conflict target",
    });
    const c = orgCrud(db, orgA.ctx, firstRunState);
    const armedAt = new Date("2026-08-01T00:00:00.000Z");

    const first = await c.insertOrFetch(
      { projectId: project.id, armedAt },
      {
        target: [firstRunState.organizationId, firstRunState.projectId],
        fetch: [eq(firstRunState.projectId, project.id)],
      },
    );
    expect(first.armedAt?.toISOString()).toBe(armedAt.toISOString());

    const second = await c.insertOrFetch(
      { projectId: project.id, armedAt: new Date("2026-08-02T00:00:00.000Z") },
      {
        target: [firstRunState.organizationId, firstRunState.projectId],
        fetch: [eq(firstRunState.projectId, project.id)],
      },
    );
    expect(second.armedAt?.toISOString()).toBe(armedAt.toISOString());
  });

  test("insertOrFetch with set merges on conflict and returns the updated row", async () => {
    const project = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "Merge target",
    });
    const c = orgCrud(db, orgA.ctx, firstRunState);
    const skippedAt = new Date("2026-08-03T00:00:00.000Z");

    await c.insertOrFetch(
      { projectId: project.id },
      {
        target: [firstRunState.organizationId, firstRunState.projectId],
        fetch: [eq(firstRunState.projectId, project.id)],
      },
    );

    const merged = await c.insertOrFetch(
      { projectId: project.id, slackSkippedAt: skippedAt },
      {
        target: [firstRunState.organizationId, firstRunState.projectId],
        set: { slackSkippedAt: skippedAt },
        fetch: [eq(firstRunState.projectId, project.id)],
      },
    );
    expect(merged.slackSkippedAt?.toISOString()).toBe(skippedAt.toISOString());
  });

  test("insertOrFetch falls back to the owned select when setWhere rejects the merge", async () => {
    const project = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "Rejected merge",
    });
    const c = orgCrud(db, orgA.ctx, firstRunState);
    const armedAt = new Date("2026-08-04T00:00:00.000Z");

    await c.insertOrFetch(
      { projectId: project.id, armedAt },
      {
        target: [firstRunState.organizationId, firstRunState.projectId],
        fetch: [eq(firstRunState.projectId, project.id)],
      },
    );

    const fetched = await c.insertOrFetch(
      { projectId: project.id },
      {
        target: [firstRunState.organizationId, firstRunState.projectId],
        set: { armedAt: new Date("2026-08-05T00:00:00.000Z") },
        setWhere: eq(firstRunState.projectId, "never-matches"),
        fetch: [eq(firstRunState.projectId, project.id)],
      },
    );
    expect(fetched.armedAt?.toISOString()).toBe(armedAt.toISOString());
  });
});
