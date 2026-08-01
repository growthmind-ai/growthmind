// items 43–45, the impure fetch wrapper.
//
// Addendum a row 5's load-bearing fact: the throttle bucket is per-endpoint. While
// session recordings were throttled, the events list still returned 200. So attempt
// counters live per endpoint for the lifetime of one poll run, and a 429 from persons
// exhausts the identity budget without pausing the events walk.
//
// Nothing here waits: `sleep` is injected and records instead of sleeping.
import { describe, expect, test } from "bun:test";

import { createPostHogClient } from "../../src/posthog/client";
import { MAX_RATE_LIMIT_ATTEMPTS } from "../../src/posthog/constants";
import {
  AD_CONFIG,
  AD_EVENTS_URL,
  adEventItem,
  adEventsPage,
  adPersonsBody,
  createFakeDeps,
  createFakeFetch,
} from "../helpers/fakes";
import { readAdapterSources } from "../helpers/source-scan";

const AD_THROTTLED_BODY = {
  type: "throttled_error",
  code: "throttled",
  detail: "Request was throttled. Expected available in 59 seconds.",
  attr: null,
};

describe("createPostHogClient", () => {
  // Item 43, /.
  test("the 429 loop gives up after MAX_RATE_LIMIT_ATTEMPTS with a recorded reason and never loops unbounded", async () => {
    const fake = createFakeFetch(() => ({
      status: 429,
      body: AD_THROTTLED_BODY,
      headers: { "retry-after": "59" },
    }));
    const { deps, sleeps } = createFakeDeps(fake.fetch);
    const client = createPostHogClient(AD_CONFIG, deps);

    const result = await client.getEventsPage(AD_EVENTS_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // A terminal, named give-up, never a stuck "still trying".
    expect(result.failure.code).toBe("rate_limited");
    expect(result.failure.message.length).toBeGreaterThan(0);

    // Bounded: the attempt counter stops exactly at the cap, and the request count
    // cannot exceed it.
    expect(client.rateLimitAttempts("events")).toBe(MAX_RATE_LIMIT_ATTEMPTS);
    expect(fake.requests.length).toBeLessThanOrEqual(MAX_RATE_LIMIT_ATTEMPTS);
    expect(fake.requests.length).toBeGreaterThan(1);

    // It backed off between attempts rather than hammering, and every wait honoured the
    // server's stated 59 seconds.
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.length).toBeLessThan(MAX_RATE_LIMIT_ATTEMPTS);
    for (const ms of sleeps) {
      expect(ms).toBeGreaterThanOrEqual(59_000);
    }
  });

  // Item 44 —. A grep guard, so the bound above cannot be reintroduced as an unbounded
  // loop somewhere else in the package.
  test("no unbounded retry loop exists in packages/adapters", () => {
    const offenders: string[] = [];
    for (const file of readAdapterSources()) {
      if (/while\s*\(\s*(?:true|1)\s*\)/.test(file.code)) {
        offenders.push(`${file.path}: while(true)`);
      }
      if (/for\s*\(\s*;\s*;\s*\)/.test(file.code)) {
        offenders.push(`${file.path}: for(;;)`);
      }
      if (/do\s*\{[\s\S]*?\}\s*while\s*\(\s*(?:true|1)\s*\)/.test(file.code)) {
        offenders.push(`${file.path}: do/while(true)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Item 45, row 5's per-endpoint bucket; mitigates the assumed row for the persons
  // throttle profile, which was never load-tested.
  test("a 429 on /persons does not pause the events walk", async () => {
    const fake = createFakeFetch((url) => {
      if (url.includes("/persons")) {
        return { status: 429, body: AD_THROTTLED_BODY, headers: { "retry-after": "59" } };
      }
      return { status: 200, body: adEventsPage([adEventItem()], null) };
    });
    const { deps } = createFakeDeps(fake.fetch);
    const client = createPostHogClient(AD_CONFIG, deps);

    // Exhaust the persons bucket first, so any shared state would show up.
    const personResult = await client.getPerson("ad-distinct-1");
    expect(personResult.ok).toBe(false);
    expect(client.rateLimitAttempts("persons")).toBeGreaterThan(0);

    // The events walk is untouched by the persons throttle.
    const eventsResult = await client.getEventsPage(AD_EVENTS_URL);
    expect(eventsResult.ok).toBe(true);
    expect(client.rateLimitAttempts("events")).toBe(0);
  });

  // Item 45, the other direction: two healthy endpoints keep independent counters, so
  // the split above is a real separation and not an artefact of one endpoint never
  // being touched.
  test("a persons lookup and an events page use separate attempt counters", async () => {
    const fake = createFakeFetch((url) =>
      url.includes("/persons")
        ? { status: 200, body: adPersonsBody("someone@ad-acme.invalid") }
        : { status: 200, body: adEventsPage([adEventItem()], null) },
    );
    const { deps } = createFakeDeps(fake.fetch);
    const client = createPostHogClient(AD_CONFIG, deps);

    const [person, events] = await Promise.all([
      client.getPerson("ad-distinct-1"),
      client.getEventsPage(AD_EVENTS_URL),
    ]);

    expect(person.ok).toBe(true);
    expect(events.ok).toBe(true);
    expect(client.rateLimitAttempts("events")).toBe(0);
    expect(client.rateLimitAttempts("persons")).toBe(0);
  });
});
