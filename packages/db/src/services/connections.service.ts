import type {
  ConnectInput,
  ConnectResult,
  ConnectRefusalCode,
  ConnectionState,
  ConnectionSummary,
  CredentialKey,
  CredentialKeyResolution,
  SessionSourcePullRequest,
  SessionSourcePullResult,
  SessionSourceValidation,
  SourceFailure,
  TenantContext,
} from "@growthmind/shared";
import {
  CONNECT_REFUSAL_MESSAGES,
  connectInputSchema,
  credentialAad,
  encryptSecret,
  inferInternalDomain,
  keyIdOf,
  logger,
  secondSourceRefusalMessage,
} from "@growthmind/shared";

import { createEventsRepo } from "../repositories/events.repo";
import { createOrganizationsRepo } from "../repositories/organizations.repo";
import { createPollRunsRepo } from "../repositories/poll-runs.repo";
import {
  ConnectionWriteError,
  createProjectConnectionsRepo,
} from "../repositories/project-connections.repo";
import { createProjectsRepo } from "../repositories/projects.repo";
import type { ScopedDb } from "../repositories/types";
import { deriveConnectionState, findLatestConnection } from "./connection-state";
import { persistPullResult } from "./intake.service";

export interface AttachableSource {
  validate(): Promise<SessionSourceValidation>;
  pull(request: SessionSourcePullRequest): Promise<SessionSourcePullResult>;
}

export interface SourceConnectionConfig {
  host: string;
  sourceProjectId: string;

  personalApiKey: string;
}

export type CreateSourceFn = (config: SourceConnectionConfig) => AttachableSource;

export interface ConnectionsServiceDeps {
  createSource: CreateSourceFn;

  credentialKey: CredentialKeyResolution;
  now: () => Date;
}

export { connectInputSchema };
export type { ConnectInput };

export interface ConnectionsService {
  connect(input: ConnectInput): Promise<ConnectResult>;

  getState(projectId: string): Promise<ConnectionState>;

  disconnect(projectId: string): Promise<ConnectionState>;
}

const UNIQUE_VIOLATION = "23505";

const ACTIVE_PROJECT_INDEX = "project_connections_active_project_uidx";

const FIRST_PULL_MAX_PAGES = 1;

const DEFAULT_POLL_INTERVAL_SECONDS = 60;

function refuse(code: ConnectRefusalCode, message?: string): ConnectResult {
  return { ok: false, refusal: { code, message: message ?? CONNECT_REFUSAL_MESSAGES[code] } };
}

function refusalFor(failure: SourceFailure): ConnectResult {
  return refuse(failure.code);
}

function isSecondSourceViolation(error: ConnectionWriteError): boolean {
  return (
    error.constraint === ACTIVE_PROJECT_INDEX ||
    error.code === UNIQUE_VIOLATION ||
    error.message.includes(ACTIVE_PROJECT_INDEX)
  );
}

function isSameSource(existing: ConnectionSummary, input: ConnectInput): boolean {
  return (
    existing.sourceKind === input.sourceKind &&
    existing.host === input.host &&
    existing.sourceProjectId === input.sourceProjectId
  );
}

