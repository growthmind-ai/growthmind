// The T1 detector corpus read.
//
// A hand-written aggregation, deliberately not a `*.repo.ts`: it is the same shape as
// `events-counter.service.ts`, so every predicate must name `ctx.organizationId` itself
// rather than inheriting tenancy from a repository's auto-injection or from the other
// side of a join (architecture). Both the sessions query and the events query carry
// the org filter; neither side is trusted to establish it for the other.
//
// The database layer's only job here is to return an org-scoped, ordered, windowed
// corpus of plain rows. No threshold, no comparison, and no class judgement lives in
// SQL. Every one of those is pure TypeScript in `@growthmind/core`. The dependency
// arrow is `db → core`, never `core → db`: this file imports `core`'s types; nothing in
// `core` may import this package.
//
// The read caps at `DETECTOR_CORPUS_MAX_SESSIONS` sessions and then loads all events
// for exactly those sessions (never mid-session) and reports `coverage.truncated` when
// the cap bound the result. A half-loaded session fabricates a drop-off, which is a
// false positive manufactured by pagination.
//
// A session is in the corpus iff `started_at ∈ [window.start, window.end]` (inclusive
// both ends). Once selected its events are returned whole, regardless of their own
// `occurred_at`. The window is an injected parameter. There is no clock on this path.
//
// The exclusion filter is not applied here: the corpus returns every selected session carrying
// its own `exclusionReason`, and the detector filters to `"none"` and uses `basis.kept`
// as its denominator. That keeps asserted against the tested pure layer rather than
// against an untested SQL read.
import type {
  AnalysisWindow,
  DetectorCorpus,
  SessionTimeline,
  TimelineEvent,
} from "@growthmind/core";
import { DETECTOR_CORPUS_MAX_SESSIONS } from "@growthmind/core";
import type { ExclusionReason, TenantContext } from "@growthmind/shared";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { events } from "../schema/events";
import { sessionSourcePollRuns } from "../schema/session-source-poll-runs";
import { sessions } from "../schema/sessions";
import { deriveConnectionState, findLatestConnection } from "./connection-state";
import { buildSetAsideBreakdown } from "./set-aside-breakdown";

export interface DetectorCorpusService {
  /**
   * The org-scoped, windowed, session-capped corpus a T1 detector run reads.
   *
   * `window` is injected, never derived from a clock.
   * Sessions are selected by `started_at` within the window, ordered `started_at DESC,
   *  id DESC`, capped at `DETECTOR_CORPUS_MAX_SESSIONS`; each selected session's
   *  events are then returned whole.
   * Every session carries its own `exclusionReason`; the detector (not this read)
   *  applies and takes its denominator from `basis.kept`.
   * `connectionState` comes from the existing `deriveConnectionState`, so "polled and
   *  found nothing" stays distinguishable from "never polled".
   * `coverage.truncated` reports the cap binding; a silent truncation reads as "no more
   *  events" and was the precedent incident.
   */
  read(projectId: string, window: AnalysisWindow): Promise<DetectorCorpus>;
}

/**
 * The cap probe. Selecting one more session than the cap allows is what makes
 * `coverage.truncated` a fact about the read rather than a second query that could
 * disagree with the first: if the extra row came back, the window held more than the
 * corpus carries.
 */
const CAP_PROBE_LIMIT = DETECTOR_CORPUS_MAX_SESSIONS + 1;

/**
 * `coverage.eventsWithoutUrlPath` is not computed by this read (edge taxonomy).
 *
 * The detector's value is authoritative: `analysedSessions` in `@growthmind/core`
 * recomputes it over the kept sessions it is about to analyse, and both detectors take
 * it from that one call, so the number is provably about what was analysed rather than
 * about what this read believed. Nothing in production ever read the value this service
 * used to compute, `analysedSessions` propagates `coverage.truncated` and recomputes
 * this one, so it was a dead wire: harmless only for as long as the two populations
 * happened to agree, and a silent disagreement the day they stopped.
 *
 * `truncated` is the opposite case and is genuinely produced here: it is a fact about
 * the read that no amount of looking at the returned sessions can recover.
 *
 * Named rather than inlined so the deadness is legible at the one site anyone would
 * read it from, instead of looking like a computed zero.
 */
