import { z } from "zod";

/**
 * Server-side environment, validated once at the edge of each process (web server,
 * worker) instead of `process.env.X` reads scattered through the code.
 *
 * Outside production every variable has a working local default, so a fresh clone runs
 * with no.env file, the same defaults docker-compose.yml bakes in. In production there
 * are no fallbacks: a missing variable fails loudly at startup rather than quietly
 * running against localhost.
 */
/**
 * The published dev-only credential-encryption key. Base64 of 32 bytes, so it is a
 * structurally valid AES-256 key and `docker compose up` from a clean clone needs
 * no.env, the same self-host promise BETTER_AUTH_SECRET's dev default keeps.
 *
 * It is published, so it is worthless as a secret. `resolveCredentialKey`
 * (src/crypto/credential-key.ts) refuses it in production at the *encryption call
 * site*. A second check that GROWTHMIND_ALLOW_INSECURE_DEFAULTS cannot open, because
 * the blast radius of this key is a third party's PostHog account rather than this
 * deployment's own sessions.
 */
export const DEV_ENCRYPTION_KEY = "Z3Jvd3RobWluZC1kZXYtb25seS1lbmNyeXB0aW9uISE=";

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  /**
   * Better Auth Infrastructure (dash.better-auth.com) API key. Optional by design: the
   * hosted dashboard is an operator convenience for this deployment, never a dependency
   * of the product. Absent (the clean-clone and `docker compose up` case) the dash
   * plugin is simply not registered (apps/web/lib/auth.ts), and auth behaves
   * identically.
   */
  BETTER_AUTH_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /**
   * Model selection is config, never a hardcoded id. Validated-if-present only, the
   * worker composition root branches on `ANTHROPIC_API_KEY` being absent (no key -> no
   * provider, no port passed to the lane), and this variable never widens that branch
   * on its own. A default lives beside the adapter's constants, not here; the resolved
   * id lands on the run row.
   */
  GROWTHMIND_COLDSTART_MODEL: z.string().min(1).optional(),
  /**
   * Base64 of 32 random bytes (44 chars). The AES-256-GCM key wrapping every stored
   * third-party credential. Required, with a dev default below, exactly like
   * BETTER_AUTH_SECRET.
   */
  GROWTHMIND_ENCRYPTION_KEY: z.string().min(44),
  /**
   * Validated-if-present, never read by the adapter. Customer credentials come
   * exclusively from `project_connections`. Reading a global env key would be a
   * single-tenant design in a multi-tenant product. These exist so local tooling and
   * scripts/spikes/* get the same validation the app gets, and so a self-hoster with no
   * PostHog boots cleanly (OQ-4 graceful absence).
   */
  POSTHOG_HOST: z.string().min(1).optional(),
  POSTHOG_PROJECT_API_KEY: z.string().min(1).optional(),
  POSTHOG_PERSONAL_API_KEY: z.string().min(1).optional(),
  POSTHOG_PROJECT_ID: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const DEV_DEFAULTS = {
  DATABASE_URL: "postgres://growthmind:growthmind@localhost:5432/growthmind",
  BETTER_AUTH_SECRET: "dev-only-secret-change-me-32-chars!",
  GROWTHMIND_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY,
} as const;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const isProduction = source.NODE_ENV === "production";
  const merged = isProduction ? source : { ...DEV_DEFAULTS, ...withoutUndefined(source) };

  // Withholding the dev defaults in production is not enough on its own: the documented
  // setup is `cp.env.example.env`, and.env.example necessarily ships a literal secret
  // so local dev works. Copy it, run the production compose profile, and the variable
  // IS set. The guard above passes while the app signs sessions with a secret published
  // in a public repo. Anyone could forge a session cookie for any user in any org. So
  // reject the known literals by value, not merely by absence. The quickstart compose
  // stack opts in explicitly (GROWTHMIND_ALLOW_INSECURE_DEFAULTS) so `docker compose
  // up` from a clean clone still reaches a working app with no.env. The self-host
  // promise CI enforces. Deleting that line from a real deployment is what turns this
  // guard back on.
  const allowInsecureDefaults = source.GROWTHMIND_ALLOW_INSECURE_DEFAULTS === "1";

  if (isProduction && !allowInsecureDefaults) {
    for (const [key, devValue] of Object.entries(DEV_DEFAULTS)) {
      if (source[key] === devValue) {
        throw new Error(
          `Invalid environment: ${key} is still set to the public example value from .env.example. ` +
            `Generate a real one (BETTER_AUTH_SECRET and GROWTHMIND_ENCRYPTION_KEY: openssl rand -base64 32) before running in production. ` +
            `The quickstart docker-compose stack sets GROWTHMIND_ALLOW_INSECURE_DEFAULTS=1 to bypass this for local demos only.`,
        );
      }
    }
  }

  const result = serverEnvSchema.safeParse(merged);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${problems}`);
  }
  return result.data;
}

/** A key set to undefined would otherwise shadow a default during spread. */
function withoutUndefined(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
