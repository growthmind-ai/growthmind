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
 *
 * TYPED STUB (O-003 scaffold): the signature is final; the body throws.
 */
import type { FetchLike } from "@growthmind/adapters";
import type { ScopedDb } from "@growthmind/db";
import type { ServerEnv } from "@growthmind/shared";

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
 * A tick with no due connections — including a deployment with none attached
 * at all — is a CLEAN NO-OP: no crash, no error state, and distinguishable
 * from "polled and found nothing", which is a recorded poll-run outcome.
 * That is the self-host graceful-absence promise in one behaviour.
 */
export function runSessionSourcePoll(
  _deps: SessionSourcePollDeps,
): Promise<SessionSourcePollSummary> {
  throw new Error("TYPED STUB (O-003 scaffold): runSessionSourcePoll");
}
