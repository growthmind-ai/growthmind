import { z } from "zod";

export const PROVIDER_RAILS = ["analytics", "code", "coding-assistant"] as const;

export type ProviderRail = (typeof PROVIDER_RAILS)[number];

// Zod's enum needs a literal tuple, so the soon subset cannot be derived from
// the catalogue at the type level; providers.test.ts asserts the two homes
// agree (AD-4, W-1). `posthog` is deliberately not here: registering interest
// in a live provider is a refusal, not a no-op.
export const INTEREST_PROVIDER_IDS = [
  "github",
  "gitlab",
  "claude-code",
  "cursor",
  "copilot",
  "codex",
  "windsurf",
  "amplitude",
  "mixpanel",
  "growthmind-analytics",
] as const;

export type InterestProviderId = (typeof INTEREST_PROVIDER_IDS)[number];

export type ProviderId = InterestProviderId | "posthog";

export type ProviderDescriptor = {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly rail: ProviderRail;
  readonly live: boolean;
};

// The one compile-time home for the eleven identities (AD-4). No second
// provider list may exist anywhere.
export const PROVIDER_CATALOGUE: readonly ProviderDescriptor[] = Object.freeze([
  { id: "posthog", displayName: "PostHog", rail: "analytics", live: true },
  { id: "github", displayName: "GitHub", rail: "code", live: false },
  { id: "gitlab", displayName: "GitLab", rail: "code", live: false },
  { id: "claude-code", displayName: "Claude Code", rail: "coding-assistant", live: false },
  { id: "cursor", displayName: "Cursor", rail: "coding-assistant", live: false },
  { id: "copilot", displayName: "Copilot", rail: "coding-assistant", live: false },
  { id: "codex", displayName: "Codex", rail: "coding-assistant", live: false },
  { id: "windsurf", displayName: "Windsurf", rail: "coding-assistant", live: false },
  { id: "amplitude", displayName: "Amplitude", rail: "analytics", live: false },
  { id: "mixpanel", displayName: "Mixpanel", rail: "analytics", live: false },
  {
    id: "growthmind-analytics",
    displayName: "Growthmind AI Analytics",
    rail: "analytics",
    live: false,
  },
]);

export const interestProviderIdSchema = z.enum(INTEREST_PROVIDER_IDS);

export const firstRunInterestInputSchema = z.strictObject({
  provider: interestProviderIdSchema,
});

export type FirstRunInterestInput = z.infer<typeof firstRunInterestInputSchema>;
