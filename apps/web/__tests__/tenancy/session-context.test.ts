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

    expect(secondContext).toEqual(firstContext);
  });
});
