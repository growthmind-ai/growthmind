import type { FetchLike, SessionSource } from "@growthmind/adapters";
import { createPostHogSessionSource, POSTHOG_SOURCE_KIND } from "@growthmind/adapters";
import type { PollRunCounts, ScopedDb } from "@growthmind/db";
import {
  createFirstRunRepo,
  createPollRunsRepo,
  createProjectConnectionsRepo,
  describeDriverError,
  persistPullResult,
} from "@growthmind/db";
import type { PollableConnection } from "@growthmind/db/system";
import {
  claimDuePollableConnections,
  readConnectionCredential,
  systemTenantContextFor,
} from "@growthmind/db/system";
import type {
  CredentialKey,
  ServerEnv,
  SessionSourcePullResult,
  SourceFailureCode,
  TenantContext,
} from "@growthmind/shared";
import {
  CONNECT_REFUSAL_MESSAGES,
  credentialAad,
  decryptSecret,
  deriveIdentityHmacKey,
  resolveCredentialKey,
} from "@growthmind/shared";

import { isolated, type TaskLogger } from "../task-logger";
import {
  MAX_CONNECTIONS_PER_RUN,
  MAX_RUN_DURATION_MS,
  isOnboardingPlan,
  resolvePollPlan,
} from "./poll-plan";

export type PollLogger = TaskLogger;

export interface SessionSourcePollDeps {
  db: ScopedDb;
   
  env: ServerEnv;
  now: () => Date;
   
  sleep: (ms: number) => Promise<void>;
  fetch: FetchLike;
  random: () => number;
  logger: PollLogger;
   
  requestAnalysis: AnalysisTrigger;
}

export interface SessionSourcePollSummary {
  connectionsClaimed: number;
   
  connectionsPolled: number;
   
  connectionsFailed: number;
   
  runsRecorded: number;
   
  stoppedOnDuration: boolean;
}

const MAX_PAGES_PER_PASS = 25;

const NO_COUNTS: PollRunCounts = {
  eventsReceived: 0,
  eventsPersisted: 0,
  eventsDroppedMalformed: 0,
  sessionsTouched: 0,
  pagesFetched: 0,
  identityLookupsUsed: 0,
};

type PollRunsRepo = ReturnType<typeof createPollRunsRepo>;
type ConnectionsRepo = ReturnType<typeof createProjectConnectionsRepo>;

interface ConnectionOutcome {
  runsRecorded: number;
  failed: boolean;
  stoppedOnDuration: boolean;
}

interface PassOutcome {
  ok: boolean;
   
  sawEvents: boolean;
  watermarkAt: Date | null;
  backfillBefore: string | null;
}

export async function runSessionSourcePoll(
  deps: SessionSourcePollDeps,
): Promise<SessionSourcePollSummary> {
  const startedAtMs = deps.now().getTime();

  const claimed = await claimDuePollableConnections(deps.db, {
    now: deps.now(),
    limit: MAX_CONNECTIONS_PER_RUN,
  });

  const summary: SessionSourcePollSummary = {
    connectionsClaimed: claimed.length,
    connectionsPolled: 0,
    connectionsFailed: 0,
    runsRecorded: 0,
    stoppedOnDuration: false,
  };

  if (claimed.length === 0) {
     
    return summary;
  }

  const overBudget = (): boolean => deps.now().getTime() - startedAtMs >= MAX_RUN_DURATION_MS;

  const overBudgetAfter = (ms: number): boolean =>
    deps.now().getTime() + ms - startedAtMs >= MAX_RUN_DURATION_MS;

  for (const connection of claimed) {
    if (overBudget()) {
       
      summary.stoppedOnDuration = true;
      break;
    }

    let outcome: ConnectionOutcome;
    try {
      outcome = await pollConnection(deps, connection, overBudget, overBudgetAfter);
    } catch (error) {
       
      deps.logger.error(
        `session source poll: connection ${connection.id} could not be processed — ${describeDriverError(error)}`,
      );
      summary.connectionsFailed += 1;
      continue;
    }

    summary.runsRecorded += outcome.runsRecorded;
    if (outcome.stoppedOnDuration) {
      summary.stoppedOnDuration = true;
    }
    if (outcome.failed) {
      summary.connectionsFailed += 1;
    } else {
      summary.connectionsPolled += 1;
    }
  }

  deps.logger.info(
    `session source poll: claimed ${summary.connectionsClaimed}, polled ${summary.connectionsPolled}, failed ${summary.connectionsFailed}, runs ${summary.runsRecorded}`,
  );

  return summary;
}

