import type { PollRunOutcome, SourceFailureCode, TenantContext } from "@growthmind/shared";
import { and, eq, sql } from "drizzle-orm";

import { sessionSourcePollRuns } from "../schema/session-source-poll-runs";
import type { ScopedDb } from "./types";

export type PollRunRecord = typeof sessionSourcePollRuns.$inferSelect;

export interface StartPollRunInput {
  projectId: string;
  connectionId: string;
  startedAt: Date;
}

export interface PollRunCounts {
  eventsReceived: number;
  eventsPersisted: number;
  eventsDroppedMalformed: number;
  sessionsTouched: number;
  pagesFetched: number;
  identityLookupsUsed: number;
}

export type PollRunTerminal =
  | ({
      status: "completed";
      finishedAt: Date;

      outcome: PollRunOutcome;

      watermarkAdvancedTo: Date | null;
    } & PollRunCounts)
  | ({
      status: "failed";
      finishedAt: Date;
      failureCode: SourceFailureCode;

      failureMessage: string;
    } & PollRunCounts);

export interface PollRunAggregate {
  runsCompleted: number;
  runsFailed: number;

  totalDroppedMalformed: number;
  totalEventsReceived: number;
  totalEventsPersisted: number;

  lastSuccessfulFinishedAt: Date | null;
}

export interface PollRunsRepo {
  start(input: StartPollRunInput): Promise<PollRunRecord>;

  finish(id: string, terminal: PollRunTerminal): Promise<PollRunRecord | null>;

  latestCompletedFor(connectionId: string): Promise<PollRunRecord | null>;
  aggregateFor(connectionId: string): Promise<PollRunAggregate>;
}

function toCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createPollRunsRepo(db: ScopedDb, ctx: TenantContext): PollRunsRepo {
  function completedForConnection(connectionId: string) {
    return db
      .select()
      .from(sessionSourcePollRuns)
      .where(
        and(
          eq(sessionSourcePollRuns.organizationId, ctx.organizationId),
          eq(sessionSourcePollRuns.connectionId, connectionId),
          eq(sessionSourcePollRuns.status, "completed"),
        ),
      )
      .orderBy(sql`${sessionSourcePollRuns.finishedAt} desc nulls last`)
      .limit(1);
  }

  return {
    async start(input: StartPollRunInput): Promise<PollRunRecord> {
      const [row] = await db
        .insert(sessionSourcePollRuns)
        .values({
          organizationId: ctx.organizationId,
          projectId: input.projectId,
          connectionId: input.connectionId,
          startedAt: input.startedAt,
          status: "running",
          outcome: null,
        })
        .returning();

      if (!row) {
        throw new Error("createPollRunsRepo.start: insert returned no row");
      }

      return row;
    },

    async finish(id: string, terminal: PollRunTerminal): Promise<PollRunRecord | null> {
      const columns =
        terminal.status === "completed"
          ? {
              status: "completed" as const,
              finishedAt: terminal.finishedAt,
              outcome: terminal.outcome,
              watermarkAdvancedTo: terminal.watermarkAdvancedTo,
              failureCode: null,
              failureMessage: null,
            }
          : {
              status: "failed" as const,
              finishedAt: terminal.finishedAt,
              outcome: null,
              watermarkAdvancedTo: null,
              failureCode: terminal.failureCode,
              failureMessage: terminal.failureMessage,
            };

      const [row] = await db
        .update(sessionSourcePollRuns)
        .set({
          ...columns,
          eventsReceived: terminal.eventsReceived,
          eventsPersisted: terminal.eventsPersisted,
          eventsDroppedMalformed: terminal.eventsDroppedMalformed,
          sessionsTouched: terminal.sessionsTouched,
          pagesFetched: terminal.pagesFetched,
          identityLookupsUsed: terminal.identityLookupsUsed,
        })
        .where(
          and(
            eq(sessionSourcePollRuns.organizationId, ctx.organizationId),
            eq(sessionSourcePollRuns.id, id),

            eq(sessionSourcePollRuns.status, "running"),
          ),
        )
        .returning();

      return row ?? null;
    },

    async latestCompletedFor(connectionId: string): Promise<PollRunRecord | null> {
      const [row] = await completedForConnection(connectionId);
      return row ?? null;
    },

    async aggregateFor(connectionId: string): Promise<PollRunAggregate> {
      const [totals] = await db
        .select({
          runsCompleted: sql<number>`coalesce(sum(case when ${sessionSourcePollRuns.status} = 'completed' then 1 else 0 end), 0)::int`,
          runsFailed: sql<number>`coalesce(sum(case when ${sessionSourcePollRuns.status} = 'failed' then 1 else 0 end), 0)::int`,
          totalDroppedMalformed: sql<number>`coalesce(sum(${sessionSourcePollRuns.eventsDroppedMalformed}), 0)::int`,
          totalEventsReceived: sql<number>`coalesce(sum(${sessionSourcePollRuns.eventsReceived}), 0)::int`,
          totalEventsPersisted: sql<number>`coalesce(sum(${sessionSourcePollRuns.eventsPersisted}), 0)::int`,
        })
        .from(sessionSourcePollRuns)
        .where(
          and(
            eq(sessionSourcePollRuns.organizationId, ctx.organizationId),
            eq(sessionSourcePollRuns.connectionId, connectionId),
          ),
        );

      const [latest] = await completedForConnection(connectionId);

      return {
        runsCompleted: toCount(totals?.runsCompleted),
        runsFailed: toCount(totals?.runsFailed),
        totalDroppedMalformed: toCount(totals?.totalDroppedMalformed),
        totalEventsReceived: toCount(totals?.totalEventsReceived),
        totalEventsPersisted: toCount(totals?.totalEventsPersisted),
        lastSuccessfulFinishedAt: latest?.finishedAt ?? null,
      };
    },
  };
}
