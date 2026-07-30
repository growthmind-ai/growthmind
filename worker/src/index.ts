import type { TaskList } from "graphile-worker";

import type { ScopedDb } from "@growthmind/db";
import { createDb } from "@growthmind/db";
import type { ServerEnv } from "@growthmind/shared";
import { parseServerEnv } from "@growthmind/shared";

import { TASK } from "./task-names";
import { heartbeatMessage } from "./tasks/heartbeat";
import { runSessionSourcePoll } from "./tasks/session-source-poll";

/**
 * The process-wide database pool and parsed environment, built on FIRST USE
 * rather than at import time. `taskList` is a module constant that tests and
 * the registry check import for its shape alone — constructing a pool the
 * moment this module is imported would open a socket for every one of them.
 */
let pollResources: { db: ScopedDb; env: ServerEnv } | null = null;

function resolvePollResources(): { db: ScopedDb; env: ServerEnv } {
  if (pollResources === null) {
    const env = parseServerEnv(process.env);
    pollResources = { env, db: createDb(env.DATABASE_URL) };
  }
  return pollResources;
}

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
  // THE ONLY QUEUE-AWARE LINE IN THE POLL PATH. Every effect the handler has
  // — the clock, sleeping, the network, randomness, the logger — is assembled
  // HERE and injected, which is what lets the wire proof drive the same plain
  // function this closure calls, with fakes, and prove the chain end to end.
  //
  // There is no payload: the task is cron-triggered, and the handler derives
  // its tenant scope from each claimed connection row instead (D-10).
  [TASK.SESSION_SOURCE_POLL_SCHEDULE]: async (_payload, helpers) => {
    const { db, env } = resolvePollResources();

    await runSessionSourcePoll({
      db,
      env,
      now: () => new Date(),
      sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      fetch: globalThis.fetch,
      random: Math.random,
      logger: helpers.logger,
    });
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
