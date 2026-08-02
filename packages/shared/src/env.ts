import { z } from "zod";

export const DEV_ENCRYPTION_KEY = "Z3Jvd3RobWluZC1kZXYtb25seS1lbmNyeXB0aW9uISE=";

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),

  BETTER_AUTH_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  GROWTHMIND_COLDSTART_MODEL: z.string().min(1).optional(),

  GROWTHMIND_ENCRYPTION_KEY: z.string().min(44),

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

function withoutUndefined(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
