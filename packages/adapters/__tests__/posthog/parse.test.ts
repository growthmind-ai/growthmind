import { describe, expect, test } from "bun:test";

import { parseEventsPage, parsePersonsResponse } from "../../src/posthog/parse";
import { adEventItem, adEventsPage } from "../helpers/fakes";

const AD_ID_GOOD_1 = "019fb42c-fc4b-70e5-b634-4af26cb7b6b7";
const AD_ID_GOOD_2 = "019fb42c-fc4b-70e5-b634-4af26cb7b6c8";

describe("parseEventsPage", () => {
  test("skips ONE malformed item, counts the drop, and returns the rest of the page", () => {
    const page = adEventsPage([
      adEventItem({ id: AD_ID_GOOD_1, timestamp: "2026-07-30T17:57:49.891000+00:00" }),

      { distinct_id: "ad-broken", timestamp: "not-a-date", person: null },
      adEventItem({ id: AD_ID_GOOD_2, timestamp: "2026-07-30T17:57:48.891000+00:00" }),
    ]);

    const parsed = parseEventsPage(page);

    expect(parsed.events.map((event) => event.id)).toEqual([AD_ID_GOOD_1, AD_ID_GOOD_2]);
    expect(parsed.droppedMalformed).toBe(1);

    expect(parsed.firstItemDropped).toBe(false);
  });

  test("firstItemDropped is true only when results[0] itself could not be parsed", () => {
    const droppedFirst = parseEventsPage(
      adEventsPage([
        { distinct_id: "ad-broken", timestamp: "2026-07-30T17:57:49.891000+00:00", person: null },
        adEventItem({ id: AD_ID_GOOD_1, timestamp: "2026-07-30T17:57:48.891000+00:00" }),
      ]),
    );
    expect(droppedFirst.droppedMalformed).toBe(1);
    expect(droppedFirst.events.map((event) => event.id)).toEqual([AD_ID_GOOD_1]);
    expect(droppedFirst.firstItemDropped).toBe(true);

    const empty = parseEventsPage(adEventsPage([], null));
    expect(empty.firstItemDropped).toBe(false);

    const unreadable = parseEventsPage({ next: null, results: "not-an-array" });
    expect(unreadable.firstItemDropped).toBe(false);
    expect(unreadable.droppedMalformed).toBe(1);

    const clean = parseEventsPage(adEventsPage([adEventItem({ id: AD_ID_GOOD_2 })]));
    expect(clean.firstItemDropped).toBe(false);
  });

  test("returns next: null for a literal null cursor and does not treat a short page as the end", () => {
    const finalPage = parseEventsPage(adEventsPage([adEventItem()], null));
    expect(finalPage.next).toBeNull();

    const serverCursor =
      "https://ph.ad-fake.invalid/api/projects/424242/events?limit=200&properties=%5B%5D&before=2026-07-30T17%3A57%3A49.891000%2B00%3A00";
    const shortPage = parseEventsPage(adEventsPage([adEventItem()], serverCursor));
    expect(shortPage.events).toHaveLength(1);
    expect(shortPage.next).toBe(serverCursor);
  });

  test("handles an empty result set, a missing properties object, an absent user agent, and an absent url path", () => {
    const empty = parseEventsPage(adEventsPage([], null));
    expect(empty.events).toEqual([]);
    expect(empty.droppedMalformed).toBe(0);
    expect(empty.next).toBeNull();

    const bare = parseEventsPage(
      adEventsPage([
        {
          id: AD_ID_GOOD_1,
          distinct_id: "ad-distinct-1",
          event: "ad_probe_event",
          timestamp: "2026-07-30T17:57:49.891000+00:00",
          person: null,
          elements: [],
          elements_chain: "",
        },
      ]),
    );
    expect(bare.droppedMalformed).toBe(0);
    expect(bare.events).toHaveLength(1);
    const bareEvent = bare.events[0];
    expect(bareEvent?.userAgent).toBeNull();
    expect(bareEvent?.urlPath).toBeNull();
    expect(bareEvent?.sessionId).toBeNull();
    expect(bareEvent?.setEmail).toBeNull();

    const noUaNoPath = parseEventsPage(
      adEventsPage([adEventItem({ properties: { $lib: "ad-fake-probe" } })]),
    );
    expect(noUaNoPath.droppedMalformed).toBe(0);
    expect(noUaNoPath.events[0]?.userAgent).toBeNull();
    expect(noUaNoPath.events[0]?.urlPath).toBeNull();
  });

  test("never reads event.person — a null person is not a parse failure", () => {
    let personWasRead = false;
    const item = adEventItem({ id: AD_ID_GOOD_1 });
    Object.defineProperty(item, "person", {
      enumerable: true,
      get: () => {
        personWasRead = true;
        return null;
      },
    });

    const parsed = parseEventsPage(adEventsPage([item]));

    expect(parsed.droppedMalformed).toBe(0);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]?.id).toBe(AD_ID_GOOD_1);
    expect(personWasRead).toBe(false);
  });
});

describe("parsePersonsResponse", () => {
  test("tolerates a full, a minimal, and an empty envelope", () => {
    const full = {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: "ad-person-1",
          distinct_ids: ["ad-distinct-1"],
          properties: {
            name: "ad-fake person",
            email: "someone@ad-acme.invalid",
            $browser: "Chrome",
            $initial_current_url: "https://ad-acme.invalid/app",
          },
        },
      ],
    };
    expect(parsePersonsResponse(full)).toBe("someone@ad-acme.invalid");

    expect(parsePersonsResponse({ results: [{}] })).toBeNull();
    expect(parsePersonsResponse({ results: [{ properties: {} }] })).toBeNull();

    expect(parsePersonsResponse({ results: [] })).toBeNull();

    expect(parsePersonsResponse({})).toBeNull();
    expect(parsePersonsResponse(null)).toBeNull();
    expect(parsePersonsResponse({ results: [{ properties: { email: 42 } }] })).toBeNull();
  });
});
