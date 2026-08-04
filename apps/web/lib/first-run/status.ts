import type { FirstRunStatusFacts, ScopedDb } from "@growthmind/db";
import {
  createApiKeysRepo,
  createDeliveriesRepo,
  createEventsCounterService,
  createFirstRunRepo,
  createFirstRunStatusService,
  createProviderInterestRepo,
  createSlackConnectionsRepo,
  describeDriverError,
  isDeliveryTarget,
} from "@growthmind/db";
import type {
  AgentConnection,
  AgentProviderId,
  DeliveryStatus,
  FirstRunDeliveryState,
  FirstRunStatus,
  InterestProviderId,
  TenantContext,
} from "@growthmind/shared";
import {
  agentProviderOrder,
  channelLabel,
  CONNECTION_STATE_MESSAGES,
  isDeliveryAddress,
  SLACK_CHANNEL_PICK_PROMPT,
  SLACK_SKIPPED_NOTICE,
  interestPingConfigured,
  logger,
  parseWebEnv,
  toAgentConnection,
  toOnboardingCounterView,
} from "@growthmind/shared";

import { mcpPublicUrl } from "@/lib/mcp/public-url";
import { slackOAuthConfigured } from "@/lib/slack/oauth";

export type FirstRunStatusPayload = FirstRunStatus & {
  readonly findingUnavailable: boolean;

  readonly connectionMessage: string;

  readonly slackSkippedAt: Date | null;

  // FR-O14, derived from the absence of a deliverable address (AD-4).
  readonly slackNotice: string | null;

  // `slack !== null`, never `channelId !== null`, and never an input to
  // `deliveryResolved`: a workspace with no channel has nowhere to deliver.
  readonly slackWorkspaceAttached: boolean;

  readonly slackWorkspaceName: string | null;

  // AD-6, server-computed: `SLACK_CLIENT_ID` reads `undefined` in the browser,
  // so a client-side check would hide the button from deployments that have one.
  readonly slackOAuthAvailable: boolean;

  readonly deliveryState: FirstRunDeliveryState;

  // The delivery lane's own next action, already written when the post failed. Non-null
  // only in the failed state, so no screen can pair it with a claim that contradicts it.
  readonly deliveryFailureReason: string | null;

  // AD-5, both REQUIRED: an optional field here is the always-absent D11 shape,
  // and every consumer that fails to compile is a consumer found.
  readonly providerInterest: readonly InterestProviderId[];

  readonly interestPingAvailable: boolean;

  // Server-derived per read, so connection is never client state or a live signal (D4).
  readonly mcpUrl: string;
  readonly agentConnection: AgentConnection;
  readonly agentProviderOrder: readonly AgentProviderId[];
};

export interface BuildFirstRunStatusInput {
  readonly db: ScopedDb;
  readonly ctx: TenantContext;
  readonly projectId: string;

  // Carries the rendered finding AND its id, from one read. A second query here is
  // how the card and the delivery line came to describe different rows (B-038).
  readonly facts: FirstRunStatusFacts;
}

export function toFirstRunDeliveryState(input: {
  hasFinding: boolean;
  channelId: string | null;
  delivery: { status: DeliveryStatus } | null;
}): FirstRunDeliveryState {
  if (!input.hasFinding) return "none";

  if (!isDeliveryTarget({ channelId: input.channelId })) return "none";

  switch (input.delivery?.status) {
    case "posted":
      return "posted";
    case "failed":
      return "failed";
    default:
      return "unposted";
  }
}

// The reason is a sentence @growthmind/shared composed from a closed union of failure
// codes, never a driver or Slack response body. Blank text is treated as absent, because
// a row written by an older shape can carry an empty column.
export function toDeliveryFailureReason(input: {
  state: FirstRunDeliveryState;
  delivery: { failureReason: string | null } | null;
}): string | null {
  if (input.state !== "failed") return null;

  const reason = input.delivery?.failureReason ?? null;
  return reason !== null && reason.trim().length > 0 ? reason : null;
}

export interface ResolvedDelivery {
  readonly state: FirstRunDeliveryState;
  readonly failureReason: string | null;
}

