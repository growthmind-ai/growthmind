import type {
  Origin,
  SessionSourcePullResult,
  SourceEvent,
  SourceSession,
  TenantContext,
} from "@growthmind/shared";
import {
  CURRENT_EXCLUSION_RULE_SET,
  EXCLUSION_RULE_SET_VERSION,
  SESSION_GROUPING_VERSION,
  URL_PATH_NORMALISATION_VERSION,
  classifyExclusion,
  normaliseUrlPath,
} from "@growthmind/shared";

import { createEventsRepo, type EventInsertRow } from "../repositories/events.repo";
import { createSessionsRepo, type SessionUpsertRow } from "../repositories/sessions.repo";
import type { ScopedDb } from "../repositories/types";

export interface IntakeConnection {
  id: string;
  projectId: string;

  inferredInternalDomain: string | null;
}

export interface IntakeCounts {
  eventsReceived: number;
  eventsPersisted: number;
  sessionsTouched: number;
  eventsDroppedMalformed: number;
}

const INTAKE_ORIGIN: Origin = "real";

function collectedFrom(result: SessionSourcePullResult): {
  sessions: readonly SourceSession[];
  events: readonly SourceEvent[];
} {
  return result.ok
    ? { sessions: result.sessions, events: result.events }
    : { sessions: result.partialSessions, events: result.partialEvents };
}

function normalisationVersionFor(urlPath: string | null): number | null {
  if (urlPath === null) return URL_PATH_NORMALISATION_VERSION;

  return normaliseUrlPath(urlPath, null) === urlPath ? URL_PATH_NORMALISATION_VERSION : null;
}

export async function persistPullResult(
  db: ScopedDb,
  ctx: TenantContext,
  input: { connection: IntakeConnection; result: SessionSourcePullResult },
): Promise<IntakeCounts> {
  const { connection, result } = input;
  const collected = collectedFrom(result);

  const sessionRows: SessionUpsertRow[] = collected.sessions.map((session) => ({
    projectId: connection.projectId,
    connectionId: connection.id,
    sessionKey: session.sessionKey,
    identityKey: session.identityKey,
    identityEmailDomain: session.identityEmailDomain,
    identityResolution: session.identityResolution,
    userAgent: session.userAgent,
    entryUrlPath: session.entryUrlPath,
    startedAt: session.startedAt,
    lastEventAt: session.lastEventAt,
    origin: INTAKE_ORIGIN,

    exclusionReason: classifyExclusion(
      {
        identityEmailDomain: session.identityEmailDomain,
        identityResolution: session.identityResolution,
        internalDomain: connection.inferredInternalDomain,
        userAgent: session.userAgent,
      },
      CURRENT_EXCLUSION_RULE_SET,
    ),
    internalDomainAtStamp: connection.inferredInternalDomain,

    exclusionRuleSetVersion: EXCLUSION_RULE_SET_VERSION,
    groupingVersion: SESSION_GROUPING_VERSION,
  }));

  const persistedSessions = await createSessionsRepo(db, ctx).upsertMany(sessionRows);

  const sessionIdByKey = new Map(persistedSessions.map((row) => [row.sessionKey, row.id]));

  const eventRows: EventInsertRow[] = [];
  for (const event of collected.events) {
    const sessionId = sessionIdByKey.get(event.sessionKey);
    if (sessionId === undefined) {
      continue;
    }

    eventRows.push({
      projectId: connection.projectId,
      connectionId: connection.id,
      sessionId,
      sourceEventId: event.sourceEventId,
      name: event.name,
      occurredAt: event.occurredAt,
      urlPath: event.urlPath,

      urlPathNormalisationVersion: normalisationVersionFor(event.urlPath),
    });
  }

  const eventsPersisted = await createEventsRepo(db, ctx).insertManyIgnoringDuplicates(eventRows);

  return {
    eventsReceived: result.eventsReceived,
    eventsPersisted,
    sessionsTouched: persistedSessions.length,

    eventsDroppedMalformed: result.droppedMalformed,
  };
}
