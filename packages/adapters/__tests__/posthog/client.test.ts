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

    expect(result.failure.code).toBe("rate_limited");
    expect(result.failure.message.length).toBeGreaterThan(0);

    expect(client.rateLimitAttempts("events")).toBe(MAX_RATE_LIMIT_ATTEMPTS);
    expect(fake.requests.length).toBeLessThanOrEqual(MAX_RATE_LIMIT_ATTEMPTS);
    expect(fake.requests.length).toBeGreaterThan(1);

    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.length).toBeLessThan(MAX_RATE_LIMIT_ATTEMPTS);
    for (const ms of sleeps) {
      expect(ms).toBeGreaterThanOrEqual(59_000);
    }
  });

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

  test("a 429 on /persons does not pause the events walk", async () => {
    const fake = createFakeFetch((url) => {
      if (url.includes("/persons")) {
        return { status: 429, body: AD_THROTTLED_BODY, headers: { "retry-after": "59" } };
      }
      return { status: 200, body: adEventsPage([adEventItem()], null) };
    });
    const { deps } = createFakeDeps(fake.fetch);
    const client = createPostHogClient(AD_CONFIG, deps);

    const personResult = await client.getPerson("ad-distinct-1");
    expect(personResult.ok).toBe(false);
    expect(client.rateLimitAttempts("persons")).toBeGreaterThan(0);

    const eventsResult = await client.getEventsPage(AD_EVENTS_URL);
    expect(eventsResult.ok).toBe(true);
    expect(client.rateLimitAttempts("events")).toBe(0);
  });

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