const NOT_COMPUTED_BY_THE_READ = 0;

export function createDetectorCorpusService(
  db: ScopedDb,
  ctx: TenantContext,
): DetectorCorpusService {
  return {
    async read(projectId: string, window: AnalysisWindow): Promise<DetectorCorpus> {
      // Every predicate below names `ctx.organizationId` out loud, on both the sessions
      // side and the events side. Neither side inherits tenancy from the other: a read
      // that establishes tenancy by joining to an already-scoped table passes every
      // behavioural test and is one refactor away from establishing none, which is the
      // exact mechanism behind the sibling cross-tenant incident (architecture).

      //  Sessions in the window. `started_at ∈ [start, end]`, inclusive at both
      // ends. The window anchors on the session. Filtering events by it instead would
      // cut sessions at the boundary and reintroduce the fabricated drop-off through a
      // different door.
      //
      // `SELECT` and `ORDER BY` only: no `HAVING`, no `count > n`, no window
      // function. Every count, comparison and threshold below is plain TypeScript, so
      // `THRESHOLD_RULE_SETS` can version it and a unit test can pin its fail
      // direction.
      const windowRows = await db
        .select({
          id: sessions.id,
          startedAt: sessions.startedAt,
          exclusionReason: sessions.exclusionReason,
          entryUrlPath: sessions.entryUrlPath,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.organizationId, ctx.organizationId),
            eq(sessions.projectId, projectId),
            gte(sessions.startedAt, window.start),
            lte(sessions.startedAt, window.end),
          ),
        )
        .orderBy(desc(sessions.startedAt), desc(sessions.id))
        .limit(CAP_PROBE_LIMIT);

      // The cap drops whole sessions, from the oldest end, and says so. A mid-session
      // cap fabricates a drop-off. The events proving the user reached the destination
      // are exactly the ones it would drop, so the detector would report a completion
      // as an abandonment. Capping by session makes every loaded session complete by
      // construction. the precedent incident was a silent truncation that read as "no more
      // events"; reporting it here is that fix applied before the incident rather than
      // after it.
      const truncated = windowRows.length > DETECTOR_CORPUS_MAX_SESSIONS;
      const selected = truncated ? windowRows.slice(0, DETECTOR_CORPUS_MAX_SESSIONS) : windowRows;
      const selectedIds = selected.map((row) => row.id);

      //  all events for exactly those session ids, never mid-session, and never
      // filtered by the window. Ordered `(occurred_at ASC, source_event_id ASC)`: the
      // composite is total by the events table's own idempotency index, so the order is
      // stable across runs and drivers. `source_event_id` happens to be a UUIDv7 in
      // this deployment; determinism is the contract, the v7 property is not.
      const eventRows =
        selectedIds.length === 0
          ? []
          : await db
              .select({
                sessionId: events.sessionId,
                sourceEventId: events.sourceEventId,
                name: events.name,
                occurredAt: events.occurredAt,
                urlPath: events.urlPath,
                urlPathNormalisationVersion: events.urlPathNormalisationVersion,
              })
              .from(events)
              .where(
                and(
                  eq(events.organizationId, ctx.organizationId),
                  eq(events.projectId, projectId),
                  inArray(events.sessionId, selectedIds),
                ),
              )
              .orderBy(asc(events.occurredAt), asc(events.sourceEventId));

      const eventsBySession = new Map<string, TimelineEvent[]>();
      for (const row of eventRows) {
        const timeline = eventsBySession.get(row.sessionId);
        const event: TimelineEvent = {
          sourceEventId: row.sourceEventId,
          name: row.name,
          occurredAt: row.occurredAt,
          urlPath: row.urlPath,
          // `null` means "written before versions were recorded. Redaction status
          // unknown", and is never coerced to `0`.
          urlPathNormalisationVersion: row.urlPathNormalisationVersion,
        };
        if (timeline) {
          timeline.push(event);
        } else {
          eventsBySession.set(row.sessionId, [event]);
        }
      }

      // The exclusion filter is not applied here (ruling 7): every selected session is
      // returned carrying its own `exclusionReason`, and the detector filters to
      // `"none"`. That keeps asserted against the tested pure layer rather than against
      // an untested SQL read.
      const timelines: SessionTimeline[] = selected.map((row) => ({
        sessionId: row.id,
        startedAt: row.startedAt,
        exclusionReason: row.exclusionReason satisfies ExclusionReason,
        entryUrlPath: row.entryUrlPath,
        events: eventsBySession.get(row.id) ?? [],
      }));

      // The denominator and its composition. A bot never had the opportunity to
      // convert, so counting it understates every rate this corpus can support.
      // Set-aside sessions are returned, but they are not the denominator.
      //
      // The unit here is **sessions**, one tally per session, not per event.
      // `events-counter.service.ts` produces a same-shaped `setAside` out of
      // **events**, which is why `buildSetAsideBreakdown` makes both call sites name
      // their unit out loud.
      let kept = 0;
      const sessionsByReason = new Map<ExclusionReason, number>();
      for (const timeline of timelines) {
        if (timeline.exclusionReason === "none") {
          // "none" means classified and kept. It is never also a set-aside row, or the
          // identity below would hold while double-counting.
          kept += 1;
          continue;
        }
        sessionsByReason.set(
          timeline.exclusionReason,
          (sessionsByReason.get(timeline.exclusionReason) ?? 0) + 1,
        );
      }

      // Labels and order come from the one builder the shipped counter also uses, so
      // has one vocabulary in one order, not two.
      const setAside = buildSetAsideBreakdown({
        unit: "sessions",
        countsByReason: sessionsByReason,
      });

      // The connection story, from the one `deriveConnectionState` rather than a second
      // copy of its branch order. `hasEvents` is project-wide, not window-scoped,
      // matching `events-counter.service.ts`: `ConnectionState` answers "is this
      // project wired up and sending?", an installation-health question. A project with
      // events last month and none this week is `connected_receiving` with an empty
      // corpus, which is exactly. Window-scoping it would conflate "your
      // integration is broken" with "nothing happened this week"; only the first is
      // actionable.
      const connection = await findLatestConnection(db, ctx, projectId);

      const [completedPoll] = await db
        .select({ id: sessionSourcePollRuns.id })
        .from(sessionSourcePollRuns)
        .where(
          and(
            eq(sessionSourcePollRuns.organizationId, ctx.organizationId),
            eq(sessionSourcePollRuns.projectId, projectId),
            eq(sessionSourcePollRuns.status, "completed"),
          ),
        )
        .limit(1);

      const [anyEvent] = await db
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.organizationId, ctx.organizationId), eq(events.projectId, projectId)))
        .limit(1);

      return {
        // The corpus describes what was asked for, so the requested id is echoed even
        // on a cross-tenant miss; emptiness is carried by `sessions` and `basis`, never
        // by the id.
        projectId,
        window,
        connectionState: deriveConnectionState(connection, {
          hasCompletedPoll: completedPoll !== undefined,
          hasEvents: anyEvent !== undefined,
        }),
        sessions: timelines,
        basis: {
          // `basis` describes the corpus that was returned, so the identity `kept + Σ
          // setAside === totalInWindow` holds by construction rather than by hope. The
          // cap's effect is reported separately, by `coverage.truncated`, and never
          // hidden inside a denominator.
          totalInWindow: timelines.length,
          kept,
          setAside,
        },
        coverage: { truncated, eventsWithoutUrlPath: NOT_COMPUTED_BY_THE_READ },
      };
    },
  };
}
