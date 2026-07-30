import { z } from "zod";

/**
 * Server-side environment, validated once at the edge of each process (web
 * server, worker) instead of `process.env.X` reads scattered through the code.
 *
 * Outside production every variable has a working local default, so a fresh
 * clone runs with no .env file — the same defaults docker-compose.yml bakes
 * in. In production there are no fallbacks: a missing variable fails loudly
 * at startup rather than quietly running against localhost.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const DEV_DEFAULTS = {
  DATABASE_URL: "postgres://growthmind:growthmind@localhost:5432/growthmind",
  BETTER_AUTH_SECRET: "dev-only-secret-change-me-32-chars!",
} as const;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const isProduction = source.NODE_ENV === "production";
  const merged = isProduction ? source : { ...DEV_DEFAULTS, ...withoutUndefined(source) };

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
