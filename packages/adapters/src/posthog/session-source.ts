// The PostHog implementation of the `SessionSource` port (O-003 D-6, D-11).
//
// It owns the walk, session assembly, identity resolution, and the overlap
// subtraction.
//
// HOT-PATH CONSTRAINT, quoted so nobody "optimises" it back:
// docs/decisions/0001-posthog-retrieval-latency.md §6 records that the events
// list API satisfied retrievability in 40 of 40 trials, while the HogQL query
// API hit the 120-second ceiling in 40 of 40 and surfaced no fresh event.
// HogQL joins persons and is viable for a batch backfill of identity; it is
// PROHIBITED on the poll path, and a grep test asserts no `/query` call
// exists here.
//
// THE WALK (D-6a–d), in the order it must happen:
//   1. If `backfillBefore` is set, resume the unfinished BACKWARD walk from it
//      before starting a new forward pass.
//   2. Page 1: `after = formatPostHogInstant(watermarkAt −
//      OVERLAP_WINDOW_SECONDS)`, `limit = PAGE_LIMIT`.
//   3. Follow `next` VERBATIM. Terminate when `next` is literally `null`,
//      when `MAX_PAGES_PER_RUN` is hit, or when the oldest item on a page is
//      at or before the previous watermark. NEVER treat "fewer rows than
//      `limit`" as an end signal.
//   4. `newestObservedAt` is PAGE 1, ITEM 0 — the ordering is strictly
//      newest-first, so it is never accumulated from the last page.
//   5. `contiguous` is true only for (3)'s first or third termination. A
//      page-cap stop sets `contiguous: false` and a `resumeBefore` cursor,
//      and the caller must not advance the watermark.
//
import type {
  SessionSourcePullRequest,
  SessionSourcePullResult,
  SessionSourceValidation,
  SourceEvent,
  SourceFailure,
  SourceSession,
} from "@growthmind/shared";
import { CONNECT_REFUSAL_MESSAGES, deriveSessionKey } from "@growthmind/shared";

import type { SessionSource } from "../session-source";
import { createPostHogClient } from "./client";
import {
  IDENTITY_LOOKUP_BUDGET,
  MAX_PAGES_PER_RUN,
  OVERLAP_WINDOW_SECONDS,
  PAGE_LIMIT,
  POSTHOG_SOURCE_KIND,
} from "./constants";
import type { PostHogSourceConfig, PostHogSourceDeps } from "./deps";
import { createIdentityResolver, harvestEmailFromEvents } from "./identity";
import { formatPostHogInstant } from "./instant";
import type { RawEvent } from "./parse";
import { parseEventsPage } from "./parse";

/**
 * The one failure a time value can produce. It is built here rather than in
 * `errors.ts` because it is OURS — nothing upstream reported it; we refused to
 * send a value we could not certify, precisely so an empty page can never be
 * mistaken for "caught up".
 */
const MISCONFIGURED: SourceFailure = {
  code: "misconfigured",
  message: CONNECT_REFUSAL_MESSAGES.misconfigured,
};

/** Why a walk stopped. Only `page_cap` means "there is more we did not read". */
type WalkStopReason = "exhausted" | "watermark" | "page_cap";

interface WalkStop {
  readonly reason: WalkStopReason;
  /** The server-encoded cursor we did NOT follow, carried verbatim. Non-null
   * only for `page_cap`. */
  readonly resumeBefore: string | null;
  /** Page 1, item 0 of THIS walk (ROW 1: ordering is strictly newest-first). */
  readonly firstItemAt: Date | null;
}

type WalkOutcome =
  | { readonly ok: true; readonly stop: WalkStop }
  | { readonly ok: false; readonly failure: SourceFailure };

/**
 * The one implementation, imported BY NAME at the composition root. There is
 * no registry, no factory table, and no dynamic lookup anywhere — the worker
 * switches exhaustively over a one-member Zod union the compiler checks, so
 * the day a second adapter lands the missing branch is a compile error rather
 * than a silent fallthrough.
 */
