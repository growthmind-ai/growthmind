/**
 * THE COMPOSITION ROOT (O-003 D-7, D-10, D-11, FR-21).
 *
 * A plain exported async function with no queue types in its signature, so it
 * is unit-testable without a queue — and so the end-to-end wire proof can
 * drive the REAL consumer entry point rather than a producer and a consumer
 * in isolation. Registration lives in ../index.ts, the only queue-aware file.
 *
 * This is the ONE place the vendor's name appears below the port:
 * `createPostHogSessionSource` is imported BY NAME and selected by an
 * exhaustive switch over `connection.sourceKind`, a one-member Zod union the
 * compiler checks. No registry, no factory table, no dynamic lookup — so the
 * day a second adapter lands, the missing branch is a compile error.
 *
 * The sequence, per claimed connection:
 *   claim → readConnectionCredential → decryptSecret →
 *   createPostHogSessionSource → pull → persistPullResult →
 *   advanceWatermark (only when the walk was contiguous) → finish the run.
 *
 * Two invariants this handler must never break:
 *
 *  - PER-CONNECTION try/catch. One bad connection cannot fail the batch (D8);
 *    a sibling connection still polls and persists.
 *  - EVERY exit path finishes its run row `completed` or `failed` with a
 *    plain-English reason. A missed terminal state leaves a stuck "polling"
 *    a customer sees forever.
 *
 * Tenant scope comes from the claimed connection ROW, never from a payload —
 * there is no payload, because the task is cron-triggered.
 */
import type { FetchLike, SessionSource } from "@growthmind/adapters";
import { createPostHogSessionSource, POSTHOG_SOURCE_KIND } from "@growthmind/adapters";
import type { PollRunCounts, ScopedDb } from "@growthmind/db";
import { createPollRunsRepo, createProjectConnectionsRepo, persistPullResult } from "@growthmind/db";
import type { PollableConnection } from "@growthmind/db/system";
import {
  claimDuePollableConnections,
  readConnectionCredential,
  systemTenantContextFor,
} from "@growthmind/db/system";
import type {
  ServerEnv,
  SessionSourcePullResult,
  SourceFailureCode,
  TenantContext,
} from "@growthmind/shared";
import {
  CONNECT_REFUSAL_MESSAGES,
  credentialAad,
  decryptSecret,
  resolveCredentialKey,
} from "@growthmind/shared";

import { MAX_CONNECTIONS_PER_RUN, MAX_RUN_DURATION_MS, resolvePollPlan } from "./poll-plan";

/** The logger surface this handler needs — the subset Graphile Worker's
 * `helpers.logger` already satisfies, so the thin closure in ../index.ts
 * passes it straight through and a test passes a recording fake. */
export interface PollLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface SessionSourcePollDeps {
  db: ScopedDb;
  /** Read once at process start. The adapter reads NO env var — customer
   * credentials come exclusively from the connection row. This is here only
   * so `resolveCredentialKey` can run against the real environment. */
  env: ServerEnv;
  now: () => Date;
  /** The only way this handler advances time. A fake clock in a test is
   * therefore total: nothing sleeps by any other route. */
  sleep: (ms: number) => Promise<void>;
  fetch: FetchLike;
  random: () => number;
  logger: PollLogger;
}

export interface SessionSourcePollSummary {
  connectionsClaimed: number;
  /** Connections whose passes all finished `completed`. */
  connectionsPolled: number;
  /** Connections that finished at least one run `failed`. Isolated — a
   * non-zero value here does not mean the batch failed. */
  connectionsFailed: number;
  /** Poll-run rows written. One per pass, never one per connection. */
  runsRecorded: number;
  /** `true` when `MAX_RUN_DURATION_MS` cut the run short and the remainder
   * was left for the next tick. Not a failure. */
  stoppedOnDuration: boolean;
}

/**
 * Pages this scheduler asks the source for, per pass. The adapter takes the
 * TIGHTER of this and its own `MAX_PAGES_PER_RUN` ceiling, so a number here
 * can only ever ask for LESS work than the adapter permits, never more — the
 * ceiling stays the adapter's to own.
 */
const MAX_PAGES_PER_PASS = 25;

/** What a run that never reached the source reports. Zeroes rather than
 * absent numbers, so a failed run is still a complete row. */
const NO_COUNTS: PollRunCounts = {
  eventsReceived: 0,
  eventsPersisted: 0,
  eventsDroppedMalformed: 0,
  sessionsTouched: 0,
  pagesFetched: 0,
  identityLookupsUsed: 0,
};

