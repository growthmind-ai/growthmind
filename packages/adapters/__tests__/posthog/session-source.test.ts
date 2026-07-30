// ADD §9 items 50–54 — the walk.
//
// Three pinned facts shape every assertion here (Addendum A ROW 1 / ROW 2 /
// ROW 4):
//   - Pagination walks BACKWARDS. `next` is an absolute url carrying an
//     exclusive `before=<last item's timestamp>`; ordering is strictly
//     newest-first; `next` is LITERAL null on the final page. A short page is
//     not the end.
//   - `after`/`before` are BOTH EXCLUSIVE, and a malformed value returns HTTP
//     200 with an empty result set — so an empty page can never be trusted as
//     "caught up".
//   - `timestamp` is CLIENT-DECLARED EVENT TIME with no ingestion-time field
//     anywhere, which is why the overlap window is load-bearing rather than
//     defensive.
import { describe, expect, test } from "bun:test";

import { OVERLAP_WINDOW_SECONDS, PAGE_LIMIT } from "../../src/posthog/constants";
import { createPostHogSessionSource } from "../../src/posthog/session-source";
import {
  AD_CONFIG,
  AD_HOST,
  AD_SOURCE_PROJECT_ID,
  adEventItem,
  adEventsPage,
  createFakeDeps,
  createFakeFetch,
  createPagedFetch,
} from "../helpers/fakes";

const AD_EVENTS_PATH = `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/events`;

/**
 * A server-encoded cursor. The `cursor=` segment is an opaque token no client
 * could ever reconstruct — that is what makes "followed VERBATIM" provable
 * rather than merely plausible.
 */
const AD_PAGE_1_NEXT = `${AD_EVENTS_PATH}?limit=${PAGE_LIMIT}&properties=%5B%5D&before=2026-07-30T17%3A57%3A48.891000%2B00%3A00&cursor=ad-opaque-server-token-1`;
const AD_PAGE_2_BEFORE = "2026-07-30T17:57:40.000000+00:00";
const AD_PAGE_2_NEXT = `${AD_EVENTS_PATH}?limit=${PAGE_LIMIT}&properties=%5B%5D&before=2026-07-30T17%3A57%3A40.000000%2B00%3A00&cursor=ad-opaque-server-token-2`;

const AD_NEWEST_WIRE = "2026-07-30T17:57:49.891000+00:00";
const AD_NEWEST_INSTANT = new Date("2026-07-30T17:57:49.891Z");

const AD_ID_1 = "019fb42c-fc4b-70e5-b634-4af26cb7b6b7";
const AD_ID_2 = "019fb42c-fc4b-70e5-b634-4af26cb7b6c8";
const AD_ID_3 = "019fb42c-fc4b-70e5-b634-4af26cb7b6d9";

const AD_NEVER_POLLED = { watermarkAt: null, backfillBefore: null, maxPages: 25 } as const;

