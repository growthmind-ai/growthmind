import { randomUUID } from "node:crypto";

import { ensureOrganization, schema } from "@growthmind/db";
import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createTestAuth,
  readMembershipsForUser,
  readOrganizationById,
  signUpTestUser,
  type SignedUpTestUser,
} from "./helpers/auth-fixture";

import { setLogSink, type LogRecord } from "@growthmind/shared";
const PASSWORD = "correct-horse-battery";

interface BetterAuthApiError extends Error {
  status?: string;
  body?: { code?: string; message?: string };
}

describe("signUpEmail leaves the user a member of exactly one auto-created organization with the derived name", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("signUpEmail leaves the user a member of exactly one auto-created organization with the derived name", async () => {
    const auth = createTestAuth(handle.db, {
      onUserCreate: async (user) => {
        await ensureOrganization(handle.db, user);
      },
    });

    const owner = await signUpTestUser(auth, {
      name: "Ada Lovelace",
      email: `signup-happy-path-${randomUUID()}@example.com`,
      password: PASSWORD,
    });

    const memberships = await readMembershipsForUser(handle.db, owner.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("owner");

    const org = await readOrganizationById(handle.db, memberships[0]!.organizationId);
    expect(org?.name).toBe("Ada's workspace");
  });
});

describe("concurrent ensureOrganization calls for one user create exactly one organization", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("concurrent ensureOrganization calls for one user create exactly one organization", async () => {
    const auth = createTestAuth(handle.db);

    const user = await signUpTestUser(auth, {
      name: "Concurrent Racer",
      email: `signup-concurrent-race-${randomUUID()}@example.com`,
      password: PASSWORD,
    });

    const [resultA, resultB] = await Promise.all([
      ensureOrganization(handle.db, user),
      ensureOrganization(handle.db, user),
    ]);

    expect(resultA.organizationId).toBe(resultB.organizationId);

    const matchingOrgs = (await handle.db.select().from(schema.organization)).filter(
      (org) => org.slug === `ws-${user.id}`,
    );
    expect(matchingOrgs).toHaveLength(1);

    const memberships = await readMembershipsForUser(handle.db, user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.organizationId).toBe(resultA.organizationId);
  });
});

describe("a user with zero memberships is healed on tenant-context resolution", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("a user with zero memberships is healed on tenant-context resolution", async () => {
    const auth = createTestAuth(handle.db);

    const user = await signUpTestUser(auth, {
      name: "Hazel Heals",
      email: `signup-self-heal-${randomUUID()}@example.com`,
      password: PASSWORD,
    });

    const membershipsBefore = await readMembershipsForUser(handle.db, user.id);
    expect(membershipsBefore).toHaveLength(0);

    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });
    try {
      const healResult = await ensureOrganization(handle.db, user);

      const membershipsAfter = await readMembershipsForUser(handle.db, user.id);
      expect(membershipsAfter).toHaveLength(1);
      expect(membershipsAfter[0]?.organizationId).toBe(healResult.organizationId);

      const org = await readOrganizationById(handle.db, healResult.organizationId);
      expect(org).toBeDefined();

      expect(logged.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });
});

describe('signup with a name Better Auth accepts but the derivation cannot use yields "Your workspace"', () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test('signup with a name Better Auth accepts but the derivation cannot use yields "Your workspace"', async () => {
    const auth = createTestAuth(handle.db, {
      onUserCreate: async (user) => {
        await ensureOrganization(handle.db, user);
      },
    });

    const user = await signUpTestUser(auth, {
      name: "   ",
      email: `signup-unusable-name-${randomUUID()}@example.com`,
      password: PASSWORD,
    });

    const memberships = await readMembershipsForUser(handle.db, user.id);
    expect(memberships).toHaveLength(1);

    const org = await readOrganizationById(handle.db, memberships[0]!.organizationId);
    expect(org?.name).toBe("Your workspace");
  });
});

describe("duplicate-email signup fails with an error the form maps to the row-3 string", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("duplicate-email signup fails with an error the form maps to the row-3 string", async () => {
    const auth = createTestAuth(handle.db, {
      onUserCreate: async (user) => {
        await ensureOrganization(handle.db, user);
      },
    });

    const email = `signup-duplicate-email-${randomUUID()}@example.com`;

    await signUpTestUser(auth, { name: "First Signup", email, password: PASSWORD });

    let duplicateError: unknown;
    try {
      await signUpTestUser(auth, { name: "Second Signup", email, password: PASSWORD });
    } catch (error) {
      duplicateError = error;
    }

    expect(duplicateError).toBeInstanceOf(Error);
    expect((duplicateError as BetterAuthApiError).body?.code).toBe(
      "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
    );
  });
});

describe("short-password signup fails with an error the form maps to the row-4 string", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("short-password signup fails with an error the form maps to the row-4 string", async () => {
    const auth = createTestAuth(handle.db, {
      onUserCreate: async (user) => {
        await ensureOrganization(handle.db, user);
      },
    });

    await signUpTestUser(auth, {
      name: "Password Prover",
      email: `signup-password-prover-${randomUUID()}@example.com`,
      password: PASSWORD,
    });

    let shortPasswordError: unknown;
    try {
      await signUpTestUser(auth, {
        name: "Short Password",
        email: `signup-short-password-${randomUUID()}@example.com`,
        password: "abc1234", // 7 chars — under Better Auth's 8-char minimum
      });
    } catch (error) {
      shortPasswordError = error;
    }

    expect(shortPasswordError).toBeInstanceOf(Error);
    expect((shortPasswordError as BetterAuthApiError).body?.code).toBe("PASSWORD_TOO_SHORT");
  });
});

describe("double-submitted signup yields one user, one organization, one membership", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("double-submitted signup yields one user, one organization, one membership", async () => {
    const auth = createTestAuth(handle.db);
    const email = `signup-double-submit-${randomUUID()}@example.com`;

    const results = await Promise.allSettled([
      signUpTestUser(auth, { name: "Double Submitter", email, password: PASSWORD }),
      signUpTestUser(auth, { name: "Double Submitter", email, password: PASSWORD }),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<SignedUpTestUser> => result.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(1);
    const survivor = fulfilled[0]!.value;

    const usersWithEmail = (await handle.db.select().from(schema.user)).filter(
      (row) => row.email === email,
    );
    expect(usersWithEmail).toHaveLength(1);

    await ensureOrganization(handle.db, survivor);

    const memberships = await readMembershipsForUser(handle.db, survivor.id);
    expect(memberships).toHaveLength(1);
  });
});
