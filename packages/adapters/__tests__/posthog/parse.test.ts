// ADD §9 items 34–38 — the boundary parser.
//
// The headline is item 34: PER-ITEM degradation. The spike's parser rejects
// the whole page when one entry is malformed — correct for a measurement
// harness, FATAL for a poller, where one weird event would stall a connection
// forever. Here one bad item is skipped, COUNTED, and the rest of the page is
// returned.
import { describe, expect, test } from "bun:test";

import { parseEventsPage, parsePersonsResponse } from "../../src/posthog/parse";
import { adEventItem, adEventsPage } from "../helpers/fakes";

const AD_ID_GOOD_1 = "019fb42c-fc4b-70e5-b634-4af26cb7b6b7";
const AD_ID_GOOD_2 = "019fb42c-fc4b-70e5-b634-4af26cb7b6c8";

describe("parseEventsPage", () => {
  // Item 34 — FR-3 / D5. THE LIVENESS HAZARD.
  test("skips ONE malformed item, counts the drop, and returns the rest of the page", () => {
    const page = adEventsPage([
      adEventItem({ id: AD_ID_GOOD_1, timestamp: "2026-07-30T17:57:49.891000+00:00" }),
      // Malformed: no `id`, and a timestamp nothing can parse. One bad item
      // must never cost the other two.
      { distinct_id: "ad-broken", timestamp: "not-a-date", person: null },
      adEventItem({ id: AD_ID_GOOD_2, timestamp: "2026-07-30T17:57:48.891000+00:00" }),
    ]);

    const parsed = parseEventsPage(page);

    expect(parsed.events.map((event) => event.id)).toEqual([AD_ID_GOOD_1, AD_ID_GOOD_2]);
    expect(parsed.droppedMalformed).toBe(1);
  });

  // Item 35 — ROW 1.
  test("returns next: null for a literal null cursor and does not treat a short page as the end", () => {
    // `next` is LITERAL null on the final page — never absent, never "".
    const finalPage = parseEventsPage(adEventsPage([adEventItem()], null));
    expect(finalPage.next).toBeNull();

    // A page far shorter than `limit` is NOT an end signal. The server-encoded
    // cursor is returned VERBATIM — reconstructing it would drop the filter and
    // the exclusive `before` the server already encoded.
    const serverCursor =
      "https://ph.ad-fake.invalid/api/projects/424242/events?limit=200&properties=%5B%5D&before=2026-07-30T17%3A57%3A49.891000%2B00%3A00";
    const shortPage = parseEventsPage(adEventsPage([adEventItem()], serverCursor));
    expect(shortPage.events).toHaveLength(1);
    expect(shortPage.next).toBe(serverCursor);
  });

  // Item 36 — D5.
  test("handles an empty result set, a missing properties object, an absent user agent, and an absent url path", () => {
    const empty = parseEventsPage(adEventsPage([], null));
    expect(empty.events).toEqual([]);
    expect(empty.droppedMalformed).toBe(0);
    expect(empty.next).toBeNull();

    // No `properties` key at all — a shape a minimal or server-side SDK
    // produces. Absent is normal, not malformed (SEC-A/B/C).
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

    // Properties present but carrying neither a UA nor any url.
    const noUaNoPath = parseEventsPage(
      adEventsPage([adEventItem({ properties: { $lib: "ad-fake-probe" } })]),
    );
    expect(noUaNoPath.droppedMalformed).toBe(0);
    expect(noUaNoPath.events[0]?.userAgent).toBeNull();
    expect(noUaNoPath.events[0]?.urlPath).toBeNull();
  });

  // Item 37 — ROW 6, the dead-code guard. `person` is null on 165/165 items,
  // so any code reading `event.person.properties.email` is dead code. This
  // test proves the key is never even READ, not merely that a null tolerates.
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
  // Item 38 — pins the ASSUMED §7 row. The persons envelope beyond this one
  // field was never pinned, so the parser must require only that `results` is
  // an array and `results[0]?.properties?.email` is an optional string.
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

    // Minimal: a person row with no properties, and one with no email.
    expect(parsePersonsResponse({ results: [{}] })).toBeNull();
    expect(parsePersonsResponse({ results: [{ properties: {} }] })).toBeNull();

    // Empty: a completed lookup that found nobody.
    expect(parsePersonsResponse({ results: [] })).toBeNull();

    // Unexpected shapes are tolerated, never thrown — anything stricter turns
    // an unpinned envelope into a liveness risk.
    expect(parsePersonsResponse({})).toBeNull();
    expect(parsePersonsResponse(null)).toBeNull();
    expect(parsePersonsResponse({ results: [{ properties: { email: 42 } }] })).toBeNull();
  });
});
