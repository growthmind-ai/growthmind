import type { FetchLike } from "@growthmind/adapters";
import type { ScopedDb } from "@growthmind/db";
import type { ClaimedProviderInterest } from "@growthmind/db/system";
import { claimUnnotifiedProviderInterest, countProviderInterest } from "@growthmind/db/system";
import type { InterestProviderId, ServerEnv } from "@growthmind/shared";
import { PROVIDER_CATALOGUE, describeError, interestPingConfigured } from "@growthmind/shared";

export interface InterestTickLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface ProviderInterestTickDeps {
  db: ScopedDb;
  env: ServerEnv;
  fetch: FetchLike;
  logger: InterestTickLogger;
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

export function interestPostText(input: InterestPostTextInput): string {
  const running =
    input.count === 1
      ? `1 workspace has asked for ${input.displayName}.`
      : `${input.count} workspaces have asked for ${input.displayName}.`;

  return `${input.orgName} asked for ${input.displayName}. ${running}`;
}

export async function runProviderInterestTick(
  deps: ProviderInterestTickDeps,
): Promise<ProviderInterestTickSummary> {
  const summary: ProviderInterestTickSummary = { rowsClaimed: 0, pingsPosted: 0, pingsFailed: 0 };

  // Same predicate twice: interestPingConfigured is the shared gate (AD-1), the
  // direct check narrows the URL for the compiler. The gate runs before the
  // claim, so an unconfigured installation accumulates unnotified rows (AD-2).
  const webhookUrl = deps.env.GROWTHMIND_INTEREST_SLACK_WEBHOOK;
  if (!interestPingConfigured(deps.env) || webhookUrl === undefined) {
    deps.logger.info(
      "provider interest tick: no internal Slack webhook is configured on this installation, so there is nothing to post",
    );
    return summary;
  }

  const claimed = await claimUnnotifiedProviderInterest(deps.db, deps.now());
  summary.rowsClaimed = claimed.length;

  for (const row of claimed) {
    try {
      await postInterestPing(deps, webhookUrl, row);
      summary.pingsPosted += 1;
    } catch (error) {
      // The stamp stays: a lost ping's information reappears in the next post's
      // running count, while a cleared stamp would risk a double post (AD-2).
      summary.pingsFailed += 1;
      deps.logger.error(
        `provider interest tick: the ping for org ${row.organizationId} about ${row.provider} ` +
          `(interest row ${row.id}) could not be sent — ${describeError(error)}`,
      );
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
