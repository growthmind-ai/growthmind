// items 55–59, identity resolution (Addendum A row 6).
//
// `person` is `null` on every event: the events list returns the key but
// never joins the person object, so email is unreachable from the item being filtered.
// Resolution therefore runs at the session level, harvesting `properties.$set.email`
// for free before spending a budgeted `/persons` call.
//
// Fail direction: "we could not find out" is `unresolved` and is counted
// separately, never laundered into "we checked and this is a real user".
import { describe, expect, test } from "bun:test";

import { createIdentityResolver, harvestEmailFromEvents } from "../../src/posthog/identity";
import { parseEventsPage } from "../../src/posthog/parse";
import {
  adEventItem,
  adEventsPage,
  adPersonsBody,
  createFakePersonsClient,
} from "../helpers/fakes";

const AD_EMAIL = "someone@ad-acme.invalid";
const AD_DOMAIN = "ad-acme.invalid";

/** An identify-shaped item: the only kind that carries an email (row 6). */
function adIdentifyItem(id: string, email: string, distinctId = "ad-distinct-1") {
  return adEventItem({
    id,
    distinct_id: distinctId,
    event: "$identify",
    properties: { $lib: "ad-fake-probe", $set: { email }, $set_once: {} },
  });
}

describe("harvestEmailFromEvents", () => {
  // Item 55 —, step 1: harvest is free and comes first.
  test("takes the first non-empty $set.email across the session's events", () => {
    const page = parseEventsPage(
      adEventsPage([
        // An ordinary event carries no email at all. The majority shape.
        adEventItem({ id: "ad-evt-1", event: "$pageview" }),
        adIdentifyItem("ad-evt-2", AD_EMAIL),
        adIdentifyItem("ad-evt-3", "second@ad-other.invalid"),
      ]),
    );

    expect(harvestEmailFromEvents(page.events)).toBe(AD_EMAIL);

    // A session with no identify-shaped event harvests nothing. The common case, not
    // the edge case.
    const noEmail = parseEventsPage(adEventsPage([adEventItem({ id: "ad-evt-4" })]));
    expect(harvestEmailFromEvents(noEmail.events)).toBeNull();
    expect(harvestEmailFromEvents([])).toBeNull();
  });

  // Item 56, shape-assumption guard. `$user_id` is a customer-chosen arbitrary id;
  // reading it as an email is exactly the assumption this test exists to forbid, even
  // when it happens to look like one.
  test("$user_id is never treated as an email", () => {
    const page = parseEventsPage(
      adEventsPage([
        adEventItem({
          id: "ad-evt-user-id",
          properties: {
            $lib: "ad-fake-probe",
            $user_id: "looks-like@ad-acme.invalid",
            $set: {},
            $set_once: {},
          },
        }),
      ]),
    );

    expect(page.droppedMalformed).toBe(0);
    expect(page.events[0]?.setEmail).toBeNull();
    expect(harvestEmailFromEvents(page.events)).toBeNull();
  });
});

