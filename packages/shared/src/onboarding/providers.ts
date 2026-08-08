import { z } from "zod";

import { AGENT_PROVIDER_IDS, type AgentProviderId } from "./agent-blocks";

export const PROVIDER_RAILS = ["analytics", "code", "coding-assistant", "delivery"] as const;

export type ProviderRail = (typeof PROVIDER_RAILS)[number];

// Zod's enum needs a literal tuple, so this cannot be derived from the
// catalogue; providers.test.ts asserts the two homes agree (AD-4, W-1). The
// five coding assistants stay after going live (D-8): persisted rows are typed
// by this enum, and narrowing it would make them unparseable.
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

export type ProviderId = InterestProviderId | "posthog" | "slack";

export type ProviderDescriptor = {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly rail: ProviderRail;
  readonly live: boolean;
};

// `satisfies` is what makes `providerDisplayName` total: a new `ProviderId`
// with no name here is a compile error, not a chip labelled with its own id.
const PROVIDER_DISPLAY_NAMES = {
  posthog: "PostHog",
  slack: "Slack",
  github: "GitHub",
  gitlab: "GitLab",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  copilot: "Copilot",
  codex: "Codex",
  windsurf: "Windsurf",
  amplitude: "Amplitude",
  mixpanel: "Mixpanel",
  "growthmind-analytics": "Growthmind AI Analytics",
} as const satisfies Record<ProviderId, string>;

// The one compile-time home for the twelve identities (AD-4). No second
// provider list may exist anywhere.
export const PROVIDER_CATALOGUE: readonly ProviderDescriptor[] = Object.freeze([
  { id: "posthog", displayName: PROVIDER_DISPLAY_NAMES.posthog, rail: "analytics", live: true },
  { id: "slack", displayName: PROVIDER_DISPLAY_NAMES.slack, rail: "delivery", live: true },
  { id: "github", displayName: PROVIDER_DISPLAY_NAMES.github, rail: "code", live: false },
  { id: "gitlab", displayName: PROVIDER_DISPLAY_NAMES.gitlab, rail: "code", live: false },
  {
    id: "claude-code",
    displayName: PROVIDER_DISPLAY_NAMES["claude-code"],
    rail: "coding-assistant",
    live: true,
  },
  {
    id: "cursor",
    displayName: PROVIDER_DISPLAY_NAMES.cursor,
    rail: "coding-assistant",
    live: true,
  },
  {
    id: "copilot",
    displayName: PROVIDER_DISPLAY_NAMES.copilot,
    rail: "coding-assistant",
    live: true,
  },
  { id: "codex", displayName: PROVIDER_DISPLAY_NAMES.codex, rail: "coding-assistant", live: true },
  {
    id: "windsurf",
    displayName: PROVIDER_DISPLAY_NAMES.windsurf,
    rail: "coding-assistant",
    live: true,
  },
  {
    id: "amplitude",
    displayName: PROVIDER_DISPLAY_NAMES.amplitude,
    rail: "analytics",
    live: false,
  },
  { id: "mixpanel", displayName: PROVIDER_DISPLAY_NAMES.mixpanel, rail: "analytics", live: false },
  {
    id: "growthmind-analytics",
    displayName: PROVIDER_DISPLAY_NAMES["growthmind-analytics"],
    rail: "analytics",
    live: false,
  },
]);

export function providerDisplayName(id: ProviderId): string {
  return PROVIDER_DISPLAY_NAMES[id];
}

const LIVE_PROVIDER_IDS: ReadonlySet<string> = new Set(
  PROVIDER_CATALOGUE.filter((entry) => entry.live).map((entry) => entry.id),
);

export function isLiveProvider(id: ProviderId): boolean {
  return LIVE_PROVIDER_IDS.has(id);
}

// What a rail can be connected to today. A rail with exactly one is a rail whose empty
// state can name the product it is offering rather than only saying nothing is there;
// with two or more the name is a choice, and naming one of them would presume it.
export function soleLiveProviderOn(rail: ProviderRail): ProviderDescriptor | null {
  const live = PROVIDER_CATALOGUE.filter((entry) => entry.rail === rail && entry.live);

  return live.length === 1 ? (live[0] ?? null) : null;
}

// Membership only — never the order the rows came back in (UX §3.7). An
// unrecognised id removes nobody: the result is always the five, and fails open.
export function agentProviderOrder(noted: readonly string[]): readonly AgentProviderId[] {
  const notedIds = new Set(noted);

  return [
    ...AGENT_PROVIDER_IDS.filter((id) => notedIds.has(id)),
    ...AGENT_PROVIDER_IDS.filter((id) => !notedIds.has(id)),
  ];
}

// Parses PERSISTED rows as well as input, so it carries no live-provider
// refusal: a refinement here would make a stored row for a now-live assistant
// unparseable and silently starve the read that orders the panel (D-8, D5).
export const interestProviderIdSchema = z.enum(INTEREST_PROVIDER_IDS);

export const firstRunInterestInputSchema = z
  .strictObject({
    provider: interestProviderIdSchema,
  })
  .refine(({ provider }) => !isLiveProvider(provider), {
    path: ["provider"],
    message: "that one is already connectable, so there is nothing to note",
  });

export type FirstRunInterestInput = z.infer<typeof firstRunInterestInputSchema>;
