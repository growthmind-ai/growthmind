import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createOrganizationsRepo } from "../../src/repositories/organizations.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner } from "../../src/testing";

describe("createOrganizationsRepo", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("rename updates only the constructing context's organization", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Org A",
      userName: "Owner A",
      email: "owner-a@example.com",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "Org B",
      userName: "Owner B",
      email: "owner-b@example.com",
    });

    const repoA = createOrganizationsRepo(db, orgA.ctx);
    const repoB = createOrganizationsRepo(db, orgB.ctx);

    const renamed = await repoA.rename("Org A Renamed");

    expect(renamed.name).toBe("Org A Renamed");
    expect(renamed.id).toBe(orgA.organizationId);

    const orgBAfter = await repoB.get();
    expect(orgBAfter.name).toBe(orgB.organizationName);
    expect(orgBAfter.name).toBe("Org B");
  });
});
