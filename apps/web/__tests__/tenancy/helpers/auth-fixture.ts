// Shared Better-Auth-over-PGlite test fixture (ADD tasks/tenancy-app-shell/add.md,
// decisions D-C/D-D/D-E). Built once so the parallel apps/web integration
// suites (signup-org, session-context, member-addition, cross-tenant,
// redirects) share one working harness instead of each reinventing it.
// Extracted and generalized from the proven, passing
// `auth-hooks.spike.test.ts`.
//
// This file constructs its OWN directly-built Better Auth instance — never
// the `apps/web` lazy singleton in `lib/auth.ts` (a later wave owns that
// file; it has existing PostHog hooks this fixture must not disturb).
import { randomUUID } from "node:crypto";

import { schema } from "@growthmind/db";
import { createTestDb, type TestDb, type TestDbHandle } from "@growthmind/db/testing";
import { tenantContextSchema, type TenantContext } from "@growthmind/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

// Fixed, deterministic test-only secret/baseURL — mirrors auth-hooks.spike.test.ts.
const TEST_SECRET = "test-only-secret-at-least-32-characters-long";
const TEST_BASE_URL = "http://localhost:3000";

/**
 * Callbacks a suite can inject into the two `databaseHooks` entries D-C
 * wires in production (`apps/web/lib/auth.ts`, a later wave): `user.create.after`
 * (the org auto-creation trigger) and `session.create.before`
 * (`activeOrganizationId` stamping). Omitting a hook is a first-class
 * fixture state, not an oversight — it simulates that hook NOT firing, which
 * is exactly the state the self-heal-path suite (D8) needs to construct.
 */
export interface TestAuthHooks {
  onUserCreate?: (user: { id: string; email: string; name: string }) => void | Promise<void>;
  onSessionCreateBefore?: (session: { userId: string }) =>
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
            // The real signature wraps any override in `{ data }` —
            // returning the session itself silently no-ops (pinned by
            // auth-hooks.spike.test.ts).
            return { data: result };
          },
        },
      },
    },
  });
}

/** The Better Auth instance type this fixture builds. Every helper below is
 * parameterized against this one concrete shape rather than each re-deriving
 * `ReturnType<typeof betterAuth>` independently. */
export type TestAuth = ReturnType<typeof buildTestAuth>;

/**
 * Builds a Better Auth instance over a caller-supplied PGlite db (typically
 * from `createTestDb()`). Use this directly when a suite needs several
 * repositories/auth instances sharing one db — e.g. the cross-tenant fixture,
 * which signs up users into two different organizations against one db.
 */
export function createTestAuth(db: TestDb, hooks?: TestAuthHooks): TestAuth {
  return buildTestAuth(db, hooks);
}

export interface AuthTestContext {
  auth: TestAuth;
  db: TestDb;
  close: TestDbHandle["close"];
}

/**
 * One-liner setup for suites that only need a single db + single auth
 * instance: boots a fresh PGlite db, builds Better Auth over it, and hands
 * back both plus a `close()`. Equivalent to `createTestDb()` followed by
 * `createTestAuth(db)` for suites that don't need to share the db across
 * multiple auth instances.
 */
export async function setupAuthTest(hooks?: TestAuthHooks): Promise<AuthTestContext> {
  const handle = await createTestDb();
  return { auth: createTestAuth(handle.db, hooks), db: handle.db, close: handle.close };
}

// --- Sign up -------------------------------------------------------------

type SignUpEmailBody = NonNullable<Parameters<TestAuth["api"]["signUpEmail"]>[0]>["body"];

export interface SignedUpTestUser {
  id: string;
  email: string;
  name: string;
  /**
   * The token Better Auth's `signUpEmail` response carries when
   * `emailAndPassword.autoSignIn` fires (the default — proven by
   * auth-hooks.spike.test.ts). A suite that needs to simulate an
   * authenticated call has the raw token here; this fixture does NOT prove
   * a header/cookie encoding for it — derive that yourself if a suite needs
   * a real authenticated `fetch`/`getSession` round-trip.
   */
  token: string | null;
}

