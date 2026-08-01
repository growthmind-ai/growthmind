// The connection lifecycle: attach, read state, detach.
//
// Why the source factory is injected. packages/db must never depend on
// packages/adapters. That would invert the layering and drag a vendor implementation
// into the data layer. So the service takes a `CreateSourceFn` as a dependency, typed
// structurally against the shapes both packages already share via @growthmind/shared.
// `SessionSource` from packages/adapters satisfies `AttachableSource` structurally,
// with no import and no cast. The same injection is what makes every test here run
// against a fake source with no network at all.
import type {
  ConnectInput,
  ConnectResult,
  ConnectRefusalCode,
  ConnectionState,
  ConnectionSummary,
  CredentialKey,
  CredentialKeyResolution,
  SessionSourcePullRequest,
  SessionSourcePullResult,
  SessionSourceValidation,
  SourceFailure,
  TenantContext,
} from "@growthmind/shared";
import {
  CONNECT_REFUSAL_MESSAGES,
  connectInputSchema,
  credentialAad,
  encryptSecret,
  inferInternalDomain,
  keyIdOf,
  secondSourceRefusalMessage,
} from "@growthmind/shared";

import { createEventsRepo } from "../repositories/events.repo";
import { createOrganizationsRepo } from "../repositories/organizations.repo";
import { createPollRunsRepo } from "../repositories/poll-runs.repo";
import {
  ConnectionWriteError,
  createProjectConnectionsRepo,
} from "../repositories/project-connections.repo";
import { createProjectsRepo } from "../repositories/projects.repo";
import type { ScopedDb } from "../repositories/types";
import { deriveConnectionState, findLatestConnection } from "./connection-state";
import { persistPullResult } from "./intake.service";

/**
 * The structural shape this service needs from a source. Deliberately narrower than
 * `SessionSource` (it does not name `kind`) so nothing here can branch on a vendor
 * name. The vendor name does not exist below the composition root.
 */
export interface AttachableSource {
  validate(): Promise<SessionSourceValidation>;
  pull(request: SessionSourcePullRequest): Promise<SessionSourcePullResult>;
}

export interface SourceConnectionConfig {
  host: string;
  sourceProjectId: string;
  /** Held only for the lifetime of the call. Never logged, never returned. */
  personalApiKey: string;
}

export type CreateSourceFn = (config: SourceConnectionConfig) => AttachableSource;

export interface ConnectionsServiceDeps {
  createSource: CreateSourceFn;
  /**
   * The resolved credential key, or the named refusal. A `{ ok: false, reason:
   * "insecure_default_key" }` here becomes a `misconfigured` connect refusal whose
   * message names the one step to fix it. The gate the insecure-defaults bypass cannot
   * open. Boot still succeeds; storing a customer's secret does not.
   */
  credentialKey: CredentialKeyResolution;
  now: () => Date;
}

//  (security audit). `ConnectInput` and its runtime `connectInputSchema` live in
// `@growthmind/shared` (`session-source/types.ts`), alongside every other
// cross-boundary shape this file already imports rather than defines. Re-exported here
// so existing callers of `@growthmind/db` keep importing both from the same place. See
// that file for why the schema exists: `connect` is the boundary this data layer
// exposes to whatever calls it, and a bare TypeScript interface is not a runtime check.
export { connectInputSchema };
export type { ConnectInput };

export interface ConnectionsService {
  /**
   * The attach flow, in this order:
   * 1. Resolve the credential key; a refusal short-circuits to
   *  `misconfigured` with NO row written and NO request made.
   * 2. `validate` through the injected source factory. A failure records
   *  a terminal health state and never leaves an active row behind —
   *  wrong-credentials, wrong-project, and unreachable stay distinct.
   * 3. Encrypt the key under the `(organizationId, projectId)` additional
   *  authenticated data and insert. A second source is refused by the
   *  partial unique index, never by a prior read, and the refusal
   *  names the existing attachment and the cutover path.
   * 4. Infer the internal domain from the org creator's email and record
   *  its provenance. No resolvable creator email ⇒ infer nothing.
   * 5. One bounded inline first pull, so the counter is non-zero the moment
   *  onboarding step 2 completes — this serves the glue moment better
   *  than any faster background tick would.
   */
  connect(input: ConnectInput): Promise<ConnectResult>;
  /**
   * The seven-state read renders. `not_connected` (no row at all),
   * `connected_never_polled` (null watermark), and `connected_no_events_yet` (polled,
   * found nothing) are three different answers and are never collapsed into one.
   */
  getState(projectId: string): Promise<ConnectionState>;
  /**
   * Deactivates the project's attachment. Requires organization membership only.
   * Matching the shipped member-vs-non-member floor. A role gate is a named future
   * decision, deliberately not designed in here, and the shape above admits one without
   * a redesign.
   *
   * Every session and event already collected is kept.
   */
  disconnect(projectId: string): Promise<ConnectionState>;
}