export function createConnectionsService(
  db: ScopedDb,
  ctx: TenantContext,
  deps: ConnectionsServiceDeps,
): ConnectionsService {
  const connections = createProjectConnectionsRepo(db, ctx);
  const projects = createProjectsRepo(db, ctx);
  const organizations = createOrganizationsRepo(db, ctx);
  const pollRuns = createPollRunsRepo(db, ctx);
  const events = createEventsRepo(db, ctx);

  async function stateOf(connection: ConnectionSummary | null): Promise<ConnectionState> {
    if (!connection) {
      return deriveConnectionState(null, { hasCompletedPoll: false, hasEvents: false });
    }

    const [latestRun, firstEvent] = await Promise.all([
      pollRuns.latestCompletedFor(connection.id),
      events.listForProject(connection.projectId, { limit: 1 }),
    ]);

    return deriveConnectionState(connection, {
      hasCompletedPoll: latestRun !== null,
      hasEvents: firstEvent.length > 0,
    });
  }

  async function performFirstPull(
    connection: ConnectionSummary,
    source: AttachableSource,
  ): Promise<{ connection: ConnectionSummary; eventsSeen: number }> {
    try {
      return await runFirstPull(connection, source);
    } catch (error) {
      logger.error(
        `connections.connect: first pull failed after the attachment was stored (connection ${connection.id})`,
        { error },
      );

      return { connection, eventsSeen: 0 };
    }
  }

  async function runFirstPull(
    connection: ConnectionSummary,
    source: AttachableSource,
  ): Promise<{ connection: ConnectionSummary; eventsSeen: number }> {
    const startedAt = deps.now();
    const run = await pollRuns.start({
      projectId: connection.projectId,
      connectionId: connection.id,
      startedAt,
    });

    const result = await source.pull({
      watermarkAt: connection.watermarkAt,
      backfillBefore: connection.backfillBefore,
      maxPages: FIRST_PULL_MAX_PAGES,
    });

    const counts = await persistPullResult(db, ctx, {
      connection: {
        id: connection.id,
        projectId: connection.projectId,
        inferredInternalDomain: connection.inferredInternalDomain,
      },
      result,
    });

    let current = connection;
    let watermarkAdvancedTo: Date | null = null;

    if (result.ok && result.contiguous && result.newestObservedAt) {
      const advanced = await connections.advanceWatermark(connection.id, {
        watermarkAt: result.newestObservedAt,
        backfillBefore: result.resumeBefore,
      });
      if (advanced) {
        current = advanced;
        watermarkAdvancedTo = result.newestObservedAt;
      }
    } else if (result.ok && !result.contiguous) {
      const held = await connections.setBackfillCursor(connection.id, result.resumeBefore);
      if (held) {
        current = held;
      }
    }

    const finishedAt = deps.now();
    const telemetry = {
      eventsReceived: counts.eventsReceived,
      eventsPersisted: counts.eventsPersisted,
      eventsDroppedMalformed: counts.eventsDroppedMalformed,
      sessionsTouched: counts.sessionsTouched,
      pagesFetched: result.pagesFetched,
      identityLookupsUsed: result.identityLookupsUsed,
    };

    if (result.ok) {
      await pollRuns.finish(run.id, {
        status: "completed",
        finishedAt,

        outcome: counts.eventsReceived > 0 ? "with_events" : "no_new_events",
        watermarkAdvancedTo,
        ...telemetry,
      });
      return { connection: current, eventsSeen: counts.eventsReceived };
    }

    await pollRuns.finish(run.id, {
      status: "failed",
      finishedAt,
      failureCode: result.failure.code,

      failureMessage: CONNECT_REFUSAL_MESSAGES[result.failure.code],
      ...telemetry,
    });

    const failed = await connections.recordHealth(connection.id, {
      health: "failing",
      reasonCode: result.failure.code,
      reasonMessage: CONNECT_REFUSAL_MESSAGES[result.failure.code],
      checkedAt: finishedAt,
    });

    return { connection: failed ?? current, eventsSeen: counts.eventsReceived };
  }

  async function applyInferredInternalDomain(
    connection: ConnectionSummary,
  ): Promise<ConnectionSummary> {
    const domain = inferInternalDomain(await organizations.creatorEmail());
    if (domain === null) {
      return connection;
    }

    const updated = await connections.setInferredInternalDomain(connection.id, {
      domain,
      provenance: "org_creator_email",
    });

    return updated ?? connection;
  }

  return {
    async connect(rawInput: ConnectInput): Promise<ConnectResult> {
      const input = connectInputSchema.parse(rawInput);

      if (!deps.credentialKey.ok) {
        return refuse("misconfigured");
      }
      const key: CredentialKey = deps.credentialKey.key;

      const project = await projects.findById(input.projectId);
      if (!project) {
        throw new Error("connect: project not found in this organization");
      }

      const existing = await connections.getActiveForProject(input.projectId);

      const isRekey = existing !== null && isSameSource(existing, input);

      const source = deps.createSource({
        host: input.host,
        sourceProjectId: input.sourceProjectId,
        personalApiKey: input.personalApiKey,
      });
      const validation = await source.validate();

      if (!validation.ok) {
        if (isRekey && existing) {
          await connections.recordHealth(existing.id, {
            health: "failing",
            reasonCode: validation.failure.code,
            reasonMessage: CONNECT_REFUSAL_MESSAGES[validation.failure.code],
            checkedAt: validation.checkedAt,
          });
        }

        return refusalFor(validation.failure);
      }

      const credentialCiphertext = encryptSecret(
        input.personalApiKey,
        key,
        credentialAad(ctx.organizationId, input.projectId),
      );
      const credentialKeyId = keyIdOf(key);

      let attached: ConnectionSummary;

      if (isRekey && existing) {
        const rekeyed = await connections.updateCredential(existing.id, {
          credentialCiphertext,
          credentialKeyId,
        });
        if (!rekeyed) {
          throw new Error("connect: re-key affected no row for this organization");
        }
        attached = rekeyed;
      } else {
        try {
          attached = await connections.insertActive({
            projectId: input.projectId,
            sourceKind: input.sourceKind,
            host: input.host,
            sourceProjectId: input.sourceProjectId,
            credentialCiphertext,
            credentialKeyId,
            health: "healthy",
            connectedAt: deps.now(),

            nextPollAt: new Date(deps.now().getTime() + DEFAULT_POLL_INTERVAL_SECONDS * 1000),
          });
        } catch (error) {
          if (error instanceof ConnectionWriteError && isSecondSourceViolation(error)) {
            const blocking = existing ?? (await connections.getActiveForProject(input.projectId));
            return refuse(
              "second_source",
              blocking
                ? secondSourceRefusalMessage({
                    host: blocking.host,
                    sourceProjectId: blocking.sourceProjectId,
                  })
                : undefined,
            );
          }
          throw error;
        }
      }

      const checked = await connections.recordHealth(attached.id, {
        health: "healthy",
        reasonCode: null,
        reasonMessage: null,
        checkedAt: validation.checkedAt,
      });

      const withDomain = await applyInferredInternalDomain(checked ?? attached);

      const pulled = await performFirstPull(withDomain, source);

      return {
        ok: true,
        connection: pulled.connection,
        firstPullEventsSeen: pulled.eventsSeen,
      };
    },

    async getState(projectId: string): Promise<ConnectionState> {
      return stateOf(await findLatestConnection(db, ctx, projectId));
    },

    async disconnect(projectId: string): Promise<ConnectionState> {
      const active = await connections.getActiveForProject(projectId);
      if (!active) {
        return stateOf(await findLatestConnection(db, ctx, projectId));
      }

      const detached = await connections.deactivate(active.id);
      return stateOf(detached ?? active);
    },
  };
}
