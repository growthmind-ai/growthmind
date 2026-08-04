import type { ScopedDb } from "@growthmind/db";
import { createSlackConnectionsRepo, describeDriverError, isDeliveryTarget } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";
import { channelLabel, logger, parseWebEnv } from "@growthmind/shared";

import { slackOAuthConfigured } from "@/lib/slack/oauth";

export interface SlackSettingsView {
  // Narrowed through `isDeliveryTarget`, so a sentinel row reads as no address.
  readonly channelId: string | null;

  readonly channelLabel: string | null;

  readonly workspaceAttached: boolean;
  readonly workspaceName: string | null;
  readonly oauthAvailable: boolean;
}

// Org-scoped, so a teammate who did not run setup can finish the connection.
// An unreadable row degrades to "nothing attached" rather than throwing: there is
// no error boundary under `app/`, and this page is the only way to attach one.
export async function readSlackSettings(
  db: ScopedDb,
  ctx: TenantContext,
): Promise<SlackSettingsView> {
  // Parsed per call so an env captured at import time cannot outlive a redeploy.
  const oauthAvailable = slackOAuthConfigured(parseWebEnv(process.env));

  try {
    const slack = await createSlackConnectionsRepo(db, ctx).getActiveForOrg();

    // One narrowing feeds both fields, so a sentinel row cannot read as deliverable in one.
    const address = slack !== null && isDeliveryTarget(slack) ? slack.channelId : null;

    return {
      channelId: address,
      channelLabel: slack === null || address === null ? null : channelLabel(slack),
      workspaceAttached: slack !== null,
      workspaceName: slack?.workspaceName ?? null,
      oauthAvailable,
    };
  } catch (error) {
    logger.error("settings: the Slack connection could not be read", {
      organizationId: ctx.organizationId,
      reason: describeDriverError(error),
    });

    return {
      channelId: null,
      channelLabel: null,
      workspaceAttached: false,
      workspaceName: null,
      oauthAvailable,
    };
  }
}
