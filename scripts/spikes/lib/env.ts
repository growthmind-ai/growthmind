// Credential gate. Pure, this module never touches process.env; the entrypoint passes
// the env record in.

import { ENV_VARS, REQUIRED_ENV_VARS, type RequiredEnvVar } from "./constants";

/** Typed credentials returned by a passing gate. Never logged, never persisted. */
export interface Credentials {
  readonly host: string;
  readonly projectApiKey: string;
  readonly personalApiKey: string;
  readonly projectId: string;
}

export type ValidateCredentialsResult =
  | { readonly ok: true; readonly creds: Credentials }
  | { readonly ok: false; readonly missing: string[] };

/**
 * Validates the four required variables. Empty string counts as missing. `missing`
 * enumerates exactly the absent names, in REQUIRED_ENV_VARS order.
 */
export function validateCredentials(
  env: Record<string, string | undefined>,
): ValidateCredentialsResult {
  const host = env[ENV_VARS.POSTHOG_HOST];
  const projectApiKey = env[ENV_VARS.POSTHOG_PROJECT_API_KEY];
  const personalApiKey = env[ENV_VARS.POSTHOG_PERSONAL_API_KEY];
  const projectId = env[ENV_VARS.POSTHOG_PROJECT_ID];

  if (
    host === undefined ||
    host === "" ||
    projectApiKey === undefined ||
    projectApiKey === "" ||
    personalApiKey === undefined ||
    personalApiKey === "" ||
    projectId === undefined ||
    projectId === ""
  ) {
    const missing: string[] = REQUIRED_ENV_VARS.filter((name) => {
      const value = env[name];
      return value === undefined || value === "";
    });
    return { ok: false, missing };
  }

  return { ok: true, creds: { host, projectApiKey, personalApiKey, projectId } };
}

/**
 * Where each required variable comes from in PostHog. One line per variable; only the
 * lines for actually-missing variables are rendered, and always after the blank line
 * that ends the missing-names paragraph. The gate-cli enumeration check filters
 * variable names by substring within that paragraph.
 */
const VAR_GUIDANCE: Readonly<Record<RequiredEnvVar, string>> = {
  [ENV_VARS.POSTHOG_HOST]: `${ENV_VARS.POSTHOG_HOST} is your PostHog region URL — for example https://us.posthog.com (or https://eu.posthog.com for EU cloud).`,
  [ENV_VARS.POSTHOG_PROJECT_API_KEY]: `${ENV_VARS.POSTHOG_PROJECT_API_KEY} is the project API key (starts with phc_) — copy it from your PostHog project settings.`,
  [ENV_VARS.POSTHOG_PERSONAL_API_KEY]: `${ENV_VARS.POSTHOG_PERSONAL_API_KEY} is a personal API key (starts with phx_) — create one on the personal API keys page in your PostHog account settings.`,
  [ENV_VARS.POSTHOG_PROJECT_ID]: `${ENV_VARS.POSTHOG_PROJECT_ID} is the numeric project ID shown in your PostHog project settings.`,
};

function isRequiredEnvVar(name: string): name is RequiredEnvVar {
  return (REQUIRED_ENV_VARS as readonly string[]).includes(name);
}

/**
 * Renders the full plain-English error block: each missing variable by name, that it
 * belongs in `.env`, and where in PostHog it comes from. No stack traces, no key
 * material.
 *
 * Structure contract (gate-cli.test.ts reuses this formatter): the paragraph starting
 * at the first /missing/i line and ending at the next blank line names exactly the
 * missing variables; all other guidance follows the blank line.
 */
export function formatCredentialError(missing: string[]): string {
  const guidance = missing.filter(isRequiredEnvVar).map((name) => VAR_GUIDANCE[name]);

  const lines = [
    "Missing required environment variables:",
    ...missing.map((name) => `  ${name}`),
    "",
    "Add the values to your .env file in the repo root.",
    "",
    ...guidance,
    "",
    "Warning: point these credentials to a TEST PostHog project — the harness writes synthetic events into whichever project they reference.",
  ];

  return lines.join("\n");
}
