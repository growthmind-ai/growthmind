// items 50–54, the walk.
//
// Three pinned facts shape every assertion here (Addendum a row 1 / row 2 / row 4):
// Pagination walks backwards. `next` is an absolute url carrying an
//  exclusive `before=<last item's timestamp>`; ordering is strictly
//  newest-first; `next` is literal null on the final page. A short page is
//  not the end.
// `after`/`before` are both exclusive, and a malformed value returns HTTP
//  200 with an empty result set — so an empty page can never be trusted as
//  "caught up".
// `timestamp` is client-declared event time with no ingestion-time field
//  anywhere, which is why the overlap window is load-bearing rather than
//  defensive.
import { describe, expect, test } from "bun:test";

import { hashIdentityKey } from "@growthmind/shared";

import { OVERLAP_WINDOW_SECONDS, PAGE_LIMIT } from "../../src/posthog/constants";
import { createPostHogSessionSource } from "../../src/posthog/session-source";
import {
  AD_CONFIG,
  AD_HOST,
  AD_IDENTITY_HMAC_KEY,
  AD_SOURCE_PROJECT_ID,
  adEventItem,
  adEventsPage,
  adPersonsBody,
  createFakeDeps,
  createFakeFetch,
  createPagedFetch,
} from "../helpers/fakes";

const AD_EVENTS_PATH = `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/events`;

