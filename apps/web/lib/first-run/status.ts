import type { ScopedDb } from "@growthmind/db";
import {
  createDeliveriesRepo,
  createEventsCounterService,
  createFindingsRepo,
  createFirstRunRepo,
  createFirstRunStatusService,
  createSlackConnectionsRepo,
  describeDriverError,
  isDeliveryTarget,
} from "@growthmind/db";
import type {
  DeliveryStatus,
  FirstRunDeliveryState,
  FirstRunStatus,
  StagePersistedFacts,
  TenantContext,
} from "@growthmind/shared";
import {
  CONNECTION_STATE_MESSAGES,
  SLACK_CHANNEL_PICK_PROMPT,
  SLACK_SKIPPED_NOTICE,
  logger,
  parseServerEnv,
  toOnboardingCounterView,
} from "@growthmind/shared";

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
};

export interface BuildFirstRunStatusInput {
  readonly db: ScopedDb;
  readonly ctx: TenantContext;
  readonly projectId: string;

  readonly facts: StagePersistedFacts;

  readonly findingUnavailable: boolean;
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

async function readNewestFindingId(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<string | null> {
  try {
    const [row] = await createFindingsRepo(db, ctx).listForProject(projectId, { limit: 1 });
    return row?.id ?? null;
  } catch (error) {
    logger.error("onboarding status: the finding on screen could not be matched to a Slack post", {
      organizationId: ctx.organizationId,
      projectId,
      reason: describeDriverError(error),
    });
    return null;
  }
}

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

  const [counter, slack, state, findingId] = await Promise.all([
    createEventsCounterService(db, ctx).read(projectId),
    createSlackConnectionsRepo(db, ctx).getActiveForOrg(),
    createFirstRunRepo(db, ctx).readState(projectId),
    facts.finding === null ? Promise.resolve(null) : readNewestFindingId(db, ctx, projectId),
  ]);

  const view = toOnboardingCounterView(counter);

  const delivery = await resolveDelivery({
    db,
    ctx,
    findingId,
    channelId: slack?.channelId ?? null,
  });

  return {
    finding: facts.finding,
    findingUnavailable: input.findingUnavailable,
    armedAt: facts.armedAt,

    retrievedAt: facts.retrievedAt,
    readingAt: facts.readingAt,
    endedAt: facts.endedAt,
    runStatus: facts.runStatus,
    runOutcome: facts.runOutcome,
    counter: view,
    connectionMessage: CONNECTION_STATE_MESSAGES[view.state.status],
    channelId: slack?.channelId ?? null,
    slackSkippedAt: state?.slackSkippedAt ?? null,
    slackNotice: notice(slack),
    slackWorkspaceAttached: slack !== null,
    slackWorkspaceName: slack?.workspaceName ?? null,
    // Read here so no caller threads it, and parsed per call so an env captured
    // at import time cannot outlive a redeploy.
    slackOAuthAvailable: slackOAuthConfigured(parseServerEnv(process.env)),
    deliveryState: delivery.state,
    deliveryFailureReason: delivery.failureReason,
  };
}

// Three states, three next actions — a workspace with no channel delivers
// nothing, so it must not collapse back into `slack === null`.
function notice(slack: { readonly channelId: string | null } | null): string | null {
  if (slack === null) return SLACK_SKIPPED_NOTICE;

  if (slack.channelId === null) return SLACK_CHANNEL_PICK_PROMPT;

  return null;
}

export async function echoFirstRunStatus(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<FirstRunStatusPayload> {
  const facts = await createFirstRunStatusService(db, ctx).read(projectId);
  return buildFirstRunStatus({ db, ctx, projectId, facts, findingUnavailable: false });
}
