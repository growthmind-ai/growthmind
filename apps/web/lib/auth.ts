import { schema, type ScopedDb } from "@growthmind/db";
import { parseServerEnv, resolveActiveOrganization, type Membership } from "@growthmind/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import { getDb } from "./db";
import { ensureOrganization } from "./ensure-organization";
import { getPostHogClient } from "./posthog-server";

type Auth = ReturnType<typeof buildAuth>;

/**
 * Test seam (ADD D-C, `apps/web/lib/auth.ts` implementation row): lets a
 * caller build a Better Auth instance wired to an alternate db/secret/baseURL
 * (e.g. an in-memory PGlite db from `@growthmind/db/testing`) instead of the
 * real pooled Postgres connection. A zero-argument call keeps reading
 * config from the environment unchanged — `auth.schema.ts` (schema
 * generation) depends on exactly that continuing to work.
 */
export interface BuildAuthOptions {
  db?: ScopedDb;
  secret?: string;
  baseURL?: string;
}

type MemberRow = typeof schema.member.$inferSelect;

// apps/web deliberately has no `drizzle-orm` dependency of its own
// (repositories/queries live in `packages/db` per ADD D-A) — these lookups
// select the whole table and filter in-memory, mirroring the precedent
// already set by `apps/web/__tests__/tenancy/helpers/auth-fixture.ts`.
async function readMembershipsForUser(db: ScopedDb, userId: string): Promise<MemberRow[]> {
  const rows = await db.select().from(schema.member);
  return rows.filter((row) => row.userId === userId);
}

async function readUserName(db: ScopedDb, userId: string): Promise<string | null> {
  const rows = await db.select().from(schema.user);
  return rows.find((row) => row.id === userId)?.name ?? null;
}

/** Exported for auth.schema.ts (schema generation) — use getAuth() at runtime. */
export function buildAuth(options: BuildAuthOptions = {}) {
  const env = parseServerEnv(process.env);
  const db = options.db ?? getDb();
  const secret = options.secret ?? env.BETTER_AUTH_SECRET;
  const baseURL = options.baseURL ?? env.BETTER_AUTH_URL;

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret,
    baseURL,
    emailAndPassword: { enabled: true },
    // Org scope is wired before any org-scoped feature exists, so nothing
    // gets built user-scoped and retrofitted (docs/stack.md, Phase 2).
    plugins: [organization()],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // D8 failure isolation: PostHog identify/capture and org
            // auto-creation (ADD D-C) are independent side effects of
            // signup — one throwing must never prevent the other from
            // running, and neither may crash `signUpEmail` itself.
            // Swallowing a failed `ensureOrganization` here is safe because
            // `getTenantContext()` self-heals any user left without a
            // membership on next resolution (D8) — this hook is an
            // optimization, not the invariant.
            await Promise.allSettled([
              (async () => {
                const posthog = getPostHogClient();
                if (!posthog) return;
                posthog.identify({ distinctId: user.id, properties: { email: user.email } });
                posthog.capture({
                  distinctId: user.id,
                  event: "user_signed_up",
                  properties: { auth_provider: "email" },
                });
                await posthog.flush();
              })().catch((error: unknown) => {
                console.error("auth.databaseHooks.user.create.after: PostHog capture failed", {
                  userId: user.id,
                  error,
                });
              }),
              ensureOrganization(db, { id: user.id, name: user.name }).catch((error: unknown) => {
                console.error("auth.databaseHooks.user.create.after: ensureOrganization failed", {
                  userId: user.id,
                  error,
                });
              }),
            ]);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            // D4: reconcile `activeOrganizationId` from PERSISTED
            // membership, never from transient session state. The
            // about-to-be-created session carries no activeOrganizationId
            // of its own yet (verified empirically), so the "session hint"
            // fed to `resolveActiveOrganization` is always null here — the
            // oldest membership (or the existing valid stamp on a later
            // sign-in, re-derived the same way) wins deterministically.
            let activeOrganizationId: string | null = null;

            try {
              let memberRows = await readMembershipsForUser(db, session.userId);

              if (memberRows.length === 0) {
                // D8 self-heal, at the earliest point possible: Better
                // Auth defers `user.create.after` (its own
                // `queueAfterTransactionHook`) until the WHOLE signUpEmail
                // call — including this very session's creation — has
                // resolved, so a brand-new user's first session can reach
                // this hook before `ensureOrganization` has run even once.
                // Calling it here too (idempotent, D-C) means the FIRST
                // session gets a correct stamp instead of a null one that
                // only self-heals on the next sign-in.
                const name = await readUserName(db, session.userId);
                await ensureOrganization(db, { id: session.userId, name });
                memberRows = await readMembershipsForUser(db, session.userId);
              }

              if (memberRows.length > 0) {
                const memberships: Membership[] = memberRows.map((row) => ({
                  organizationId: row.organizationId,
                  organizationName: "",
                  role: row.role,
                  createdAt: row.createdAt,
                }));
                activeOrganizationId = resolveActiveOrganization(memberships, null);
              }
            } catch (error) {
              console.error(
                "auth.databaseHooks.session.create.before: failed to resolve activeOrganizationId",
                { userId: session.userId, error },
              );
            }

            // The real signature wraps any override in `{ data }` —
            // returning the session itself silently no-ops (pinned by
            // auth-hooks.spike.test.ts).
            return { data: { activeOrganizationId } };
          },
          after: async (session) => {
            const posthog = getPostHogClient();
            if (!posthog) return;
            posthog.capture({
              distinctId: session.userId,
              event: "user_signed_in",
              properties: { auth_provider: "email" },
            });
            await posthog.flush();
          },
        },
      },
    },
  });
}

// Lazy singleton: nothing reads the environment at module load, so
// `next build` (which imports route modules with no runtime env) never
// trips the production env validation.
const globalForAuth = globalThis as unknown as { __growthmindAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__growthmindAuth ??= buildAuth();
  return globalForAuth.__growthmindAuth;
}
