import type { TaskList } from "graphile-worker";

import {
  DEFAULT_COLDSTART_MODEL,
  createAnthropicModel,
  createAnthropicSessionSummariser,
} from "@growthmind/adapters";
import { modelSummaryOutputSchema } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import {
  createAnalysisRunsRepo,
  createDb,
  createDeliveriesRepo,
  createFindingsRepo,
  createSignatureLedgerService,
} from "@growthmind/db";
import type { DeliveryPoster, ServerEnv } from "@growthmind/shared";
import { parseServerEnv } from "@growthmind/shared";

import { COLDSTART_MODEL_CALL_CAP, ORG_MODEL_CALL_CAP } from "./analysis-cap";
import { createAnalysisLaneSource } from "./analysis-lane-source";
import { TASK } from "./task-names";
import type { AnalysisLaneSource, ConfiguredSummariser } from "./tasks/analysis-tick";
import { runAnalysisTick } from "./tasks/analysis-tick";
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
 * TODO(O-008): return `{ poster, lanes }` here — this function is the ONLY place
 * that changes, because `runDeliveryTick` takes both as injected dependencies
 * typed by their ports and never names a vendor. Its test suite already drives
 * the full sequence with fakes, so what lands here is the wire, not the
 * behaviour. `createSlackDeliveryPoster` (shipped, `@growthmind/adapters`) needs
 * only a bot token and a `fetch`; the lane source needs a `findings` read that
 * no table in this branch supports yet.
 *
 * BE HONEST ABOUT WHAT THIS MEANS: until that lands, this tick posts nothing on
 * any installation. O-007's DoD — the scheduler, the renderer's legibility
 * budget, the residual scanner running before any post, D4 idempotency and D8
 * failure isolation — is met and proven, but proven against fakes driving the
 * real entry point, not against production traffic. That is the D11 hazard this
 * codebase names (a value computed and then dropped on the floor), held open
 * deliberately and visibly rather than hidden: the absence is logged once per
 * tick, and this comment is the reason it is not a silent no-op.
 */
function resolveDeliveryComposition(): DeliveryComposition | null {
  return null;
}

/**
 * The two effects the analysis tick cannot construct for itself: which projects
 * have gate-passed candidates waiting, and — only if this installation
 * configured one — the port that writes them up in plain English.
 */
type AnalysisComposition = {
  /**
   * `null` ⇒ NO WRITTEN-EXPLANATION CAPABILITY IS CONFIGURED HERE, and that is
   * a decision this function takes rather than a failure anything catches
   * (AD-15). `runAnalysisTick` accepts the null, selects `floor_no_key_configured`
   * before it claims anything, and therefore makes ZERO model calls — see the
   * header below for why the branch has to live at this end of the wire.
   */
  summariser: ConfiguredSummariser | null;
  lanes: AnalysisLaneSource;
};

