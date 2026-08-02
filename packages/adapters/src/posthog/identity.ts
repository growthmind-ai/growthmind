import type { IdentityResolution } from "@growthmind/shared";
import { emailDomainOf } from "@growthmind/shared";

import type { PostHogClient } from "./client";
import type { RawEvent } from "./parse";
import { parsePersonsResponse } from "./parse";

export function harvestEmailFromEvents(events: readonly RawEvent[]): string | null {
  for (const event of events) {
    const email = event.setEmail === null ? "" : event.setEmail.trim();
    if (email.length > 0) {
      return email;
    }
  }
  return null;
}

export interface ResolvedIdentity {
  readonly resolution: IdentityResolution;

  readonly emailDomain: string | null;
}

export interface IdentityResolver {
  resolve(input: {
    distinctId: string | null;
    harvestedEmail: string | null;
  }): Promise<ResolvedIdentity>;

  lookupsUsed(): number;
}

export function createIdentityResolver(
  client: PostHogClient,
  options: { budget: number },
): IdentityResolver {
  const cache = new Map<string, ResolvedIdentity>();
  let spent = 0;

  const NOT_FOUND_OUT: ResolvedIdentity = { resolution: "unresolved", emailDomain: null };

  return {
    async resolve(input: {
      distinctId: string | null;
      harvestedEmail: string | null;
    }): Promise<ResolvedIdentity> {
      const harvestedDomain = emailDomainOf(input.harvestedEmail);
      if (harvestedDomain !== null) {
        return { resolution: "resolved", emailDomain: harvestedDomain };
      }

      const distinctId = input.distinctId === null ? "" : input.distinctId.trim();
      if (distinctId.length === 0) {
        return NOT_FOUND_OUT;
      }

      const cached = cache.get(distinctId);
      if (cached !== undefined) {
        return cached;
      }

      if (spent >= options.budget) {
        return NOT_FOUND_OUT;
      }

      spent += 1;
      const result = await client.getPerson(distinctId);
      if (!result.ok) {
        cache.set(distinctId, NOT_FOUND_OUT);
        return NOT_FOUND_OUT;
      }

      const email = parsePersonsResponse(result.value);
      if (email === null) {
        const absent: ResolvedIdentity = { resolution: "absent", emailDomain: null };
        cache.set(distinctId, absent);
        return absent;
      }

      const domain = emailDomainOf(email);

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
