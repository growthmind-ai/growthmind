import type { EventsSeenCounter, ExclusionReason, TenantContext } from "@growthmind/shared";
import {
  COUNTER_COMPLETENESS_STATEMENT,
  COUNTER_WINDOW_STATEMENT,
  describeExpectedLag,
} from "@growthmind/shared";
import { and, eq, sql } from "drizzle-orm";

import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { events } from "../schema/events";
import { sessionSourcePollRuns } from "../schema/session-source-poll-runs";
import { sessions } from "../schema/sessions";
import { deriveConnectionState, findLatestConnection } from "./connection-state";
import { buildSetAsideBreakdown } from "./set-aside-breakdown";

export interface EventsCounterService {
  read(projectId: string): Promise<EventsSeenCounter>;
}

const DEFAULT_POLL_INTERVAL_SECONDS = 60;

function toCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createEventsCounterService(db: ScopedDb, ctx: TenantContext): EventsCounterService {
  const s = scoped(db, ctx);

  return {
    async read(projectId: string): Promise<EventsSeenCounter> {
      const connection = await findLatestConnection(db, ctx, projectId);

      const breakdownRows = await db
        .select({
          reason: sessions.exclusionReason,
          count: sql<number>`count(*)::int`,
        })
        .from(events)
        .innerJoin(sessions, eq(events.sessionId, sessions.id))
        .where(
          // Both joined tables carry their own org predicate — the join key alone
          // does not scope the right-hand side.
          and(s.org(events), eq(events.projectId, projectId), s.org(sessions)),
        )
        .groupBy(sessions.exclusionReason);

      const [unverified] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessions)
        .where(
          s.owned(
            sessions,
            eq(sessions.projectId, projectId),
            eq(sessions.exclusionReason, "none"),
            eq(sessions.identityResolution, "unresolved"),
          ),
        );

      const [runTotals] = await db
        .select({
          runsCompleted: sql<number>`coalesce(sum(case when ${sessionSourcePollRuns.status} = 'completed' then 1 else 0 end), 0)::int`,
          droppedUnreadable: sql<number>`coalesce(sum(${sessionSourcePollRuns.eventsDroppedMalformed}), 0)::int`,
        })
        .from(sessionSourcePollRuns)
        .where(s.owned(sessionSourcePollRuns, eq(sessionSourcePollRuns.projectId, projectId)));

      const [lastSuccessful] = await db
        .select({ finishedAt: sessionSourcePollRuns.finishedAt })
        .from(sessionSourcePollRuns)
        .where(
          s.owned(
            sessionSourcePollRuns,
            eq(sessionSourcePollRuns.projectId, projectId),
            eq(sessionSourcePollRuns.status, "completed"),
          ),
        )
        .orderBy(sql`${sessionSourcePollRuns.finishedAt} desc nulls last`)
        .limit(1);

      let kept = 0;
      const eventsByReason: [ExclusionReason, number][] = [];

      for (const row of breakdownRows) {
        const count = toCount(row.count);
        if (count === 0) continue;

        if (row.reason === "none") {
          kept += count;
          continue;
        }

        eventsByReason.push([row.reason satisfies ExclusionReason, count]);
      }

      const setAside = buildSetAsideBreakdown({ unit: "events", countsByReason: eventsByReason });

      const droppedUnreadable = toCount(runTotals?.droppedUnreadable);
      const setAsideTotal = setAside.reduce((total, row) => total + row.count, 0);

      return {
        state: deriveConnectionState(connection, {
          hasCompletedPoll: toCount(runTotals?.runsCompleted) > 0,
          hasEvents: kept + setAsideTotal > 0,
        }),

        totalReceived: kept + setAsideTotal + droppedUnreadable,
        kept,
        setAside,
        keptIdentityUnverified: toCount(unverified?.count),
        droppedUnreadable,
        asOf: lastSuccessful?.finishedAt ?? null,
        windowStatement: COUNTER_WINDOW_STATEMENT,
        completenessStatement: COUNTER_COMPLETENESS_STATEMENT,
        expectedLag: describeExpectedLag({
          pollIntervalSeconds: connection?.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS,
        }),
      };
    },
  };
}
