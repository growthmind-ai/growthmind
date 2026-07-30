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
//
// TYPED STUB (O-003 scaffold): signatures and return types are final; bodies
// throw.
import type { EventsSeenCounter, TenantContext } from "@growthmind/shared";

import type { ScopedDb } from "../repositories/types";

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

export function createEventsCounterService(
  _db: ScopedDb,
  _ctx: TenantContext,
): EventsCounterService {
  throw new Error("TYPED STUB (O-003 scaffold): createEventsCounterService");
}
