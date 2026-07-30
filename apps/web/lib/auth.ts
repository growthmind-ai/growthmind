import { schema } from "@growthmind/db";
import { parseServerEnv } from "@growthmind/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import { getDb } from "./db";
import { getPostHogClient } from "./posthog-server";

type Auth = ReturnType<typeof buildAuth>;

/** Exported for auth.schema.ts (schema generation) — use getAuth() at runtime. */
export function buildAuth() {
  const env = parseServerEnv(process.env);
  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true },
    // Org scope is wired before any org-scoped feature exists, so nothing
    // gets built user-scoped and retrofitted (docs/stack.md, Phase 2).
    plugins: [organization()],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const posthog = getPostHogClient();
            if (!posthog) return;
            posthog.identify({ distinctId: user.id, properties: { email: user.email } });
            posthog.capture({
              distinctId: user.id,
              event: "user_signed_up",
              properties: { auth_provider: "email" },
            });
            await posthog.flush();
          },
        },
      },
      session: {
        create: {
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
