import type { FetchLike } from "@growthmind/adapters";
import type { ScopedDb } from "@growthmind/db";
import type { ClaimedProviderInterest } from "@growthmind/db/system";
import { claimUnnotifiedProviderInterest, countProviderInterest } from "@growthmind/db/system";
import type { InterestProviderId, WorkerEnv } from "@growthmind/shared";
import { PROVIDER_CATALOGUE, interestPingConfigured } from "@growthmind/shared";

import { isolated, type TaskLogger } from "../task-logger";

export interface ProviderInterestTickDeps {
  db: ScopedDb;
  env: WorkerEnv;
  fetch: FetchLike;
  logger: TaskLogger;
  now: () => Date;
}

export interface ProviderInterestTickSummary {
  rowsClaimed: number;
  pingsPosted: number;
  pingsFailed: number;
}

export interface InterestPostTextInput {
  readonly orgName: string;
  readonly displayName: string;
  readonly count: number;
}

// Slack reads &, < and > as control sequences, so an org named <!channel>
// must arrive as text rather than ping the channel.
function escapeSlackText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function interestPostText(input: InterestPostTextInput): string {
  const displayName = escapeSlackText(input.displayName);
  const running =
    input.count === 1
      ? `1 workspace has asked for ${displayName}.`
      : `${input.count} workspaces have asked for ${displayName}.`;

  return `${escapeSlackText(input.orgName)} asked for ${displayName}. ${running}`;
}

export async function runProviderInterestTick(
  deps: ProviderInterestTickDeps,
): Promise<ProviderInterestTickSummary> {
  const summary: ProviderInterestTickSummary = { rowsClaimed: 0, pingsPosted: 0, pingsFailed: 0 };

  // Same predicate twice: interestPingConfigured is the shared gate (AD-1), the
  // direct check narrows the URL for the compiler. The gate runs before the
  // claim, so an unconfigured installation accumulates unnotified rows (AD-2).
  const webhookUrl = deps.env.INTEREST_SLACK_WEBHOOK;
  if (!interestPingConfigured(deps.env) || webhookUrl === undefined) {
    deps.logger.info(
      "provider interest tick: no internal Slack webhook is configured on this installation, so there is nothing to post",
    );
    return summary;
  }

  const claimed = await claimUnnotifiedProviderInterest(deps.db, deps.now());
  summary.rowsClaimed = claimed.length;

  for (const row of claimed) {
    // The stamp stays on a failed send: a lost ping's information reappears in
    // the next post's running count, while a cleared stamp would risk a double
    // post (AD-2).
    const posted = await isolated(
      deps.logger,
      `provider interest tick: the ping for org ${row.organizationId} about ${row.provider} ` +
        `(interest row ${row.id}) could not be sent`,
      () => postInterestPing(deps, webhookUrl, row),
    );

    if (posted) {
      summary.pingsPosted += 1;
    } else {
      summary.pingsFailed += 1;
    }
  }

  return summary;
}

async function postInterestPing(
  deps: ProviderInterestTickDeps,
  webhookUrl: string,
  row: ClaimedProviderInterest,
): Promise<void> {
  const total = await countProviderInterest(deps.db, row.provider);
  const text = interestPostText({
    orgName: row.organizationName,
    displayName: displayNameFor(row.provider),
    count: total,
  });

  const response = await deps.fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`the webhook answered with status ${response.status}`);
  }
}

function displayNameFor(provider: InterestProviderId): string {
  return PROVIDER_CATALOGUE.find((entry) => entry.id === provider)?.displayName ?? provider;
}
