// Wave 0 feasibility spike (ADD tasks/tenancy-app-shell/add.md, D-D ordering
// note): this test PINS Better Auth 1.6.25's real hook and server-API
// signatures against a PGlite-backed instance, before D-C/D-E are built for
// real in waves 6-7. It constructs its own directly-built Better Auth
// instance (never the apps/web lazy singleton in lib/auth.ts, which this
// task must not modify) so the assertions below are proof of the library's
// behavior, not of our own future glue code.
import { randomUUID } from "node:crypto";

import { schema } from "@growthmind/db";
import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

// apps/web does not depend on drizzle-orm directly (repositories/queries
// live in packages/db per D-A) — filtering in-memory below avoids adding a
// dependency just for this spike's assertions.

// A session created through the real signUpEmail path (autoSignIn defaults
// to true) so we can inspect what databaseHooks actually receive and
// persist, without depending on ensureOrganization/getTenantContext (wave
// 6-7 work, not built yet).
describe("better-auth hooks and server member API match the signatures this ADD assumes", () => {
  let handle: TestDbHandle;
  let auth: ReturnType<typeof buildTestAuth>;

  // Captured by databaseHooks.user.create.after — proves what shape the
  // hook actually receives (assumption behind D-C's ensureOrganization
  // trigger).
  let capturedUser: { id: string; email: string; name: string } | undefined;

  // D-C assumes databaseHooks.session.create.before can stamp
  // activeOrganizationId by returning a modified session object. The real
  // signature returns `{ data: Partial<Session> }`, not the raw session —
  // this constant proves whatever `data` we return actually lands in the
  // row Better Auth persists.
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
              // Real signature (@better-auth/core init-options.ts):
              // `Promise<boolean | void | { data: Optional<Session> & Record<string, any> }>`.
              // Returning the session itself (as the ADD's prose loosely
              // suggested) would NOT work — it must be wrapped in `data`.
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
    // --- 2: signUpEmail succeeds through the real Better Auth API surface ---
    const signUpResult = await auth.api.signUpEmail({
      body: { name: "Ada Lovelace", email: "ada@example.com", password: "correct-horse-battery" },
    });
    expect(signUpResult.user).toBeTruthy();

    // --- 3: user.create.after receives the real created user shape ---
    expect(capturedUser).toBeDefined();
    expect(capturedUser?.id).toBe(signUpResult.user.id);
    expect(capturedUser?.email).toBe("ada@example.com");
    expect(capturedUser?.name).toBe("Ada Lovelace");

    // --- 4: session.create.before's `{ data }` return actually persists ---
    // signUpEmail's response is `{ token, user }` — it does not echo back
    // the session row, so we read the persisted row directly to prove the
    // hook's returned override landed on disk, not just in-memory.
    const allSessions = await handle.db.select().from(schema.session);
    const persistedSessions = allSessions.filter((s) => s.userId === signUpResult.user.id);
    expect(persistedSessions).toHaveLength(1);
    expect(persistedSessions[0]?.activeOrganizationId).toBe(STAMPED_ORG_ID);

    // --- 5: probe auth.api.addMember (D-E) ---
    // Confirmed present on 1.6.25 (better-auth/dist/plugins/organization/organization.mjs):
    // exported as a server-only endpoint — "callable as `auth.api.addMember`
    // from trusted server code... not registered as an HTTP route and has
    // no client method, so it runs no session or permission check of its
    // own; the caller is responsible for authorizing the request."
    // Body shape: { userId, role, organizationId?, teamId? }.
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

    // D-E's fallback question: does Better Auth itself enforce D3
    // (duplicate add -> one membership), or must our service edge wrap it
    // with ensure-style idempotency? Answer: Better Auth enforces it itself
    // by THROWING on a duplicate (crud-members.mjs: adapter.findMemberByEmail
    // check -> APIError "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION") — it
    // does NOT silently return the existing membership. D-E's own text
    // anticipates exactly this: "if Better Auth does not enforce this itself,
    // ensure-style idempotency wraps the call at our service edge" — Better
    // Auth DOES enforce it, but via a throw, so wave 6-7's member-addition
    // service must catch that specific error and treat it as the idempotent
    // success case, never assume a silent no-op.
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
