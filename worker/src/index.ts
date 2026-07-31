import type { TaskList } from "graphile-worker";

import type { ScopedDb } from "@growthmind/db";
import { createDb, createDeliveriesRepo } from "@growthmind/db";
import type { DeliveryPoster, ServerEnv } from "@growthmind/shared";
import { parseServerEnv } from "@growthmind/shared";

import { TASK } from "./task-names";
import type { DeliveryLaneSource } from "./tasks/delivery-tick";
import { runDeliveryTick } from "./tasks/delivery-tick";
import { heartbeatMessage } from "./tasks/heartbeat";
import { runSessionSourcePoll } from "./tasks/session-source-poll";

/**
 * The process-wide database pool and parsed environment, built on FIRST USE
 * rather than at import time. `taskList` is a module constant that tests and
 * the registry check import for its shape alone — constructing a pool the
 * moment this module is imported would open a socket for every one of them.
 */
let resources: { db: ScopedDb; env: ServerEnv } | null = null;

function resolveResources(): { db: ScopedDb; env: ServerEnv } {
  if (resources === null) {
    const env = parseServerEnv(process.env);
    resources = { env, db: createDb(env.DATABASE_URL) };
  }
  return resources;
}

/** The two effects the delivery tick cannot construct for itself: where to
 * post, and which projects are due. */
type DeliveryComposition = {
  poster: DeliveryPoster;
  lanes: DeliveryLaneSource;
};

/**
 * The delivery lane's runtime composition — NULL ON THIS INSTALLATION TODAY,
 * deliberately and visibly.
 *
 * Both halves are missing from this branch's history, and neither is something
 * the handler could invent: a `slack_connections` row is what a concrete poster
 * is built from, and a `findings` table is what a lane source reads. O-007
 * shipped the scheduler, the renderer, the residual scanner, the deliveries
 * ledger and the poster PORT; the adapter and the lane read are the remaining
 * wiring.
 *
 * So the tick degrades to a clean no-op rather than crashing or pretending: an
 * installation with no delivery channel connected is a supported deployment
 * (the self-host graceful-absence promise, AGENTS.md), and a worker that
 * crash-loops on boot because Slack was never connected would take the analysis
 * pipeline down with it.
 *
 * TODO(O-007 composition): return `{ poster, lanes }` here — this function is
 * the ONLY place that changes, because `runDeliveryTick` takes both as injected
 * dependencies typed by their ports and never names a vendor. Its test suite
 * already drives the full sequence with fakes, so what lands here is the wire,
 * not the behaviour.
 */
function resolveDeliveryComposition(): DeliveryComposition | null {
  return null;
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
    const { db, env } = resolveResources();

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
  // THE ONLY QUEUE-AWARE LINE IN THE DELIVERY PATH, and the only place a
  // concrete poster is ever chosen. The handler takes the poster and the lane
  // source as ports, so this closure is where a vendor could be named and the
  // task file is where it never can be.
  //
  // There is no payload: the task is cron-triggered, and each lane's tenant
  // scope comes from the lane row the source read (D7).
  [TASK.DELIVERY_TICK]: async (_payload, helpers) => {
    const composed = resolveDeliveryComposition();

    if (composed === null) {
      // Graceful absence, said out loud once per tick rather than swallowed. A
      // silent return here would be indistinguishable from a lane that ran and
      // found nothing — the one distinction this vocabulary exists to keep.
      helpers.logger.info(
        "delivery tick: no delivery channel is connected on this installation, so there is nothing to post",
      );
      return;
    }

    const { db } = resolveResources();

    await runDeliveryTick({
      lanes: composed.lanes,
      // The ledger, org-scoped per lane from the context the handler builds out
      // of the lane row — never from a payload.
      deliveriesFor: (ctx) => createDeliveriesRepo(db, ctx),
      poster: composed.poster,
      now: () => new Date(),
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
/**
 * The delivery tick carries NO `?fill` either, and for a sharper reason than
 * the poll's: a backfilled burst of delivery ticks is a burst of POSTS. The
 * lane's pacing (one open finding at a time, a weekly ceiling) would collapse
 * them, but the guarantee must not rest on that — a scheduler whose restraint
 * depends on a downstream check is one bug away from posting a week of findings
 * in a second. A tick missed while the worker was down means a finding goes out
 * fifteen minutes late, which is not a fact anybody can observe.
 *
 * Every fifteen minutes, not daily: the cadence is not the pacing. `decideDelivery`
 * is what decides whether anything goes out, and it is deliberately unaware of
 * the clock beyond the instant it is handed. A frequent tick only means a
 * finding reaches the founder promptly once the previous one is answered —
 * which is the product behaviour §7's backpressure is for, rather than a queue
 * that drains on a timetable.
 */
export const crontab = [
  `*/15 * * * * ${TASK.HEARTBEAT} ?fill=1d`,
  `* * * * * ${TASK.SESSION_SOURCE_POLL_SCHEDULE}`,
  `*/15 * * * * ${TASK.DELIVERY_TICK}`,
].join("\n");
