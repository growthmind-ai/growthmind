// FR-1/D5/D6/D8 (ADD tasks/tenancy-app-shell/add.md, decision D-C): signup
// must land the user inside an auto-created organization with zero
// org-creation form steps, and no signed-in user may ever observe an
// orgless state. This file pins the `ensureOrganization` idempotent
// completion contract end to end through the REAL signup path
// (`auth.api.signUpEmail`, never a raw row insert), plus the D-I
// E2E-substitute server-side contracts for First-Run rows 3/4/5
// (duplicate email, short password, double submit).
//
// Every test below wires `onUserCreate` to the REAL (still-unimplemented)
// `ensureOrganization` (apps/web/lib/ensure-organization.ts, D-C) rather than
// the fixture's `createTestOrganization` bypass — org auto-creation on
// signup is exactly the contract under test. At Wave 0 `ensureOrganization`
// throws "not implemented", so every test below fails at that first call —
// not on a fixture or compile error — and flips green once a later wave
// implements it, with no change to this file. This mirrors the precedent
// already set by the sibling files in this directory (member-addition.test.ts,
// session-context.test.ts, redirects.test.ts).
import { randomUUID } from "node:crypto";

import { ensureOrganization, schema } from "@growthmind/db";
import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import {
  createTestAuth,
  readMembershipsForUser,
  readOrganizationById,
  signUpTestUser,
  type SignedUpTestUser,
} from "./helpers/auth-fixture";

const PASSWORD = "correct-horse-battery";

/**
 * Shape of the error better-auth's server API throws (an `APIError` from
 * `better-call`) — `.body.code` is the stable, machine-readable
 * discriminant (auth-hooks.spike.test.ts / member-addition.test.ts already
 * pin this shape for the organization-membership throw; this file pins it
 * for the email/password validation throws).
 */
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
    // No onUserCreate hook wired — isolates the D6 race to ensureOrganization
    // itself rather than racing it against the hook's own invocation.
    const auth = createTestAuth(handle.db);

    const user = await signUpTestUser(auth, {
      name: "Concurrent Racer",
      email: `signup-concurrent-race-${randomUUID()}@example.com`,
      password: PASSWORD,
    });

    // Fired concurrently (Promise.all, not sequential awaits) — D-C: the
    // race is settled by the unique constraint on organization.slug, not by
    // the membership check that ran earlier. The loser must re-read and
    // return the winner's org, never throw.
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
    // No onUserCreate hook wired — simulates the hook NOT having fired
    // (D-C's own risk: "even a hook regression cannot strand a user").
    const auth = createTestAuth(handle.db);

    const user = await signUpTestUser(auth, {
      name: "Hazel Heals",
      email: `signup-self-heal-${randomUUID()}@example.com`,
      password: PASSWORD,
    });

    const membershipsBefore = await readMembershipsForUser(handle.db, user.id);
    expect(membershipsBefore).toHaveLength(0);

    // `getTenantContext()` (@/lib/tenant.ts) composes exactly this call on
    // its self-heal branch — its own doc comment: "zero memberships ->
    // ensureOrganization self-heal -> re-derive". Driving this through the
    // real `getTenantContext()` entry point would require a signed session
    // cookie wired into the apps/web `getAuth()`/`getDb()` singletons, which
    // — per redirects.test.ts and session-context.test.ts's own documented
    // trade-off in this same directory — this fixture deliberately does not
    // construct. The self-heal CONTRACT (no orgless state survives
    // resolution) is instead pinned directly against the primitive it
    // composes.
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const healResult = await ensureOrganization(handle.db, user);

      const membershipsAfter = await readMembershipsForUser(handle.db, user.id);
      expect(membershipsAfter).toHaveLength(1);
      expect(membershipsAfter[0]?.organizationId).toBe(healResult.organizationId);

      const org = await readOrganizationById(handle.db, healResult.organizationId);
      expect(org).toBeDefined();

      // D8: failures are logged with context, never silently swallowed —
      // the self-heal trigger (a user reaching resolution with zero
      // memberships, exactly what a missed/failed hook produces) must leave
      // a trace an operator can see, never vanish silently.
      expect(errorSpy.mock.calls.length).toBeGreaterThan(0);
    } finally {
      errorSpy.mockRestore();
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

    // Whitespace-only: Better Auth's own signUpEmail validation accepts it
    // verbatim (no trimming, no rejection — pinned against the real API
    // before writing this assertion), while deriveWorkspaceName cannot
    // extract a usable first word from it (D5 neutral fallback). Never
    // empty, never "undefined's workspace".
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

    // Dedicated, deliberately-reused address — the collision IS the point
    // here (every other seeded email in this file is unique per the file's
    // own scope rule).
    const email = `signup-duplicate-email-${randomUUID()}@example.com`;

    await signUpTestUser(auth, { name: "First Signup", email, password: PASSWORD });

    let duplicateError: unknown;
    try {
      await signUpTestUser(auth, { name: "Second Signup", email, password: PASSWORD });
    } catch (error) {
      duplicateError = error;
    }

    // UI row-3 string the form maps this to: "That email is already in use
    // — sign in instead?"
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

    // Better Auth rejects a short password BEFORE the user (and therefore
    // the org auto-create hook) is ever created — pinned against the real
    // API: the hook never fires and no user row is written on that branch.
    // So a signup through this exact path never reaches ensureOrganization
    // on its own. First prove one valid signup completes through this same
    // real auth instance — that call is where this test fails at Wave 0,
    // always on "not implemented", never on a fixture error — so the
    // short-password assertion below is exercised against a genuinely
    // working signup path once ensureOrganization lands, not a
    // coincidentally-untested one.
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

    // UI row-4 string the form maps this to: "Passwords need at least 8
    // characters."
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
    // No onUserCreate hook wired for the double-submit race itself — this
    // isolates the D6 UI-double-click invariant (one user survives two
    // concurrent signUpEmail calls with the same email — Better Auth's own
    // proven behavior, pinned against the real API) from org auto-creation,
    // which is layered on afterward for the single surviving user.
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

    // One organization, one membership — the D-C completion the real
    // product path performs for that single surviving user.
    await ensureOrganization(handle.db, survivor);

    const memberships = await readMembershipsForUser(handle.db, survivor.id);
    expect(memberships).toHaveLength(1);
  });
});