describe("createIdentityResolver", () => {
  // Item 55, the ordering half: harvest short-circuits the lookup entirely.
  test("spends no /persons lookup when an email was already harvested", async () => {
    const fake = createFakePersonsClient(() => ({
      ok: true,
      value: adPersonsBody("never-used@ad-other.invalid"),
    }));
    const resolver = createIdentityResolver(fake.client, { budget: 50 });

    const resolved = await resolver.resolve({
      distinctId: "ad-distinct-1",
      harvestedEmail: AD_EMAIL,
    });

    expect(resolved.resolution).toBe("resolved");
    expect(resolved.emailDomain).toBe(AD_DOMAIN);
    expect(fake.personCalls).toEqual([]);
    expect(resolver.lookupsUsed()).toBe(0);

    // Only when the harvest came back empty is a lookup spent.
    const viaLookup = await resolver.resolve({ distinctId: "ad-distinct-2", harvestedEmail: null });
    expect(viaLookup.resolution).toBe("resolved");
    expect(fake.personCalls).toEqual(["ad-distinct-2"]);
    expect(resolver.lookupsUsed()).toBe(1);
  });

  // Item 57, the N+1 bound. The cache is per poll run, per connection, so it cannot go
  // stale and cannot leak across organizations by construction.
  test("the identity cache issues exactly one /persons call for two sessions sharing a distinct_id", async () => {
    const fake = createFakePersonsClient(() => ({ ok: true, value: adPersonsBody(AD_EMAIL) }));
    const resolver = createIdentityResolver(fake.client, { budget: 50 });

    const first = await resolver.resolve({ distinctId: "ad-shared", harvestedEmail: null });
    const second = await resolver.resolve({ distinctId: "ad-shared", harvestedEmail: null });

    expect(fake.personCalls).toEqual(["ad-shared"]);
    expect(resolver.lookupsUsed()).toBe(1);
    expect(second.resolution).toBe(first.resolution);
    expect(second.emailDomain).toBe(first.emailDomain);
  });

  // Item 58, F-8. Deterministic first-seen order is what makes budget exhaustion
  // reproducible in a test rather than random in production.
  test('budget exhaustion resolves remaining identities as "unresolved" in deterministic first-seen order', async () => {
    const fake = createFakePersonsClient((distinctId) => ({
      ok: true,
      value: adPersonsBody(`${distinctId}@ad-acme.invalid`),
    }));
    const resolver = createIdentityResolver(fake.client, { budget: 2 });

    const first = await resolver.resolve({ distinctId: "ad-budget-1", harvestedEmail: null });
    const second = await resolver.resolve({ distinctId: "ad-budget-2", harvestedEmail: null });
    const third = await resolver.resolve({ distinctId: "ad-budget-3", harvestedEmail: null });

    expect(first.resolution).toBe("resolved");
    expect(second.resolution).toBe("resolved");

    // The third is kept by the caller (fail-open) but visibly unchecked. "we did not
    // find out", never "we checked and found nothing".
    expect(third.resolution).toBe("unresolved");
    expect(third.emailDomain).toBeNull();

    expect(fake.personCalls).toEqual(["ad-budget-1", "ad-budget-2"]);
    expect(resolver.lookupsUsed()).toBe(2);

    // A completed lookup proving there is NO email is a different fact: `absent`, not
    // `unresolved`.
    const noEmailFake = createFakePersonsClient(() => ({ ok: true, value: adPersonsBody(null) }));
    const noEmailResolver = createIdentityResolver(noEmailFake.client, { budget: 50 });
    const absent = await noEmailResolver.resolve({
      distinctId: "ad-no-email",
      harvestedEmail: null,
    });
    expect(absent.resolution).toBe("absent");
    expect(absent.emailDomain).toBeNull();

    // A failed or throttled lookup is `unresolved`, never `absent`.
    const throttledFake = createFakePersonsClient(() => ({
      ok: false,
      failure: { code: "rate_limited", message: "We could not check who this was." },
    }));
    const throttledResolver = createIdentityResolver(throttledFake.client, { budget: 50 });
    const throttled = await throttledResolver.resolve({
      distinctId: "ad-throttled",
      harvestedEmail: null,
    });
    expect(throttled.resolution).toBe("unresolved");

    // No distinct id at all: nothing to look up, so nothing was found out.
    const noIdResolver = createIdentityResolver(fake.client, { budget: 50 });
    const noId = await noIdResolver.resolve({ distinctId: null, harvestedEmail: null });
    expect(noId.resolution).toBe("unresolved");
  });

  // Item 59, product-decisions: only the domain crosses the boundary.
  test("only the email DOMAIN crosses the port boundary — no result carries an address", async () => {
    const fake = createFakePersonsClient(() => ({ ok: true, value: adPersonsBody(AD_EMAIL) }));
    const resolver = createIdentityResolver(fake.client, { budget: 50 });

    const viaLookup = await resolver.resolve({ distinctId: "ad-distinct-1", harvestedEmail: null });
    const viaHarvest = await resolver.resolve({ distinctId: null, harvestedEmail: AD_EMAIL });

    for (const resolved of [viaLookup, viaHarvest]) {
      expect(resolved.emailDomain).toBe(AD_DOMAIN);
      const serialised = JSON.stringify(resolved);
      expect(serialised).not.toContain("someone@");
      expect(serialised).not.toContain(AD_EMAIL);
      expect(serialised).not.toContain("@");
    }
  });
});
