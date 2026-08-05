import { z } from "zod";

export const DEV_ENCRYPTION_KEY = "Z3Jvd3RobWluZC1kZXYtb25seS1lbmNyeXB0aW9uISE=";

// Every process needs these. Anything a single process needs belongs in that process's
// schema below, never here: a required variable no consumer reads is a variable that can
// only ever fail a boot it was not protecting.
const baseShape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  GROWTHMIND_ENCRYPTION_KEY: z.string().min(44),

  POSTHOG_HOST: z.string().min(1).optional(),
  POSTHOG_PROJECT_API_KEY: z.string().min(1).optional(),
  POSTHOG_PERSONAL_API_KEY: z.string().min(1).optional(),
  POSTHOG_PROJECT_ID: z.string().min(1).optional(),

  // A URL, unlike the credential pairs: a typo'd webhook must fail at boot, not per send.
  INTEREST_SLACK_WEBHOOK: z.url().optional(),
} as const;

const webShape = {
  ...baseShape,
  BETTER_AUTH_SECRET: z.string().min(16),
  // NO `.default()`: a schema default survives the production branch below, so an
  // omitted value booted production on localhost. Dev value in `WEB_DEV_DEFAULTS`.
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_API_KEY: z.string().min(1).optional(),

  // Who may see the unfinished surfaces. Optional, and absent means nobody — a preview
  // gate that fails open shows invented findings to a customer.
  GROWTHMIND_PREVIEW_USER_IDS: z.string().min(1).optional(),

  // Optional because self-host is first-class; both-or-neither is enforced at each
  // composition root, never here — half a credential pair must not stop a boot.
  SLACK_CLIENT_ID: z.string().min(1).optional(),
  SLACK_CLIENT_SECRET: z.string().min(1).optional(),
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
} as const;

const workerShape = {
  ...baseShape,
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  GROWTHMIND_COLDSTART_MODEL: z.string().min(1).optional(),
} as const;

export const baseEnvSchema = z.object(baseShape);
export const webEnvSchema = z.object(webShape);
export const workerEnvSchema = z.object(workerShape);

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function interestPingConfigured(env: BaseEnv): boolean {
  return env.INTEREST_SLACK_WEBHOOK !== undefined;
}

// The ONLY place a fallback belongs: production withholds these and the literal-rejection
// loop walks them, and a schema `.default()` joins neither.
const BASE_DEV_DEFAULTS = {
  DATABASE_URL: "postgres://growthmind:growthmind@localhost:5432/growthmind",
  GROWTHMIND_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY,
} as const;

const WEB_DEV_DEFAULTS = {
  ...BASE_DEV_DEFAULTS,
  BETTER_AUTH_SECRET: "dev-only-secret-change-me-32-chars!",
  BETTER_AUTH_URL: "http://localhost:3000",
} as const;

const WORKER_DEV_DEFAULTS = BASE_DEV_DEFAULTS;

function parseWith<Schema extends z.ZodType>(
  schema: Schema,
  devDefaults: Record<string, string>,
  source: Record<string, string | undefined>,
): z.infer<Schema> {
  const isProduction = source.NODE_ENV === "production";
  const merged = isProduction ? source : { ...devDefaults, ...withoutUndefined(source) };

  const allowInsecureDefaults = source.GROWTHMIND_ALLOW_INSECURE_DEFAULTS === "1";

  if (isProduction && !allowInsecureDefaults) {
    for (const [key, devValue] of Object.entries(devDefaults)) {
      if (source[key] === devValue) {
        throw new Error(
          `Invalid environment: ${key} is still set to the public example value from .env.example. ` +
            `Set a real one before running in production (BETTER_AUTH_SECRET and GROWTHMIND_ENCRYPTION_KEY: openssl rand -base64 32; ` +
            `DATABASE_URL and BETTER_AUTH_URL: the addresses this deployment actually uses). ` +
            `The quickstart docker-compose stack sets GROWTHMIND_ALLOW_INSECURE_DEFAULTS=1 to bypass this for local demos only.`,
        );
      }
    }
  }

  const result = schema.safeParse(merged);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${problems}`);
  }
  return result.data;
}

export function parseBaseEnv(source: Record<string, string | undefined>): BaseEnv {
  return parseWith(baseEnvSchema, BASE_DEV_DEFAULTS, source);
}

export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  return parseWith(webEnvSchema, WEB_DEV_DEFAULTS, source);
}

export function parseWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  return parseWith(workerEnvSchema, WORKER_DEV_DEFAULTS, source);
}

function withoutUndefined(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
