import { randomUUID } from "node:crypto";

import { ensureOrganization, schema } from "@growthmind/db";
import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

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

    await handle.db.insert(schema.user).values({
      id: userId,
      name: "Grace Hopper",
      email: `orphaned-org-${randomUUID()}@example.com`,
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    });

    const organizationId = `org-${randomUUID()}`;
    await handle.db.insert(schema.organization).values({
      id: organizationId,
      name: "Grace's Workspace",
      slug: `ws-${userId}`,
      createdAt,
    });

    expect(await readMembershipsForUser(handle.db, userId)).toHaveLength(0);

    const result = await ensureOrganization(handle.db, { id: userId, name: "Grace Hopper" });

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
