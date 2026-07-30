// The connection lifecycle: attach, read state, detach (O-003 D-1, D-7,
// FR-8/FR-9/FR-11).
//
// WHY THE SOURCE FACTORY IS INJECTED. packages/db must never depend on
// packages/adapters — that would invert the layering and drag a vendor
// implementation into the data layer. So the service takes a `CreateSourceFn`
// as a dependency, typed structurally against the shapes both packages
// already share via @growthmind/shared. `SessionSource` from
// packages/adapters satisfies `AttachableSource` structurally, with no import
// and no cast. The same injection is what makes every test here run against a
// fake source with no network at all (FR-2).
import type {
  ConnectResult,
  ConnectRefusalCode,
  ConnectionState,
  ConnectionSummary,
  CredentialKey,
  CredentialKeyResolution,
  SessionSourceKind,
  SessionSourcePullRequest,
  SessionSourcePullResult,
  SessionSourceValidation,
  SourceFailure,
  TenantContext,
} from "@growthmind/shared";
import {
  CONNECT_REFUSAL_MESSAGES,
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
 * The structural shape this service needs from a source. Deliberately narrower
 * than `SessionSource` — it does not name `kind` — so nothing here can branch
 * on a vendor name. The vendor name does not exist below the composition root.
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
   * The resolved credential key, or the named refusal. A
   * `{ ok: false, reason: "insecure_default_key" }` here becomes a
   * `misconfigured` connect refusal whose message names the one step to fix
   * it — the D-1 gate the insecure-defaults bypass cannot open. Boot still
   * succeeds; storing a customer's secret does not.
   */
  credentialKey: CredentialKeyResolution;
  now: () => Date;
}

export interface ConnectInput {
  projectId: string;
  sourceKind: SessionSourceKind;
  host: string;
  sourceProjectId: string;
  personalApiKey: string;
}

export interface ConnectionsService {
  /**
   * The attach flow, in this order:
   *   1. Resolve the credential key; a refusal short-circuits to
   *      `misconfigured` with NO row written and NO request made.
   *   2. `validate()` through the INJECTED source factory. A failure records
   *      a terminal health state and never leaves an active row behind (D8) —
   *      wrong-credentials, wrong-project, and unreachable stay distinct.
   *   3. Encrypt the key under the `(organizationId, projectId)` additional
   *      authenticated data and insert. A second source is refused by the
   *      partial unique index, never by a prior read (D6), and the refusal
   *      names the existing attachment and the cutover path.
   *   4. Infer the internal domain from the org creator's email and record
   *      its provenance. No resolvable creator email ⇒ infer nothing (F-2).
   *   5. ONE bounded inline first pull, so the counter is non-zero the moment
   *      onboarding step 2 completes — this serves the glue moment better
   *      than any faster background tick would.
   */
  connect(input: ConnectInput): Promise<ConnectResult>;
  /**
   * The seven-state read O-008 renders. `not_connected` (no row at all),
   * `connected_never_polled` (null watermark), and
   * `connected_no_events_yet` (polled, found nothing) are three DIFFERENT
   * answers and are never collapsed into one.
   */
  getState(projectId: string): Promise<ConnectionState>;
  /**
   * Deactivates the project's attachment. Requires organization membership
   * only — matching the shipped member-vs-non-member floor. A role gate is a
   * named future decision, deliberately not designed in here, and the shape
   * above admits one without a redesign.
   *
   * Every session and event already collected is KEPT.
   */
  disconnect(projectId: string): Promise<ConnectionState>;
}

/** Postgres' `unique_violation`. The partial index on
 * `(project_id) WHERE is_active` is the ONLY unique constraint an
 * `insertActive` can trip — the primary key is a freshly generated uuid — so
 * this class of write refusal is exactly the second-source case. */
const UNIQUE_VIOLATION = "23505";

/** The index name, so the branch is on an identifier rather than on parsed
 * prose (D9). Kept as a fallback for drivers that surface the name only
 * inside the message. */
