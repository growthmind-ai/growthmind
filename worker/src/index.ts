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
};

/**
 * Cron lines, one per scheduled task. `?fill` backfills runs missed while
 * the worker was down — the reason Graphile Worker was chosen: a skipped
 * rollup would otherwise be a permanent hole in a retention curve.
 */
export const crontab = `*/15 * * * * ${TASK.HEARTBEAT} ?fill=1d`;
