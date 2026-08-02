import { randomUUID } from "node:crypto";

import { schema } from "@growthmind/db";
import { createTestDb, type TestDb, type TestDbHandle } from "@growthmind/db/testing";
import { tenantContextSchema, type TenantContext } from "@growthmind/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

const TEST_SECRET = "test-only-secret-at-least-32-characters-long";
const TEST_BASE_URL = "http://localhost:3000";

export interface TestAuthHooks {
  onUserCreate?: (user: { id: string; email: string; name: string }) => void | Promise<void>;
  onSessionCreateBefore?: (session: {
    userId: string;
  }) =>
    | { activeOrganizationId: string | null }
    | undefined
    | Promise<{ activeOrganizationId: string | null } | undefined>;
}

function buildTestAuth(db: TestDb, hooks: TestAuthHooks = {}) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
    emailAndPassword: { enabled: true },
    plugins: [organization()],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (!hooks.onUserCreate) return;
            await hooks.onUserCreate({ id: user.id, email: user.email, name: user.name });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            if (!hooks.onSessionCreateBefore) return;
            const result = await hooks.onSessionCreateBefore({ userId: session.userId });
            if (!result) return;

            return { data: result };
          },
        },
      },
    },
  });
}

export type TestAuth = ReturnType<typeof buildTestAuth>;

export function createTestAuth(db: TestDb, hooks?: TestAuthHooks): TestAuth {
  return buildTestAuth(db, hooks);
}

export interface AuthTestContext {
  auth: TestAuth;
  db: TestDb;
  close: TestDbHandle["close"];
}

export async function setupAuthTest(hooks?: TestAuthHooks): Promise<AuthTestContext> {
  const handle = await createTestDb();
  return { auth: createTestAuth(handle.db, hooks), db: handle.db, close: handle.close };
}

type SignUpEmailBody = NonNullable<Parameters<TestAuth["api"]["signUpEmail"]>[0]>["body"];

export interface SignedUpTestUser {
  id: string;
  email: string;
  name: string;

  token: string | null;
}

export interface SignUpCapableAuth {
  api: {
    signUpEmail: (ctx: { body: SignUpEmailBody }) => Promise<{
      token: string | null;
      user: { id: string; email: string; name: string };
    }>;
  };
}

export async function signUpTestUser(
  auth: SignUpCapableAuth,
  input: SignUpEmailBody,
): Promise<SignedUpTestUser> {
  const result = await auth.api.signUpEmail({ body: input });
  return {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
    token: result.token,
  };
}

type AddMemberBody = NonNullable<Parameters<TestAuth["api"]["addMember"]>[0]>["body"];
type AddMemberResult = Awaited<ReturnType<TestAuth["api"]["addMember"]>>;

export interface AddMemberCapableAuth {
  api: {
    addMember: (ctx: { body: AddMemberBody }) => Promise<AddMemberResult>;
  };
}

export async function addTestMember(
  auth: AddMemberCapableAuth,
  input: AddMemberBody,
): Promise<AddMemberResult> {
  return auth.api.addMember({ body: input });
}

export type OrganizationRow = typeof schema.organization.$inferSelect;
export type MemberRow = typeof schema.member.$inferSelect;
export type SessionRow = typeof schema.session.$inferSelect;

export async function readMembershipsForUser(db: TestDb, userId: string): Promise<MemberRow[]> {
  const rows = await db.select().from(schema.member);
  return rows.filter((row) => row.userId === userId);
}

export async function readOrganizationById(
  db: TestDb,
  organizationId: string,
): Promise<OrganizationRow | undefined> {
  const rows = await db.select().from(schema.organization);
  return rows.find((row) => row.id === organizationId);
}

export async function readSessionsForUser(db: TestDb, userId: string): Promise<SessionRow[]> {
  const rows = await db.select().from(schema.session);
  return rows.filter((row) => row.userId === userId);
}

export async function buildTestTenantContext(
  db: TestDb,
  input: { userId: string; organizationId: string },
): Promise<TenantContext> {
  const organizationRow = await readOrganizationById(db, input.organizationId);
  if (!organizationRow) {
    throw new Error(`buildTestTenantContext: no organization row for id "${input.organizationId}"`);
  }

  const memberships = await readMembershipsForUser(db, input.userId);
  const membership = memberships.find((row) => row.organizationId === input.organizationId);
  if (!membership) {
    throw new Error(
      `buildTestTenantContext: user "${input.userId}" is not a member of organization "${input.organizationId}"`,
    );
  }

  return tenantContextSchema.parse({
    userId: input.userId,
    organizationId: input.organizationId,
    organizationName: organizationRow.name,
    role: membership.role,
  });
}

export async function createTestOrganization(
  db: TestDb,
  input: { name: string; ownerUserId: string; slug?: string },
): Promise<OrganizationRow> {
  const id = `org-${randomUUID()}`;
  const slug = input.slug ?? `org-${randomUUID()}`;
  const createdAt = new Date();

  await db.insert(schema.organization).values({ id, name: input.name, slug, createdAt });
  await db.insert(schema.member).values({
    id: `member-${randomUUID()}`,
    organizationId: id,
    userId: input.ownerUserId,
    role: "owner",
    createdAt,
  });

  const row = await readOrganizationById(db, id);
  if (!row) {
    throw new Error(`createTestOrganization: failed to read back organization "${id}"`);
  }
  return row;
}
