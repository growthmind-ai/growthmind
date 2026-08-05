// The first-run route input schemas (AD-16a), here because `apps/web` declares no `zod`
// (WIRE-Z1). Every one is `z.strictObject`: a plain `z.object` strips a tenancy key and 200s.
import { z } from "zod";

import { businessFactKindSchema } from "../growth/business";
import { STATEMENT_MAX } from "../growth/provenance";
import { surfaceRoleSchema } from "../growth/types";

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

// `.trim()` is load-bearing: a bare `.min(1)` accepts `"   "`, and the delivery guard then
// refuses that row for good while the screen says "chosen".
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

// One page at a time: a whole-list write from a stale page reverts the nightly derivation.
export const settingsPageRoleInputSchema = z.strictObject({
  surface: z.string().min(1).max(512),

  role: surfaceRoleSchema,

  // Only for a page §5 refuses, and only ever set by a person.
  changeable: z.boolean().optional(),
});
export type SettingsPageRoleInput = z.infer<typeof settingsPageRoleInputSchema>;

export const settingsSiteInputSchema = z.strictObject({
  domain: z.string().min(1).max(253),
});
export type SettingsSiteInput = z.infer<typeof settingsSiteInputSchema>;

export const settingsBusinessFactInputSchema = z
  .strictObject({
    kind: businessFactKindSchema,

    // Null adds a fact rather than replacing one. Five of the twelve kinds have no reader
    // that could ever propose them, so adding is the only way they are ever filled.
    was: z.string().min(1).max(STATEMENT_MAX).nullable(),

    // Null removes the fact named by `was`.
    statement: z.string().min(1).max(STATEMENT_MAX).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.was === null && value.statement === null) {
      ctx.addIssue({
        code: "custom",
        path: ["statement"],
        message: "an addition has to say something: there is no earlier statement to remove",
      });
    }
  });
export type SettingsBusinessFactInput = z.infer<typeof settingsBusinessFactInputSchema>;