type PollRunsRepo = ReturnType<typeof createPollRunsRepo>;
type ConnectionsRepo = ReturnType<typeof createProjectConnectionsRepo>;

/** What one connection's turn produced. Never thrown out of `pollConnection`
 * — an isolated failure is a value, not an exception (D8). */
interface ConnectionOutcome {
  runsRecorded: number;
  failed: boolean;
  stoppedOnDuration: boolean;
}

/** What one pass produced, and the two cursors the next pass inherits. */
interface PassOutcome {
  ok: boolean;
  /** The pass actually saw events at the boundary. The onboarding
   * acceleration exists to catch the FIRST ones, so this ends the multi-pass
   * loop — a connection already producing does not need three more passes
   * inside the same tick. */
  sawEvents: boolean;
  watermarkAt: Date | null;
  backfillBefore: string | null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A tick with no due connections — including a deployment with none attached
 * at all — is a CLEAN NO-OP: no crash, no error state, and distinguishable
 * from "polled and found nothing", which is a recorded poll-run outcome.
 * That is the self-host graceful-absence promise in one behaviour.
 */
export async function runSessionSourcePoll(
  deps: SessionSourcePollDeps,
): Promise<SessionSourcePollSummary> {
  const startedAtMs = deps.now().getTime();

  // THE CLAIM IS THE LOCK. It mutates as it selects, so the rows below are
  // held for this tick alone and are never re-claimed. Two overlapping ticks
  // partition the work rather than duplicating it (D6).
  const claimed = await claimDuePollableConnections(deps.db, {
    now: deps.now(),
    limit: MAX_CONNECTIONS_PER_RUN,
  });

  const summary: SessionSourcePollSummary = {
    connectionsClaimed: claimed.length,
    connectionsPolled: 0,
    connectionsFailed: 0,
    runsRecorded: 0,
    stoppedOnDuration: false,
  };

  if (claimed.length === 0) {
    // Nothing attached, or nothing due. Both are ordinary — a self-hoster
    // with no analytics account is a supported deployment, not a fault — so
    // NOTHING is recorded and nothing is logged as an error. Recording a run
    // here would make "we have no connection" indistinguishable from "we
    // polled and found nothing", which is the one distinction FR-23 asks for.
    return summary;
  }

  /** Checked BETWEEN connections and BETWEEN passes, never mid-walk:
   * abandoning a walk halfway would waste the pages already fetched. */
  const overBudget = (): boolean => deps.now().getTime() - startedAtMs >= MAX_RUN_DURATION_MS;

  /** Would the budget be spent `ms` from now? Threaded into the adapter so a
   * 429 backoff cannot sleep past this run's claim (D4/D6). */
  const overBudgetAfter = (ms: number): boolean =>
    deps.now().getTime() + ms - startedAtMs >= MAX_RUN_DURATION_MS;

  for (const connection of claimed) {
    if (overBudget()) {
      // Not a failure. The claim already moved these rows' cursors, so the
      // remainder is simply overdue and the next tick takes it.
      summary.stoppedOnDuration = true;
      break;
    }

    let outcome: ConnectionOutcome;
    try {
      outcome = await pollConnection(deps, connection, overBudget, overBudgetAfter);
    } catch (error) {
      // BELT AND BRACES. Every path inside `pollConnection` already finishes
      // its own run row; this exists so a fault in the paths AROUND a run (a
      // repository constructor, the context build) still cannot take the
      // batch down with it.
      deps.logger.error(
        `session source poll: connection ${connection.id} could not be processed — ${describeError(error)}`,
      );
      summary.connectionsFailed += 1;
      continue;
    }

    summary.runsRecorded += outcome.runsRecorded;
    if (outcome.stoppedOnDuration) {
      summary.stoppedOnDuration = true;
    }
    if (outcome.failed) {
      summary.connectionsFailed += 1;
    } else {
      summary.connectionsPolled += 1;
    }
  }

  deps.logger.info(
    `session source poll: claimed ${summary.connectionsClaimed}, polled ${summary.connectionsPolled}, failed ${summary.connectionsFailed}, runs ${summary.runsRecorded}`,
  );

  return summary;
}

/**
 * One claimed connection's turn: read its credential once, build its source
 * once, then make the planned passes.
 *
 * The tenant context is built from the CLAIMED ROW (D-10). There is no
 * payload and no caller-supplied id anywhere in this file, so there is
 * nothing else a scope could be derived from even in principle.
 */
async function pollConnection(
  deps: SessionSourcePollDeps,
  connection: PollableConnection,
  overBudget: () => boolean,
  overBudgetAfter: (ms: number) => boolean,
): Promise<ConnectionOutcome> {
  const ctx = systemTenantContextFor(connection);
  const pollRuns = createPollRunsRepo(deps.db, ctx);
  const connections = createProjectConnectionsRepo(deps.db, ctx);

  const outcome: ConnectionOutcome = {
    runsRecorded: 0,
    failed: false,
    stoppedOnDuration: false,
  };

  // ONE decrypt per connection, not one per pass: the plaintext key's lifetime
  // is the shortest thing that still works.
  const credential = await openCredential(deps, connection);
  if (!credential.ok) {
    // FAIL CLOSED (F-11), and VISIBLY. No request is made and no fallback key
    // is tried — but a run row is still written and finished, because a
    // connection that silently stops polling is the stuck state the
    // transparency rule exists to forbid.
    deps.logger.error(
      `session source poll: connection ${connection.id} has a stored key this installation cannot read`,
    );
    await recordUnattemptedFailure(deps, {
      pollRuns,
      connections,
      connection,
      code: credential.code,
      // `exactOptionalPropertyTypes` distinguishes "absent" from "present
      // and undefined" — spread only when there IS an override, so an
      // absent override does not become an explicit `message: undefined`.
      ...(credential.message !== undefined ? { message: credential.message } : {}),
    });
    outcome.runsRecorded += 1;
    outcome.failed = true;
    return outcome;
  }

  const source = createSourceFor(connection, credential.personalApiKey, deps, (ms) =>
    // Would this backoff outlast the run's own budget? If so the adapter gives
    // up as `rate_limited` rather than sleeping past its claim.
    overBudgetAfter(ms),
  );
  const plan = resolvePollPlan({
    connectedAt: connection.connectedAt,
    now: deps.now(),
    pollIntervalSeconds: connection.pollIntervalSeconds,
  });

  // The two cursors travel from pass to pass in memory, so a second pass
  // resumes where the first left off rather than re-reading the row.
  let watermarkAt = connection.watermarkAt;
  let backfillBefore = connection.backfillBefore;

  for (let pass = 0; pass < plan.passes; pass += 1) {
    if (pass > 0) {
      if (overBudget()) {
        outcome.stoppedOnDuration = true;
        break;
      }
      await deps.sleep(plan.sleepMsBetween);
    }

    const passOutcome = await runOnePass({
      deps,
      ctx,
      connection,
      source,
      pollRuns,
      connections,
      watermarkAt,
      backfillBefore,
    });
    outcome.runsRecorded += 1;

    if (!passOutcome.ok) {
      // One failed pass ends this connection's turn. Retrying inside the same
      // tick would spend the customer's rate-limit budget on a fault the next
      // tick can retry a minute later for free.
      outcome.failed = true;
      break;
    }

    watermarkAt = passOutcome.watermarkAt;
    backfillBefore = passOutcome.backfillBefore;

    if (passOutcome.sawEvents) {
      break;
    }
  }

  return outcome;
}

/**
 * ONE PASS = ONE POLL-RUN ROW. The row is opened first and finished on every
 * path out of this function — success, source failure, and unexpected throw.
 * There is no branch that returns without a terminal state.
 */
async function runOnePass(input: {
  deps: SessionSourcePollDeps;
  ctx: TenantContext;
  connection: PollableConnection;
  source: SessionSource;
  pollRuns: PollRunsRepo;
  connections: ConnectionsRepo;
  watermarkAt: Date | null;
  backfillBefore: string | null;
}): Promise<PassOutcome> {
  const { deps, ctx, connection, source, pollRuns, connections } = input;

  const run = await pollRuns.start({
    projectId: connection.projectId,
    connectionId: connection.id,
    startedAt: deps.now(),
  });

  /** Both cursors exactly as they were. Every failure path returns these —
   * the advance is all-or-nothing per invocation (D-6d). */
  const unchanged = {
    watermarkAt: input.watermarkAt,
    backfillBefore: input.backfillBefore,
  };

  let result: SessionSourcePullResult;
  try {
    result = await source.pull({
      watermarkAt: input.watermarkAt,
      backfillBefore: input.backfillBefore,
      maxPages: MAX_PAGES_PER_PASS,
    });
  } catch (error) {
    // The port is contracted to RETURN its failures rather than throw them.
    // If one escapes anyway the run still reaches a terminal state — a
    // contract violation must not become a stuck "polling…".
    deps.logger.error(
      `session source poll: connection ${connection.id} threw while fetching — ${describeError(error)}`,
    );
    await finishFailed(deps, {
      pollRuns,
      connections,
      connection,
      runId: run.id,
      code: "unreachable",
      counts: NO_COUNTS,
    });
    return { ok: false, sawEvents: false, ...unchanged };
  }

  try {
    // PERSIST FIRST, ON BOTH OUTCOMES. The walk is newest-first, so a failed
    // pull's partials are the NEWEST events; throwing them away would make
    // FR-22's "partial progress survives" a hope rather than a guarantee.
    const counts = await persistPullResult(deps.db, ctx, {
      connection: {
        id: connection.id,
        projectId: connection.projectId,
        inferredInternalDomain: connection.inferredInternalDomain,
      },
      result,
    });

    const telemetry: PollRunCounts = {
      eventsReceived: counts.eventsReceived,
      eventsPersisted: counts.eventsPersisted,
      eventsDroppedMalformed: counts.eventsDroppedMalformed,
      sessionsTouched: counts.sessionsTouched,
      pagesFetched: result.pagesFetched,
      identityLookupsUsed: result.identityLookupsUsed,
    };

    if (!result.ok) {
      // THE ADVANCE IS SKIPPED ENTIRELY. Already-persisted rows stay
      // persisted, the cursor stays exactly where it was, and the next run's
      // overlap re-query re-sees those rows — absorbed by the FR-6 unique
      // index (D-6d, FR-22).
      await finishFailed(deps, {
        pollRuns,
        connections,
        connection,
        runId: run.id,
        code: result.failure.code,
        counts: telemetry,
      });
      return { ok: false, sawEvents: false, ...unchanged };
    }

    const cursors = await applyCursors(connections, connection.id, result, input.watermarkAt);
    const finishedAt = deps.now();

    await pollRuns.finish(run.id, {
      status: "completed",
      finishedAt,
      // An empty page is NEVER authoritative (D-6g): a permanently-zero
      // connection has to be visible rather than indistinguishable from a
      // healthy quiet one, so the two are recorded distinctly.
      outcome: counts.eventsReceived > 0 ? "with_events" : "no_new_events",
      watermarkAdvancedTo: cursors.advancedTo,
      ...telemetry,
    });

    // The last thing we know about this attachment is that a fetch WORKED, so
    // that is what the customer is told — from a persisted fact, never from a
    // transient signal (D4).
    //
    // D8: isolated from the run above deliberately. Inside the outer try, a
    // throw here reached the catch and rewrote an ALREADY-COMPLETED run as a
    // zeroed failure — events persisted, watermark advanced, audit row saying
    // otherwise. A stale health badge is the strictly better failure.
    try {
      await connections.recordHealth(connection.id, {
        health: "healthy",
        reasonCode: null,
        reasonMessage: null,
        checkedAt: finishedAt,
      });
    } catch (error) {
      deps.logger.error(
        `session source poll: connection ${connection.id} polled successfully but its health badge could not be updated — ${describeError(error)}`,
      );
    }

    return {
      ok: true,
      sawEvents: counts.eventsReceived > 0,
      watermarkAt: cursors.watermarkAt,
      backfillBefore: cursors.backfillBefore,
    };
  } catch (error) {
    // Persistence or a cursor write failed. The run row is already open, so it
    // is closed here rather than left `running` forever.
    deps.logger.error(
      `session source poll: connection ${connection.id} could not store what it fetched — ${describeError(error)}`,
    );
    await finishFailed(deps, {
      pollRuns,
      connections,
      connection,
      runId: run.id,
      code: "unreachable",
      counts: NO_COUNTS,
    });
    return { ok: false, sawEvents: false, ...unchanged };
  }
}

/**
 * THE ALL-OR-NOTHING ADVANCE (D-6d), applied only AFTER persistence
 * succeeded.
 *
 * - Contiguous walk ⇒ the watermark moves to page 1, item 0. `greatest(…)` in
 *   the repository keeps it monotonic, so a late run can never drag it back.
 * - Page-capped walk ⇒ the watermark does NOT move; only the resume cursor is
 *   recorded, via `setBackfillCursor`, which touches `backfill_before` alone
 *   (CR-1 fix). That is what lets a NEVER-POLLED connection
 *   (`watermark_at IS NULL`) record a resume cursor too: there is no
 *   watermark to hold steady, because nothing here writes that column at
 *   all. Without this, a backlog deeper than one run's page cap could never
 *   drain — every tick would re-walk from the newest event forever, and the
 *   first-connect backlog would stall permanently and silently.
 */
async function applyCursors(
  connections: ConnectionsRepo,
  connectionId: string,
  result: Extract<SessionSourcePullResult, { ok: true }>,
  currentWatermarkAt: Date | null,
): Promise<{ watermarkAt: Date | null; backfillBefore: string | null; advancedTo: Date | null }> {
  if (result.contiguous && result.newestObservedAt !== null) {
    const advanced = await connections.advanceWatermark(connectionId, {
      watermarkAt: result.newestObservedAt,
      backfillBefore: result.resumeBefore,
    });
    if (advanced) {
      return {
        watermarkAt: advanced.watermarkAt,
        backfillBefore: advanced.backfillBefore,
        // What THIS run provably covered. The stored value may already be
        // further along; the monotonic `greatest` keeps it there.
        advancedTo: result.newestObservedAt,
      };
    }
  }

  if (!result.contiguous) {
    // CR-3 FIX: persist whatever the walk computed EVEN WHEN `resumeBefore`
    // is `null`. A `null` here is not "nothing to record" — per the
    // adapter's CR-11 contract, it is "this specific walk never got a page
    // to fetch", which happens when an EARLIER walk in the same pull (the
    // backward resume) already exhausted the old backlog using the whole
    // shared page budget, leaving none for the forward pass. Before this
    // fix, that exact combination (`contiguous: false`, `resumeBefore:
    // null`) fell through to the fallback below WITHOUT writing anything —
    // so the connection stayed pinned on the stale `backfill_before` from
    // the previous run, reproduced the identical page sequence forever, and
    // never advanced: a livelock, not merely a slow catch-up. Writing
    // `null` here clears that stale cursor, so the NEXT tick's resume pass
    // starts fresh with the full page budget instead of repeating this
    // exact call forever — `setBackfillCursor` touches `backfill_before`
    // alone, so this is safe whether or not a watermark exists yet
    // (including the never-polled case).
    const held = await connections.setBackfillCursor(connectionId, result.resumeBefore);
    if (held) {
      return {
        watermarkAt: held.watermarkAt,
        backfillBefore: held.backfillBefore,
        advancedTo: null,
      };
    }
  }

  return { watermarkAt: currentWatermarkAt, backfillBefore: null, advancedTo: null };
}

/** Finishes a run `failed` and records the connection's health from the same
 * fact. The sentence is OURS, keyed by code — the vendor's own `detail` text
 * cannot reach a customer through a channel that never carries vendor text.
 *
 * CR-14: `message` is an OPTIONAL override of the code-keyed default. It
 * exists for exactly one caller today — `openCredential`'s decrypt-failure
 * branch, where the code-keyed `misconfigured` sentence ("Set
 * GROWTHMIND_ENCRYPTION_KEY…, restart") is the CONNECT-TIME, install-has-no-
 * key story. Reusing it for an ALREADY-CONNECTED row whose stored secret
 * this installation can no longer decrypt (a rotated key, an AAD mismatch)
 * tells the customer to restart a server that is running fine, and leaks an
 * env var name and a shell command into customer-facing copy. `messages.ts`
 * is out of scope for this fix (every customer-facing string is supposed to
 * live there — D-13), so the corrected sentence is local to its one call
 * site here rather than duplicated into the shared table; migrating it
 * there is a follow-up. */
async function finishFailed(
  deps: SessionSourcePollDeps,
  input: {
    pollRuns: PollRunsRepo;
    connections: ConnectionsRepo;
    connection: PollableConnection;
    runId: string;
    code: SourceFailureCode;
    counts: PollRunCounts;
    message?: string;
  },
): Promise<void> {
  const finishedAt = deps.now();
  const message = input.message ?? CONNECT_REFUSAL_MESSAGES[input.code];

  try {
    await input.pollRuns.finish(input.runId, {
      status: "failed",
      finishedAt,
      failureCode: input.code,
      failureMessage: message,
      ...input.counts,
    });
    await input.connections.recordHealth(input.connection.id, {
      health: "failing",
      reasonCode: input.code,
      reasonMessage: message,
      checkedAt: finishedAt,
    });
  } catch (error) {
    // The terminal write itself failed. Nothing further can be persisted, so
    // it is logged loudly rather than swallowed — this is the one path that
    // can leave a `running` row behind, and it has to be findable.
    deps.logger.error(
      `session source poll: connection ${input.connection.id} could not record its failed run — ${describeError(error)}`,
    );
  }
}

/** A pass that never reached the source at all still gets a complete run row,
 * opened and finished back to back. */
async function recordUnattemptedFailure(
  deps: SessionSourcePollDeps,
  input: {
    pollRuns: PollRunsRepo;
    connections: ConnectionsRepo;
    connection: PollableConnection;
    code: SourceFailureCode;
    message?: string;
  },
): Promise<void> {
  const run = await input.pollRuns.start({
    projectId: input.connection.projectId,
    connectionId: input.connection.id,
    startedAt: deps.now(),
  });

  await finishFailed(deps, { ...input, runId: run.id, counts: NO_COUNTS });
}

type OpenedCredential =
  | { readonly ok: true; readonly personalApiKey: string }
  | { readonly ok: false; readonly code: SourceFailureCode; readonly message?: string };

/** CR-14. The `misconfigured` code is correct here — the customer's project
 * is not attached to a working credential either way — but the default
 * message (`CONNECT_REFUSAL_MESSAGES.misconfigured`) tells a customer whose
 * connection USED to work to set an env var and restart the server, which is
 * both wrong (the server is fine; this installation's key material simply no
 * longer opens THIS row's stored secret) and a leak of an env var name and a
 * shell command into copy the customer sees. Named separately from the
 * connect-time gate's message so the two stay distinguishable even though
 * they share a code. */
const STORED_CREDENTIAL_UNREADABLE_MESSAGE =
  "We could not unlock the analytics key saved for this project. This can happen when the security key this installation uses has changed since it was connected. Reconnect this project with your analytics key to fix it.";

/**
 * The credential path, in the one order that fails closed at every step: the
 * org-keyed read, then the key this installation resolves, then the envelope
 * bound to `(organization, project)` as additional authenticated data.
 *
 * There is NO fallback to an environment key and NO unauthenticated call — an
 * unreadable credential is a `misconfigured` failure with no request made
 * (F-11). The plaintext never leaves this call chain: it goes into the source
 * config and nowhere else, and no branch here puts it in a message.
 */
async function openCredential(
  deps: SessionSourcePollDeps,
  connection: PollableConnection,
): Promise<OpenedCredential> {
  const stored = await readConnectionCredential(deps.db, {
    connectionId: connection.id,
    organizationId: connection.organizationId,
  });
  if (stored === null) {
    return { ok: false, code: "misconfigured" };
  }

  const key = resolveCredentialKey(deps.env);
  if (!key.ok) {
    return { ok: false, code: "misconfigured" };
  }

  const opened = decryptSecret(
    stored.ciphertext,
    key.key,
    credentialAad(connection.organizationId, connection.projectId),
  );
  if (!opened.ok) {
    // CR-14: THIS branch, specifically, is a decrypt failure on an already-
    // connected row — never the connect-time "no working key at all" story
    // the default message tells. See `STORED_CREDENTIAL_UNREADABLE_MESSAGE`.
    return { ok: false, code: "misconfigured", message: STORED_CREDENTIAL_UNREADABLE_MESSAGE };
  }

  return { ok: true, personalApiKey: opened.value };
}

/**
 * THE ONE PLACE THE VENDOR IS NAMED. An exhaustive switch over a one-member
 * Zod union the compiler checks — no registry, no factory table, no dynamic
 * lookup — so the day a second `SessionSourceKind` member lands, the missing
 * branch is a compile error rather than a silent fallthrough.
 */
function createSourceFor(
  connection: PollableConnection,
  personalApiKey: string,
  deps: SessionSourcePollDeps,
  /**
   * Lets the adapter's 429 backoff see this run's deadline. Without it the
   * budget is only observed between passes, so a throttled connection sleeps
   * straight through its own claim and the cron re-claims it concurrently
   * (O-003 edge sweep, D4/D6).
   */
  deadlineExceededAfter: (ms: number) => boolean,
): SessionSource {
  switch (connection.sourceKind) {
    case POSTHOG_SOURCE_KIND:
      return createPostHogSessionSource(
        {
          host: connection.host,
          sourceProjectId: connection.sourceProjectId,
          personalApiKey,
        },
        {
          fetch: deps.fetch,
          sleep: deps.sleep,
          now: deps.now,
          random: deps.random,
          deadlineExceededAfter,
        },
      );
  }

  const unsupported: never = connection.sourceKind;
  throw new Error(`session source poll: unsupported source kind ${String(unsupported)}`);
}
