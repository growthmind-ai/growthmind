import type {
  AnalysisWindow,
  DetectorCorpus,
  SessionAction,
  SessionReplay,
  SessionTimeline,
  TimelineEvent,
} from "@growthmind/core";
import {
  DETECTOR_CORPUS_MAX_SESSIONS,
  pagesOfActions,
  rehydratePersistedActions,
  tallyActions,
} from "@growthmind/core";
import type { AudienceRule, ExclusionReason, TenantContext } from "@growthmind/shared";
import { confirmedAudienceRules, evaluateAudience, readBusinessContext } from "@growthmind/shared";
import { asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { createRecordingSummariesRepo } from "../repositories/recording-summaries.repo";
import type { SessionRecordingCitation } from "../repositories/recording-summaries.repo";
import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { events } from "../schema/events";
import { growthContext } from "../schema/growth-context";
import { sessionSourcePollRuns } from "../schema/session-source-poll-runs";
import { sessions } from "../schema/sessions";
import { deriveConnectionState, findLatestConnection } from "./connection-state";
import { buildSetAsideBreakdown } from "./set-aside-breakdown";

// The corpus arrives with its evidence attached, so no caller has to remember to ask for it and
// no session id is ever hand-assembled between the two reads (edge-case taxonomy D11).
export type DetectorCorpusRead = DetectorCorpus & {
  readonly citations: readonly SessionRecordingCitation[];
};

export interface DetectorCorpusService {
  read(projectId: string, window: AnalysisWindow): Promise<DetectorCorpusRead>;
}

const CAP_PROBE_LIMIT = DETECTOR_CORPUS_MAX_SESSIONS + 1;

const NOT_COMPUTED_BY_THE_READ = 0;

// `startedAt`/`clockOriginAtMs` have no source in a citation (only `buildTranscript`'s original
// rrweb pull knows them) and are left null — both fields are nullable by design for exactly
// this "unknown" case, and no detector reads either off `corpus.replays` today.
function durationOf(actions: readonly SessionAction[]): number {
  const first = actions[0];
  const last = actions[actions.length - 1];
  if (first === undefined || last === undefined) return 0;
  return Math.max(0, last.atMs - first.atMs);
}

function replayFrom(citation: SessionRecordingCitation): SessionReplay | null {
  if (citation.actions === null) return null;

  const actions = rehydratePersistedActions(citation.actions);

  return {
    sessionId: citation.sessionId,
    transcript: {
      actions,
      startedAt: null,
      clockOriginAtMs: null,
      durationMs: durationOf(actions),
      pages: pagesOfActions(actions),
      counts: tallyActions(actions),
      droppedEvents: citation.omitted,
    },
  };
}

async function readConfirmedAudienceRules(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<readonly AudienceRule[]> {
  const s = scoped(db, ctx);

  const [row] = await db
    .select({ businessContext: growthContext.businessContext })
    .from(growthContext)
    .where(s.owned(growthContext, eq(growthContext.projectId, projectId)))
    .limit(1);

  if (row === undefined) return [];

  return confirmedAudienceRules(readBusinessContext(row.businessContext));
}

export function createDetectorCorpusService(
  db: ScopedDb,
  ctx: TenantContext,
): DetectorCorpusService {
  const s = scoped(db, ctx);

  return {
    async read(projectId: string, window: AnalysisWindow): Promise<DetectorCorpusRead> {
      const audienceRules = await readConfirmedAudienceRules(db, ctx, projectId);

      const windowRows = await db
        .select({
          id: sessions.id,
          startedAt: sessions.startedAt,
          exclusionReason: sessions.exclusionReason,
          entryUrlPath: sessions.entryUrlPath,
          identityEmailDomain: sessions.identityEmailDomain,
          identityResolution: sessions.identityResolution,
        })
        .from(sessions)
        .where(
          s.owned(
            sessions,
            eq(sessions.projectId, projectId),
            gte(sessions.startedAt, window.start),
            lte(sessions.startedAt, window.end),
          ),
        )
        .orderBy(desc(sessions.startedAt), desc(sessions.id))
        .limit(CAP_PROBE_LIMIT);

      const truncated = windowRows.length > DETECTOR_CORPUS_MAX_SESSIONS;
      const selected = truncated ? windowRows.slice(0, DETECTOR_CORPUS_MAX_SESSIONS) : windowRows;
      const selectedIds = selected.map((row) => row.id);

      const eventRows =
        selectedIds.length === 0
          ? []
          : await db
              .select({
                sessionId: events.sessionId,
                sourceEventId: events.sourceEventId,
                name: events.name,
                occurredAt: events.occurredAt,
                urlPath: events.urlPath,
                urlPathNormalisationVersion: events.urlPathNormalisationVersion,
              })
              .from(events)
              .where(
                s.owned(
                  events,
                  eq(events.projectId, projectId),
                  inArray(events.sessionId, selectedIds),
                ),
              )
              .orderBy(asc(events.occurredAt), asc(events.sourceEventId));

      const eventsBySession = new Map<string, TimelineEvent[]>();
      for (const row of eventRows) {
        const timeline = eventsBySession.get(row.sessionId);
        const event: TimelineEvent = {
          sourceEventId: row.sourceEventId,
          name: row.name,
          occurredAt: row.occurredAt,
          urlPath: row.urlPath,

          urlPathNormalisationVersion: row.urlPathNormalisationVersion,
        };
        if (timeline) {
          timeline.push(event);
        } else {
          eventsBySession.set(row.sessionId, [event]);
        }
      }

      let unchecked = 0;

      const timelines: SessionTimeline[] = selected.map((row) => {
        const stamped = row.exclusionReason satisfies ExclusionReason;

        // A session already set aside keeps the reason it was set aside for: re-labelling it
        // would move a count between two rows of the same breakdown.
        const verdict =
          stamped === "none"
            ? evaluateAudience(audienceRules, {
                identityEmailDomain: row.identityEmailDomain,
                identityResolution: row.identityResolution,
                entryUrlPath: row.entryUrlPath,
              })
            : "counts";

        if (verdict === "unknown") unchecked += 1;

        return {
          sessionId: row.id,
          startedAt: row.startedAt,
          exclusionReason: verdict === "outside" ? "outside_who_counts" : stamped,
          entryUrlPath: row.entryUrlPath,
          events: eventsBySession.get(row.id) ?? [],
        };
      });

      const keptSessionIds: string[] = [];
      const sessionsByReason = new Map<ExclusionReason, number>();
      for (const timeline of timelines) {
        if (timeline.exclusionReason === "none") {
          keptSessionIds.push(timeline.sessionId);
          continue;
        }
        sessionsByReason.set(
          timeline.exclusionReason,
          (sessionsByReason.get(timeline.exclusionReason) ?? 0) + 1,
        );
      }

      const setAside = buildSetAsideBreakdown({
        unit: "sessions",
        countsByReason: sessionsByReason,
      });

      // Bounded by the same constant citationsFor refuses to exceed: keptSessionIds is a subset
      // of `selected`, which is sliced to DETECTOR_CORPUS_MAX_SESSIONS above.
      const citations = await createRecordingSummariesRepo(db, ctx).citationsFor(
        projectId,
        keptSessionIds,
      );

      const replays = citations
        .map((citation) => replayFrom(citation))
        .filter((replay) => replay !== null);

      const connection = await findLatestConnection(db, ctx, projectId);

      const [completedPoll] = await db
        .select({ id: sessionSourcePollRuns.id })
        .from(sessionSourcePollRuns)
        .where(
          s.owned(
            sessionSourcePollRuns,
            eq(sessionSourcePollRuns.projectId, projectId),
            eq(sessionSourcePollRuns.status, "completed"),
          ),
        )
        .limit(1);

      const [anyEvent] = await db
        .select({ id: events.id })
        .from(events)
        .where(s.owned(events, eq(events.projectId, projectId)))
        .limit(1);

      return {
        projectId,
        window,
        connectionState: deriveConnectionState(connection, {
          hasCompletedPoll: completedPoll !== undefined,
          hasEvents: anyEvent !== undefined,
        }),
        sessions: timelines,
        citations,
        replays,
        basis: {
          totalInWindow: timelines.length,
          kept: keptSessionIds.length,
          setAside,
          keptUnchecked: unchecked,
        },
        coverage: { truncated, eventsWithoutUrlPath: NOT_COMPUTED_BY_THE_READ },
      };
    },
  };
}