/** Postgres' `unique_violation`. The partial index on `(project_id) WHERE is_active` is
 * the only unique constraint an `insertActive` can trip (the primary key is a freshly
 * generated uuid) so this class of write refusal is exactly the second-source case. */
const UNIQUE_VIOLATION = "23505";

/** The index name, so the branch is on an identifier rather than on parsed prose. Kept
 * as a fallback for drivers that surface the name only inside the message. */
const ACTIVE_PROJECT_INDEX = "project_connections_active_project_uidx";

/** One page. The inline first pull exists to make the counter non-zero, not to backfill
 * history. The scheduler owns the walk from here. */
const FIRST_PULL_MAX_PAGES = 1;

/**
 * Mirrors `project_connections.poll_interval_seconds`'s schema default. The insert does
 * not set that column, so the row takes the default, and the first `nextPollAt` must be
 * one interval out, not immediate, so the cron cannot claim the row while the inline
 * first pull is still running.
 */
const DEFAULT_POLL_INTERVAL_SECONDS = 60;

function refuse(code: ConnectRefusalCode, message?: string): ConnectResult {
  return { ok: false, refusal: { code, message: message ?? CONNECT_REFUSAL_MESSAGES[code] } };
}

/**
 * The source's own `message` is deliberately dropped here, not scrubbed. the bar is
 * that no key material reaches a customer surface in any encoding, and a leaky upstream
 * can echo a key back URL-encoded, JSON-escaped or truncated. Three forms an
 * exact-string scrub misses. Only the code crosses this boundary; the sentence comes
 * from the one home every customer-facing string in this sprint lives in. A vendor
 * stack trace cannot reach a customer through a channel that never carries vendor text.
 */
function refusalFor(failure: SourceFailure): ConnectResult {
  return refuse(failure.code);
}

function isSecondSourceViolation(error: ConnectionWriteError): boolean {
  return (
    error.constraint === ACTIVE_PROJECT_INDEX ||
    error.code === UNIQUE_VIOLATION ||
    error.message.includes(ACTIVE_PROJECT_INDEX)
  );
}

/** Same host, same vendor project, same kind ⇒ the same attachment being re-keyed,
 * which is an update rather than the second source refuses. */
function isSameSource(existing: ConnectionSummary, input: ConnectInput): boolean {
  return (
    existing.sourceKind === input.sourceKind &&
    existing.host === input.host &&
    existing.sourceProjectId === input.sourceProjectId
  );
}

