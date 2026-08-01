import {
  ensureOrganization,
  findMembershipsByUserId,
  findUserNameById,
  schema,
  type ScopedDb,
} from "@growthmind/db";
import { parseServerEnv, resolveActiveOrganization } from "@growthmind/shared";
import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import { getDb } from "./db";
import { getPostHogClient } from "./posthog-server";

type Auth = ReturnType<typeof buildAuth>;

/**
 * Test seam (`apps/web/lib/auth.ts` implementation row): lets a caller build a Better
 * Auth instance wired to an alternate db/secret/baseURL (e.g. an in-memory PGlite db
 * from `@growthmind/db/testing`) instead of the real pooled Postgres connection. A
 * zero-argument call keeps reading config from the environment unchanged,
 * `auth.schema.ts` (schema generation) depends on exactly that continuing to work.
 */
export interface BuildAuthOptions {
  db?: ScopedDb;
  secret?: string;
  baseURL?: string;
}

/** Exported for auth.schema.ts (schema generation). Use getAuth at runtime. */
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
    advanced: {
      // Derived from baseURL by default, which is `http://localhost:3000` in the
      // shipped compose profile, so a self-hoster who terminates TLS at a proxy without
      // overriding BETTER_AUTH_URL would get session cookies with no Secure flag. Pin
      // it to the runtime instead of the URL.
      useSecureCookies: process.env.NODE_ENV === "production",
    },
    // Org scope is wired before any org-scoped feature exists, so nothing gets built
    // user-scoped and retrofitted (docs/stack.md, Phase 2). Each user gets exactly one
    // auto-created workspace; there is no multi-workspace UX and no product decision
    // calling for one. Leaving creation open would expose unbounded org creation with
    // user-chosen slugs on an endpoint no test covers. Deletion is disabled because
    // `projects` and `write_keys` FK the org with `onDelete: cascade`. A single POST to
    // /organization/delete would silently destroy every project and write key in the
    // org, with no confirmation surface anywhere in the product and no way back. The
    // dash plugin (dash.better-auth.com) is registered only when this deployment has an
    // API key. It serves /api/auth/dash/config, which the hosted dashboard calls to
    // verify ownership of the base URL, without it the connect step fails with
    // DASH_VALIDATE_NOT_FOUND. Keeping it conditional means a clean clone, CI, and
    // every self-hoster get an auth config with no external SaaS dependency, and the
    // generated Drizzle schema is identical either way (activityTracking defaults to
    // false, so no `lastActiveAt` column is added. Do not enable it without
    // regenerating packages/db/src/schema/auth.ts).
    plugins: [
      organization({ allowUserToCreateOrganization: false, disableOrganizationDeletion: true }),
      ...(env.BETTER_AUTH_API_KEY ? [dash({ apiKey: env.BETTER_AUTH_API_KEY })] : []),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // failure isolation: PostHog identify/capture and org auto-creation are
            // independent side effects of signup, one throwing must never prevent the
            // other from running, and neither may crash `signUpEmail` itself.
            // Swallowing a failed `ensureOrganization` here is safe because
            // `getTenantContext` self-heals any user left without a membership on
            // next resolution. This hook is an optimization, not the invariant.
            await Promise.allSettled([
              (async () => {
                const posthog = getPostHogClient();
                if (!posthog) return;
                // The user id is an opaque identifier; the email is PII and is
                // deliberately not sent. Growthmind's own events discipline (product
                // decisions –) keeps PII out of event streams. Shipping every signup
                // email to a third party on install, with no opt-out, would violate the
                // rule the product sells.
                posthog.identify({ distinctId: user.id });
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
            // Reconcile `activeOrganizationId` from persisted membership, never from
            // transient session state. The about-to-be-created session carries no
            // activeOrganizationId of its own yet (verified empirically), so the
            // "session hint" fed to `resolveActiveOrganization` is always null here.
            // The oldest membership (or the existing valid stamp on a later sign-in,
            // re-derived the same way) wins deterministically.
            let activeOrganizationId: string | null = null;

            try {
              let memberships = await findMembershipsByUserId(db, session.userId);

              if (memberships.length === 0) {
                // self-heal, at the earliest point possible: Better Auth defers
                // `user.create.after` (its own `queueAfterTransactionHook`) until the
                // whole signUpEmail call (including this very session's creation) has
                // resolved, so a brand-new user's first session can reach this hook
                // before `ensureOrganization` has run even once. Calling it here too
                // (idempotent) means the first session gets a correct stamp instead
                // of a null one that only self-heals on the next sign-in.
                const name = await findUserNameById(db, session.userId);
                await ensureOrganization(db, { id: session.userId, name });
                memberships = await findMembershipsByUserId(db, session.userId);
              }

              // Resolves to null on an empty list, which is exactly the stamp a user
              // with no memberships should get.
              activeOrganizationId = resolveActiveOrganization(memberships, null);
            } catch (error) {
              console.error(
                "auth.databaseHooks.session.create.before: failed to resolve activeOrganizationId",
                { userId: session.userId, error },
              );
            }

            // The real signature wraps any override in `{ data }`. Returning the
            // session itself silently no-ops (pinned by auth-hooks.spike.test.ts).
            return { data: { activeOrganizationId } };
          },
          after: async (session) => {
            // Analytics must never be able to fail the request that triggered it.
            // `flush` rethrows on network failure, and Better Auth awaits after-hooks
            // in a bare loop with no error handling, so an unreachable PostHog host
            // propagated straight out of the endpoint. With `flushAt: 1, flushInterval:
            // 0` every auth event blocks on a synchronous round trip, so a PostHog
            // outage hung both signup and sign-in for ~36s (3 retries) and then 500'd
            // them, despite the user, org, membership and session having committed
            // correctly. The sibling `user.create.after` hook was already isolated this
            // way; this one was not.
            try {
              const posthog = getPostHogClient();
              if (!posthog) return;
              posthog.capture({
                distinctId: session.userId,
                event: "user_signed_in",
                properties: { auth_provider: "email" },
              });
              await posthog.flush();
            } catch (error) {
              console.error("auth.databaseHooks.session.create.after: PostHog capture failed", {
                userId: session.userId,
                error,
              });
            }
          },
        },
      },
    },
  });
}

// Lazy singleton: nothing reads the environment at module load, so `next build` (which
// imports route modules with no runtime env) never trips the production env validation.
const globalForAuth = globalThis as unknown as { __growthmindAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__growthmindAuth ??= buildAuth();
  return globalForAuth.__growthmindAuth;
}
