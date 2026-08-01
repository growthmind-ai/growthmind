// Repository for the `sessions` table: org-scoped at construction, no organization id
// parameter, mutations keyed on `(org, id)`.
import type {
  ExclusionReason,
  IdentityResolution,
  Origin,
  TenantContext,
} from "@growthmind/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { projects } from "../schema/projects";
import { sessions } from "../schema/sessions";
import type { ScopedDb } from "./types";

export type SessionRecord = typeof sessions.$inferSelect;

export interface SessionUpsertRow {
  projectId: string;
  connectionId: string;
  sessionKey: string;
  identityKey: string | null;
  /** Domain only, never the address. */
  identityEmailDomain: string | null;
  identityResolution: IdentityResolution;
  userAgent: string | null;
  entryUrlPath: string | null;
  startedAt: Date;
  lastEventAt: Date;
  origin: Origin;
  exclusionReason: ExclusionReason;
  internalDomainAtStamp: string | null;
  exclusionRuleSetVersion: number;
  groupingVersion: number;
}

export interface SessionsRepo {
  /**
   * `ON CONFLICT (project_id, session_key) DO UPDATE`, idempotent under repeated
   * application by construction, which is what makes a retried worker task safe without
   * a prior existence check:
   *
   * `started_at` takes the earliest of stored and incoming;
   * `last_event_at` takes the latest;
   * `identity_email_domain` keeps the stored value when it is already set;
   * `identity_resolution` upgrades monotonically along `unresolved → absent → resolved`
   *  and never regresses, so a later run that could not check does not erase an
   *  earlier run that could.
   */
  upsertMany(rows: readonly SessionUpsertRow[]): Promise<SessionRecord[]>;
  /** Org-filtered list for one project, newest first. */
  listForProject(projectId: string, options: { limit: number }): Promise<SessionRecord[]>;
  /** Org-filtered lookup by session key, `null` for a foreign org. */
  findByKey(projectId: string, sessionKey: string): Promise<SessionRecord | null>;
}

/** `unresolved < absent < resolved`. `absent` is a fact (a completed lookup proving no
 * email); `unresolved` is an admission of ignorance, so it can never overwrite either
 * of the other two. */
const RESOLUTION_RANK: Record<IdentityResolution, number> = {
  unresolved: 1,
  absent: 2,
  resolved: 3,
};

/**
 * `ON CONFLICT … DO UPDATE` raises "cannot affect row a second time" when one statement
 * carries the same conflict target twice, so two rows sharing a `(project_id,
 * session_key)` are merged here (under exactly the rules the SQL below applies) before
 * they reach the wire.
 */
function mergeSessionRows(rows: readonly SessionUpsertRow[]): SessionUpsertRow[] {
  const merged = new Map<string, SessionUpsertRow>();

  for (const row of rows) {
    const key = `${row.projectId}\u0000${row.sessionKey}`;
    const stored = merged.get(key);

    if (!stored) {
      merged.set(key, row);
      continue;
    }

    const incomingWins =
      RESOLUTION_RANK[row.identityResolution] >= RESOLUTION_RANK[stored.identityResolution];
    const earliest = row.startedAt < stored.startedAt ? row : stored;

    merged.set(key, {
      ...(incomingWins ? row : stored),
      startedAt: earliest.startedAt,
      lastEventAt: row.lastEventAt > stored.lastEventAt ? row.lastEventAt : stored.lastEventAt,
      identityKey: stored.identityKey ?? row.identityKey,
      identityEmailDomain: stored.identityEmailDomain ?? row.identityEmailDomain,
      userAgent: stored.userAgent ?? row.userAgent,
      entryUrlPath: earliest.entryUrlPath ?? stored.entryUrlPath ?? row.entryUrlPath,
    });
  }

  return [...merged.values()];
}

