// Repository for the `session_source_poll_runs` table. D-B: org-scoped at
// construction, no organization id parameter, mutations keyed on `(org, id)`.
//
// TYPED STUB (O-003 scaffold): signatures and return types are final; bodies
// throw.
import type { PollRunOutcome, SourceFailureCode, TenantContext } from "@growthmind/shared";

import type { sessionSourcePollRuns } from "../schema/session-source-poll-runs";
import type { ScopedDb } from "./types";

export type PollRunRecord = typeof sessionSourcePollRuns.$inferSelect;

export interface StartPollRunInput {
  projectId: string;
  connectionId: string;
  startedAt: Date;
}

/** Counters every terminal path reports, so a failed run is as informative
 * as a successful one. */
export interface PollRunCounts {
  eventsReceived: number;
  eventsPersisted: number;
  eventsDroppedMalformed: number;
  sessionsTouched: number;
  pagesFetched: number;
  identityLookupsUsed: number;
}

/**
 * A run is `completed` or `failed` — there is no third shape and no way to
 * express a non-terminal finish. Every exit path in the handler produces one
 * of these, which is what keeps a stuck "running" from being shippable (D8).
 */
export type PollRunTerminal =
  | ({
      status: "completed";
      finishedAt: Date;
      /** `no_new_events` is recorded DISTINCTLY from `with_events`: an empty
       * page is never authoritative, so a permanently-zero connection must be
       * visible rather than indistinguishable from a quiet healthy one. */
      outcome: PollRunOutcome;
      /** Non-null only when the walk was provably contiguous. */
      watermarkAdvancedTo: Date | null;
    } & PollRunCounts)
  | ({
      status: "failed";
      finishedAt: Date;
      failureCode: SourceFailureCode;
      /** Plain English. Scrubbed of key material before it gets here. */
      failureMessage: string;
    } & PollRunCounts);

export interface PollRunAggregate {
  runsCompleted: number;
  runsFailed: number;
  /** Summed across every run, for the counter's `droppedUnreadable`. */
  totalDroppedMalformed: number;
  totalEventsReceived: number;
  totalEventsPersisted: number;
  /** The completion time of the most recent SUCCESSFUL run — the counter's
   * `asOf` anchor. Not wall-clock now, and not the newest event's own
   * declared time. `null` when no run has ever succeeded. */
  lastSuccessfulFinishedAt: Date | null;
}

export interface PollRunsRepo {
  start(input: StartPollRunInput): Promise<PollRunRecord>;
  /** Keyed on `(org, id)` — `null` for a foreign org's run id. */
  finish(id: string, terminal: PollRunTerminal): Promise<PollRunRecord | null>;
  /** The most recent run with `status = "completed"`, or `null`. */
  latestCompletedFor(connectionId: string): Promise<PollRunRecord | null>;
  aggregateFor(connectionId: string): Promise<PollRunAggregate>;
}

export function createPollRunsRepo(_db: ScopedDb, _ctx: TenantContext): PollRunsRepo {
  throw new Error("TYPED STUB (O-003 scaffold): createPollRunsRepo");
}
