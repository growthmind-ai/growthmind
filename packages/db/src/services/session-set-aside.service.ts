import type { ExclusionReason, SetAsideBreakdown, TenantContext } from "@growthmind/shared";
import { sql } from "drizzle-orm";

import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { sessions } from "../schema/sessions";
import { buildSetAsideBreakdown } from "./set-aside-breakdown";

export interface SessionSetAside {
  readonly total: number;
  readonly kept: number;

  readonly setAside: readonly SetAsideBreakdown[];

  // Every rule-set version the counted rows were stamped under, ascending. More than one
  // means the total spans a rule change, so a single "under these rules" sentence over the
  // whole count would be untrue of some of it.
  readonly ruleSetVersions: readonly number[];
}

export interface SessionSetAsideService {
  read(): Promise<SessionSetAside>;
}

const KEPT: ExclusionReason = "none";

function toCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Sessions across the whole organization, not events inside one project: the receipt answers
// "what did you set aside, out of how many" about the workspace, and the events-per-project
// counter on the setup surface answers a different question at a different unit.
export function createSessionSetAsideService(
  db: ScopedDb,
  ctx: TenantContext,
): SessionSetAsideService {
  const s = scoped(db, ctx);

  return {
    async read(): Promise<SessionSetAside> {
      const rows = await db
        .select({
          reason: sessions.exclusionReason,
          version: sessions.exclusionRuleSetVersion,
          count: sql<number>`count(*)::int`,
        })
        .from(sessions)
        .where(s.org(sessions))
        .groupBy(sessions.exclusionReason, sessions.exclusionRuleSetVersion);

      const countsByReason = new Map<ExclusionReason, number>();
      const versions = new Set<number>();
      let total = 0;

      for (const row of rows) {
        const count = toCount(row.count);
        total += count;
        versions.add(row.version);

        // The kept rows are the denominator, never a row in the breakdown: "none" is not a
        // reason anything was set aside, and listing it would double-count the total.
        if (row.reason !== KEPT) {
          countsByReason.set(row.reason, (countsByReason.get(row.reason) ?? 0) + count);
        }
      }

      const setAside = buildSetAsideBreakdown({ unit: "sessions", countsByReason });

      return {
        total,
        kept: total - setAside.reduce((sum, entry) => sum + entry.count, 0),
        setAside,
        ruleSetVersions: [...versions].toSorted((a, b) => a - b),
      };
    },
  };
}
