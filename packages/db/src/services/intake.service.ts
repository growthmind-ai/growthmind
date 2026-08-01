// The single write path for `sessions` and `events`.
//
// Everything the classifier consumes is stamped on the session row here, so a stored
// stamp is reproducible from persisted data alone with zero vendor access. The exact
// property the future `exclusions.backfill` depends on.
//
// Persists on both pull outcomes. The walk is newest-first, so a mid-walk failure has
// already retrieved the newest events; those are written and the watermark is not
// advanced. Partial progress survives by contract, not by hope.
import type {
  Origin,
  SessionSourcePullResult,
  SourceEvent,
  SourceSession,
  TenantContext,
} from "@growthmind/shared";
import {
  CURRENT_EXCLUSION_RULE_SET,
  EXCLUSION_RULE_SET_VERSION,
  SESSION_GROUPING_VERSION,
  URL_PATH_NORMALISATION_VERSION,
  classifyExclusion,
  normaliseUrlPath,
} from "@growthmind/shared";

import { createEventsRepo, type EventInsertRow } from "../repositories/events.repo";
import { createSessionsRepo, type SessionUpsertRow } from "../repositories/sessions.repo";
import type { ScopedDb } from "../repositories/types";

/** The connection fields the intake needs. Nothing credential-bearing. */
export interface IntakeConnection {
  id: string;
  projectId: string;
  /** What the classifier will see, and what gets stamped on each session as
   * `internal_domain_at_stamp`. The provenance of the stamp, not the project's current
   * domain. */
  inferredInternalDomain: string | null;
}

export interface IntakeCounts {
  eventsReceived: number;
  eventsPersisted: number;
  sessionsTouched: number;
  eventsDroppedMalformed: number;
}

/** This sprint's only writer stamps `real`; `synthetic` arrives with simulation. The
 * shared `originSchema` union is reused, never redefined. */
const INTAKE_ORIGIN: Origin = "real";

/**
 * Splits the discriminated pull result into the one shape the write path cares about. A
 * failed pull is not an empty pull: the walk is newest-first, so its partials are the
 * newest events and throwing them away would make the "partial progress survives" a
 * hope rather than a guarantee.
 */
function collectedFrom(result: SessionSourcePullResult): {
  sessions: readonly SourceSession[];
  events: readonly SourceEvent[];
} {
  return result.ok
    ? { sessions: result.sessions, events: result.events }
    : { sessions: result.partialSessions, events: result.partialEvents };
}

/**
 * The version stamp for one event's `url_path`. Asserted, never assumed.
 *
 * `SourceEvent` (`packages/shared/src/session-source/types.ts`) deliberately carries no
 * version field, so nothing in the port type ties a stamp to the value having actually
 * been normalised. Today `packages/adapters/src/posthog/ parse.ts` happens to call
 * `normaliseUrlPath`; a second source adapter forwarding a raw `$current_url` would get
 * the same stamp on an UN-normalised path, and the PII remediation query (`WHERE
 * url_path_normalisation_version IS NULL OR < N`) would then never select those rows. A
 * live reset token or an email address in `events.url_path` made permanently invisible
 * to the remediation the column exists to enable.
 *
 * The check is idempotence, exactly as `assertNormalisedSurface` in
 * `packages/core/src/findings/evidence-shape.ts`: a value is normalised exactly when
 * re-normalising it is a no-op. That inherits every rule `normaliseUrlPath` has and
 * every rule it ever gains, rather than a second copy here that would drift and then
 * disagree.
 *
 * `null` (`urlPath === null`) is stamped with the version: there is no path to be
 * un-redacted, and the guarantee that `NULL` in the column means exactly one thing
 * ("redaction status unknown") depends on a no-path row carrying it.
 *
 * Fail direction: `null`, and deliberately not a throw. `null` means "redaction status
 * unknown, remediate me" and IS selected by the remediation query, whereas a false
 * stamp is invisible forever. Intake is a write path: throwing would lose the event,
 * and a lost event is a worse outcome than a row flagged for remediation.
 *
 * Nothing here echoes the path itself. Into a message, a log line, or an error. Echoing
 * the raw value is how a live token escapes the one column it was confined to.
 */
