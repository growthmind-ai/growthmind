// D8 regression: `ensureOrganization` must be idempotent against the
// orphaned-org state — an organization exists under the user's deterministic
// slug (`ws-<userId>`) but the user holds NO membership row in it.
//
// This is not hypothetical. Better Auth's organization plugin is mounted in
// `apps/web/lib/auth.ts` with default config, which exposes member removal and
// self-leave under `/api/auth/organization/*`. Either action leaves exactly
// this state behind.
//
// Before the fix, the unique-violation branch re-read only *membership*, found
// none, and threw. Because the slug is derived from the user id, every retry
// collided identically — and because `/`, `/sign-in`, and `/sign-up` all
// resolve tenant context, the user got a 500 on every page, including the one
// they would have signed out from. A permanently bricked account with no
// recovery path.
//
// Found by the O-002 security audit (H-1).
import { randomUUID } from "node:crypto";

import { schema } from "@growthmind/db";
import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { ensureOrganization } from "@/lib/ensure-organization";

import { readMembershipsForUser } from "./helpers/auth-fixture";

describe("ensureOrganization recovers an organization whose membership row is missing", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("restores the missing membership instead of throwing when the slug-owning org already exists", async () => {
    const userId = `user-${randomUUID()}`;
    const createdAt = new Date();

    // The user must exist: `member.userId` is a foreign key.
    await handle.db.insert(schema.user).values({
      id: userId,
      name: "Grace Hopper",
      email: `orphaned-org-${randomUUID()}@example.com`,
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    });

    // The orphaned state: the org holds the user's deterministic slug, but no
    // membership row links them — exactly what removal or self-leave leaves.
    const organizationId = `org-${randomUUID()}`;
    await handle.db.insert(schema.organization).values({
      id: organizationId,
      name: "Grace's Workspace",
      slug: `ws-${userId}`,
      createdAt,
    });

    expect(await readMembershipsForUser(handle.db, userId)).toHaveLength(0);

    // Previously threw "unique-slug conflict … but no membership found on
    // re-read" here, permanently.
    const result = await ensureOrganization(handle.db, { id: userId, name: "Grace Hopper" });

    // Recovered into the EXISTING org — not a second one under a new id.
    expect(result.organizationId).toBe(organizationId);

    const memberships = await readMembershipsForUser(handle.db, userId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.organizationId).toBe(organizationId);
    expect(memberships[0]?.role).toBe("owner");
  });

  test("is idempotent — a second call after recovery adds no duplicate membership", async () => {
    const userId = `user-${randomUUID()}`;
    const createdAt = new Date();

    await handle.db.insert(schema.user).values({
      id: userId,
      name: "Alan Turing",
      email: `orphaned-org-idempotent-${randomUUID()}@example.com`,
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    });

    const organizationId = `org-${randomUUID()}`;
    await handle.db.insert(schema.organization).values({
      id: organizationId,
      name: "Alan's Workspace",
      slug: `ws-${userId}`,
      createdAt,
    });

    const first = await ensureOrganization(handle.db, { id: userId, name: "Alan Turing" });
    const second = await ensureOrganization(handle.db, { id: userId, name: "Alan Turing" });

    expect(second.organizationId).toBe(first.organizationId);
    expect(await readMembershipsForUser(handle.db, userId)).toHaveLength(1);
  });
});
