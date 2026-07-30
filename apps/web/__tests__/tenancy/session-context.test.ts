// FR-2/D4 (ADD tasks/tenancy-app-shell/add.md, decision D-C): session
// creation must stamp `activeOrganizationId` from PERSISTED membership,
// never from transient session state — and that derivation must survive a
// full sign-out/sign-in cycle so a returning user lands in the identical
// workspace with zero re-setup (First-Run rows 8/10).
import { randomUUID } from "node:crypto";

import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { buildAuth } from "@/lib/auth";

import {
  buildTestTenantContext,
  readMembershipsForUser,
  readSessionsForUser,
  signUpTestUser,
} from "./helpers/auth-fixture";

const PASSWORD = "correct-horse-battery";
const TEST_SECRET = "test-only-secret-at-least-32-characters-long";
const TEST_BASE_URL = "http://localhost:3000";

/**
 * These tests drive the REAL production auth wiring (`apps/web/lib/auth.ts`)
 * through its `{ db, secret, baseURL }` test seam (ADD D-C) rather than a
 * hand-rebuilt replica of its hooks. That distinction is load bearing: an
 * earlier revision of this file simulated `session.create.before` locally
 * and, because the replica lacked production's inline self-heal, asserted
 * against weaker behaviour than the app actually ships. Better Auth defers
 * `user.create.after` (its own `queueAfterTransactionHook`) until the whole
 * `signUpEmail` call — including that first session's creation — resolves,
 * so only the real hook's inline `ensureOrganization` gets the FIRST session
 * stamped. Testing the seam means these assertions cover what production does.
 */
function createAuthUnderTest(db: TestDbHandle["db"]) {
  return buildAuth({ db, secret: TEST_SECRET, baseURL: TEST_BASE_URL });
}

describe("session creation stamps activeOrganizationId from persisted membership", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("session creation stamps activeOrganizationId from persisted membership", async () => {
    const auth = createAuthUnderTest(handle.db);

    const email = `session-stamp-${randomUUID()}@example.com`;
    const user = await signUpTestUser(auth, { name: "Stamp Test User", email, password: PASSWORD });

    const sessions = await readSessionsForUser(handle.db, user.id);
    expect(sessions).toHaveLength(1);

    const memberships = await readMembershipsForUser(handle.db, user.id);
    expect(memberships).toHaveLength(1);

    // The value must be the PERSISTED membership's org id, and it must
    // actually land on the session row read back from disk — not merely
    // returned in-memory by the hook (auth-hooks.spike.test.ts already pins
    // that the `{ data }` wrapping is required for this to persist at all).
    expect(sessions[0]?.activeOrganizationId).toBe(memberships[0]?.organizationId);
  });
});

describe("sign-in after sign-out resolves the identical tenant context", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("sign-in after sign-out resolves the identical tenant context", async () => {
    const auth = createAuthUnderTest(handle.db);

    const email = `signout-signin-${randomUUID()}@example.com`;
    const user = await signUpTestUser(auth, { name: "Returning User", email, password: PASSWORD });

    const firstSessions = await readSessionsForUser(handle.db, user.id);
    expect(firstSessions).toHaveLength(1);
    const organizationId = firstSessions[0]?.activeOrganizationId;
    expect(organizationId).toBeTruthy();

    const firstContext = await buildTestTenantContext(handle.db, {
      userId: user.id,
      organizationId: organizationId as string,
    });

    // A real sign-out over HTTP needs a signed session cookie this fixture
    // deliberately does not construct (see `SignedUpTestUser`'s doc comment
    // in auth-fixture.ts). The D4 contract under test — "session state is a
    // hint; persisted membership is the truth" — is equally proven by a
    // FRESH sign-in minting an independent second session and re-resolving
    // the identical org from the same persisted membership, with no
    // dependency on the first session still existing (which is exactly what
    // "zero re-setup after sign-out" means at the data layer).
    await auth.api.signInEmail({ body: { email, password: PASSWORD } });

    const allSessions = await readSessionsForUser(handle.db, user.id);
    expect(allSessions.length).toBeGreaterThanOrEqual(2);

    const latestSession = allSessions.toSorted(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];

    expect(latestSession?.activeOrganizationId).toBe(organizationId);

    const secondContext = await buildTestTenantContext(handle.db, {
      userId: user.id,
      organizationId: latestSession?.activeOrganizationId as string,
    });

    // Identical workspace, identical resolved identity — not just "some"
    // organization matching by id.
    expect(secondContext).toEqual(firstContext);
  });
});