function normalisationVersionFor(urlPath: string | null): number | null {
  if (urlPath === null) return URL_PATH_NORMALISATION_VERSION;

  return normaliseUrlPath(urlPath, null) === urlPath ? URL_PATH_NORMALISATION_VERSION : null;
}

/**
 * Assembles session rows, runs `classifyExclusion` against
 * `CURRENT_EXCLUSION_RULE_SET`, upserts sessions, then inserts events keyed to them.
 *
 * Sessions before events, deliberately: `events.session_id` is a foreign key, so the
 * session row must exist first, and the session upsert is idempotent so a retry
 * re-establishes the linkage rather than orphaning it.
 */
export async function persistPullResult(
  db: ScopedDb,
  ctx: TenantContext,
  input: { connection: IntakeConnection; result: SessionSourcePullResult },
): Promise<IntakeCounts> {
  const { connection, result } = input;
  const collected = collectedFrom(result);

  const sessionRows: SessionUpsertRow[] = collected.sessions.map((session) => ({
    projectId: connection.projectId,
    connectionId: connection.id,
    sessionKey: session.sessionKey,
    identityKey: session.identityKey,
    identityEmailDomain: session.identityEmailDomain,
    identityResolution: session.identityResolution,
    userAgent: session.userAgent,
    entryUrlPath: session.entryUrlPath,
    startedAt: session.startedAt,
    lastEventAt: session.lastEventAt,
    origin: INTAKE_ORIGIN,
    // . The classifier reads only the four facts below, and all four are written
    // onto the row in the same statement, `internal_domain_at_stamp` records what the
    // classifier saw, not what the project's domain happens to be later. That is what
    // makes re-running the classifier over persisted rows reproduce every stamp
    // exactly, with zero vendor access.
    exclusionReason: classifyExclusion(
      {
        identityEmailDomain: session.identityEmailDomain,
        identityResolution: session.identityResolution,
        internalDomain: connection.inferredInternalDomain,
        userAgent: session.userAgent,
      },
      CURRENT_EXCLUSION_RULE_SET,
    ),
    internalDomainAtStamp: connection.inferredInternalDomain,
    // Both versions travel with the stamp. When a v2 rule set lands,
    // `EXCLUSION_RULE_SETS.get` still reproduces this row's stamp exactly, so a rule
    // change is a migratable event rather than a silent fork.
    exclusionRuleSetVersion: EXCLUSION_RULE_SET_VERSION,
    groupingVersion: SESSION_GROUPING_VERSION,
  }));

  const persistedSessions = await createSessionsRepo(db, ctx).upsertMany(sessionRows);

  // The repository returns exactly the rows the write touched. A row this context does
  // not own is filtered out before the statement and never comes back. Keying events
  // off this map rather than off the pull result is what makes a foreign-project pull
  // produce zero orphan events instead of a foreign-key error.
  const sessionIdByKey = new Map(persistedSessions.map((row) => [row.sessionKey, row.id]));

  const eventRows: EventInsertRow[] = [];
  for (const event of collected.events) {
    const sessionId = sessionIdByKey.get(event.sessionKey);
    if (sessionId === undefined) {
      continue;
    }

    eventRows.push({
      projectId: connection.projectId,
      connectionId: connection.id,
      sessionId,
      sourceEventId: event.sourceEventId,
      name: event.name,
      occurredAt: event.occurredAt,
      urlPath: event.urlPath,
      // The version travels with the value, exactly as the session stamps above do.
      // `url_path` is redacted by `normaliseUrlPath`, and a stored path written under
      // an older rule set may still carry a live token or an email; this stamp is the
      // only thing that could ever tell a remediation migration which rows those are,
      // which is why it asserts the value is normalised rather than assuming it.
      urlPathNormalisationVersion: normalisationVersionFor(event.urlPath),
    });
  }

  const eventsPersisted = await createEventsRepo(db, ctx).insertManyIgnoringDuplicates(eventRows);

  return {
    // What the boundary handed us, not what we managed to store. The two differ by the
    // overlap window's re-requested duplicates, and reporting the stored figure as
    // "received" would hide the drop count below.
    eventsReceived: result.eventsReceived,
    eventsPersisted,
    sessionsTouched: persistedSessions.length,
    // Skipped and counted. A malformed item the parser could not read is reported as
    // its own number so it never reads as a quiet product.
    eventsDroppedMalformed: result.droppedMalformed,
  };
}
