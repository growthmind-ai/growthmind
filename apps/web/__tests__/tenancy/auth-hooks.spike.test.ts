import { randomUUID } from "node:crypto";

import { schema } from "@growthmind/db";
import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

describe("better-auth hooks and server member API match the signatures this ADD assumes", () => {
  let handle: TestDbHandle;
  let auth: ReturnType<typeof buildTestAuth>;

  let capturedUser: { id: string; email: string; name: string } | undefined;

  const STAMPED_ORG_ID = `org-${randomUUID()}`;

  function buildTestAuth(db: TestDbHandle["db"]) {
    return betterAuth({
      database: drizzleAdapter(db, { provider: "pg", schema }),
      secret: "test-only-secret-at-least-32-characters-long",
      baseURL: "http://localhost:3000",
      emailAndPassword: { enabled: true },
      plugins: [organization()],
      databaseHooks: {
        user: {
          create: {
            after: async (user) => {
              capturedUser = { id: user.id, email: user.email, name: user.name };
            },
          },
        },
        session: {
          create: {
            before: async () => {
              return { data: { activeOrganizationId: STAMPED_ORG_ID } };
            },
          },
        },
      },
    });
  }

  beforeAll(async () => {
    handle = await createTestDb();
    auth = buildTestAuth(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  test("better-auth hooks and server member API match the signatures this ADD assumes", async () => {
    const signUpResult = await auth.api.signUpEmail({
      body: { name: "Ada Lovelace", email: "ada@example.com", password: "correct-horse-battery" },
    });
    expect(signUpResult.user).toBeTruthy();

    expect(capturedUser).toBeDefined();
    expect(capturedUser?.id).toBe(signUpResult.user.id);
    expect(capturedUser?.email).toBe("ada@example.com");
    expect(capturedUser?.name).toBe("Ada Lovelace");

    const allSessions = await handle.db.select().from(schema.session);
    const persistedSessions = allSessions.filter((s) => s.userId === signUpResult.user.id);
    expect(persistedSessions).toHaveLength(1);
    expect(persistedSessions[0]?.activeOrganizationId).toBe(STAMPED_ORG_ID);

    const orgId = `org-${randomUUID()}`;
    await handle.db.insert(schema.organization).values({
      id: orgId,
      name: "Acme",
      slug: `acme-${randomUUID()}`,
      createdAt: new Date(),
    });

    const secondUser = await auth.api.signUpEmail({
      body: { name: "Grace Hopper", email: "grace@example.com", password: "correct-horse-battery" },
    });

    const addedMember = await auth.api.addMember({
      body: { userId: secondUser.user.id, role: "member", organizationId: orgId },
    });
    expect(addedMember).toBeTruthy();
    expect(addedMember?.organizationId).toBe(orgId);
    expect(addedMember?.userId).toBe(secondUser.user.id);

    await expect(
      auth.api.addMember({
        body: { userId: secondUser.user.id, role: "member", organizationId: orgId },
      }),
    ).rejects.toThrow();

    const allMembers = await handle.db.select().from(schema.member);
    const membersForOrg = allMembers.filter((m) => m.organizationId === orgId);
    expect(membersForOrg).toHaveLength(1);
  });
});