/**
 * Wraps `auth.api.signUpEmail` — the real product path FR-1/FR-9 require.
 * Returns a minimal, stable shape (not Better Auth's raw response) so
 * suites assert against a fixed contract regardless of plugin-added fields.
 */
/**
 * Structural minimum these helpers need, rather than the nominal `TestAuth`.
 * Suites may pass EITHER the fixture's own instance or the real production
 * one built through `buildAuth`'s `{ db, secret, baseURL }` test seam — those
 * are structurally identical but distinct generic instantiations, so a
 * nominal parameter type would reject the production instance and push suites
 * back toward asserting against a replica of the app instead of the app.
 */
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

// --- Member addition (D-E: Better Auth's real server-side organization API,
// never a raw `member`-row insert — FR-9) ---------------------------------

type AddMemberBody = NonNullable<Parameters<TestAuth["api"]["addMember"]>[0]>["body"];
type AddMemberResult = Awaited<ReturnType<TestAuth["api"]["addMember"]>>;

/**
 * Wraps `auth.api.addMember` verbatim — deliberately no try/catch. A
 * duplicate add THROWS `APIError`
 * (`USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`), per
 * auth-hooks.spike.test.ts; whether our own service edge swallows that as
 * idempotent success is an implementation-wave decision (D-E), so this
 * helper surfaces the throw for the member-addition suite to assert on
 * directly rather than hiding it here.
 */
/** Structural minimum — see `SignUpCapableAuth` for why this is not nominal. */
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

// --- Reading back persisted rows -----------------------------------------

export type OrganizationRow = typeof schema.organization.$inferSelect;
export type MemberRow = typeof schema.member.$inferSelect;
export type SessionRow = typeof schema.session.$inferSelect;

// apps/web deliberately has no drizzle-orm dependency of its own (see
// auth-hooks.spike.test.ts's header comment) — filtering in-memory here
// mirrors that precedent instead of adding one just for test helpers.

/** Every `member` row for a user, across every organization. */
export async function readMembershipsForUser(db: TestDb, userId: string): Promise<MemberRow[]> {
  const rows = await db.select().from(schema.member);
  return rows.filter((row) => row.userId === userId);
}

/** The `organization` row for an id, or `undefined` if none exists. */
export async function readOrganizationById(
  db: TestDb,
  organizationId: string,
): Promise<OrganizationRow | undefined> {
  const rows = await db.select().from(schema.organization);
  return rows.find((row) => row.id === organizationId);
}

/** Every `session` row for a user. */
export async function readSessionsForUser(db: TestDb, userId: string): Promise<SessionRow[]> {
  const rows = await db.select().from(schema.session);
  return rows.filter((row) => row.userId === userId);
}

// --- TenantContext construction (so a suite can build org-scoped
// repositories from @growthmind/db against a signed-up user) --------------

/**
 * Reads back the persisted organization + membership row for
 * `(userId, organizationId)` and assembles a real `TenantContext` — the
 * only input `createXRepo(db, ctx)` factories in `@growthmind/db` accept
 * (ADD D-B). Throws if the membership doesn't exist: unlike
 * `deriveTenantContext`'s "no memberships yet" case, a caller here supplies
 * both ids explicitly, so a missing row means the test's own setup is wrong,
 * not a legitimate empty state to model.
 */
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

// --- Organization bootstrap for fixtures that run ahead of `ensureOrganization`
// --------------------------------------------------------------------------

/**
 * Creates an organization + owner membership directly, bypassing
 * `ensureOrganization` (still an unimplemented D-C stub at Wave 0). This is
 * fixture setup ONLY — production org auto-creation is `ensureOrganization`
 * (`apps/web/lib/ensure-organization.ts`), not this helper. A suite testing
 * `ensureOrganization` itself (or the self-heal path) must call the real
 * function, not this one.
 */
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