export function createSessionsRepo(db: ScopedDb, ctx: TenantContext): SessionsRepo {
  return {
    async upsertMany(rows: readonly SessionUpsertRow[]): Promise<SessionRecord[]> {
      if (rows.length === 0) {
        return [];
      }

      // The cross-tenant write vector, closed explicitly.
      //
      // The upsert's conflict target is `(project_id, session_key)`. That index carries
      // NO organization id, so `ON CONFLICT … DO UPDATE` does not inherit tenancy from
      // it: a foreign org supplying another org's `projectId` + `sessionKey` would
      // match that org's row and edit it. The index cannot be the guard here, and
      // relying on it is the bug.
      //
      // Two independent mechanisms close it, and both are deliberate:
      //
      // 1. Ownership filter (below). Rows naming a project this context does
      //  not own are dropped before the write, so a foreign org can neither
      //  edit an existing row nor inject a new one into another org's
      //  project. A project never changes organization, so this is a lookup
      //  on an immutable relationship, not the read-then-write race
      //  forbids.
      // 2. `setWhere` (further below) pins the do update to
      //  `sessions.organization_id = ctx.organizationId`, so even if
      //  were ever removed or bypassed the update matches zero rows and
      //  Returning yields nothing — never a silent successful edit.
      const requestedProjectIds = [...new Set(rows.map((row) => row.projectId))];
      const ownedProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, ctx.organizationId),
            inArray(projects.id, requestedProjectIds),
          ),
        );
      const ownedProjectIds = new Set(ownedProjects.map((project) => project.id));

      const ourRows = mergeSessionRows(rows.filter((row) => ownedProjectIds.has(row.projectId)));
      if (ourRows.length === 0) {
        return [];
      }

      // `excluded` is the proposed row; the qualified column is the stored row.
      // Postgres evaluates every set expression against the pre-update values, so
      // `entry_url_path` can branch on the stored `started_at` while `started_at` is
      // itself being set.
      const incomingRank = sql`case excluded.identity_resolution when 'resolved' then 3 when 'absent' then 2 else 1 end`;
      const storedRank = sql`case ${sessions.identityResolution} when 'resolved' then 3 when 'absent' then 2 else 1 end`;
      // A run that knew at least as much as the stored one re-stamps the
      // classification; a run that knew less leaves it alone. This is what keeps the
      // persisted facts and the stamp derived from them coherent, which is the whole
      // property the recomputability rests on.
      const knewAtLeastAsMuch = sql`(${incomingRank}) >= (${storedRank})`;

      return db
        .insert(sessions)
        .values(
          ourRows.map((row) => ({
            organizationId: ctx.organizationId,
            projectId: row.projectId,
            connectionId: row.connectionId,
            sessionKey: row.sessionKey,
            identityKey: row.identityKey,
            identityEmailDomain: row.identityEmailDomain,
            identityResolution: row.identityResolution,
            userAgent: row.userAgent,
            entryUrlPath: row.entryUrlPath,
            startedAt: row.startedAt,
            lastEventAt: row.lastEventAt,
            origin: row.origin,
            exclusionReason: row.exclusionReason,
            internalDomainAtStamp: row.internalDomainAtStamp,
            exclusionRuleSetVersion: row.exclusionRuleSetVersion,
            groupingVersion: row.groupingVersion,
          })),
        )
        .onConflictDoUpdate({
          target: [sessions.projectId, sessions.sessionKey],
          set: {
            connectionId: sql`excluded.connection_id`,
            // Never erase a known fact with an absent one.
            identityKey: sql`coalesce(${sessions.identityKey}, excluded.identity_key)`,
            identityEmailDomain: sql`coalesce(${sessions.identityEmailDomain}, excluded.identity_email_domain)`,
            identityResolution: sql`case when ${knewAtLeastAsMuch} then excluded.identity_resolution else ${sessions.identityResolution} end`,
            userAgent: sql`coalesce(${sessions.userAgent}, excluded.user_agent)`,
            // The entry path belongs to whichever run saw the earlier start.
            entryUrlPath: sql`case when excluded.started_at < ${sessions.startedAt} then coalesce(excluded.entry_url_path, ${sessions.entryUrlPath}) else coalesce(${sessions.entryUrlPath}, excluded.entry_url_path) end`,
            startedAt: sql`least(${sessions.startedAt}, excluded.started_at)`,
            lastEventAt: sql`greatest(${sessions.lastEventAt}, excluded.last_event_at)`,
            origin: sql`excluded.origin`,
            exclusionReason: sql`case when ${knewAtLeastAsMuch} then excluded.exclusion_reason else ${sessions.exclusionReason} end`,
            internalDomainAtStamp: sql`case when ${knewAtLeastAsMuch} then excluded.internal_domain_at_stamp else ${sessions.internalDomainAtStamp} end`,
            exclusionRuleSetVersion: sql`case when ${knewAtLeastAsMuch} then excluded.exclusion_rule_set_version else ${sessions.exclusionRuleSetVersion} end`,
            groupingVersion: sql`excluded.grouping_version`,
            updatedAt: sql`now()`,
          },
          // Mechanism 2 of the guard above. Zero rows and an empty returning for a
          // foreign org, never a silent successful edit.
          setWhere: eq(sessions.organizationId, ctx.organizationId),
        })
        .returning();
    },

    async listForProject(projectId: string, options: { limit: number }): Promise<SessionRecord[]> {
      return db
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.organizationId, ctx.organizationId), eq(sessions.projectId, projectId)),
        )
        .orderBy(desc(sessions.startedAt))
        .limit(options.limit);
    },

    async findByKey(projectId: string, sessionKey: string): Promise<SessionRecord | null> {
      const [row] = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.organizationId, ctx.organizationId),
            eq(sessions.projectId, projectId),
            eq(sessions.sessionKey, sessionKey),
          ),
        )
        .limit(1);

      return row ?? null;
    },
  };
}
