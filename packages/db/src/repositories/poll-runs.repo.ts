// Repository for the `session_source_poll_runs` table. D-B: org-scoped at
// construction, no organization id parameter, mutations keyed on `(org, id)`.
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

/** Counters every terminal path reports, so a failed run is as informative
 * as a successful one. */
export interface PollRunCounts {
  eventsReceived: number;
  eventsPersisted: number;
  eventsDroppedMalformed: number;
  sessionsTouched: number;
  pagesFetched: number;
  identityLookupsUsed: number;
}

/**
 * A run is `completed` or `failed` — there is no third shape and no way to
 * express a non-terminal finish. Every exit path in the handler produces one
 * of these, which is what keeps a stuck "running" from being shippable (D8).
 */
export type PollRunTerminal =
  | ({
      status: "completed";
      finishedAt: Date;
      /** `no_new_events` is recorded DISTINCTLY from `with_events`: an empty
       * page is never authoritative, so a permanently-zero connection must be
       * visible rather than indistinguishable from a quiet healthy one. */
      outcome: PollRunOutcome;
      /** Non-null only when the walk was provably contiguous. */
      watermarkAdvancedTo: Date | null;
    } & PollRunCounts)
  | ({
      status: "failed";
      finishedAt: Date;
      failureCode: SourceFailureCode;
      /** Plain English. Scrubbed of key material before it gets here. */
      failureMessage: string;
    } & PollRunCounts);

export interface PollRunAggregate {
  runsCompleted: number;
  runsFailed: number;
  /** Summed across every run, for the counter's `droppedUnreadable`. */
  totalDroppedMalformed: number;
  totalEventsReceived: number;
  totalEventsPersisted: number;
  /** The completion time of the most recent SUCCESSFUL run — the counter's
   * `asOf` anchor. Not wall-clock now, and not the newest event's own
   * declared time. `null` when no run has ever succeeded. */
  lastSuccessfulFinishedAt: Date | null;
}

export interface PollRunsRepo {
  start(input: StartPollRunInput): Promise<PollRunRecord>;
  /** Keyed on `(org, id)` — `null` for a foreign org's run id. */
  finish(id: string, terminal: PollRunTerminal): Promise<PollRunRecord | null>;
  /** The most recent run with `status = "completed"`, or `null`. */
  latestCompletedFor(connectionId: string): Promise<PollRunRecord | null>;
  aggregateFor(connectionId: string): Promise<PollRunAggregate>;
}

/** `::int` already yields a JS number through both drivers; this exists so an
 * unexpected driver-side numeric-as-string can never reach a caller doing
 * arithmetic on the counter. */
function toCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createPollRunsRepo(db: ScopedDb, ctx: TenantContext): PollRunsRepo {
  /** Newest completed run first. `nulls last` because a `finished_at` of NULL
   * is a run that never reached a terminal state, and Postgres would sort it
   * to the FRONT of a plain `desc` — the stuck-run row masquerading as the
   * latest success. */
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
      // The two terminal shapes are written EXHAUSTIVELY — each clears the
      // other's columns rather than leaving them stale, so a run that failed
      // after a previous attempt set an outcome cannot read as half-successful.
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
      // A HAND-WRITTEN AGGREGATION CARRIES ITS OWN ORG FILTER (§9). Nothing
      // about an aggregate inherits tenancy, so `organization_id` is in the
      // WHERE clause explicitly and the totals are zeros — never another org's
      // numbers — for a connection id this context does not own.
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

      // Read through the typed column rather than a raw `max(…)` expression so
      // the driver hands back a real `Date`, not a driver-dependent string.
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
