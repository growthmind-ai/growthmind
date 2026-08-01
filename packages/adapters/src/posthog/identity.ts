// Identity resolution (Addendum A row 6).
//
// `person` is `null` on every event. The events list returns the key but
// never joins the person object, so email is unreachable from the item being filtered.
// Resolution therefore runs at the session level, never per event, in three steps:
//
// 1. Harvest (free), scan the session's events for `properties.$set.email`
//  and take the first non-empty one. `$user_id` is deliberately not
//  treated as an email source: it is a customer-chosen arbitrary id, and
//  reading it as an email is a shape assumption.
// 2. Cached lookup (budgeted), for sessions still without an email and
//  with a non-null distinct id, one persons call, behind a per-run cache.
// 3. Give up, visibly, `unresolved`.
//
// Fail direction: an `unresolved` session is kept, and counted separately as
// `keptIdentityUnverified`, so the gap stays visible rather than being laundered into
// "12 real users". A session we could not check is not a session we checked and
// cleared.
import type { IdentityResolution } from "@growthmind/shared";
import { emailDomainOf } from "@growthmind/shared";

import type { PostHogClient } from "./client";
import type { RawEvent } from "./parse";
import { parsePersonsResponse } from "./parse";

/** Takes the first non-empty `properties.$set.email` across the session's events. Free,
 * no request, no budget. */
export function harvestEmailFromEvents(events: readonly RawEvent[]): string | null {
  for (const event of events) {
    // `setEmail` is `properties.$set.email` and nothing else. `$user_id` is a
    // customer-chosen arbitrary id; the parser deliberately never reads it as an email,
    // so no email can enter here by that route.
    const email = event.setEmail === null ? "" : event.setEmail.trim();
    if (email.length > 0) {
      return email;
    }
  }
  return null;
}

export interface ResolvedIdentity {
  readonly resolution: IdentityResolution;
  /** Domain only, the address never crosses this boundary (product-decisions). `null`
   * unless `resolution === "resolved"`. */
  readonly emailDomain: string | null;
}

export interface IdentityResolver {
  /**
   * Resolves one session's identity. `harvestedEmail` short-circuits the lookup
   * entirely; otherwise a `distinctId` spends one unit of budget.
   *
   * Returns `absent` only for a completed lookup that proved there is no email. A fact.
   * Everything else we did not find out is `unresolved`: no distinct id, a failed
   * lookup, a throttled lookup, or an exhausted budget.
   */
  resolve(input: {
    distinctId: string | null;
    harvestedEmail: string | null;
  }): Promise<ResolvedIdentity>;

  /** Persons calls actually spent, for the poll-run row. */
  lookupsUsed(): number;
}

/**
 * The cache is a plain `Map<distinctId, string | null>` created fresh per poll run, per
 * connection. Lifetime is one invocation, which is why it cannot go stale, needs no
 * invalidation story, and cannot leak across organizations by construction.
 *
 * A persistent identity cache was rejected: it would need an invalidation story (emails
 * change) and would persist an identity-to-email mapping we otherwise never store,
 * expanding the privacy surface for a caching win.
 *
 * Identities are looked up in deterministic first-seen order, so budget exhaustion is
 * reproducible in a test rather than random.
 */
export function createIdentityResolver(
  client: PostHogClient,
  options: { budget: number },
): IdentityResolver {
  const cache = new Map<string, ResolvedIdentity>();
  let spent = 0;

  // One shared value, so "we did not find out" is literally the same object on every
  // route that produces it. No route can accidentally attach a domain.
  const NOT_FOUND_OUT: ResolvedIdentity = { resolution: "unresolved", emailDomain: null };

  return {
    async resolve(input: {
      distinctId: string | null;
      harvestedEmail: string | null;
    }): Promise<ResolvedIdentity> {
      // Step 1, the free harvest. `emailDomainOf` returns the domain and never the
      // address (product-decisions), so the address stops here.
      const harvestedDomain = emailDomainOf(input.harvestedEmail);
      if (harvestedDomain !== null) {
        return { resolution: "resolved", emailDomain: harvestedDomain };
      }

      // Nothing to look up is not a fact about this identity. It is a thing we did not
      // find out.
      const distinctId = input.distinctId === null ? "" : input.distinctId.trim();
      if (distinctId.length === 0) {
        return NOT_FOUND_OUT;
      }

      // Step 2, the budgeted, cached lookup. The cache is created here, so its lifetime
      // is one resolver, i.e. one poll run for one connection: it cannot go stale,
      // needs no invalidation story, and cannot cross an organization boundary by
      // construction.
      const cached = cache.get(distinctId);
      if (cached !== undefined) {
        return cached;
      }

      // Step 3, give up, visibly. An exhausted budget is not evidence about the
      // identity, so it can never read as "we checked and cleared this". Deliberately
      // not cached: only a spent lookup earns a cache entry, so the first-seen order of
      // the ids that did spend budget stays readable.
      if (spent >= options.budget) {
        return NOT_FOUND_OUT;
      }

      spent += 1;
      const result = await client.getPerson(distinctId);
      if (!result.ok) {
        // A failed or throttled lookup is `unresolved`, never `absent`. A 429 on this
        // endpoint must not be laundered into "this person has no email".
        cache.set(distinctId, NOT_FOUND_OUT);
        return NOT_FOUND_OUT;
      }

      const email = parsePersonsResponse(result.value);
      if (email === null) {
        // A completed lookup that proved there is no email. This is a fact, and the
        // only route to `absent`.
        const absent: ResolvedIdentity = { resolution: "absent", emailDomain: null };
        cache.set(distinctId, absent);
        return absent;
      }

      const domain = emailDomainOf(email);
      // An address we cannot read a domain out of is a shape we did not understand, not
      // proof there is no email, so it fails toward `unresolved` rather than toward the
      // stronger claim.
      const resolved: ResolvedIdentity =
        domain === null ? NOT_FOUND_OUT : { resolution: "resolved", emailDomain: domain };
      cache.set(distinctId, resolved);
      return resolved;
    },

    lookupsUsed() {
      return spent;
    },
  };
}
