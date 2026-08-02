import {
  ensureOrganization,
  findMembershipsByUserId,
  findUserNameById,
  schema,
  type ScopedDb,
} from "@growthmind/db";
import { logger, parseServerEnv, resolveActiveOrganization } from "@growthmind/shared";
import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import { getDb } from "./db";
import { getPostHogClient } from "./posthog-server";

type Auth = ReturnType<typeof buildAuth>;

export interface BuildAuthOptions {
  db?: ScopedDb;
  secret?: string;
  baseURL?: string;
}

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
      useSecureCookies: process.env.NODE_ENV === "production",
    },

    plugins: [
      organization({ allowUserToCreateOrganization: false, disableOrganizationDeletion: true }),
      ...(env.BETTER_AUTH_API_KEY ? [dash({ apiKey: env.BETTER_AUTH_API_KEY })] : []),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await Promise.allSettled([
              (async () => {
                const posthog = getPostHogClient();
                if (!posthog) return;

                posthog.identify({ distinctId: user.id });
                posthog.capture({
                  distinctId: user.id,
                  event: "user_signed_up",
                  properties: { auth_provider: "email" },
                });
                await posthog.flush();
              })().catch((error: unknown) => {
                logger.error("auth.databaseHooks.user.create.after: PostHog capture failed", {
                  userId: user.id,
                  error,
                });
              }),
              ensureOrganization(db, { id: user.id, name: user.name }).catch((error: unknown) => {
                logger.error("auth.databaseHooks.user.create.after: ensureOrganization failed", {
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
            let activeOrganizationId: string | null = null;

            try {
              let memberships = await findMembershipsByUserId(db, session.userId);

              if (memberships.length === 0) {
                const name = await findUserNameById(db, session.userId);
                await ensureOrganization(db, { id: session.userId, name });
                memberships = await findMembershipsByUserId(db, session.userId);
              }

              activeOrganizationId = resolveActiveOrganization(memberships, null);
            } catch (error) {
              logger.error(
                "auth.databaseHooks.session.create.before: failed to resolve activeOrganizationId",
                { userId: session.userId, error },
              );
            }

            return { data: { activeOrganizationId } };
          },
          after: async (session) => {
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
              logger.error("auth.databaseHooks.session.create.after: PostHog capture failed", {
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

const globalForAuth = globalThis as unknown as { __growthmindAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__growthmindAuth ??= buildAuth();
  return globalForAuth.__growthmindAuth;
}