export interface AnalysisTrigger {
   
  requestForProject(input: { readonly projectId: string }): Promise<void>;
}

async function pollConnection(
  deps: SessionSourcePollDeps,
  connection: PollableConnection,
  overBudget: () => boolean,
  overBudgetAfter: (ms: number) => boolean,
): Promise<ConnectionOutcome> {
  const ctx = systemTenantContextFor(connection);
  const pollRuns = createPollRunsRepo(deps.db, ctx);
  const connections = createProjectConnectionsRepo(deps.db, ctx);

  const outcome: ConnectionOutcome = {
    runsRecorded: 0,
    failed: false,
    stoppedOnDuration: false,
  };

  const credential = await openCredential(deps, connection);
  if (!credential.ok) {
     
    deps.logger.error(
      `session source poll: connection ${connection.id} has a stored key this installation cannot read`,
    );
    await recordUnattemptedFailure(deps, {
      pollRuns,
      connections,
      connection,
      code: credential.code,
       
      ...(credential.message !== undefined ? { message: credential.message } : {}),
    });
    outcome.runsRecorded += 1;
    outcome.failed = true;
    return outcome;
  }

  const source = createSourceFor(
    connection,
    credential.personalApiKey,
    credential.credentialKey,
    deps,
    (ms) =>
       
      overBudgetAfter(ms),
  );
  const plan = resolvePollPlan({
    connectedAt: connection.connectedAt,
    armedAt: await readArmClock(deps, ctx, connection),
    now: deps.now(),
    pollIntervalSeconds: connection.pollIntervalSeconds,
  });

  let watermarkAt = connection.watermarkAt;
  let backfillBefore = connection.backfillBefore;

  for (let pass = 0; pass < plan.passes; pass += 1) {
    if (pass > 0) {
      if (overBudget()) {
        outcome.stoppedOnDuration = true;
        break;
      }
      await deps.sleep(plan.sleepMsBetween);
    }

    const passOutcome = await runOnePass({
      deps,
      ctx,
      connection,
      source,
      pollRuns,
      connections,
      watermarkAt,
      backfillBefore,
    });
    outcome.runsRecorded += 1;

    if (!passOutcome.ok) {
       
      outcome.failed = true;
      break;
    }

    watermarkAt = passOutcome.watermarkAt;
    backfillBefore = passOutcome.backfillBefore;

    if (passOutcome.sawEvents && isOnboardingPlan(plan)) {
      await isolated(
        deps.logger,
        `session source poll: connection ${connection.id} persisted new events but the fast analysis could not be requested, so this project waits for the hourly check`,
        () => deps.requestAnalysis.requestForProject({ projectId: connection.projectId }),
      );
    }

    if (passOutcome.sawEvents) {
      break;
    }
  }

  return outcome;
}

async function readArmClock(
  deps: SessionSourcePollDeps,
  ctx: TenantContext,
  connection: PollableConnection,
): Promise<Date | null> {
  try {
    const state = await createFirstRunRepo(deps.db, ctx).readState(connection.projectId);
    return state?.armedAt ?? null;
  } catch (error) {
    // A failed query's own message carries the statement and both bound tenancy ids.
    deps.logger.error(
      `session source poll: connection ${connection.id} could not read when this project started ` +
        `watching, so this pass uses the connect clock — ${describeDriverError(error)}`,
    );
    return null;
  }
}

