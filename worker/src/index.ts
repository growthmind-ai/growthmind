import type { TaskList } from "graphile-worker";

import { TASK } from "./task-names";
import { heartbeatMessage } from "./tasks/heartbeat";

/**
 * The task registry — the only place task names meet handlers. Handlers stay
 * queue-agnostic (plain functions in ./tasks); the thin closures here adapt
 * them to Graphile Worker's signature. worker/src/registry.test.ts asserts
 * this list and TASK never drift apart.
 */
export const taskList: TaskList = {
  [TASK.HEARTBEAT]: (_payload, helpers) => {
    helpers.logger.info(heartbeatMessage(new Date()));
    return Promise.resolve();
  },
  // TYPED STUB (O-003 scaffold). Registered now so TASK, taskList, and
  // crontab cannot drift — a queued name with no handler retries silently
  // forever, which is precisely what the registry test exists to catch.
  //
  // Wave 3 assembles the handler's deps here (the parsed environment, a db
  // client, the real fetch/sleep/now/random, and helpers.logger) and calls
  // `runSessionSourcePoll` from ./tasks/session-source-poll.
  [TASK.SESSION_SOURCE_POLL_SCHEDULE]: () => {
    throw new Error("TYPED STUB (O-003 scaffold): session-source.poll-schedule");
  },
};

/**
 * Cron lines, one per scheduled task. `?fill` backfills runs missed while
 * the worker was down — the reason Graphile Worker was chosen: a skipped
 * rollup would otherwise be a permanent hole in a retention curve.
 *
 * The poll schedule carries NO `?fill`, deliberately. Its own claim is
 * time-based (`is_active AND next_poll_at <= now`), so a connection that went
 * unpolled while the worker was down is simply overdue and is claimed by the
 * next ordinary tick. Backfilling would queue a burst of redundant ticks that
 * the claim would immediately collapse into one anyway.
 *
 * `crontab` is MULTI-LINE from here on. The registry test parses it line by
 * line — if it ever stops handling that, extend the parser rather than
 * collapsing these back onto one line.
 */
export const crontab = [
  `*/15 * * * * ${TASK.HEARTBEAT} ?fill=1d`,
  `* * * * * ${TASK.SESSION_SOURCE_POLL_SCHEDULE}`,
].join("\n");
