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
  SLACK_SKIPPED_NOTICE,
  toOnboardingCounterView,
} from "@growthmind/shared";

export type FirstRunStatusPayload = FirstRunStatus & {
  readonly findingUnavailable: boolean;

  readonly connectionMessage: string;

  readonly slackSkippedAt: Date | null;

  readonly slackNotice: string | null;
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
    slackNotice: slack === null ? SLACK_SKIPPED_NOTICE : null,
  };
}

export async function echoFirstRunStatus(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<FirstRunStatusPayload> {
  const facts = await createFirstRunStatusService(db, ctx).read(projectId);
  return buildFirstRunStatus({ db, ctx, projectId, facts, findingUnavailable: false });
}
