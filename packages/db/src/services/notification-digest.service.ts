import type { TenantContext, Weekday } from "@growthmind/shared";

import type { ScopedDb, ScopedExecutor } from "../repositories/types";

export interface DigestDueOrganization {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly digestDay: Weekday;
}

// Every org with Slack connected, LEFT JOINed to its settings row. The outer join is
// load-bearing and one keyword from being wrong: absence is the default, so an INNER JOIN
// would silently exclude every customer who has never opened the card — the exact
// population the control would then be lying to.
export function listOrganizationsDueForDigest(
  _db: ScopedDb,
  _at: Date,
): Promise<readonly DigestDueOrganization[]> {
  throw new Error("O-051 job 2: not implemented");
}

export interface DigestGatherInput {
  readonly windowStart: Date;
  readonly windowEnd: Date;

  readonly limit: number;
}

export interface DigestGather {
  // Capped at `limit`; the payload freezes ids, never text.
  readonly notificationIds: readonly string[];

  // Of the whole window, so the summary's denominator describes the week rather than
  // whatever the list happened to hold.
  readonly totalCount: number;
}

// Exactly the population `quiet: digest` was minted for. Anything actionable either posted
// or is unsettled, and belongs to the rescue rather than to a summary.
export function gatherDigestNotifications(
  _db: ScopedExecutor,
  _ctx: TenantContext,
  _input: DigestGatherInput,
): Promise<DigestGather> {
  throw new Error("O-051 job 2: not implemented");
}