/**
 * A server-encoded cursor. The `cursor=` segment is an opaque token no client could
 * ever reconstruct. That is what makes "followed verbatim" provable rather than merely
 * plausible.
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
  // Item 50, row 1.
  test("the pull walk follows next verbatim until it is literally null and never reconstructs the cursor", async () => {
    const fake = createPagedFetch([
      {
        status: 200,
        body: adEventsPage(
          [
            // `distinct_id: null`: this test is about pagination mechanics, not
            // identity. A real distinct id here would (correctly, since) spend an
            // extra `/persons` request the assertions below don't account for.
            adEventItem({ id: AD_ID_1, timestamp: AD_NEWEST_WIRE, distinct_id: null }),
            adEventItem({
              id: AD_ID_2,
              timestamp: "2026-07-30T17:57:48.891000+00:00",
              distinct_id: null,
            }),
          ],
          AD_PAGE_1_NEXT,
        ),
      },
      {
        status: 200,
        body: adEventsPage(
          [adEventItem({ id: AD_ID_3, timestamp: AD_PAGE_2_BEFORE, distinct_id: null })],
          null,
        ),
      },
    ]);
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull(AD_NEVER_POLLED);

    expect(result.ok).toBe(true);
    // Page 2 was requested at exactly the url the server handed back, not a url rebuilt
    // from its parts, which would drop the encoded filter and the exclusive `before`.
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]?.url).toBe(AD_PAGE_1_NEXT);
    // The walk stopped on the literal null, not on a short page.
    if (!result.ok) return;
    expect(result.contiguous).toBe(true);
    expect(result.resumeBefore).toBeNull();
    expect(result.pagesFetched).toBe(2);
    expect(result.events.map((event) => event.sourceEventId)).toEqual([AD_ID_1, AD_ID_2, AD_ID_3]);
  });

  // Item 51, row 1. Ordering is strictly newest-first, so the newest instant is page 1
  // item 0. Accumulating it from the last page would walk the watermark backwards every
  // run and re-fetch the same window forever.
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

  // Item 52, / row 4. `after` is exclusive and `timestamp` is client-declared, so an
  // event from a late-flushing buffer or a skewed clock lands behind the watermark.
  // Subtracting the overlap window is the only thing that re-queries it.
  test("an event whose declared timestamp predates the watermark is still requested, because after = watermark − overlap", async () => {
    const watermarkAt = new Date("2026-07-30T18:00:00.000Z");
    const expectedAfter = "2026-07-30T17:45:00.000+00:00"; // watermark − 900 s
    expect(OVERLAP_WINDOW_SECONDS).toBe(900);

    // Declared ten minutes before the watermark. Inside the overlap window.
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

    // The request asked from the overlap-subtracted instant, in the one tested wire
    // form, never the raw watermark, never a naive string.
    const requestedUrl = fake.requests[0]?.url ?? "";
    expect(decodeURIComponent(requestedUrl)).toContain(expectedAfter);
    expect(decodeURIComponent(requestedUrl)).not.toContain("2026-07-30T18:00:00");

    // And the backdated event actually comes back, rather than being lost behind the
    // exclusive boundary forever.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map((event) => event.sourceEventId)).toEqual([AD_ID_1]);
  });

  // Item 53 —. A page-cap stop is not end-of-data. Reporting it as one would advance
  // the watermark past events never read. A silent, permanent hole.
  test("hitting the page cap returns contiguous:false with a resumeBefore cursor — never a silent end-of-data", async () => {
    // `distinct_id: null` throughout: this test is about the page-cap mechanic, not
    // identity. A real distinct id would (correctly, since) spend an extra `/persons`
    // request the request-count assertion below doesn't account for.
    const fake = createPagedFetch([
      {
        status: 200,
        body: adEventsPage(
          [adEventItem({ id: AD_ID_1, timestamp: AD_NEWEST_WIRE, distinct_id: null })],
          AD_PAGE_1_NEXT,
        ),
      },
      {
        status: 200,
        body: adEventsPage(
          [
            adEventItem({
              id: AD_ID_2,
              timestamp: "2026-07-30T17:57:45.000000+00:00",
              distinct_id: null,
            }),
          ],
          AD_PAGE_2_NEXT,
        ),
      },
      // A third page exists. The cap must stop the walk before it, and say so.
      {
        status: 200,
        body: adEventsPage(
          [adEventItem({ id: AD_ID_3, timestamp: AD_PAGE_2_BEFORE, distinct_id: null })],
          null,
        ),
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
    // The resume point references the stop point the server encoded, whether it is
    // carried as the whole cursor url or as the `before` value inside it.
    expect(decodeURIComponent(String(result.resumeBefore))).toContain(AD_PAGE_2_BEFORE);
    // The newest instant is still page 1 item 0. The caller uses it only once the walk
    // is provably contiguous.
    expect(result.newestObservedAt).toEqual(AD_NEWEST_INSTANT);
    expect(result.pagesFetched).toBe(2);
  });

  // test gap, "pass 1, finish the unfinished backward walk" (~lines 297–320) had zero
  // coverage anywhere in the repo before this: every existing test either sent
  // `backfillBefore: null`, or only asserted that a page-cap stop produces a resume
  // cursor, never that a stored one is actually consumed.

  //  A stored backfillBefore is consumed: Pass 1 requests it verbatim, before
  // anything from a freshly-built forward-pass url.
  test("a stored backfillBefore resumes PASS 1 from that exact cursor, before any forward-pass request", async () => {
    // `distinct_id: null`: this test is about pass ordering, not identity. A real
    // distinct id would (correctly, since) spend an extra `/persons` request the
    // request-count assertion below doesn't expect.
    const fake = createPagedFetch([
      // Pass 1, the resumed walk's own page. A literal `null` next ends it cleanly (not
      // a page-cap stop), so pass 2 is expected to run after.
      {
        status: 200,
        body: adEventsPage(
          [adEventItem({ id: AD_ID_2, timestamp: AD_PAGE_2_BEFORE, distinct_id: null })],
          null,
        ),
      },
      // Pass 2, the forward pass, a completely separate walk starting from `after`
      // computed off `watermarkAt`.
      {
        status: 200,
        body: adEventsPage(
          [adEventItem({ id: AD_ID_1, timestamp: AD_NEWEST_WIRE, distinct_id: null })],
          null,
        ),
      },
    ]);
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull({
      watermarkAt: null,
      backfillBefore: AD_PAGE_1_NEXT,
      maxPages: 25,
    });

    expect(fake.requests).toHaveLength(2);
    // Pass 1 followed the stored cursor verbatim, not a url this call reconstructed
    // from `watermarkAt`/`after`.
    expect(fake.requests[0]?.url).toBe(AD_PAGE_1_NEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both passes' events are present: the resumed walk's own page and the fresh
    // forward pass.
    expect(result.events.map((e) => e.sourceEventId).toSorted()).toEqual(
      [AD_ID_1, AD_ID_2].toSorted(),
    );
  });

  //  Once the resumed backward walk finishes cleanly (not another page-cap stop),
  // pass 2 runs and the overall result is contiguous with a real `newestObservedAt`.
  // The shape the caller needs to advance the watermark.
  test("once the resumed backward walk finishes cleanly, the forward pass runs and the result is contiguous with a real newestObservedAt", async () => {
    const fake = createPagedFetch([
      {
        status: 200,
        body: adEventsPage([adEventItem({ id: AD_ID_2, timestamp: AD_PAGE_2_BEFORE })], null),
      },
      {
        status: 200,
        body: adEventsPage([adEventItem({ id: AD_ID_1, timestamp: AD_NEWEST_WIRE })], null),
      },
    ]);
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull({
      watermarkAt: null,
      backfillBefore: AD_PAGE_1_NEXT,
      maxPages: 25,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The backlog is now fully drained. This is what lets the caller finally advance
    // the watermark, closing out the stall.
    expect(result.contiguous).toBe(true);
    expect(result.resumeBefore).toBeNull();
    // Page 1, item 0 of pass 2 (the forward pass), never accumulated from pass 1's
    // resumed walk, which would report a stale instant.
    expect(result.newestObservedAt).toEqual(AD_NEWEST_INSTANT);
    expect(result.pagesFetched).toBe(2);
  });

  // A resumed walk that is still capped: Pass 2 must not run (a partial forward pass
  // would report a `newestObservedAt` the walk never covered), and the new resume
  // cursor points at the resumed walk's own stop, not the original one.
  test("a resumed walk that hits the page cap again stays non-contiguous and skips the forward pass entirely", async () => {
    // `distinct_id: null`: identity resolution is not what this test covers, and a real
    // distinct id would (correctly, since) spend an extra `/persons` request the
    // request-count assertion below doesn't expect.
    const fake = createPagedFetch([
      {
        status: 200,
        body: adEventsPage(
          [
            adEventItem({
              id: AD_ID_2,
              timestamp: "2026-07-30T17:57:45.000000+00:00",
              distinct_id: null,
            }),
          ],
          AD_PAGE_2_NEXT,
        ),
      },
    ]);
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull({
      watermarkAt: null,
      backfillBefore: AD_PAGE_1_NEXT,
      maxPages: 1,
    });

    // Only one request, the resumed page. No forward-pass request at all.
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.url).toBe(AD_PAGE_1_NEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contiguous).toBe(false);
    expect(result.resumeBefore).toBe(AD_PAGE_2_NEXT);
    // No forward pass ran, so there is no fresh newest instant to report.
    expect(result.newestObservedAt).toBeNull();
  });

  // Item 54 —. Because the walk is newest-first, a mid-walk failure has already
  // retrieved the newest events. Losing them would throw away the most valuable rows of
  // the run.
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

  // A page-cap stop whose walk made zero requests (the budget was already spent
  // entirely by a clean pass 1 completion. Reason "exhausted", not "page_cap") must not
  // echo back the freshly-built pass 2 forward-pass url as `resumeBefore`. That value
  // carries no server-issued cursor at all: storing it in `backfill_before` would make
  // the next run's pass 1 replay the exact same forward range pass 2 would build fresh
  // anyway, in the same run.
  test("when pass 1 legitimately exhausts the whole page budget, pass 2 makes zero requests and resumeBefore is null, not the fresh forward-pass url", async () => {
    // `distinct_id: null`: this test is about the cursor mechanic, not identity. A real
    // distinct id would (correctly, since) spend an extra `/persons` request the
    // request-count assertion below doesn't expect.
    const fake = createPagedFetch([
      // Pass 1's only page. A literal `null` next ends it cleanly. This is not a
      // page-cap stop, so `contiguous` stays true entering pass 2.
      {
        status: 200,
        body: adEventsPage(
          [adEventItem({ id: AD_ID_2, timestamp: AD_PAGE_2_BEFORE, distinct_id: null })],
          null,
        ),
      },
    ]);
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull({
      watermarkAt: null,
      backfillBefore: AD_PAGE_1_NEXT,
      maxPages: 1,
    });

    // Only pass 1's one request happened. Pass 2 never got to fetch a single page. Its
    // own page-cap check fires before any request, because pass 1 already spent the
    // whole budget.
    expect(fake.requests).toHaveLength(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contiguous).toBe(false);
    // The crux of: Not the freshly-built forward-pass url. Pass 2 issued no request, so
    // there is no server-issued cursor to resume from.
    expect(result.resumeBefore).toBeNull();
    expect(result.newestObservedAt).toBeNull();
    expect(result.pagesFetched).toBe(1);
  });

  // If the genuinely newest item on page 1 (index 0) is unparseable, the watermark must
  // not silently skip past it by trusting the next survivor's timestamp as "the
  // newest". `after`/`before` are both exclusive (row 2), so once that survivor's
  // instant becomes the new watermark, the malformed item eventually ages out of the
  // overlap window and is permanently lost. Visible only as a rising
  // `droppedMalformed`.
  test("a page 1 whose newest item is unparseable never advances the watermark past it", async () => {
    const fake = createPagedFetch([
      {
        status: 200,
        // The first item in the wire array (index 0, the genuinely newest) has no
        // readable `id` or `timestamp`. It cannot be parsed at all. The second item is
        // fine and would be page.events[0] after filtering, which is exactly the false
        // signal forbids trusting.
        body: adEventsPage(
          [
            { distinct_id: "ad-unreadable", timestamp: "not-a-date", person: null },
            adEventItem({ id: AD_ID_1, timestamp: AD_NEWEST_WIRE }),
          ],
          null,
        ),
      },
    ]);
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull(AD_NEVER_POLLED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The surviving item is still returned. Per-item degradation, never per-page.
    expect(result.events.map((event) => event.sourceEventId)).toEqual([AD_ID_1]);
    expect(result.droppedMalformed).toBe(1);
    // The crux of: `newestObservedAt` is not the survivor's timestamp. It is unknown,
    // so it must stay null, never a false "caught up to here" the caller would use to
    // advance the watermark.
    expect(result.newestObservedAt).toBeNull();
  });

  // The dead wire. `assemble` must hand the resolver the session's real raw distinct
  // id, not a hardcoded `null`, or the budgeted `/persons` lookup can never run in
  // production. This drives the wire through `pull` itself (the real path), not the
  // resolver directly. That is precisely the gap the producer/consumer tests alone left
  // open.
  test("pull actually spends a /persons lookup for a session with a distinct_id and no harvested $set.email", async () => {
    const AD_WIRED_DISTINCT_ID = "ad-distinct-wired";
    const AD_WIRED_EMAIL = "someone@ad-wired.invalid";
    const fake = createFakeFetch((url) => {
      if (url.includes("/persons")) {
        return { status: 200, body: adPersonsBody(AD_WIRED_EMAIL) };
      }
      return {
        status: 200,
        body: adEventsPage(
          [
            adEventItem({
              id: AD_ID_1,
              timestamp: AD_NEWEST_WIRE,
              distinct_id: AD_WIRED_DISTINCT_ID,
            }),
          ],
          null,
        ),
      };
    });
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull(AD_NEVER_POLLED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The budgeted /persons lookup actually ran, with the session's real distinct id.
    // This is the wire fixes.
    const personsRequests = fake.requests.filter((request) => request.url.includes("/persons"));
    expect(personsRequests).toHaveLength(1);
    expect(personsRequests[0]?.url).toContain(AD_WIRED_DISTINCT_ID);
    expect(result.identityLookupsUsed).toBe(1);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.identityResolution).toBe("resolved");
    expect(result.sessions[0]?.identityEmailDomain).toBe("ad-wired.invalid");
  });

  // Only a project-salted hash of the distinct id may ever cross the port boundary
  // (product-decisions, prd: domain only, never the address). PostHog's own
  // `identify` is routinely called with an email address as the distinct id, so this
  // pins the one shape the repo had zero coverage of before this fix.
  test("an email-shaped distinct_id is hashed before crossing the port boundary — never appears in identityKey or sessionKey", async () => {
    const AD_EMAIL_SHAPED_DISTINCT_ID = "person@ad-emailshaped.invalid";
    const fake = createFakeFetch(() => ({
      status: 200,
      body: adEventsPage(
        [
          adEventItem({
            id: AD_ID_1,
            timestamp: AD_NEWEST_WIRE,
            distinct_id: AD_EMAIL_SHAPED_DISTINCT_ID,
          }),
        ],
        null,
      ),
    }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await createPostHogSessionSource(AD_CONFIG, deps).pull(AD_NEVER_POLLED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The raw address never appears anywhere in the returned pull result, not in
    // identityKey, not in sessionKey, not embedded in any other field.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(AD_EMAIL_SHAPED_DISTINCT_ID);
    expect(serialised).not.toContain("@ad-emailshaped.invalid");

    const expectedHash = hashIdentityKey(
      AD_IDENTITY_HMAC_KEY,
      AD_SOURCE_PROJECT_ID,
      AD_EMAIL_SHAPED_DISTINCT_ID,
    );
    expect(result.sessions[0]?.identityKey).toBe(expectedHash);
    expect(result.sessions[0]?.sessionKey).toContain(expectedHash);
    // Deterministic and stable: re-hashing the same key + project + distinct id off the
    // port produces the byte-identical digest that crossed it.
    expect(result.sessions[0]?.identityKey).toBe(
      hashIdentityKey(AD_IDENTITY_HMAC_KEY, AD_SOURCE_PROJECT_ID, AD_EMAIL_SHAPED_DISTINCT_ID),
    );
  });
});
