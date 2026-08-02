import { randomUUID } from "node:crypto";

import { ensureOrganization } from "@growthmind/db";
import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  addTestMember,
  createTestAuth,
  readMembershipsForUser,
  signUpTestUser,
} from "./helpers/auth-fixture";

const PASSWORD = "correct-horse-battery";

describe("a second user added through Better Auth machinery becomes a member of the existing organization", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("a second user added through Better Auth machinery becomes a member of the existing organization", async () => {
    const auth = createTestAuth(handle.db, {
      onUserCreate: async (user) => {
        await ensureOrganization(handle.db, user);
      },
    });

    const ownerEmail = `member-add-owner-${randomUUID()}@example.com`;
    const owner = await signUpTestUser(auth, {
      name: "Owner User",
      email: ownerEmail,
      password: PASSWORD,
    });

    const ownerMemberships = await readMembershipsForUser(handle.db, owner.id);
    expect(ownerMemberships).toHaveLength(1);
    const organizationId = ownerMemberships[0]!.organizationId;

    const teammateEmail = `member-add-teammate-${randomUUID()}@example.com`;
    const teammate = await signUpTestUser(auth, {
      name: "Teammate User",
      email: teammateEmail,
      password: PASSWORD,
    });

    const addedMember = await addTestMember(auth, {
      organizationId,
      userId: teammate.id,
      role: "member",
    });
    expect(addedMember?.organizationId).toBe(organizationId);
    expect(addedMember?.userId).toBe(teammate.id);

    const teammateMemberships = await readMembershipsForUser(handle.db, teammate.id);
    expect(
      teammateMemberships.some(
        (row) => row.organizationId === organizationId && row.role === "member",
      ),
    ).toBe(true);
  });
});

describe("adding the same member twice yields exactly one membership", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("adding the same member twice yields exactly one membership", async () => {
    const auth = createTestAuth(handle.db, {
      onUserCreate: async (user) => {
        await ensureOrganization(handle.db, user);
      },
    });

    const ownerEmail = `member-dup-owner-${randomUUID()}@example.com`;
    const owner = await signUpTestUser(auth, {
      name: "Owner User",
      email: ownerEmail,
      password: PASSWORD,
    });

    const ownerMemberships = await readMembershipsForUser(handle.db, owner.id);
    expect(ownerMemberships).toHaveLength(1);
    const organizationId = ownerMemberships[0]!.organizationId;

    const teammateEmail = `member-dup-teammate-${randomUUID()}@example.com`;
    const teammate = await signUpTestUser(auth, {
      name: "Teammate User",
      email: teammateEmail,
      password: PASSWORD,
    });

    await addTestMember(auth, { organizationId, userId: teammate.id, role: "member" });

    let duplicateError: unknown;
    try {
      await addTestMember(auth, { organizationId, userId: teammate.id, role: "member" });
    } catch (error) {
      duplicateError = error;
    }

    expect((duplicateError as { body?: { code?: string } })?.body?.code).toContain(
      "ALREADY_A_MEMBER",
    );

    const teammateMemberships = await readMembershipsForUser(handle.db, teammate.id);
    const matchingOrgMemberships = teammateMemberships.filter(
      (row) => row.organizationId === organizationId,
    );
    expect(matchingOrgMemberships).toHaveLength(1);
  });
});
