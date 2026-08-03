import type { WebEnv } from "@growthmind/shared";

export const SOCIAL_PROVIDERS = ["google", "github"] as const;

export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number];

export interface SocialProviderCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

// Not `WebEnv`: requiring the whole schema here demanded DATABASE_URL during the
// build, where there is no database. `WebEnv` still satisfies this shape.
export type SocialCredentialsSource = {
  readonly [key: string]: string | undefined;
};

const CREDENTIAL_KEYS = {
  google: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
  github: { id: "GITHUB_CLIENT_ID", secret: "GITHUB_CLIENT_SECRET" },
} as const satisfies Record<SocialProviderId, { id: keyof WebEnv; secret: keyof WebEnv }>;

// `KEY=` arrives as the empty string, not as absent, and the web schema refuses
// that at boot — this read has to agree.
const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

export const SOCIAL_PROVIDER_LABELS = {
  google: "Google",
  github: "GitHub",
} as const satisfies Record<SocialProviderId, string>;

// One half alone renders a button whose consent-screen callback cannot complete.
export function resolveSocialCredentials(
  env: SocialCredentialsSource,
  provider: SocialProviderId,
): SocialProviderCredentials | null {
  const keys = CREDENTIAL_KEYS[provider];
  const clientId = env[keys.id];
  const clientSecret = env[keys.secret];

  if (!present(clientId) || !present(clientSecret)) return null;

  return { clientId, clientSecret };
}

export function configuredSocialProviders(
  env: SocialCredentialsSource,
): readonly SocialProviderId[] {
  return SOCIAL_PROVIDERS.filter((provider) => resolveSocialCredentials(env, provider) !== null);
}

export function socialProvidersConfig(
  env: SocialCredentialsSource,
): Partial<Record<SocialProviderId, SocialProviderCredentials>> {
  const config: Partial<Record<SocialProviderId, SocialProviderCredentials>> = {};

  for (const provider of SOCIAL_PROVIDERS) {
    const credentials = resolveSocialCredentials(env, provider);
    if (credentials !== null) config[provider] = credentials;
  }

  return config;
}

// Better Auth writes "credential" for the email-and-password path; every other
// value is the provider's own id.
export function authProviderLabel(providerId: string | null): string {
  if (providerId === null) return "unknown";
  if (providerId === "credential") return "email";
  return (SOCIAL_PROVIDERS as readonly string[]).includes(providerId) ? providerId : "unknown";
}
