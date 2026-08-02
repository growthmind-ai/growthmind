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
  test("the pull walk follows next verbatim until it is literally null and never reconstructs the cursor", async () => {
    const fake = createPagedFetch([
      {
        status: 200,
        body: adEventsPage(
          [
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

    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]?.url).toBe(AD_PAGE_1_NEXT);

    if (!result.ok) return;
    expect(result.contiguous).toBe(true);
    expect(result.resumeBefore).toBeNull();
    expect(result.pagesFetched).toBe(2);
    expect(result.events.map((event) => event.sourceEventId)).toEqual([AD_ID_1, AD_ID_2, AD_ID_3]);
  });

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

  test("an event whose declared timestamp predates the watermark is still requested, because after = watermark − overlap", async () => {
    const watermarkAt = new Date("2026-07-30T18:00:00.000Z");
    const expectedAfter = "2026-07-30T17:45:00.000+00:00";
    expect(OVERLAP_WINDOW_SECONDS).toBe(900);

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

    const requestedUrl = fake.requests[0]?.url ?? "";
    expect(decodeURIComponent(requestedUrl)).toContain(expectedAfter);
    expect(decodeURIComponent(requestedUrl)).not.toContain("2026-07-30T18:00:00");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map((event) => event.sourceEventId)).toEqual([AD_ID_1]);
  });

  test("hitting the page cap returns contiguous:false with a resumeBefore cursor — never a silent end-of-data", async () => {
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

    expect(decodeURIComponent(String(result.resumeBefore))).toContain(AD_PAGE_2_BEFORE);

    expect(result.newestObservedAt).toEqual(AD_NEWEST_INSTANT);
    expect(result.pagesFetched).toBe(2);
  });

  test("a stored backfillBefore resumes PASS 1 from that exact cursor, before any forward-pass request", async () => {
    const fake = createPagedFetch([
      {
        status: 200,
        body: adEventsPage(
          [adEventItem({ id: AD_ID_2, timestamp: AD_PAGE_2_BEFORE, distinct_id: null })],
          null,
        ),
      },

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

    expect(fake.requests[0]?.url).toBe(AD_PAGE_1_NEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events.map((e) => e.sourceEventId).toSorted()).toEqual(
      [AD_ID_1, AD_ID_2].toSorted(),
    );
  });

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

    expect(result.contiguous).toBe(true);
    expect(result.resumeBefore).toBeNull();

    expect(result.newestObservedAt).toEqual(AD_NEWEST_INSTANT);
    expect(result.pagesFetched).toBe(2);
  });

  test("a resumed walk that hits the page cap again stays non-contiguous and skips the forward pass entirely", async () => {
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

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.url).toBe(AD_PAGE_1_NEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contiguous).toBe(false);
    expect(result.resumeBefore).toBe(AD_PAGE_2_NEXT);

    expect(result.newestObservedAt).toBeNull();
  });

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

  test("when pass 1 legitimately exhausts the whole page budget, pass 2 makes zero requests and resumeBefore is null, not the fresh forward-pass url", async () => {
    const fake = createPagedFetch([
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

    expect(fake.requests).toHaveLength(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contiguous).toBe(false);

    expect(result.resumeBefore).toBeNull();
    expect(result.newestObservedAt).toBeNull();
    expect(result.pagesFetched).toBe(1);
  });

  test("a page 1 whose newest item is unparseable never advances the watermark past it", async () => {
    const fake = createPagedFetch([
      {
        status: 200,

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

    expect(result.events.map((event) => event.sourceEventId)).toEqual([AD_ID_1]);
    expect(result.droppedMalformed).toBe(1);

    expect(result.newestObservedAt).toBeNull();
  });

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

    const personsRequests = fake.requests.filter((request) => request.url.includes("/persons"));
    expect(personsRequests).toHaveLength(1);
    expect(personsRequests[0]?.url).toContain(AD_WIRED_DISTINCT_ID);
    expect(result.identityLookupsUsed).toBe(1);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.identityResolution).toBe("resolved");
    expect(result.sessions[0]?.identityEmailDomain).toBe("ad-wired.invalid");
  });

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

    expect(result.sessions[0]?.identityKey).toBe(
      hashIdentityKey(AD_IDENTITY_HMAC_KEY, AD_SOURCE_PROJECT_ID, AD_EMAIL_SHAPED_DISTINCT_ID),
    );
  });
});