async function runOnePass(input: {
  deps: SessionSourcePollDeps;
  ctx: TenantContext;
  connection: PollableConnection;
  source: SessionSource;
  pollRuns: PollRunsRepo;
  connections: ConnectionsRepo;
  watermarkAt: Date | null;
  backfillBefore: string | null;
}): Promise<PassOutcome> {
  const { deps, ctx, connection, source, pollRuns, connections } = input;

  const run = await pollRuns.start({
    projectId: connection.projectId,
    connectionId: connection.id,
    startedAt: deps.now(),
  });

  const unchanged = {
    watermarkAt: input.watermarkAt,
    backfillBefore: input.backfillBefore,
  };

  let result: SessionSourcePullResult;
  try {
    result = await source.pull({
      watermarkAt: input.watermarkAt,
      backfillBefore: input.backfillBefore,
      maxPages: MAX_PAGES_PER_PASS,
    });
  } catch (error) {
     
    deps.logger.error(
      `session source poll: connection ${connection.id} threw while fetching — ${describeDriverError(error)}`,
    );
    await finishFailed(deps, {
      pollRuns,
      connections,
      connection,
      runId: run.id,
      code: "unreachable",
      counts: NO_COUNTS,
    });
    return { ok: false, sawEvents: false, ...unchanged };
  }

  try {
     
    const counts = await persistPullResult(deps.db, ctx, {
      connection: {
        id: connection.id,
        projectId: connection.projectId,
        inferredInternalDomain: connection.inferredInternalDomain,
      },
      result,
    });

    const telemetry: PollRunCounts = {
      eventsReceived: counts.eventsReceived,
      eventsPersisted: counts.eventsPersisted,
      eventsDroppedMalformed: counts.eventsDroppedMalformed,
      sessionsTouched: counts.sessionsTouched,
      pagesFetched: result.pagesFetched,
      identityLookupsUsed: result.identityLookupsUsed,
    };

    if (!result.ok) {
       
      await finishFailed(deps, {
        pollRuns,
        connections,
        connection,
        runId: run.id,
        code: result.failure.code,
        counts: telemetry,
      });
      return { ok: false, sawEvents: false, ...unchanged };
    }

    const cursors = await applyCursors(connections, connection.id, result, input.watermarkAt);
    const finishedAt = deps.now();

    await pollRuns.finish(run.id, {
      status: "completed",
      finishedAt,
       
      outcome: counts.eventsReceived > 0 ? "with_events" : "no_new_events",
      watermarkAdvancedTo: cursors.advancedTo,
      ...telemetry,
    });

    await isolated(
      deps.logger,
      `session source poll: connection ${connection.id} polled successfully but its health badge could not be updated`,
      () =>
        connections.recordHealth(connection.id, {
          health: "healthy",
          reasonCode: null,
          reasonMessage: null,
          checkedAt: finishedAt,
        }),
    );

    return {
      ok: true,
      sawEvents: counts.eventsReceived > 0,
      watermarkAt: cursors.watermarkAt,
      backfillBefore: cursors.backfillBefore,
    };
  } catch (error) {
     
    deps.logger.error(
      `session source poll: connection ${connection.id} could not store what it fetched — ${describeDriverError(error)}`,
    );
    await finishFailed(deps, {
      pollRuns,
      connections,
      connection,
      runId: run.id,
      code: "unreachable",
      counts: NO_COUNTS,
    });
    return { ok: false, sawEvents: false, ...unchanged };
  }
}

async function applyCursors(
  connections: ConnectionsRepo,
  connectionId: string,
  result: Extract<SessionSourcePullResult, { ok: true }>,
  currentWatermarkAt: Date | null,
): Promise<{ watermarkAt: Date | null; backfillBefore: string | null; advancedTo: Date | null }> {
  if (result.contiguous && result.newestObservedAt !== null) {
    const advanced = await connections.advanceWatermark(connectionId, {
      watermarkAt: result.newestObservedAt,
      backfillBefore: result.resumeBefore,
    });
    if (advanced) {
      return {
        watermarkAt: advanced.watermarkAt,
        backfillBefore: advanced.backfillBefore,
         
        advancedTo: result.newestObservedAt,
      };
    }
  }

  if (!result.contiguous) {
     
    const held = await connections.setBackfillCursor(connectionId, result.resumeBefore);
    if (held) {
      return {
        watermarkAt: held.watermarkAt,
        backfillBefore: held.backfillBefore,
        advancedTo: null,
      };
    }
  }

  return { watermarkAt: currentWatermarkAt, backfillBefore: null, advancedTo: null };
}

