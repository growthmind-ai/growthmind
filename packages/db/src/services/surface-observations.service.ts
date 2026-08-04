import { MONEY_SEGMENTS, type SurfaceObservation } from "@growthmind/core";
import { URL_PATH_NORMALISATION_VERSION, type TenantContext } from "@growthmind/shared";
import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";

import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { events } from "../schema/events";
import { sessions } from "../schema/sessions";

export const OBSERVED_SURFACE_LIMIT = 200;

export interface ObserveSurfacesInput {
  readonly projectId: string;
  readonly since: Date;
}

export interface SurfaceObservationsService {
  observe(input: ObserveSurfacesInput): Promise<readonly SurfaceObservation[]>;
}

// The parentheses are load-bearing: `or` binds looser than the `and`s it sits beside, so an
// unwrapped chain reads as `(org and project and like_a) or like_b or …` and every predicate
// after the first — the organization filter included — stops applying.
const moneySurface = (column: SQL | typeof events.urlPath): SQL =>
  sql`(${sql.join(
    MONEY_SEGMENTS.map((segment) => sql`lower(${column}) like ${`%${segment}%`}`),
    sql` or `,
  )})`;

export function createSurfaceObservationsService(
  db: ScopedDb,
  ctx: TenantContext,
): SurfaceObservationsService {
  const s = scoped(db, ctx);

  return {
    async observe(input: ObserveSurfacesInput): Promise<readonly SurfaceObservation[]> {
      // §4: a role derived from the founder's own visits, a crawler's, or a preview
      // deployment's describes nobody who matters. Excluded and synthetic sessions are
      // dropped in this one predicate, which every part of the query below reuses.
      const countableSession = and(
        s.org(sessions),
        eq(sessions.projectId, input.projectId),
        eq(sessions.exclusionReason, "none"),
        eq(sessions.origin, "real"),
        sql`${sessions.startedAt} >= ${input.since}`,
      );

      const readableEvent = and(
        s.org(events),
        eq(events.projectId, input.projectId),
        isNotNull(events.urlPath),
        eq(events.urlPathNormalisationVersion, URL_PATH_NORMALISATION_VERSION),
      );

      // A visit is one (session, surface) pair, never one event: a page firing six events
      // per view would otherwise outrank one firing a single event per view.
      const visits = db.$with("visits").as(
        db
          .selectDistinct({
            sessionId: events.sessionId,
            surface: sql<string>`${events.urlPath}`.as("surface"),
            identityKey: sql<string>`${sessions.identityKey}`.as("identity_key"),
            startedAt: sql<Date>`${sessions.startedAt}`.as("started_at"),
          })
          .from(events)
          .innerJoin(sessions, eq(sessions.id, events.sessionId))
          .where(and(readableEvent, countableSession)),
      );

      const returners = db.$with("returners").as(
        db
          .select({ identityKey: sql<string>`${sessions.identityKey}`.as("identity_key") })
          .from(sessions)
          .where(and(countableSession, isNotNull(sessions.identityKey)))
          .groupBy(sessions.identityKey)
          .having(sql`count(*) > 1`),
      );

      // min(started_at) rather than a window function: a session is an identity's first when
      // it started when that identity started.
      const firstSeen = db.$with("first_seen").as(
        db
          .select({
            identityKey: sql<string>`${sessions.identityKey}`.as("identity_key"),
            firstAt: sql<Date>`min(${sessions.startedAt})`.as("first_at"),
          })
          .from(sessions)
          .where(and(countableSession, isNotNull(sessions.identityKey)))
          .groupBy(sessions.identityKey),
      );

      const moneySessions = db.$with("money_sessions").as(
        db
          .selectDistinct({ sessionId: events.sessionId })
          .from(events)
          .innerJoin(sessions, eq(sessions.id, events.sessionId))
          .where(and(readableEvent, countableSession, moneySurface(events.urlPath))),
      );

      const rows = await db
        .with(visits, returners, firstSeen, moneySessions)
        .select({
          surface: sql<string>`v.surface`,
          sessions: sql<number>`count(distinct v.session_id)::int`,
          visitsByReturningIdentities: sql<number>`count(distinct case when v.identity_key in (select identity_key from returners) then v.session_id end)::int`,
          firstSessionVisitsByReturners: sql<number>`count(distinct case when v.identity_key in (select identity_key from returners) and v.started_at = (select first_at from first_seen f where f.identity_key = v.identity_key) then v.session_id end)::int`,
          sessionsAlsoReachingMoney: sql<number>`count(distinct case when v.session_id in (select session_id from money_sessions) then v.session_id end)::int`,
        })
        .from(sql`visits v`)
        .groupBy(sql`v.surface`)
        .orderBy(sql`count(distinct v.session_id) desc`)
        .limit(OBSERVED_SURFACE_LIMIT);

      return rows.map((row) => ({
        surface: row.surface,
        normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        sessions: row.sessions,
        firstSessionVisitsByReturners: row.firstSessionVisitsByReturners,
        visitsByReturningIdentities: row.visitsByReturningIdentities,
        sessionsAlsoReachingMoney: row.sessionsAlsoReachingMoney,
      }));
    },
  };
}
