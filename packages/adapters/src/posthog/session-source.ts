// The PostHog implementation of the `SessionSource` port.
//
// It owns the walk, session assembly, identity resolution, and the overlap subtraction.
//
// Hot-path constraint, quoted so nobody "optimises" it back:
// docs/decisions/0001-posthog-retrieval-latency.md records that the events list API
// satisfied retrievability in 40 of 40 trials, while the HogQL query API hit the
// 120-second ceiling in 40 of 40 and surfaced no fresh event. HogQL joins persons and
// is viable for a batch backfill of identity; it is prohibited on the poll path, and a
// grep test asserts no `/query` call exists here.
//
// The walk, in the order it must happen:
// 1. If `backfillBefore` is set, resume the unfinished backward walk from it
//  before starting a new forward pass.
// 2. Page 1: `after = formatPostHogInstant(watermarkAt −
//  OVERLAP_WINDOW_SECONDS)`, `limit = PAGE_LIMIT`.
// 3. Follow `next` verbatim. Terminate when `next` is literally `null`,
//  when `MAX_PAGES_PER_RUN` is hit, or when the oldest item on a page is
//  at or before the previous watermark. Never treat "fewer rows than
//  `limit`" as an end signal.
// 4. `newestObservedAt` is page 1, item 0. The ordering is strictly
//  newest-first, so it is never accumulated from the last page. If that
//  item could not be parsed, its instant is unknown, and no later item on
//  the page may stand in for it: `newestObservedAt` is `null` for the
//  whole walk rather than a watermark that quietly skips past it.
// 5. `contiguous` is true only for's first or third termination. A
//  page-cap stop sets `contiguous: false` and a `resumeBefore` cursor —
//  but only when a page was actually fetched in the walk that hit the
//  cap. A walk that starts with zero budget left resumes from `null`,
//  never from the request url it was never able to send.
import type {
  SessionSourcePullRequest,
  SessionSourcePullResult,
  SessionSourceValidation,
  SourceEvent,
  SourceFailure,
  SourceSession,
} from "@growthmind/shared";
import { CONNECT_REFUSAL_MESSAGES, deriveSessionKey, hashIdentityKey } from "@growthmind/shared";

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
import { checkHost, isSameOriginAsHost } from "./host-guard";
import { createIdentityResolver, harvestEmailFromEvents } from "./identity";
import { formatPostHogInstant } from "./instant";
import type { RawEvent } from "./parse";
import { parseEventsPage } from "./parse";

/**
 * The one failure a time value can produce. It is built here rather than in `errors.ts`
 * because it is ours. Nothing upstream reported it; we refused to send a value we could
 * not certify, precisely so an empty page can never be mistaken for "caught up".
 */
const MISCONFIGURED: SourceFailure = {
  code: "misconfigured",
  message: CONNECT_REFUSAL_MESSAGES.misconfigured,
};

/** Why a walk stopped. Only `page_cap` means "there is more we did not read". */
type WalkStopReason = "exhausted" | "watermark" | "page_cap";

interface WalkStop {
  readonly reason: WalkStopReason;
  /** The server-encoded cursor we did not follow, carried verbatim. Non-null only for
   * `page_cap`. */
  readonly resumeBefore: string | null;
  /** Page 1, item 0 of this walk (row 1: ordering is strictly newest-first). */
  readonly firstItemAt: Date | null;
}

type WalkOutcome =
  | { readonly ok: true; readonly stop: WalkStop }
  | { readonly ok: false; readonly failure: SourceFailure };

/**
 * The one implementation, imported by name at the composition root. There is no
 * registry, no factory table, and no dynamic lookup anywhere. The worker switches
 * exhaustively over a one-member Zod union the compiler checks, so the day a second
 * adapter lands the missing branch is a compile error rather than a silent fallthrough.
 */