async function finishFailed(
  deps: SessionSourcePollDeps,
  input: {
    pollRuns: PollRunsRepo;
    connections: ConnectionsRepo;
    connection: PollableConnection;
    runId: string;
    code: SourceFailureCode;
    counts: PollRunCounts;
    message?: string;
  },
): Promise<void> {
  const finishedAt = deps.now();
  const message = input.message ?? CONNECT_REFUSAL_MESSAGES[input.code];

  // Two writes, two catches. Bundled, a health-badge throw was reported as "could not
  // record its failed run" while the run had in fact been recorded — the terminal state
  // and the badge fail for different reasons and read differently to whoever is paged.
  // The badge is attempted either way: the connection is failing whether or not its run
  // row landed, and a stale "healthy" badge is the worse of the two wrong answers.
  let recorded = true;

  try {
    await input.pollRuns.finish(input.runId, {
      status: "failed",
      finishedAt,
      failureCode: input.code,
      failureMessage: message,
      ...input.counts,
    });
  } catch (error) {
    recorded = false;
    deps.logger.error(
      `session source poll: connection ${input.connection.id} could not record its failed run — ${describeDriverError(error)}`,
    );
  }

  await isolated(
    deps.logger,
    recorded
      ? `session source poll: connection ${input.connection.id} recorded its failed run but its health badge could not be updated`
      : `session source poll: connection ${input.connection.id} could not record its failed run, and its health badge could not be updated either`,
    () =>
      input.connections.recordHealth(input.connection.id, {
        health: "failing",
        reasonCode: input.code,
        reasonMessage: message,
        checkedAt: finishedAt,
      }),
  );
}

async function recordUnattemptedFailure(
  deps: SessionSourcePollDeps,
  input: {
    pollRuns: PollRunsRepo;
    connections: ConnectionsRepo;
    connection: PollableConnection;
    code: SourceFailureCode;
    message?: string;
  },
): Promise<void> {
  const run = await input.pollRuns.start({
    projectId: input.connection.projectId,
    connectionId: input.connection.id,
    startedAt: deps.now(),
  });

  await finishFailed(deps, { ...input, runId: run.id, counts: NO_COUNTS });
}

type OpenedCredential =
  | {
      readonly ok: true;
      readonly personalApiKey: string;
       
      readonly credentialKey: CredentialKey;
    }
  | { readonly ok: false; readonly code: SourceFailureCode; readonly message?: string };

const STORED_CREDENTIAL_UNREADABLE_MESSAGE =
  "We could not unlock the analytics key saved for this project. This can happen when the security key this installation uses has changed since it was connected. Reconnect this project with your analytics key to fix it.";

async function openCredential(
  deps: SessionSourcePollDeps,
  connection: PollableConnection,
): Promise<OpenedCredential> {
  const stored = await readConnectionCredential(deps.db, {
    connectionId: connection.id,
    organizationId: connection.organizationId,
  });
  if (stored === null) {
    return { ok: false, code: "misconfigured" };
  }

  const key = resolveCredentialKey(deps.env);
  if (!key.ok) {
    return { ok: false, code: "misconfigured" };
  }

  const opened = decryptSecret(
    stored.ciphertext,
    key.key,
    credentialAad(connection.organizationId, connection.projectId),
  );
  if (!opened.ok) {
     
    return { ok: false, code: "misconfigured", message: STORED_CREDENTIAL_UNREADABLE_MESSAGE };
  }

  return { ok: true, personalApiKey: opened.value, credentialKey: key.key };
}

function createSourceFor(
  connection: PollableConnection,
  personalApiKey: string,
   
  credentialKey: CredentialKey,
  deps: SessionSourcePollDeps,
   
  deadlineExceededAfter: (ms: number) => boolean,
): SessionSource {
  switch (connection.sourceKind) {
    case POSTHOG_SOURCE_KIND:
      return createPostHogSessionSource(
        {
          host: connection.host,
          sourceProjectId: connection.sourceProjectId,
          personalApiKey,
        },
        {
          fetch: deps.fetch,
          sleep: deps.sleep,
          now: deps.now,
          random: deps.random,
           
          identityHmacKey: deriveIdentityHmacKey(credentialKey),
          deadlineExceededAfter,
        },
      );
  }

  const unsupported: never = connection.sourceKind;
  throw new Error(`session source poll: unsupported source kind ${String(unsupported)}`);
}