const ACTIVE_PROJECT_INDEX = "project_connections_active_project_uidx";

/** One page. The inline first pull exists to make the counter non-zero, not
 * to backfill history — the scheduler owns the walk from here (D-7). */
const FIRST_PULL_MAX_PAGES = 1;

function refuse(code: ConnectRefusalCode, message?: string): ConnectResult {
  return { ok: false, refusal: { code, message: message ?? CONNECT_REFUSAL_MESSAGES[code] } };
}

/**
 * The source's own `message` is DELIBERATELY DROPPED here, not scrubbed.
 * FR-7's bar is that no key material reaches a customer surface in ANY
 * encoding, and a leaky upstream can echo a key back URL-encoded,
 * JSON-escaped or truncated — three forms an exact-string scrub misses. Only
 * the CODE crosses this boundary; the sentence comes from the one home every
 * customer-facing string in this sprint lives in. A vendor stack trace cannot
 * reach a customer through a channel that never carries vendor text.
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

/** Same host, same vendor project, same kind ⇒ the SAME attachment being
 * re-keyed, which is an update rather than the second source FR-8 refuses. */
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
   * The two persisted facts `deriveConnectionState` needs. Both are reads of
   * stored rows — never of anything this request happened to observe — so a
   * customer landing after the fact sees what happened rather than a state
   * frozen at whatever the last live signal said (D4).
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
   * The inline first pull and everything that records it. Isolated from the
   * attach itself (D8): the attachment is valid the moment validation
   * succeeded, so a pull that fails afterwards downgrades health and finishes
   * its run row honestly — it never turns a successful attach into a refusal
   * and never leaves a run stuck `running`.
   */
  async function performFirstPull(
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
      // A brand-new attachment has never been polled, so there is no window to
      // resume from and nothing to overlap against.
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

    // ALL OR NOTHING (D-6d). The watermark moves only when the walk provably
    // covered its window; a page-capped walk leaves it where it was so the
    // next pass re-reads rather than silently skipping.
    if (result.ok && result.contiguous && result.newestObservedAt) {
      const advanced = await connections.advanceWatermark(connection.id, {
        watermarkAt: result.newestObservedAt,
        backfillBefore: result.resumeBefore,
      });
      if (advanced) {
        current = advanced;
        watermarkAdvancedTo = result.newestObservedAt;
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
        // An empty page is never authoritative, so it is recorded DISTINCTLY
        // rather than as an absent outcome (D-6g).
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
      // Our sentence, never the vendor's — see `refusalFor`.
      failureMessage: CONNECT_REFUSAL_MESSAGES[result.failure.code],
      ...telemetry,
    });

    // The last thing we know about this attachment is that a fetch failed, so
    // that is what the customer is told. The attach itself still succeeded —
    // the key is stored and the scheduler will retry on its own cadence.
    const failed = await connections.recordHealth(connection.id, {
      health: "failing",
      reasonCode: result.failure.code,
      reasonMessage: CONNECT_REFUSAL_MESSAGES[result.failure.code],
      checkedAt: finishedAt,
    });

    return { connection: failed ?? current, eventsSeen: counts.eventsReceived };
  }

  /** F-2: a missing creator email infers NOTHING. A wrong internal domain
   * silently excludes the customer's entire user base, so a guess costs more
   * than an absent value ever can. */
  async function applyInferredInternalDomain(
    connection: ConnectionSummary,
  ): Promise<ConnectionSummary> {
    const domain = inferInternalDomain(await organizations.creatorEmail());
    if (domain === null) {
      return connection;
    }

    const updated = await connections.setInferredInternalDomain(connection.id, {
      // The value AND how it was arrived at, so O-008 can show the customer
      // what we inferred before it takes effect rather than after.
      domain,
      provenance: "org_creator_email",
    });

    return updated ?? connection;
  }

  return {
    async connect(input: ConnectInput): Promise<ConnectResult> {
      // (1) D-1, FIRST and unconditionally. An installation that cannot store
      // an outside key safely makes NO request and writes NO row — the check
      // that `GROWTHMIND_ALLOW_INSECURE_DEFAULTS` cannot open sits here, at
      // the encryption call site, precisely so boot stays possible and
      // storing a customer's secret does not.
      if (!deps.credentialKey.ok) {
        return refuse("misconfigured");
      }
      const key: CredentialKey = deps.credentialKey.key;

      // D7. Ownership is established before a single byte leaves the process,
      // so a foreign project id cannot even make this service call the
      // customer's analytics account on its behalf.
      const project = await projects.findById(input.projectId);
      if (!project) {
        throw new Error("connect: project not found in this organization");
      }

      const existing = await connections.getActiveForProject(input.projectId);
      // A re-key of the SAME attachment is an update, not FR-8's second
      // source. This read ROUTES; it never decides the refusal — that stays
      // with the database (D6), so two concurrent attaches cannot both win.
      const isRekey = existing !== null && isSameSource(existing, input);

      // (2) Validation, through the injected factory. This service never
      // constructs a vendor client of its own — that is what keeps
      // packages/db independent of packages/adapters.
      const source = deps.createSource({
        host: input.host,
        sourceProjectId: input.sourceProjectId,
        personalApiKey: input.personalApiKey,
      });
      const validation = await source.validate();

      if (!validation.ok) {
        if (isRekey && existing) {
          // A TERMINAL state, always. Parking a customer on `validating`
          // forever is the stuck-state shape the transparency rule forbids.
          await connections.recordHealth(existing.id, {
            health: "failing",
            reasonCode: validation.failure.code,
            reasonMessage: CONNECT_REFUSAL_MESSAGES[validation.failure.code],
            checkedAt: validation.checkedAt,
          });
        }
        // A NEW attach that fails validation writes NOTHING. There is no
        // half-written row to leave the customer locked out of their own
        // project by a typo, and `not_connected` is itself terminal — the one
        // state this path can produce is never `validating`.
        return refusalFor(validation.failure);
      }

      // (3) Encrypt under the AAD binding this ciphertext to this org's row,
      // then let the DATABASE settle whether a second source is allowed.
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
            // Due immediately: the scheduler's onboarding window is what makes
            // the first minutes feel alive, and the inline pull below is what
            // makes the counter non-zero before then.
            nextPollAt: deps.now(),
          });
        } catch (error) {
          if (error instanceof ConnectionWriteError && isSecondSourceViolation(error)) {
            // The refusal NAMES THE EXISTING ATTACHMENT, so the customer knows
            // which one to detach rather than filing a support ticket. Read
            // after the violation, never before it.
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

      // (4) then (5): the domain must be stamped BEFORE the first pull, or the
      // first pull's sessions would be classified against a domain we already
      // knew and had not yet written — a stamp whose provenance disagrees with
      // the row that produced it.
      const withDomain = await applyInferredInternalDomain(checked ?? attached);

      const pulled = await performFirstPull(withDomain, source);

      return {
        ok: true,
        connection: pulled.connection,
        firstPullEventsSeen: pulled.eventsSeen,
      };
    },

    async getState(projectId: string): Promise<ConnectionState> {
      // Answered from PERSISTED state alone. No source is constructed here —
      // reading what a project is doing must never depend on the customer's
      // analytics account being reachable.
      return stateOf(await findLatestConnection(db, ctx, projectId));
    },

    async disconnect(projectId: string): Promise<ConnectionState> {
      const active = await connections.getActiveForProject(projectId);
      if (!active) {
        return stateOf(await findLatestConnection(db, ctx, projectId));
      }

      // Everything already collected is KEPT — `deactivate` clears the flag
      // and sets health, and touches no session or event row.
      const detached = await connections.deactivate(active.id);
      return stateOf(detached ?? active);
    },
  };
}
