import type {
  SessionSourcePullRequest,
  SessionSourcePullResult,
  SessionSourceValidation,
  SourceEvent,
  SourceFailure,
  SourceSession,
} from "@growthmind/shared";
import { CONNECT_REFUSAL_MESSAGES, deriveSessionKey, hashIdentityKey } from "@growthmind/shared";

import { isSameOriginAsHost } from "../http/origin";
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
import { checkHost } from "./host-guard";
import { createIdentityResolver, harvestEmailFromEvents } from "./identity";
import { formatPostHogInstant } from "./instant";
import type { RawEvent } from "./parse";
import { parseEventsPage } from "./parse";

const MISCONFIGURED: SourceFailure = {
  code: "misconfigured",
  message: CONNECT_REFUSAL_MESSAGES.misconfigured,
};

type WalkStopReason = "exhausted" | "watermark" | "page_cap";

interface WalkStop {
  readonly reason: WalkStopReason;

  readonly resumeBefore: string | null;

  readonly firstItemAt: Date | null;
}

type WalkOutcome =
  | { readonly ok: true; readonly stop: WalkStop }
  | { readonly ok: false; readonly failure: SourceFailure };

export function createPostHogSessionSource(
  config: PostHogSourceConfig,
  deps: PostHogSourceDeps,
): SessionSource {
  return {
    kind: POSTHOG_SOURCE_KIND,

    async validate(): Promise<SessionSourceValidation> {
      if (!checkHost(config.host).ok) {
        return { ok: false, checkedAt: deps.now(), failure: MISCONFIGURED };
      }

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

      const pageCap = Math.min(request.maxPages, MAX_PAGES_PER_RUN);
      const watermarkAt = request.watermarkAt;

      const collected: RawEvent[] = [];
      let pagesFetched = 0;
      let droppedMalformed = 0;
      let eventsReceived = 0;

      async function walk(startUrl: string): Promise<WalkOutcome> {
        let url: string | null = startUrl;
        let firstItemAt: Date | null = null;

        let isFirstPageOfThisWalk = true;

        let madeAnyRequest = false;

        while (url !== null) {
          if (pagesFetched >= pageCap) {
            return {
              ok: true,
              stop: { reason: "page_cap", resumeBefore: madeAnyRequest ? url : null, firstItemAt },
            };
          }

          const response = await client.getEventsPage(url);
          if (!response.ok) {
            return { ok: false, failure: response.failure };
          }
          pagesFetched += 1;
          madeAnyRequest = true;

          const page = parseEventsPage(response.value);
          droppedMalformed += page.droppedMalformed;
          eventsReceived += page.events.length;

          const newestOnPage = page.events[0];
          if (isFirstPageOfThisWalk) {
            if (!page.firstItemDropped && newestOnPage !== undefined) {
              firstItemAt = newestOnPage.timestamp;
            }
            isFirstPageOfThisWalk = false;
          }
          for (const event of page.events) {
            collected.push(event);
          }

          const oldestOnPage = page.events[page.events.length - 1];
          if (
            watermarkAt !== null &&
            oldestOnPage !== undefined &&
            oldestOnPage.timestamp.getTime() <= watermarkAt.getTime()
          ) {
            return { ok: true, stop: { reason: "watermark", resumeBefore: null, firstItemAt } };
          }

          if (page.next !== null && !isSameOriginAsHost(page.next, config.host)) {
            return { ok: false, failure: MISCONFIGURED };
          }
          url = page.next;
        }

        return { ok: true, stop: { reason: "exhausted", resumeBefore: null, firstItemAt } };
      }

      async function assemble(
        raw: readonly RawEvent[],
      ): Promise<{ sessions: SourceSession[]; events: SourceEvent[] }> {
        const events: SourceEvent[] = [];
        const grouped = new Map<string, RawEvent[]>();

        for (const event of raw) {
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

        for (const [sessionKey, bucket] of grouped) {
          const chronological = bucket.toSorted(
            (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
          );
          const first = chronological[0];
          const last = chronological[chronological.length - 1];
          if (first === undefined || last === undefined) {
            continue;
          }

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

            entryUrlPath: chronological.find((event) => event.urlPath !== null)?.urlPath ?? null,
            startedAt: first.timestamp,
            lastEventAt: last.timestamp,
          });
        }

        return { sessions, events };
      }

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
