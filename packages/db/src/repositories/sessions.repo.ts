// Repository for the `sessions` table. D-B: org-scoped at construction, no
// organization id parameter, mutations keyed on `(org, id)`.
//
// TYPED STUB (O-003 scaffold): signatures and return types are final; bodies
// throw.
import type {
  ExclusionReason,
  IdentityResolution,
  Origin,
  TenantContext,
} from "@growthmind/shared";

import type { sessions } from "../schema/sessions";
import type { ScopedDb } from "./types";

export type SessionRecord = typeof sessions.$inferSelect;

export interface SessionUpsertRow {
  projectId: string;
  connectionId: string;
  sessionKey: string;
  identityKey: string | null;
  /** DOMAIN ONLY, never the address. */
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
   * `ON CONFLICT (project_id, session_key) DO UPDATE` — IDEMPOTENT UNDER
   * REPEATED APPLICATION BY CONSTRUCTION, which is what makes a retried
   * worker task safe without a prior existence check (D4/D6):
   *
   * - `started_at` takes the EARLIEST of stored and incoming;
   * - `last_event_at` takes the LATEST;
   * - `identity_email_domain` keeps the stored value when it is already set;
   * - `identity_resolution` upgrades MONOTONICALLY along
   *   `unresolved → absent → resolved` and never regresses, so a later run
   *   that could not check does not erase an earlier run that could.
   */
  upsertMany(rows: readonly SessionUpsertRow[]): Promise<SessionRecord[]>;
  /** Org-filtered list for one project, newest first. */
  listForProject(projectId: string, options: { limit: number }): Promise<SessionRecord[]>;
  /** Org-filtered lookup by session key — `null` for a foreign org. */
  findByKey(projectId: string, sessionKey: string): Promise<SessionRecord | null>;
}

export function createSessionsRepo(_db: ScopedDb, _ctx: TenantContext): SessionsRepo {
  throw new Error("TYPED STUB (O-003 scaffold): createSessionsRepo");
}
