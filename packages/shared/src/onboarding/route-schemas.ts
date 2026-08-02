import { z } from "zod";

export const firstRunStatusInputSchema = z.strictObject({});

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

export const firstRunSlackTestInputSchema = z.strictObject({});

export const firstRunSlackSkipInputSchema = z.strictObject({});

export const firstRunArmInputSchema = z.strictObject({});

export const firstRunDismissInputSchema = z.strictObject({});
