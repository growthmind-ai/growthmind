// Identity resolution (O-003 D-5, Addendum A ROW 6).
//
// `person` is `null` on EVERY event (165/165) — the events list returns the
// key but never joins the person object — so email is unreachable from the
// item being filtered. Resolution therefore runs at the SESSION level, never
// per event, in three steps:
//
//   1. HARVEST (free) — scan the session's events for `properties.$set.email`
//      and take the first non-empty one. `$user_id` is deliberately NOT
//      treated as an email source: it is a customer-chosen arbitrary id, and
//      reading it as an email is a D5 shape assumption.
//   2. CACHED LOOKUP (budgeted) — for sessions still without an email and
//      with a non-null distinct id, one persons call, behind a per-run cache.
//   3. GIVE UP, VISIBLY — `unresolved`.
//
// FAIL DIRECTION (F-8): an `unresolved` session is KEPT, and counted
// separately as `keptIdentityUnverified`, so the gap stays visible rather
// than being laundered into "12 real users". A session we could not check is
// not a session we checked and cleared.
//
// TYPED STUB (O-003 scaffold): the types are final; the bodies throw.
import type { IdentityResolution } from "@growthmind/shared";

import type { PostHogClient } from "./client";
import type { RawEvent } from "./parse";

/** Takes the first non-empty `properties.$set.email` across the session's
 * events. Free — no request, no budget. */
export function harvestEmailFromEvents(_events: readonly RawEvent[]): string | null {
  throw new Error("TYPED STUB (O-003 scaffold): harvestEmailFromEvents");
}

export interface ResolvedIdentity {
  readonly resolution: IdentityResolution;
  /** DOMAIN ONLY — the address never crosses this boundary
   * (product-decisions §5). `null` unless `resolution === "resolved"`. */
  readonly emailDomain: string | null;
}

export interface IdentityResolver {
  /**
   * Resolves one session's identity. `harvestedEmail` short-circuits the
   * lookup entirely; otherwise a `distinctId` spends one unit of budget.
   *
   * Returns `absent` only for a COMPLETED lookup that proved there is no
   * email — a fact. Everything else we did not find out is `unresolved`: no
   * distinct id, a failed lookup, a throttled lookup, or an exhausted budget.
   */
  resolve(input: {
    distinctId: string | null;
    harvestedEmail: string | null;
  }): Promise<ResolvedIdentity>;

  /** Persons calls actually spent, for the poll-run row. */
  lookupsUsed(): number;
}

/**
 * The cache is a plain `Map<distinctId, string | null>` created fresh PER
 * POLL RUN, PER CONNECTION. Lifetime is one invocation, which is why it
 * cannot go stale, needs no invalidation story, and cannot leak across
 * organizations by construction.
 *
 * A persistent identity cache was rejected: it would need an invalidation
 * story (emails change) and would persist an identity-to-email mapping we
 * otherwise never store, expanding the privacy surface for a caching win.
 *
 * Identities are looked up in deterministic FIRST-SEEN order, so budget
 * exhaustion is reproducible in a test rather than random.
 */
export function createIdentityResolver(
  _client: PostHogClient,
  _options: { budget: number },
): IdentityResolver {
  throw new Error("TYPED STUB (O-003 scaffold): createIdentityResolver");
}