describe("createPostHogSessionSource#pull", () => {
  // Item 50 — ROW 1.
  test("the pull walk follows next verbatim until it is literally null and never reconstructs the cursor", async () => {
    const fake = createPagedFetch([
      {
        status: 200,
        body: adEventsPage(
          [
            adEventItem({ id: AD_ID_1, timestamp: AD_NEWEST_WIRE }),
            adEventItem({ id: AD_ID_2, timestamp: "2026-07-30T17:57:48.891000+00:00" }),
          ],
          AD_PAGE_1_NEXT,
        ),
      },
      {
        status: 200,
        body: adEventsPage([adEventItem({ id: AD_ID_3, timestamp: AD_PAGE_2_BEFORE })], null),
      },
    ]);
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull(AD_NEVER_POLLED);

    expect(result.ok).toBe(true);
    // Page 2 was requested at EXACTLY the url the server handed back — not a
    // url rebuilt from its parts, which would drop the encoded filter and the
    // exclusive `before`.
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]?.url).toBe(AD_PAGE_1_NEXT);
    // The walk stopped on the LITERAL null, not on a short page.
    if (!result.ok) return;
    expect(result.contiguous).toBe(true);
    expect(result.resumeBefore).toBeNull();
    expect(result.pagesFetched).toBe(2);
    expect(result.events.map((event) => event.sourceEventId)).toEqual([AD_ID_1, AD_ID_2, AD_ID_3]);
  });

  // Item 51 — ROW 1. Ordering is strictly newest-first, so the newest instant
  // is page 1 item 0. Accumulating it from the last page would walk the
  // watermark BACKWARDS every run and re-fetch the same window forever.
  test("the watermark is taken from the FIRST item of the FIRST page, never accumulated from the last page", async () => {
    const fake = createPagedFetch([
      {
        status: 200,
        body: adEventsPage(
          [
            adEventItem({ id: AD_ID_1, timestamp: AD_NEWEST_WIRE }),
            adEventItem({ id: AD_ID_2, timestamp: "2026-07-30T17:57:48.891000+00:00" }),
          ],
          AD_PAGE_1_NEXT,
        ),
      },
      {
        status: 200,
        body: adEventsPage([adEventItem({ id: AD_ID_3, timestamp: AD_PAGE_2_BEFORE })], null),
      },
    ]);
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull(AD_NEVER_POLLED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newestObservedAt).toEqual(AD_NEWEST_INSTANT);
    expect(result.newestObservedAt).not.toEqual(new Date(AD_PAGE_2_BEFORE));
  });

  // Item 52 — FR-5 / ROW 4. `after` is EXCLUSIVE and `timestamp` is
  // client-declared, so an event from a late-flushing buffer or a skewed clock
  // lands BEHIND the watermark. Subtracting the overlap window is the only
  // thing that re-queries it.
  test("an event whose declared timestamp predates the watermark is still requested, because after = watermark − overlap", async () => {
    const watermarkAt = new Date("2026-07-30T18:00:00.000Z");
    const expectedAfter = "2026-07-30T17:45:00.000+00:00"; // watermark − 900 s
    expect(OVERLAP_WINDOW_SECONDS).toBe(900);

    // Declared ten minutes BEFORE the watermark — inside the overlap window.
    const backdatedWire = "2026-07-30T17:50:00.000000+00:00";
    const fake = createFakeFetch(() => ({
      status: 200,
      body: adEventsPage([adEventItem({ id: AD_ID_1, timestamp: backdatedWire })], null),
    }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull({
      watermarkAt,
      backfillBefore: null,
      maxPages: 25,
    });

    // The request asked from the overlap-subtracted instant, in the one tested
    // wire form — never the raw watermark, never a naive string.
    const requestedUrl = fake.requests[0]?.url ?? "";
    expect(decodeURIComponent(requestedUrl)).toContain(expectedAfter);
    expect(decodeURIComponent(requestedUrl)).not.toContain("2026-07-30T18:00:00");

    // And the backdated event actually comes back, rather than being lost
    // behind the exclusive boundary forever.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map((event) => event.sourceEventId)).toEqual([AD_ID_1]);
  });

  // Item 53 — FR-4. A page-cap stop is NOT end-of-data. Reporting it as one
  // would advance the watermark past events never read — a silent, permanent
  // hole.
  test("hitting the page cap returns contiguous:false with a resumeBefore cursor — never a silent end-of-data", async () => {
    const fake = createPagedFetch([
      {
        status: 200,
        body: adEventsPage(
          [adEventItem({ id: AD_ID_1, timestamp: AD_NEWEST_WIRE })],
          AD_PAGE_1_NEXT,
        ),
      },
      {
        status: 200,
        body: adEventsPage(
          [adEventItem({ id: AD_ID_2, timestamp: "2026-07-30T17:57:45.000000+00:00" })],
          AD_PAGE_2_NEXT,
        ),
      },
      // A third page exists. The cap must stop the walk before it, and say so.
      {
        status: 200,
        body: adEventsPage([adEventItem({ id: AD_ID_3, timestamp: AD_PAGE_2_BEFORE })], null),
      },
    ]);
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull({
      watermarkAt: null,
      backfillBefore: null,
      maxPages: 2,
    });

    expect(fake.requests).toHaveLength(2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contiguous).toBe(false);
    expect(result.resumeBefore).not.toBeNull();
    // The resume point references the stop point the SERVER encoded, whether it
    // is carried as the whole cursor url or as the `before` value inside it.
    expect(decodeURIComponent(String(result.resumeBefore))).toContain(AD_PAGE_2_BEFORE);
    // The newest instant is still page 1 item 0 — the caller uses it only once
    // the walk is provably contiguous.
    expect(result.newestObservedAt).toEqual(AD_NEWEST_INSTANT);
    expect(result.pagesFetched).toBe(2);
  });

  // Item 54 — FR-22. Because the walk is newest-first, a mid-walk failure has
  // ALREADY retrieved the newest events. Losing them would throw away the most
  // valuable rows of the run.
  test("a mid-walk fetch failure returns ok:false with partialEvents preserved", async () => {
    const fake = createPagedFetch([
      {
        status: 200,
        body: adEventsPage(
          [
            adEventItem({ id: AD_ID_1, timestamp: AD_NEWEST_WIRE }),
            adEventItem({ id: AD_ID_2, timestamp: "2026-07-30T17:57:48.891000+00:00" }),
          ],
          AD_PAGE_1_NEXT,
        ),
      },
      { networkError: true },
    ]);
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull(AD_NEVER_POLLED);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.code).toBe("unreachable");
    expect(result.partialEvents.map((event) => event.sourceEventId)).toEqual([AD_ID_1, AD_ID_2]);
    expect(result.partialSessions.length).toBeGreaterThan(0);
    expect(result.eventsReceived).toBe(2);
    expect(result.pagesFetched).toBe(1);
  });
});