/**
 * THE NO-KEY BRANCH. It lives at this end of the wire and nowhere else
 * (AD-15, FR-M12).
 *
 * `null` IFF `env.ANTHROPIC_API_KEY` is absent. That branch SELECTS the lane; it
 * never tries a port and swallows the failure. With no key there is no provider
 * constructed and no port passed, so a candidate reaches `floor_no_key_configured`
 * BEFORE the cap is claimed and the count of model calls attempted is
 * structurally zero — not zero because an error was caught, zero because nothing
 * was ever called. `packages/adapters/__tests__/anthropic/probe.test.ts:181-203`
 * is why it has to be this way round: `createAnthropic({})` does NOT throw
 * without a key, and neither does obtaining a model from it, so the absence would
 * otherwise surface as a failed call at the network edge — billed as a cap claim,
 * reported as `floor_model_call_failed`, and telling a self-hoster their model
 * call broke when in truth they simply never configured one.
 *
 * This is the self-host promise `packages/shared/src/env.ts:31-39` and
 * `.env.example:36-41` already made in writing: `docker compose up` from a clean
 * clone, with no key anywhere, must reach a working pipeline. Every finding still
 * ships, carrying its numbers, with no written explanation attached. A worker that
 * crash-looped because no model key was configured would take the whole analysis
 * pipeline down over an optional feature.
 *
 * THE API KEY IS READ ONLY HERE. It is never logged, never persisted, never
 * echoed into an error message and never handed to the task body, which reads no
 * environment variable by any route. It travels exactly one function call, into
 * `createAnthropicModel` (`@growthmind/adapters`), which is where the SDK lives —
 * NO file under `worker/` may import `ai` or `@ai-sdk/anthropic` (ADD §9, task
 * 4.1), and passing the bare model id string instead would typecheck and then
 * resolve through the Vercel AI Gateway rather than Anthropic. What reaches a run
 * row is the resolved MODEL ID, which is configuration, not a credential.
 *
 * The model id is RESOLVED here and hardcoded nowhere (AD-3): configuration
 * first, then the one default that lives beside the adapter that speaks to the
 * vendor. The same resolved id goes to the provider, to the port, AND to the
 * lane beside the port, so the id a run row names is always the id the call
 * addressed — on every path, including the defensive one where the port throws
 * and no result comes back to read an id off. Returning the port alone is what
 * used to leave that path writing a null `resolved_model_id` beside a non-zero
 * `model_calls_attempted`, contradicting both columns' documented rule; the
 * pairing is `ConfiguredSummariser` and it exists so the two cannot separate.
 *
 * `outputSchema` is core's, injected (AD-16). `packages/adapters` may never
 * import `packages/core`, so the anti-invention shape keeps one home and this is
 * the seam where the two meet.
 */
function resolveSummariser(env: ServerEnv): ConfiguredSummariser | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (apiKey === undefined) {
    return null;
  }

  const resolvedModelId = env.GROWTHMIND_COLDSTART_MODEL ?? DEFAULT_COLDSTART_MODEL;

  return {
    port: createAnthropicSessionSummariser({
      model: createAnthropicModel({ apiKey, resolvedModelId }),
      resolvedModelId,
      outputSchema: modelSummaryOutputSchema,
    }),
    resolvedModelId,
  };
}

/**
 * Which projects have candidates to consider — THE WIRE, LANDED (O-012,
 * closing O-011 ADD AD-0 / R-9's TODO exactly where it said the change would
 * happen, and nowhere else).
 *
 * `createAnalysisLaneSource` is the adapter this port waited for: every
 * project with an active connection, its corpus read over the producer's
 * trailing window, both T1 detectors run, every proposal through the evidence
 * gate, and the survivors assembled into one lane per project. From this line
 * on, the tick's graceful-absence log means "no projects connected" — never
 * "no producer written".
 *
 * The logger here is the console pair rather than a Graphile helper because
 * this composition happens once per process, outside any task closure; the
 * per-tick logger the handler receives still carries every lane-level line.
 */
function resolveAnalysisLanes(): AnalysisLaneSource | null {
  const { db } = resolveResources();
  return createAnalysisLaneSource({
    db,
    logger: {
      info: (message) => console.info(message),
      error: (message) => console.error(message),
    },
  });
}

/**
 * The analysis lane's runtime composition — still NULL ON THIS INSTALLATION
 * TODAY, for exactly one remaining reason, and it is not the model.
 *
 * The two halves are resolved independently above and they fail differently, on
 * purpose. A missing lane source means there is nothing to analyse and the tick
 * has no work at all. A missing API key means there is work and it will be done
 * — the deterministic floor writes every finding, carrying its numbers, with no
 * written explanation attached. Collapsing those into one "not configured" would
 * throw away the distinction the whole lane's vocabulary exists to keep.
 *
 * The lane source is resolved FIRST so that an installation with nothing to
 * analyse never constructs a provider it would not use.
 *
 * ── BE HONEST ABOUT WHAT THIS MEANS ─────────────────────────────────────────
 * Until the heir lands, this tick analyses nothing on any installation: it logs
 * one graceful-absence line per hour and persists no finding and no run. O-011's
 * DoD — the ladder's fixed order, the cap's named exhaustion, the guard over the
 * text as persisted, `summary_source` on every row, every exit path terminal —
 * is met and proven, but proven against fakes driving the real entry point, not
 * against production traffic. That is the D11 hazard this codebase names, held
 * open deliberately and visibly rather than hidden: the absence is logged once
 * per tick, and this comment is the reason it is not a silent no-op.
 */
