import type { ScopedDb } from "@growthmind/db";
import {
  createEventsCounterService,
  createFirstRunRepo,
  createFirstRunStatusService,
  createSlackConnectionsRepo,
} from "@growthmind/db";
import type { FirstRunStatus, StagePersistedFacts, TenantContext } from "@growthmind/shared";
import {
  CONNECTION_STATE_MESSAGES,
  SLACK_CHANNEL_PICK_PROMPT,
  SLACK_SKIPPED_NOTICE,
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
};

export interface BuildFirstRunStatusInput {
  readonly db: ScopedDb;
  readonly ctx: TenantContext;
  readonly projectId: string;

  readonly facts: StagePersistedFacts;

  readonly findingUnavailable: boolean;
}

export async function buildFirstRunStatus(
  input: BuildFirstRunStatusInput,
): Promise<FirstRunStatusPayload> {
  const { db, ctx, projectId, facts } = input;

  const [counter, slack, state] = await Promise.all([
    createEventsCounterService(db, ctx).read(projectId),
    createSlackConnectionsRepo(db, ctx).getActiveForOrg(),
    createFirstRunRepo(db, ctx).readState(projectId),
  ]);

  const view = toOnboardingCounterView(counter);

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
