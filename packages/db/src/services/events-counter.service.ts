// The onboarding step 2 counter (O-003 FR-15).
//
// A HAND-WRITTEN AGGREGATION, so it carries `organization_id` ITSELF in every
// predicate rather than relying on a repository's auto-injection. That is the
// architecture §9 rule, and it is exactly the shape whose absence produced the
// sibling cross-tenant incident: an aggregation that establishes tenancy by
// joining is one refactor away from establishing none.
//
// A LIVE AGGREGATION, not a rollup — correct and simple at this volume. It
// needs a rollup table before `events` reaches tens of millions of rows.
import type {
  EventsSeenCounter,
  ExclusionReason,
  SetAsideBreakdown,
  TenantContext,
} from "@growthmind/shared";
import {
  COUNTER_COMPLETENESS_STATEMENT,
  COUNTER_WINDOW_STATEMENT,
  EXCLUSION_REASON_LABELS,
  describeExpectedLag,
} from "@growthmind/shared";
import { and, eq, sql } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { events } from "../schema/events";
import { sessionSourcePollRuns } from "../schema/session-source-poll-runs";
import { sessions } from "../schema/sessions";
import { deriveConnectionState, findLatestConnection } from "./connection-state";

export interface EventsCounterService {
  /**
   * Every number carries its denominator, and every gap stays visible:
   *
   * - `totalReceived = kept + Σ setAside + droppedUnreadable` — an identity,
   *   asserted by test, so the breakdown can never quietly fail to add up.
   * - `kept` / `setAside` come from events joined to their session's
   *   `exclusion_reason`; `setAside` is broken down BY reason so the customer
   *   is told which kind of traffic was removed, in their own terms.
   * - `keptIdentityUnverified` counts sessions kept with
   *   `identity_resolution = "unresolved"` — sessions we could not check.
   *   Reported SEPARATELY from `kept` so "we could not check" is never
   *   laundered into "we checked and it is a real user" (F-8). A completed
   *   lookup proving no email (`absent`) is NOT counted here: that is a fact,
   *   not a gap.
   * - `droppedUnreadable` sums the parser's skipped items across poll runs.
   * - `asOf` is the completion time of the most recent SUCCESSFUL poll run —
   *   never wall-clock now, and never the newest event's own declared time.
   * - `state` distinguishes not-connected from never-polled from
   *   polled-and-found-nothing. Three different situations, three different
   *   answers.
   * - `windowStatement` names the window explicitly. A count with an implied
   *   window is a count nobody can act on.
   */
  read(projectId: string): Promise<EventsSeenCounter>;
}

/** Mirrors `project_connections.poll_interval_seconds`' column default, used
 * only when there is no attachment to read a cadence from. */
const DEFAULT_POLL_INTERVAL_SECONDS = 60;

/** `::int` already yields a JS number through both drivers; this exists so an
 * unexpected driver-side numeric-as-string can never reach a customer-facing
 * subtraction. */
function toCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createEventsCounterService(db: ScopedDb, ctx: TenantContext): EventsCounterService {
  return {
    async read(projectId: string): Promise<EventsSeenCounter> {
      // ---------------------------------------------------------------------
      // Every predicate below names `ctx.organizationId` OUT LOUD. These are
      // hand-written aggregations: nothing about a `group by` or a `sum`
      // inherits tenancy, and establishing it by joining to a scoped table
      // would leave the boundary one refactor away from disappearing (D7,
      // architecture §9). A foreign org reading another org's project id gets
      // zeros here, never that org's numbers.
      // ---------------------------------------------------------------------
      const connection = await findLatestConnection(db, ctx, projectId);

      // Events joined to their own session's stamp. The join is on
      // `session_id`, and BOTH sides carry the org filter — the session table
      // is not trusted to inherit it from the event side or vice versa.
      const breakdownRows = await db
        .select({
          reason: sessions.exclusionReason,
          count: sql<number>`count(*)::int`,
        })
        .from(events)
        .innerJoin(sessions, eq(events.sessionId, sessions.id))
        .where(
          and(
            eq(events.organizationId, ctx.organizationId),
            eq(events.projectId, projectId),
            eq(sessions.organizationId, ctx.organizationId),
          ),
        )
        .groupBy(sessions.exclusionReason);

      // Sessions we KEPT but could not check. Counted from the session table
      // rather than the event table because the thing we failed to establish
      // is a person, not an event — and `absent` is deliberately excluded: a
      // completed lookup proving no email is a fact, not a gap (F-8).
      const [unverified] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessions)
        .where(
          and(
            eq(sessions.organizationId, ctx.organizationId),
            eq(sessions.projectId, projectId),
            eq(sessions.exclusionReason, "none"),
            eq(sessions.identityResolution, "unresolved"),
          ),
        );

      // Poll-run totals, aggregated PER PROJECT rather than per connection, so
      // a cutover to a second source does not silently reset the drop count
      // or the as-of the customer is reading.
      const [runTotals] = await db
        .select({
          runsCompleted: sql<number>`coalesce(sum(case when ${sessionSourcePollRuns.status} = 'completed' then 1 else 0 end), 0)::int`,
          droppedUnreadable: sql<number>`coalesce(sum(${sessionSourcePollRuns.eventsDroppedMalformed}), 0)::int`,
        })
        .from(sessionSourcePollRuns)
        .where(
          and(
            eq(sessionSourcePollRuns.organizationId, ctx.organizationId),
            eq(sessionSourcePollRuns.projectId, projectId),
          ),
        );

      // THE CLOCK ANCHOR. The most recent run that actually SUCCEEDED — a
      // failed run is not an as-of, wall-clock now is a claim we cannot
      // support, and the newest event's own declared time is the customer's
      // browser's clock rather than ours. `nulls last` because a run that
      // never reached a terminal state has a NULL `finished_at`, which a plain
      // `desc` would sort to the FRONT and present as the latest success.
      const [lastSuccessful] = await db
        .select({ finishedAt: sessionSourcePollRuns.finishedAt })
        .from(sessionSourcePollRuns)
        .where(
          and(
            eq(sessionSourcePollRuns.organizationId, ctx.organizationId),
            eq(sessionSourcePollRuns.projectId, projectId),
            eq(sessionSourcePollRuns.status, "completed"),
          ),
        )
        .orderBy(sql`${sessionSourcePollRuns.finishedAt} desc nulls last`)
        .limit(1);

      let kept = 0;
      const setAside: SetAsideBreakdown[] = [];

      for (const row of breakdownRows) {
        const count = toCount(row.count);
        if (count === 0) continue;

        if (row.reason === "none") {
          // "none" means CLASSIFIED AND KEPT. It is the kept total and never
          // also a set-aside row — a kept event counted twice would break the
          // denominator identity silently.
          kept += count;
          continue;
        }

        setAside.push({
          reason: row.reason satisfies ExclusionReason,
          count,
          // The customer's own terms, on the same screen as the number. An
          // unexplained gap reads as a broken product: "the counter says 3 but
          // my analytics says 8".
          label: EXCLUSION_REASON_LABELS[row.reason],
        });
      }

      // Stable order — largest gap first — so the same data never renders in
      // two different orders between reads.
      setAside.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

      const droppedUnreadable = toCount(runTotals?.droppedUnreadable);
      const setAsideTotal = setAside.reduce((total, row) => total + row.count, 0);

      return {
        state: deriveConnectionState(connection, {
          hasCompletedPoll: toCount(runTotals?.runsCompleted) > 0,
          hasEvents: kept + setAsideTotal > 0,
        }),
        // THE DENOMINATOR, built as the sum of its own parts rather than
        // counted separately. There is no second query that could disagree
        // with the breakdown, so the identity holds by construction and the
        // test asserting it is a regression guard rather than a hope.
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
