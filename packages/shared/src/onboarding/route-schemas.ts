// The first-run route input schemas (AD-16a). Here, not beside their routes,
// because `apps/web` declares no `zod` (WIRE-Z1). Every one is `z.strictObject`
// and takes no tenancy key — a plain `z.object` strips one and answers 200.
import { z } from "zod";

export const firstRunStatusInputSchema = z.strictObject({});

export const firstRunAnalyticsDiscoverInputSchema = z.strictObject({
  personalApiKey: z.string().min(1),

  host: z.string().min(1).optional(),
});
export type FirstRunAnalyticsDiscoverInput = z.infer<typeof firstRunAnalyticsDiscoverInputSchema>;

export const firstRunAnalyticsConnectInputSchema = z.strictObject({
  host: z.string().min(1),

  sourceProjectId: z.string().min(1),

  personalApiKey: z.string().min(1),
});
export type FirstRunAnalyticsConnectInput = z.infer<typeof firstRunAnalyticsConnectInputSchema>;

export const firstRunAnalyticsDisconnectInputSchema = z.strictObject({});

// `.trim()` is load-bearing: a bare `.min(1)` accepts `"   "`, and the delivery
// guard then refuses that row for good while the screen says "chosen". One home,
// because the two routes that take an address had drifted to different rules.
const channelIdField = z.string().trim().min(1);

export const firstRunSlackConnectInputSchema = z.strictObject({
  botToken: z.string().trim().min(1),
  channelId: channelIdField,
});
export type FirstRunSlackConnectInput = z.infer<typeof firstRunSlackConnectInputSchema>;

export const firstRunSlackOAuthStartInputSchema = z.strictObject({});

export const firstRunSlackOAuthCallbackInputSchema = z.strictObject({});

export const firstRunSlackChannelsInputSchema = z.strictObject({});

export const firstRunSlackChannelInputSchema = z.strictObject({
  channelId: channelIdField,
});
export type FirstRunSlackChannelInput = z.infer<typeof firstRunSlackChannelInputSchema>;

// Separate from the first-run schema: that route fills an address, this one moves it.
export const settingsSlackChannelInputSchema = z.strictObject({
  channelId: channelIdField,
});
export type SettingsSlackChannelInput = z.infer<typeof settingsSlackChannelInputSchema>;

export const firstRunSlackTestInputSchema = z.strictObject({});

export const firstRunSlackSkipInputSchema = z.strictObject({});

export const firstRunArmInputSchema = z.strictObject({});

export const firstRunDismissInputSchema = z.strictObject({});