function resolveAnalysisComposition(): AnalysisComposition | null {
  const lanes = resolveAnalysisLanes();
  if (lanes === null) {
    return null;
  }

  const { env } = resolveResources();

  return { summariser: resolveSummariser(env), lanes };
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
  // THE ONLY QUEUE-AWARE LINE IN THE ANALYSIS PATH, and the only place a model
  // vendor could ever be named. `runAnalysisTick` takes the lane source and the
  // summariser as ports and imports neither `ai` nor `@ai-sdk/anthropic` — the
  // whole SDK surface is reachable from `@growthmind/adapters` alone.
  //
  // There is no payload: the task is cron-triggered, and the handler reads none
  // by any route — a stronger guarantee than parsing a value cron never sends,
  // and the same shape both ticks above use. Each lane's tenant scope comes from
  // the lane ROW the source read (D7), never from anything a caller supplies.
  [TASK.ANALYSIS_TICK]: async (_payload, helpers) => {
    const composed = resolveAnalysisComposition();

    if (composed === null) {
      // Graceful absence, said out loud once per tick rather than swallowed. A
      // silent return here would be indistinguishable from a tick that ran and
      // found no project due — the one distinction this lane's whole vocabulary
      // exists to keep.
      helpers.logger.info(
        "analysis tick: no analysis lane is wired on this installation, so there is nothing to check",
      );
      return;
    }

    const { db } = resolveResources();

    await runAnalysisTick({
      lanes: composed.lanes,
      // `null` ⇒ the no-key lane, decided above. The task body never learns
      // whether a key exists; it learns only whether it was handed a port.
      summariser: composed.summariser,
      // The two repositories and the ledger, org-scoped PER LANE from the
      // context the handler builds out of the lane row — never from a payload.
      // The one call to each `create*` lives here, beside the pool it needs.
      findingsFor: (ctx) => createFindingsRepo(db, ctx),
      runsFor: (ctx) => createAnalysisRunsRepo(db, ctx),
      ledgerFor: (ctx) => createSignatureLedgerService(db, ctx),
      // Policy, injected — BOTH ceilings (AD-23). A spend limit is a property
      // of the lane that spends, so both travel from ./analysis-cap.ts through
      // here and neither leaks into `packages/db`, whose claim takes them as
      // parameters. The organisation-wide one is what supplies the N the
      // per-project one is missing: nothing limits how many projects an
      // organisation creates.
      projectCap: COLDSTART_MODEL_CALL_CAP,
      organizationCap: ORG_MODEL_CALL_CAP,
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
/**
 * The analysis tick carries NO `?fill`, and here the reason stops being about
 * tidiness and starts being about money: A BACKFILLED BURST OF ANALYSIS TICKS IS
 * A BURST OF MODEL CALLS. Twelve hours of downtime would queue twelve ticks that
 * all fire at once, each one free to spend a project's whole cap, and the bill
 * for a worker restart is not a thing anybody should be able to run up by
 * accident. The per-project cap and the run row's single-writer index would
 * collapse most of that — but a spend ceiling that only holds because something
 * downstream collapsed a burst is not a ceiling, it is a coincidence, and it is
 * one bug away from being a real invoice.
 *
 * Hourly, not every fifteen minutes: a check that reads a window of sessions has
 * nothing new to say four times an hour, and every tick that finds nothing still
 * opens and closes a run. A tick missed while the worker was down means a
 * project is checked an hour late, which costs a founder nothing observable.
 */
export const crontab = [
  `*/15 * * * * ${TASK.HEARTBEAT} ?fill=1d`,
  `* * * * * ${TASK.SESSION_SOURCE_POLL_SCHEDULE}`,
  `*/15 * * * * ${TASK.DELIVERY_TICK}`,
  `0 * * * * ${TASK.ANALYSIS_TICK}`,
].join("\n");
