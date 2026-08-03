import type { ScopedDb } from "@growthmind/db";
import { createSlackConnectionsRepo, isDeliveryTarget } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";
import { parseWebEnv } from "@growthmind/shared";

import { slackOAuthConfigured } from "@/lib/slack/oauth";

export interface SlackSettingsView {
  // Already narrowed through `isDeliveryTarget`, so a row holding "", "null" or
  // whitespace reads here as "no channel chosen" — which is what it means.
  readonly channelId: string | null;

  readonly workspaceAttached: boolean;
  readonly workspaceName: string | null;
  readonly oauthAvailable: boolean;
}

// `getActiveForOrg`, so a teammate who did not run setup sees the same
// connection and can finish it (D1/D2).
export async function readSlackSettings(
  db: ScopedDb,
  ctx: TenantContext,
): Promise<SlackSettingsView> {
  const slack = await createSlackConnectionsRepo(db, ctx).getActiveForOrg();

  return {
    channelId: slack !== null && isDeliveryTarget(slack) ? slack.channelId : null,
    workspaceAttached: slack !== null,
    workspaceName: slack?.workspaceName ?? null,
    // Parsed per call so an env captured at import time cannot outlive a redeploy.
    oauthAvailable: slackOAuthConfigured(parseWebEnv(process.env)),
  };
}
