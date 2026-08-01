// Repository tests for `createOrganizationsRepo` (add tasks/tenancy-app-shell/add.md).
// Both methods key solely on `ctx.organizationId`. There is no id parameter to accept
// at all, so a foreign org can never be named through this repository. Runs against
// real SQL via PGlite (`createTestDb`), never a fake.
//
// Wave 0: `createOrganizationsRepo`'s method bodies are typed stubs that throw "not
// implemented". The test below must fail for that reason, never a compile error.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createOrganizationsRepo } from "../../src/repositories/organizations.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner } from "../helpers/fixtures";

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

    // Sibling org's name must be unchanged. Rename must not have leaked scope to any
    // other organization row.
    const orgBAfter = await repoB.get();
    expect(orgBAfter.name).toBe(orgB.organizationName);
    expect(orgBAfter.name).toBe("Org B");
  });
});
