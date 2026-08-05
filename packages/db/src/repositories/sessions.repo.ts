import type {
  StampedExclusionReason,
  IdentityResolution,
  Origin,
  TenantContext,
} from "@growthmind/shared";
import { desc, eq, sql } from "drizzle-orm";

import { sessions } from "../schema/sessions";
import { orgCrud } from "./crud";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

export type SessionRecord = typeof sessions.$inferSelect;

export interface SessionUpsertRow {
  projectId: string;
  connectionId: string;
  sessionKey: string;
  identityKey: string | null;

  identityEmailDomain: string | null;
  identityResolution: IdentityResolution;
  userAgent: string | null;
  entryUrlPath: string | null;
  startedAt: Date;
  lastEventAt: Date;
  origin: Origin;
  exclusionReason: StampedExclusionReason;
  internalDomainAtStamp: string | null;
  exclusionRuleSetVersion: number;
  groupingVersion: number;
}

export interface SessionsRepo {
  upsertMany(rows: readonly SessionUpsertRow[]): Promise<SessionRecord[]>;

  listForProject(projectId: string, options: { limit: number }): Promise<SessionRecord[]>;

  findByKey(projectId: string, sessionKey: string): Promise<SessionRecord | null>;
}

const RESOLUTION_RANK: Record<IdentityResolution, number> = {
  unresolved: 1,
  absent: 2,
  resolved: 3,
};

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

export function createSessionsRepo(db: ScopedExecutor, ctx: TenantContext): SessionsRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, sessions);

  return {
    async upsertMany(rows: readonly SessionUpsertRow[]): Promise<SessionRecord[]> {
      if (rows.length === 0) {
        return [];
      }

      const ownedProjectIds = await s.ownedProjectIds(rows.map((row) => row.projectId));

      const ourRows = mergeSessionRows(rows.filter((row) => ownedProjectIds.has(row.projectId)));
      if (ourRows.length === 0) {
        return [];
      }

      const incomingRank = sql`case excluded.identity_resolution when 'resolved' then 3 when 'absent' then 2 else 1 end`;
      const storedRank = sql`case ${sessions.identityResolution} when 'resolved' then 3 when 'absent' then 2 else 1 end`;

      const knewAtLeastAsMuch = sql`(${incomingRank}) >= (${storedRank})`;

      return db
        .insert(sessions)
        .values(
          ourRows.map((row) => ({
            organizationId: s.stamp.organizationId,
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

            identityKey: sql`coalesce(${sessions.identityKey}, excluded.identity_key)`,
            identityEmailDomain: sql`coalesce(${sessions.identityEmailDomain}, excluded.identity_email_domain)`,
            identityResolution: sql`case when ${knewAtLeastAsMuch} then excluded.identity_resolution else ${sessions.identityResolution} end`,
            userAgent: sql`coalesce(${sessions.userAgent}, excluded.user_agent)`,

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

          setWhere: s.org(sessions),
        })
        .returning();
    },

    async listForProject(projectId: string, options: { limit: number }): Promise<SessionRecord[]> {
      return c.list({
        where: eq(sessions.projectId, projectId),
        orderBy: [desc(sessions.startedAt)],
        limit: options.limit,
      });
    },

    async findByKey(projectId: string, sessionKey: string): Promise<SessionRecord | null> {
      return c.maybe(eq(sessions.projectId, projectId), eq(sessions.sessionKey, sessionKey));
    },
  };
}