const NO_DELIVERY: ResolvedDelivery = { state: "none", failureReason: null };

async function resolveDelivery(input: {
  readonly db: ScopedDb;
  readonly ctx: TenantContext;
  readonly findingId: string | null;
  readonly channelId: string | null;
}): Promise<ResolvedDelivery> {
  const { findingId } = input;
  const target = { channelId: input.channelId };

  if (findingId === null || !isDeliveryTarget(target)) return NO_DELIVERY;

  try {
    const delivery = await createDeliveriesRepo(input.db, input.ctx).findFor(
      findingId,
      target.channelId,
    );
    const state = toFirstRunDeliveryState({
      hasFinding: true,
      channelId: target.channelId,
      delivery,
    });

    return { state, failureReason: toDeliveryFailureReason({ state, delivery }) };
  } catch (error) {
    logger.error("onboarding status: whether this finding reached Slack could not be read", {
      organizationId: input.ctx.organizationId,
      reason: describeDriverError(error),
    });
    return NO_DELIVERY;
  }
}

export async function buildFirstRunStatus(
  input: BuildFirstRunStatusInput,
): Promise<FirstRunStatusPayload> {
  const { db, ctx, projectId, facts } = input;

  const [counter, slack, state, providerInterest, keyUse] = await Promise.all([
    createEventsCounterService(db, ctx).read(projectId),
    createSlackConnectionsRepo(db, ctx).getActiveForOrg(),
    createFirstRunRepo(db, ctx).readState(projectId),
    createProviderInterestRepo(db, ctx).listNotedProviders(),
    createApiKeysRepo(db, ctx).liveKeyUse(),
  ]);

  const view = toOnboardingCounterView(counter);

  const delivery = await resolveDelivery({
    db,
    ctx,
    findingId: facts.findingId,
    channelId: slack?.channelId ?? null,
  });

  // Read here so no caller threads it, and parsed per call so an env captured
  // at import time cannot outlive a redeploy. One parse feeds both flags.
  const env = parseWebEnv(process.env);

  // One address feeds both fields, so a sentinel row cannot read as deliverable
  // in the label while reading as undeliverable in the id.
  const address = isDeliveryAddress(slack?.channelId) ? slack.channelId : null;

  return {
    finding: facts.finding,
    findingUnavailable: facts.findingUnavailable,
    armedAt: facts.armedAt,

    retrievedAt: facts.retrievedAt,
    readingAt: facts.readingAt,
    endedAt: facts.endedAt,
    runStatus: facts.runStatus,
    runOutcome: facts.runOutcome,
    counter: view,
    connectionMessage: CONNECTION_STATE_MESSAGES[view.state.status],
    channelId: address,
    // Derived here and nowhere else, so no screen can forget the fallback to the id.
    channelLabel: slack === null || address === null ? null : channelLabel(slack),
    slackSkippedAt: state?.slackSkippedAt ?? null,
    slackNotice: notice(slack),
    slackWorkspaceAttached: slack !== null,
    slackWorkspaceName: slack?.workspaceName ?? null,
    slackOAuthAvailable: slackOAuthConfigured(env),
    interestPingAvailable: interestPingConfigured(env),
    providerInterest,
    mcpUrl: mcpPublicUrl(env),
    agentConnection: toAgentConnection(keyUse),
    agentProviderOrder: agentProviderOrder(providerInterest),
    deliveryState: delivery.state,
    deliveryFailureReason: delivery.failureReason,
  };
}

// Three states, three next actions — a workspace with no channel delivers
// nothing, so it must not collapse back into `slack === null`.
function notice(slack: { readonly channelId: string | null } | null): string | null {
  if (slack === null) return SLACK_SKIPPED_NOTICE;

  // The predicate, not `=== null`: a sentinel row must read as "pick a channel"
  // rather than suppressing the prompt that tells the founder to.
  if (!isDeliveryAddress(slack.channelId)) return SLACK_CHANNEL_PICK_PROMPT;

  return null;
}

export async function echoFirstRunStatus(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<FirstRunStatusPayload> {
  const facts = await createFirstRunStatusService(db, ctx).read(projectId);
  return buildFirstRunStatus({ db, ctx, projectId, facts });
}