export function createPostHogSessionSource(
  config: PostHogSourceConfig,
  deps: PostHogSourceDeps,
): SessionSource {
  return {
    kind: POSTHOG_SOURCE_KIND,

    async validate(): Promise<SessionSourceValidation> {
      // Ssrf gate (audit C-1), before any request. `validate` runs on the attach
      // attempt and fires an outbound request whether or not a row is ever written, so
      // an unvalidated host means merely *trying* to connect reaches wherever the
      // customer pointed us, and the failure codes this adapter deliberately keeps
      // distinct (`unreachable` vs `invalid_credentials` vs `project_not_found`) become
      // a port-scanning oracle for the provider's own network.
      if (!checkHost(config.host).ok) {
        return { ok: false, checkedAt: deps.now(), failure: MISCONFIGURED };
      }

      // One bounded check that the credentials and the project reach real data.
      // `limit=1` because the question is reachability, not volume.
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

      // The page cap is the tighter of the caller's request and the package ceiling, so
      // a caller can only ever ask for less work, never more.
      const pageCap = Math.min(request.maxPages, MAX_PAGES_PER_RUN);
      const watermarkAt = request.watermarkAt;

      const collected: RawEvent[] = [];
      let pagesFetched = 0;
      let droppedMalformed = 0;
      let eventsReceived = 0;

      /**
       * One backward walk from `startUrl`. Every page after the first is the server's
       * own `next`, followed verbatim.
       *
       * The loop is bounded by `url !== null` and by `pageCap`; it has no unbounded
       * form and no recursion.
       */
      async function walk(startUrl: string): Promise<WalkOutcome> {
        let url: string | null = startUrl;
        let firstItemAt: Date | null = null;
        // `firstItemAt` may only ever be seeded from this walk's own page 1 (row 1).
        // Tracked explicitly rather than inferred from `firstItemAt === null`, because
        // a page 1 that contributes zero parseable events (all malformed, or a page
        // whose `next` still points to a page 2) must not let a later page's item 0 be
        // mistaken for the newest.
        let isFirstPageOfThisWalk = true;
        // A page-cap `resumeBefore` must be a cursor the server handed us via a page's
        // `next`. If this walk call never got to fetch a single page (the budget was
        // already spent by an earlier walk in the same run), `url` here is still
        // exactly `startUrl`. For pass 2 that is the freshly-built forward-pass url,
        // not a real resume cursor. Storing it would make the next run's pass 1 replay
        // the exact same range pass 2 is about to build fresh anyway.
        let madeAnyRequest = false;

        while (url !== null) {
          if (pagesFetched >= pageCap) {
            // Not end-of-data. The cursor we did not follow is handed back so the
            // caller can resume, and the watermark must not advance.
            return {
              ok: true,
              stop: { reason: "page_cap", resumeBefore: madeAnyRequest ? url : null, firstItemAt },
            };
          }

          const response = await client.getEventsPage(url);
          if (!response.ok) {
            // The walk is newest-first, so whatever `collected` already holds is the
            // most valuable part of the run. The caller keeps it.
            return { ok: false, failure: response.failure };
          }
          pagesFetched += 1;
          madeAnyRequest = true;

          const page = parseEventsPage(response.value);
          droppedMalformed += page.droppedMalformed;
          eventsReceived += page.events.length;

          const newestOnPage = page.events[0];
          if (isFirstPageOfThisWalk) {
            // Trust `events[0]` as "the newest instant, everything at or after this is
            // captured" only when page 1's own item 0 was itself readable. A dropped
            // item 0 means the true newest instant is unknown, `events[0]` here would
            // be a strictly older item, so `firstItemAt` stays `null` for the whole
            // walk, which is what keeps the caller from advancing the watermark past it
            // (packages/db's connections service only commits `newestObservedAt` when
            // it is non-null).
            if (!page.firstItemDropped && newestOnPage !== undefined) {
              firstItemAt = newestOnPage.timestamp;
            }
            isFirstPageOfThisWalk = false;
          }
          for (const event of page.events) {
            collected.push(event);
          }

          // Crossing the previous watermark is a real end: everything older was covered
          // by an earlier contiguous run.
          const oldestOnPage = page.events[page.events.length - 1];
          if (
            watermarkAt !== null &&
            oldestOnPage !== undefined &&
            oldestOnPage.timestamp.getTime() <= watermarkAt.getTime()
          ) {
            return { ok: true, stop: { reason: "watermark", resumeBefore: null, firstItemAt } };
          }

          // The only end signal a page can give. A page shorter than `limit` gives none
          // (row 1).
          //
          // Security (audit C-2): `next` is an absolute url chosen by the upstream, and
          // the client attaches the customer's personal API key to whatever it fetches.
          // An upstream answering `{"results":[],"next":"https://attacker.tld/x"}`
          // would hand that key straight to the attacker, and would bypass any
          // allow-list applied only to the configured host. So every hop must stay on
          // the configured origin.
          //
          // Treated as a hard failure, not as end-of-pages: stopping quietly would let
          // a hostile upstream silently truncate a customer's data, which is a quieter
          // bug rather than a safer outcome.
          if (page.next !== null && !isSameOriginAsHost(page.next, config.host)) {
            return { ok: false, failure: MISCONFIGURED };
          }
          url = page.next;
        }

        return { ok: true, stop: { reason: "exhausted", resumeBefore: null, firstItemAt } };
      }

      /**
       * Groups the walk's events into sessions and resolves each one's identity, in
       * deterministic first-seen order.
       *
       * Identity resolution spends the budget here, and that is a decision.
       * `harvestEmailFromEvents` (free) is tried first; only when it comes back empty
       * does resolving a session spend one `/persons` lookup (— the resolver is handed
       * the session's real raw distinct id, so the step 2 can actually run, rather than
       * a hardcoded `null` that made step 2 permanently unreachable). The fail
       * direction on a spent OR an exhausted budget is the safe one either way. The
       * session is kept and reported `unresolved`, never laundered into "we checked and
       * cleared this".
       *
       * Only a hash ever crosses the port boundary (security audit,
       * product-decisions, prd). PostHog's raw `distinct_id` is real signal. The
       * `/persons` lookup above needs it, and session grouping needs a stable key
       * derived from it, but `identify` is routinely called with an email address, so
       * the raw value can carry PII. `hashIdentityKey` (a keyed HMAC-SHA256,
       * `@growthmind/shared`. Keyed, not merely project-salted, because the project id
       * salt is public and an unkeyed digest of an email-shaped distinct id is
       * dictionary-reversible from it) is applied once, at the point each event's
       * identity key is produced below, so `deriveSessionKey` (and therefore
       * `session_key`) never sees the raw value either. The raw distinct id itself
       * lives only in this function's local scope, for exactly as long as the
       * `/persons` lookup needs it.
       */
      async function assemble(
        raw: readonly RawEvent[],
      ): Promise<{ sessions: SourceSession[]; events: SourceEvent[] }> {
        const events: SourceEvent[] = [];
        const grouped = new Map<string, RawEvent[]>();

        for (const event of raw) {
          // Hashed once, here, so every downstream consumer of an identity key. Session
          // grouping below, and the persisted session further down. Only ever sees the
          // hash, never the raw PostHog value.
          const hashedIdentityKey =
            event.distinctId === null
              ? null
              : hashIdentityKey(deps.identityHmacKey, config.sourceProjectId, event.distinctId);

          const sessionKey = deriveSessionKey({
            postHogSessionId: event.sessionId,
            identityKey: hashedIdentityKey,
            occurredAt: event.timestamp,
            sourceEventId: event.id,
          });

          // Emitted in walk order, so the caller sees exactly the sequence the server
          // returned rather than a regrouped one.
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
        // `Map` preserves insertion order, so this is first-seen order, which is what
        // makes any budget spend reproducible in a test.
        for (const [sessionKey, bucket] of grouped) {
          const chronological = bucket.toSorted(
            (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
          );
          const first = chronological[0];
          const last = chronological[chronological.length - 1];
          if (first === undefined || last === undefined) {
            continue;
          }

          // The raw distinct id. PostHog's own identifier, not ours to invent a
          // substitute for. Is what the budgeted `/persons` lookup (step 2) needs. It
          // stays local to this call; the resolver never persists it, and the value
          // that crosses the port boundary below is always the hash.
          const rawDistinctId =
            chronological.find((event) => event.distinctId !== null)?.distinctId ?? null;
          const identity = await resolver.resolve({
            distinctId: rawDistinctId,
            harvestedEmail: harvestEmailFromEvents(chronological),
          });

          sessions.push({
            sessionKey,
            identityKey:
              rawDistinctId === null
                ? null
                : hashIdentityKey(deps.identityHmacKey, config.sourceProjectId, rawDistinctId),
            identityEmailDomain: identity.emailDomain,
            identityResolution: identity.resolution,
            userAgent: chronological.find((event) => event.userAgent !== null)?.userAgent ?? null,
            // The entry path is the earliest event's, not the newest. The walk reads
            // backwards, so taking the first row seen would name the exit.
            entryUrlPath: chronological.find((event) => event.urlPath !== null)?.urlPath ?? null,
            startedAt: first.timestamp,
            lastEventAt: last.timestamp,
          });
        }

        return { sessions, events };
      }

      // `after` is exclusive and `timestamp` is client-declared, so an event from a
      // late flush or a skewed clock lands behind the watermark. Subtracting the
      // overlap window is the only thing that re-queries it; the unique index absorbs
      // the re-seen rows.
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

      // Pass 1, finish the unfinished backward walk first, if a previous run stopped on
      // the page cap. The cursor is the server's own url, so it still carries that
      // run's `after` bound and its encoded filter; it is resumed verbatim rather than
      // rebuilt.
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

      // Pass 2, the forward pass, from the newest event backwards. Skipped when pass 1
      // already used the page budget, because a partial forward pass would report a
      // `newestObservedAt` the walk had not covered.
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

        // Page 1, item 0 of the forward pass, never accumulated from the last page,
        // which would walk the watermark backwards every run.
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
