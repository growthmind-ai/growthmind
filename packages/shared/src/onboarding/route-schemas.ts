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

export const firstRunSlackConnectInputSchema = z.strictObject({
  botToken: z.string().min(1),

  channelId: z.string().min(1),
});
export type FirstRunSlackConnectInput = z.infer<typeof firstRunSlackConnectInputSchema>;

export const firstRunSlackOAuthStartInputSchema = z.strictObject({});

export const firstRunSlackOAuthCallbackInputSchema = z.strictObject({});

export const firstRunSlackChannelsInputSchema = z.strictObject({});

export const firstRunSlackChannelInputSchema = z.strictObject({
  // `.trim()` is load-bearing: a bare `.min(1)` accepts `"   "`, and the delivery
  // guard then refuses that row for good while the screen says "chosen".
  channelId: z.string().trim().min(1),
});
export type FirstRunSlackChannelInput = z.infer<typeof firstRunSlackChannelInputSchema>;

export const firstRunSlackTestInputSchema = z.strictObject({});

export const firstRunSlackSkipInputSchema = z.strictObject({});

export const firstRunArmInputSchema = z.strictObject({});

export const firstRunDismissInputSchema = z.strictObject({});
