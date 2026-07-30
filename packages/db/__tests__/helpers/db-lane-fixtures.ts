// Row seeders for the O-003 repository/system suites (Wave 0b, lane L3).
//
// `__tests__/helpers/fixtures.ts` already owns org/user/member/project/
// connection seeding. This file adds only the three row shapes that lane's
// tests need and that file does not have — `sessions`, `events`, and
// `session_source_poll_runs` — deliberately in a lane-named module so a
// parallel lane editing `fixtures.ts` can never collide with it.
//
// Every seeder writes a REAL row through the same drizzle instance the
// repositories under test use, and every seeder takes `organizationId`
// EXPLICITLY rather than a `TenantContext`: the cross-tenant fixtures must be
// able to express "a row in org B that org A's context must not see", and a
// context-only seeder cannot say that.
//
// These bypass the repositories on purpose — they are the arrange step, never
// the assertion. Every read-back in the suites goes back through the public
// repository contract, or the test would prove nothing about scoping.
import { randomUUID } from "node:crypto";

import type {
  ExclusionReason,
  IdentityResolution,
  Origin,
  PollRunOutcome,
  PollRunStatus,
  SourceFailureCode,
} from "@growthmind/shared";

import type { ScopedDb } from "../../src/repositories/types";
import * as schema from "../../src/schema";

/**
 * Suite-unique fixture naming. The O-002 retro's costliest hour went to four
 * suites colliding on a reused `user.email`, which read as a correct red and
 * was not — so every org name, user email, and project name in this lane
 * carries the lane prefix `db-` plus a per-file token plus a counter.
 */
export function laneNames(fileToken: string): {
  orgName: (label: string) => string;
  userName: (label: string) => string;
  email: (label: string) => string;
  projectName: (label: string) => string;
} {
  const base = `db-${fileToken}`;
  return {
    orgName: (label) => `${base}-org-${label}`,
    userName: (label) => `${base}-user-${label}`,
    // example.com is IANA-reserved; nothing here addresses a real mailbox.
    email: (label) => `${base}-${label}@example.com`,
    projectName: (label) => `${base}-project-${label}`,
  };
}

export interface SeededSession {
  id: string;
  sessionKey: string;
}

export async function seedSession(
  db: ScopedDb,
  params: {
    organizationId: string;
    projectId: string;
    connectionId: string;
    sessionKey: string;
    identityKey?: string | null;
    identityEmailDomain?: string | null;
    identityResolution?: IdentityResolution;
    userAgent?: string | null;
    entryUrlPath?: string | null;
    startedAt?: Date;
    lastEventAt?: Date;
    origin?: Origin;
    exclusionReason?: ExclusionReason;
    internalDomainAtStamp?: string | null;
    exclusionRuleSetVersion?: number;
    groupingVersion?: number;
  },
): Promise<SeededSession> {
  const startedAt = params.startedAt ?? new Date("2026-07-30T10:00:00.000Z");

  const [row] = await db
    .insert(schema.sessions)
    .values({
      id: randomUUID(),
      organizationId: params.organizationId,
      projectId: params.projectId,
      connectionId: params.connectionId,
      sessionKey: params.sessionKey,
      identityKey: params.identityKey ?? null,
      identityEmailDomain: params.identityEmailDomain ?? null,
      identityResolution: params.identityResolution ?? "unresolved",
      userAgent: params.userAgent ?? null,
      entryUrlPath: params.entryUrlPath ?? null,
      startedAt,
      lastEventAt: params.lastEventAt ?? startedAt,
      origin: params.origin ?? "real",
      exclusionReason: params.exclusionReason ?? "none",
      internalDomainAtStamp: params.internalDomainAtStamp ?? null,
      exclusionRuleSetVersion: params.exclusionRuleSetVersion ?? 1,
      groupingVersion: params.groupingVersion ?? 1,
    })
    .returning();

  if (!row) {
    throw new Error("seedSession: insert returned no row");
  }

  return { id: row.id, sessionKey: row.sessionKey };
}

export interface SeededEvent {
  id: string;
  sourceEventId: string;
}

export async function seedEvent(
  db: ScopedDb,
  params: {
    organizationId: string;
    projectId: string;
    connectionId: string;
    sessionId: string;
    sourceEventId: string;
    name?: string;
    occurredAt?: Date;
    urlPath?: string | null;
  },
): Promise<SeededEvent> {
  const [row] = await db
    .insert(schema.events)
    .values({
      id: randomUUID(),
      organizationId: params.organizationId,
      projectId: params.projectId,
      connectionId: params.connectionId,
      sessionId: params.sessionId,
      sourceEventId: params.sourceEventId,
      name: params.name ?? "$pageview",
      occurredAt: params.occurredAt ?? new Date("2026-07-30T10:00:00.000Z"),
      urlPath: params.urlPath ?? "/pricing",
    })
    .returning();

  if (!row) {
    throw new Error("seedEvent: insert returned no row");
  }

  return { id: row.id, sourceEventId: row.sourceEventId };
}

export interface SeededPollRun {
  id: string;
}

export async function seedPollRun(
  db: ScopedDb,
  params: {
    organizationId: string;
    projectId: string;
    connectionId: string;
    status?: PollRunStatus;
    outcome?: PollRunOutcome | null;
    failureCode?: SourceFailureCode | null;
    failureMessage?: string | null;
    startedAt?: Date;
    finishedAt?: Date | null;
    eventsReceived?: number;
    eventsPersisted?: number;
    eventsDroppedMalformed?: number;
    sessionsTouched?: number;
    pagesFetched?: number;
    identityLookupsUsed?: number;
    watermarkAdvancedTo?: Date | null;
  },
): Promise<SeededPollRun> {
  const [row] = await db
    .insert(schema.sessionSourcePollRuns)
    .values({
      id: randomUUID(),
      organizationId: params.organizationId,
      projectId: params.projectId,
      connectionId: params.connectionId,
      status: params.status ?? "completed",
      outcome: params.outcome ?? "with_events",
      failureCode: params.failureCode ?? null,
      failureMessage: params.failureMessage ?? null,
      startedAt: params.startedAt ?? new Date("2026-07-30T10:00:00.000Z"),
      finishedAt: params.finishedAt ?? new Date("2026-07-30T10:00:05.000Z"),
      eventsReceived: params.eventsReceived ?? 1,
      eventsPersisted: params.eventsPersisted ?? 1,
      eventsDroppedMalformed: params.eventsDroppedMalformed ?? 0,
      sessionsTouched: params.sessionsTouched ?? 1,
      pagesFetched: params.pagesFetched ?? 1,
      identityLookupsUsed: params.identityLookupsUsed ?? 0,
      watermarkAdvancedTo: params.watermarkAdvancedTo ?? new Date("2026-07-30T10:00:00.000Z"),
    })
    .returning();

  if (!row) {
    throw new Error("seedPollRun: insert returned no row");
  }

  return { id: row.id };
}
