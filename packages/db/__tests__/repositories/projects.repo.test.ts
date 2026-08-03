import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createProjectsRepo } from "../../src/repositories/projects.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner } from "../../src/testing";

describe("createProjectsRepo", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("creates a project stamped with the constructing context's organization id", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Org A",
      userName: "Owner A",
      email: "owner-a-1@example.com",
    });

    const repoA = createProjectsRepo(db, orgA.ctx);

    const project = await repoA.create({ name: "Landing page" });

    expect(project.organizationId).toBe(orgA.organizationId);
    expect(project.name).toBe("Landing page");
  });

  test("freshly created project is returned by the scoped list that serves it", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Org A",
      userName: "Owner A",
      email: "owner-a-2@example.com",
    });

    const repoA = createProjectsRepo(db, orgA.ctx);

    const created = await repoA.create({ name: "Checkout funnel" });
    const listed = await repoA.list();

    expect(listed.map((p) => p.id)).toContain(created.id);
  });

  test("findById of another org's project returns null", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Org A",
      userName: "Owner A",
      email: "owner-a-3@example.com",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "Org B",
      userName: "Owner B",
      email: "owner-b-4@example.com",
    });

    const repoA = createProjectsRepo(db, orgA.ctx);
    const repoB = createProjectsRepo(db, orgB.ctx);

    const projectA = await repoA.create({ name: "Org A's project" });

    const result = await repoB.findById(projectA.id);

    expect(result).toBeNull();
  });

  test("rename keyed on (org, id) affects 0 rows and returns null for a foreign org's project", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Org A",
      userName: "Owner A",
      email: "owner-a-5@example.com",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "Org B",
      userName: "Owner B",
      email: "owner-b-6@example.com",
    });

    const repoA = createProjectsRepo(db, orgA.ctx);
    const repoB = createProjectsRepo(db, orgB.ctx);

    const projectA = await repoA.create({ name: "Original name" });

    const result = await repoB.rename(projectA.id, "Hijacked name");

    expect(result).toBeNull();

    const reread = await repoA.findById(projectA.id);
    expect(reread?.name).toBe("Original name");
  });

  test("list returns an empty array for an org with no projects", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Org A",
      userName: "Owner A",
      email: "owner-a-7@example.com",
    });

    const repoA = createProjectsRepo(db, orgA.ctx);

    const listed = await repoA.list();

    expect(listed).toEqual([]);
  });
});