export function createConnectionsService(
  db: ScopedDb,
  ctx: TenantContext,
  deps: ConnectionsServiceDeps,
): ConnectionsService {
  const connections = createProjectConnectionsRepo(db, ctx);
  const projects = createProjectsRepo(db, ctx);
  const organizations = createOrganizationsRepo(db, ctx);
  const pollRuns = createPollRunsRepo(db, ctx);
  const events = createEventsRepo(db, ctx);

  /**
   * The two persisted facts `deriveConnectionState` needs. Both are reads of stored
   * rows, never of anything this request happened to observe, so a customer landing
   * after the fact sees what happened rather than a state frozen at whatever the last
   * live signal said.
   */
  async function stateOf(connection: ConnectionSummary | null): Promise<ConnectionState> {
    if (!connection) {
      return deriveConnectionState(null, { hasCompletedPoll: false, hasEvents: false });
    }

    const [latestRun, firstEvent] = await Promise.all([
      pollRuns.latestCompletedFor(connection.id),
      events.listForProject(connection.projectId, { limit: 1 }),
    ]);

    return deriveConnectionState(connection, {
      hasCompletedPoll: latestRun !== null,
      hasEvents: firstEvent.length > 0,
    });
  }

  /**
   * The inline first pull and everything that records it. Isolated from the attach
   * itself: the attachment is valid the moment validation succeeded, so a pull that
   * fails afterwards downgrades health and finishes its run row honestly. It never
   * turns a successful attach into a refusal and never leaves a run stuck `running`.
   */
  async function performFirstPull(
    connection: ConnectionSummary,
    source: AttachableSource,
  ): Promise<{ connection: ConnectionSummary; eventsSeen: number }> {
    // Actually enforced. The docstring above always claimed this was isolated from the
    // attach, but nothing caught: a throw anywhere below (the pull, the persist, either
    // finish) propagated out of `connect` after the row and ciphertext were written.
    // Surfacing a successful attach as an error and leaving the run row `running`
    // forever, which is exactly what the poll-runs schema says must never happen.
    try {
      return await runFirstPull(connection, source);
    } catch (error) {
      // No credential is in scope here, `error` is a persistence/transport fault and
      // the adapter never puts key material on a thrown value.
      console.error(
        `connections.connect: first pull failed after the attachment was stored (connection ${connection.id})`,
        error,
      );
      // The attachment is real and valid. Validation already passed before the row was
      // written. The scheduler will poll it on the next tick.
      return { connection, eventsSeen: 0 };
    }
  }

  async function runFirstPull(
    connection: ConnectionSummary,
    source: AttachableSource,
  ): Promise<{ connection: ConnectionSummary; eventsSeen: number }> {
    const startedAt = deps.now();
    const run = await pollRuns.start({
      projectId: connection.projectId,
      connectionId: connection.id,
      startedAt,
    });

    const result = await source.pull({
      // A brand-new attachment has never been polled, so there is no window to resume
      // from and nothing to overlap against.
      watermarkAt: connection.watermarkAt,
      backfillBefore: connection.backfillBefore,
      maxPages: FIRST_PULL_MAX_PAGES,
    });

    const counts = await persistPullResult(db, ctx, {
      connection: {
        id: connection.id,
        projectId: connection.projectId,
        inferredInternalDomain: connection.inferredInternalDomain,
      },
      result,
    });

    let current = connection;
    let watermarkAdvancedTo: Date | null = null;

    // All or nothing. The watermark moves only when the walk provably covered its
    // window; a page-capped walk leaves it where it was so the next pass re-reads
    // rather than silently skipping.
    if (result.ok && result.contiguous && result.newestObservedAt) {
      const advanced = await connections.advanceWatermark(connection.id, {
        watermarkAt: result.newestObservedAt,
        backfillBefore: result.resumeBefore,
      });
      if (advanced) {
        current = advanced;
        watermarkAdvancedTo = result.newestObservedAt;
      }
    } else if (result.ok && !result.contiguous) {
      // Fix. This attachment has never been polled (`watermarkAt` is null) so a
      // page-capped inline first pull used to have nowhere to record its resume cursor:
      // `advanceWatermark` writes both columns in one statement and needs an existing
      // watermark to hold steady. `setBackfillCursor` touches `backfill_before` alone,
      // so the resume point survives even with no watermark yet, and the scheduler's
      // next tick can continue the walk instead of silently restarting it from the
      // newest event forever.
      //
      // Fix: this now writes even when `result.resumeBefore` is `null`.
      // `FIRST_PULL_MAX_PAGES = 1` means a re-key whose connection already carried a
      // `backfillBefore` from an earlier partial walk can hit the adapter's "this walk
      // got zero of the one-page budget" case (an earlier walk in the same pull already
      // exhausted the old backlog using the whole budget). A `null` resume value there
      // means "nothing left to resume from that direction", not "leave the stale cursor
      // in place". The mirror of the same fix in
      // worker/src/tasks/session-source-poll.ts's `applyCursors`.
      const held = await connections.setBackfillCursor(connection.id, result.resumeBefore);
      if (held) {
        current = held;
      }
    }

    const finishedAt = deps.now();
    const telemetry = {
      eventsReceived: counts.eventsReceived,
      eventsPersisted: counts.eventsPersisted,
      eventsDroppedMalformed: counts.eventsDroppedMalformed,
      sessionsTouched: counts.sessionsTouched,
      pagesFetched: result.pagesFetched,
      identityLookupsUsed: result.identityLookupsUsed,
    };

    if (result.ok) {
      await pollRuns.finish(run.id, {
        status: "completed",
        finishedAt,
        // An empty page is never authoritative, so it is recorded distinctly rather
        // than as an absent outcome.
        outcome: counts.eventsReceived > 0 ? "with_events" : "no_new_events",
        watermarkAdvancedTo,
        ...telemetry,
      });
      return { connection: current, eventsSeen: counts.eventsReceived };
    }

    await pollRuns.finish(run.id, {
      status: "failed",
      finishedAt,
      failureCode: result.failure.code,
      // Our sentence, never the vendor's, see `refusalFor`.
      failureMessage: CONNECT_REFUSAL_MESSAGES[result.failure.code],
      ...telemetry,
    });

    // The last thing we know about this attachment is that a fetch failed, so that is
    // what the customer is told. The attach itself still succeeded. The key is stored
    // and the scheduler will retry on its own cadence.
    const failed = await connections.recordHealth(connection.id, {
      health: "failing",
      reasonCode: result.failure.code,
      reasonMessage: CONNECT_REFUSAL_MESSAGES[result.failure.code],
      checkedAt: finishedAt,
    });

    return { connection: failed ?? current, eventsSeen: counts.eventsReceived };
  }

  /** F-2: a missing creator email infers nothing. A wrong internal domain silently
   * excludes the customer's entire user base, so a guess costs more than an absent
   * value ever can. */
  async function applyInferredInternalDomain(
    connection: ConnectionSummary,
  ): Promise<ConnectionSummary> {
    const domain = inferInternalDomain(await organizations.creatorEmail());
    if (domain === null) {
      return connection;
    }

    const updated = await connections.setInferredInternalDomain(connection.id, {
      // The value and how it was arrived at, so can show the customer what we inferred
      // before it takes effect rather than after.
      domain,
      provenance: "org_creator_email",
    });

    return updated ?? connection;
  }

  return {
    async connect(rawInput: ConnectInput): Promise<ConnectResult> {
      // , before everything else, including the gate below: a shape violation on
      // the way in. Malformed JSON from a future untrusted API route, a caller bug, a
      // wrong-cased sourceKind. Throws here rather than reaching an encryption call
      // site or a database write with a value nothing has actually validated. Zod is
      // this repo's single source of truth for shapes; this is the one entry point
      // where a value from outside a typed caller can reach this service at all.
      const input = connectInputSchema.parse(rawInput);

      // , first and unconditionally. An installation that cannot store an outside
      // key safely makes NO request and writes NO row. The check that
      // `GROWTHMIND_ALLOW_INSECURE_DEFAULTS` cannot open sits here, at the encryption
      // call site, precisely so boot stays possible and storing a customer's secret
      // does not.
      if (!deps.credentialKey.ok) {
        return refuse("misconfigured");
      }
      const key: CredentialKey = deps.credentialKey.key;

      // Ownership is established before a single byte leaves the process, so a
      // foreign project id cannot even make this service call the customer's analytics
      // account on its behalf.
      const project = await projects.findById(input.projectId);
      if (!project) {
        throw new Error("connect: project not found in this organization");
      }

      const existing = await connections.getActiveForProject(input.projectId);
      // A re-key of the same attachment is an update, not the second source. This read
      // routes; it never decides the refusal. That stays with the database, so two
      // concurrent attaches cannot both win.
      const isRekey = existing !== null && isSameSource(existing, input);

      //  Validation, through the injected factory. This service never constructs a
      // vendor client of its own. That is what keeps packages/db independent of
      // packages/adapters.
      const source = deps.createSource({
        host: input.host,
        sourceProjectId: input.sourceProjectId,
        personalApiKey: input.personalApiKey,
      });
      const validation = await source.validate();

      if (!validation.ok) {
        if (isRekey && existing) {
          // A terminal state, always. Parking a customer on `validating` forever is the
          // stuck-state shape the transparency rule forbids.
          await connections.recordHealth(existing.id, {
            health: "failing",
            reasonCode: validation.failure.code,
            reasonMessage: CONNECT_REFUSAL_MESSAGES[validation.failure.code],
            checkedAt: validation.checkedAt,
          });
        }
        // A new attach that fails validation writes nothing. There is no half-written
        // row to leave the customer locked out of their own project by a typo, and
        // `not_connected` is itself terminal. The one state this path can produce is
        // never `validating`.
        return refusalFor(validation.failure);
      }

      //  Encrypt under the aad binding this ciphertext to this org's row, then let
      // the database settle whether a second source is allowed.
      const credentialCiphertext = encryptSecret(
        input.personalApiKey,
        key,
        credentialAad(ctx.organizationId, input.projectId),
      );
      const credentialKeyId = keyIdOf(key);

      let attached: ConnectionSummary;

      if (isRekey && existing) {
        const rekeyed = await connections.updateCredential(existing.id, {
          credentialCiphertext,
          credentialKeyId,
        });
        if (!rekeyed) {
          throw new Error("connect: re-key affected no row for this organization");
        }
        attached = rekeyed;
      } else {
        try {
          attached = await connections.insertActive({
            projectId: input.projectId,
            sourceKind: input.sourceKind,
            host: input.host,
            sourceProjectId: input.sourceProjectId,
            credentialCiphertext,
            credentialKeyId,
            health: "healthy",
            connectedAt: deps.now(),
            // Not due immediately. `performFirstPull` below covers the glue moment
            // inline; marking the row due at the same instant lets the every-minute
            // cron claim it while that inline pull is still in flight (measured pull
            // p90 ~25s against a 60s tick, so this is reachable on a large fraction of
            // first connects).
            //
            // The race loses customer history: the cron reads a snapshot with
            // `backfillBefore = null`, the inline pull page-caps and writes a backfill
            // cursor, then the cron's contiguous pass advances the watermark with its
            // stale `backfillBefore: null` and overwrites that cursor back to NULL. The
            // unfinished backward walk's resume point is gone and every later tick
            // restarts from newest. Permanently, silently. (edge sweep, /.)
            nextPollAt: new Date(deps.now().getTime() + DEFAULT_POLL_INTERVAL_SECONDS * 1000),
          });
        } catch (error) {
          if (error instanceof ConnectionWriteError && isSecondSourceViolation(error)) {
            // The refusal names the existing attachment, so the customer knows which
            // one to detach rather than filing a support ticket. Read after the
            // violation, never before it.
            const blocking = existing ?? (await connections.getActiveForProject(input.projectId));
            return refuse(
              "second_source",
              blocking
                ? secondSourceRefusalMessage({
                    host: blocking.host,
                    sourceProjectId: blocking.sourceProjectId,
                  })
                : undefined,
            );
          }
          throw error;
        }
      }

      const checked = await connections.recordHealth(attached.id, {
        health: "healthy",
        reasonCode: null,
        reasonMessage: null,
        checkedAt: validation.checkedAt,
      });

      //  then: the domain must be stamped before the first pull, or the first
      // pull's sessions would be classified against a domain we already knew and had
      // not yet written. A stamp whose provenance disagrees with the row that produced
      // it.
      const withDomain = await applyInferredInternalDomain(checked ?? attached);

      const pulled = await performFirstPull(withDomain, source);

      return {
        ok: true,
        connection: pulled.connection,
        firstPullEventsSeen: pulled.eventsSeen,
      };
    },

    async getState(projectId: string): Promise<ConnectionState> {
      // Answered from persisted state alone. No source is constructed here. Reading
      // what a project is doing must never depend on the customer's analytics account
      // being reachable.
      return stateOf(await findLatestConnection(db, ctx, projectId));
    },

    async disconnect(projectId: string): Promise<ConnectionState> {
      const active = await connections.getActiveForProject(projectId);
      if (!active) {
        return stateOf(await findLatestConnection(db, ctx, projectId));
      }

      // Everything already collected is kept, `deactivate` clears the flag and sets
      // health, and touches no session or event row.
      const detached = await connections.deactivate(active.id);
      return stateOf(detached ?? active);
    },
  };
}