export function createPostHogSessionSource(
  config: PostHogSourceConfig,
  deps: PostHogSourceDeps,
): SessionSource {
  return {
    kind: POSTHOG_SOURCE_KIND,

    async validate(): Promise<SessionSourceValidation> {
      // ONE bounded check that the credentials and the project reach real
      // data. `limit=1` because the question is reachability, not volume.
      const client = createPostHogClient(config, deps);

      let url: string;
      try {
        url = client.firstEventsPageUrl({ after: null, before: null, limit: 1 });
      } catch {
        return { ok: false, checkedAt: deps.now(), failure: MISCONFIGURED };
      }

      const result = await client.getEventsPage(url);
      if (!result.ok) {
        return { ok: false, checkedAt: deps.now(), failure: result.failure };
      }
      return { ok: true, checkedAt: deps.now() };
    },

    async pull(request: SessionSourcePullRequest): Promise<SessionSourcePullResult> {
      const client = createPostHogClient(config, deps);
      const resolver = createIdentityResolver(client, { budget: IDENTITY_LOOKUP_BUDGET });

      // The page cap is the TIGHTER of the caller's request and the package
      // ceiling, so a caller can only ever ask for less work, never more.
      const pageCap = Math.min(request.maxPages, MAX_PAGES_PER_RUN);
      const watermarkAt = request.watermarkAt;

      const collected: RawEvent[] = [];
      let pagesFetched = 0;
      let droppedMalformed = 0;
      let eventsReceived = 0;

      /**
       * One backward walk from `startUrl`. Every page after the first is the
       * server's own `next`, followed VERBATIM.
       *
       * The loop is bounded by `url !== null` and by `pageCap`; it has no
       * unbounded form and no recursion.
       */
      async function walk(startUrl: string): Promise<WalkOutcome> {
        let url: string | null = startUrl;
        let firstItemAt: Date | null = null;

        while (url !== null) {
          if (pagesFetched >= pageCap) {
            // NOT end-of-data. The cursor we did not follow is handed back so
            // the caller can resume, and the watermark must not advance.
            return { ok: true, stop: { reason: "page_cap", resumeBefore: url, firstItemAt } };
          }

          const response = await client.getEventsPage(url);
          if (!response.ok) {
            // The walk is newest-first, so whatever `collected` already holds
            // is the MOST valuable part of the run. The caller keeps it.
            return { ok: false, failure: response.failure };
          }
          pagesFetched += 1;

          const page = parseEventsPage(response.value);
          droppedMalformed += page.droppedMalformed;
          eventsReceived += page.events.length;

          const newestOnPage = page.events[0];
          if (firstItemAt === null && newestOnPage !== undefined) {
            firstItemAt = newestOnPage.timestamp;
          }
          for (const event of page.events) {
            collected.push(event);
          }

          // Crossing the previous watermark is a real end: everything older
          // was covered by an earlier contiguous run.
          const oldestOnPage = page.events[page.events.length - 1];
          if (
            watermarkAt !== null &&
            oldestOnPage !== undefined &&
            oldestOnPage.timestamp.getTime() <= watermarkAt.getTime()
          ) {
            return { ok: true, stop: { reason: "watermark", resumeBefore: null, firstItemAt } };
          }

          // The ONLY end signal a page can give. A page shorter than `limit`
          // gives none (ROW 1).
          url = page.next;
        }

        return { ok: true, stop: { reason: "exhausted", resumeBefore: null, firstItemAt } };
      }

      /**
       * Groups the walk's events into sessions and resolves each one's
       * identity, in deterministic first-seen order.
       *
       * IDENTITY INSIDE THE WALK IS HARVEST-ONLY, and that is a decision.
       * `harvestEmailFromEvents` is free, so it always runs. The budgeted
       * `/persons` fallback is NOT spent here: a lookup per assembled session
       * turns one poll into an N+1 fan-out against the one endpoint whose
       * throttle profile was never measured (§7 ASSUMED), and the fail
       * direction of not spending it is the safe one — the session is KEPT and
       * reported `unresolved`, never laundered into "we checked and cleared
       * this" (F-8). The resolver is handed no distinct id, so no budget can
       * be spent by this path and `identityLookupsUsed` is structurally 0.
       */
      async function assemble(
        raw: readonly RawEvent[],
      ): Promise<{ sessions: SourceSession[]; events: SourceEvent[] }> {
        const events: SourceEvent[] = [];
        const grouped = new Map<string, RawEvent[]>();

        for (const event of raw) {
          const sessionKey = deriveSessionKey({
            postHogSessionId: event.sessionId,
            identityKey: event.distinctId,
            occurredAt: event.timestamp,
            sourceEventId: event.id,
          });

          // Emitted in WALK order, so the caller sees exactly the sequence the
          // server returned rather than a regrouped one.
          events.push({
            sourceEventId: event.id,
            sessionKey,
            name: event.event,
            occurredAt: event.timestamp,
            urlPath: event.urlPath,
          });

          const bucket = grouped.get(sessionKey);
          if (bucket === undefined) {
            grouped.set(sessionKey, [event]);
          } else {
            bucket.push(event);
          }
        }

        const sessions: SourceSession[] = [];
        // `Map` preserves insertion order, so this is first-seen order — which
        // is what makes any budget spend reproducible in a test.
        for (const [sessionKey, bucket] of grouped) {
          const chronological = bucket.toSorted(
            (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
          );
          const first = chronological[0];
          const last = chronological[chronological.length - 1];
          if (first === undefined || last === undefined) {
            continue;
          }

          const identityKey = chronological.find((event) => event.distinctId !== null)?.distinctId;
          const identity = await resolver.resolve({
            distinctId: null,
            harvestedEmail: harvestEmailFromEvents(chronological),
          });

          sessions.push({
            sessionKey,
            identityKey: identityKey ?? null,
            identityEmailDomain: identity.emailDomain,
            identityResolution: identity.resolution,
            userAgent: chronological.find((event) => event.userAgent !== null)?.userAgent ?? null,
            // The ENTRY path is the earliest event's, not the newest — the
            // walk reads backwards, so taking the first row seen would name
            // the exit.
            entryUrlPath: chronological.find((event) => event.urlPath !== null)?.urlPath ?? null,
            startedAt: first.timestamp,
            lastEventAt: last.timestamp,
          });
        }

        return { sessions, events };
      }

      // `after` is EXCLUSIVE and `timestamp` is client-declared, so an event
      // from a late flush or a skewed clock lands BEHIND the watermark.
      // Subtracting the overlap window is the only thing that re-queries it;
      // the FR-6 unique index absorbs the re-seen rows.
      let after: string | null = null;
      try {
        if (watermarkAt !== null) {
          after = formatPostHogInstant(
            new Date(watermarkAt.getTime() - OVERLAP_WINDOW_SECONDS * 1000),
          );
        }
      } catch {
        const assembled = await assemble(collected);
        return {
          ok: false,
          failure: MISCONFIGURED,
          partialSessions: assembled.sessions,
          partialEvents: assembled.events,
          pagesFetched,
          droppedMalformed,
          identityLookupsUsed: resolver.lookupsUsed(),
          eventsReceived,
        };
      }

      let contiguous = true;
      let resumeBefore: string | null = null;
      let newestObservedAt: Date | null = null;

      // PASS 1 — finish the unfinished backward walk first, if a previous run
      // stopped on the page cap. The cursor is the server's own url, so it
      // still carries that run's `after` bound and its encoded filter; it is
      // resumed VERBATIM rather than rebuilt.
      if (request.backfillBefore !== null) {
        const outcome = await walk(request.backfillBefore);
        if (!outcome.ok) {
          const assembled = await assemble(collected);
          return {
            ok: false,
            failure: outcome.failure,
            partialSessions: assembled.sessions,
            partialEvents: assembled.events,
            pagesFetched,
            droppedMalformed,
            identityLookupsUsed: resolver.lookupsUsed(),
            eventsReceived,
          };
        }
        if (outcome.stop.reason === "page_cap") {
          contiguous = false;
          resumeBefore = outcome.stop.resumeBefore;
        }
      }

      // PASS 2 — the forward pass, from the newest event backwards. Skipped
      // when pass 1 already used the page budget, because a partial forward
      // pass would report a `newestObservedAt` the walk had not covered.
      if (contiguous) {
        let firstUrl: string;
        try {
          firstUrl = client.firstEventsPageUrl({ after, before: null, limit: PAGE_LIMIT });
        } catch {
          const assembled = await assemble(collected);
          return {
            ok: false,
            failure: MISCONFIGURED,
            partialSessions: assembled.sessions,
            partialEvents: assembled.events,
            pagesFetched,
            droppedMalformed,
            identityLookupsUsed: resolver.lookupsUsed(),
            eventsReceived,
          };
        }

        const outcome = await walk(firstUrl);
        if (!outcome.ok) {
          const assembled = await assemble(collected);
          return {
            ok: false,
            failure: outcome.failure,
            partialSessions: assembled.sessions,
            partialEvents: assembled.events,
            pagesFetched,
            droppedMalformed,
            identityLookupsUsed: resolver.lookupsUsed(),
            eventsReceived,
          };
        }

        // PAGE 1, ITEM 0 of the forward pass — never accumulated from the last
        // page, which would walk the watermark backwards every run.
        newestObservedAt = outcome.stop.firstItemAt;
        if (outcome.stop.reason === "page_cap") {
          contiguous = false;
          resumeBefore = outcome.stop.resumeBefore;
        }
      }

      const assembled = await assemble(collected);
      return {
        ok: true,
        sessions: assembled.sessions,
        events: assembled.events,
        newestObservedAt,
        contiguous,
        resumeBefore,
        pagesFetched,
        droppedMalformed,
        identityLookupsUsed: resolver.lookupsUsed(),
        eventsReceived,
      };
    },
  };
}
