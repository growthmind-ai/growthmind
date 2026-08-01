import type { TaskList } from "graphile-worker";

import {
  DEFAULT_COLDSTART_MODEL,
  createAnthropicModel,
  createAnthropicSessionSummariser,
  createSlackDeliveryPoster,
} from "@growthmind/adapters";
import { modelSummaryOutputSchema } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import {
  createAnalysisRunsRepo,
  createDb,
  createDeliveriesRepo,
  createFindingsRepo,
  createSignatureLedgerService,
  createSlackConnectionsRepo,
} from "@growthmind/db";
import { existsAnyActiveSlackConnection } from "@growthmind/db/system";
import type { ServerEnv } from "@growthmind/shared";
import { parseServerEnv, resolveCredentialKey } from "@growthmind/shared";

import { COLDSTART_MODEL_CALL_CAP, ORG_MODEL_CALL_CAP } from "./analysis-cap";
import { createAnalysisLaneSource } from "./analysis-lane-source";
import { createDeliveryLaneSource } from "./delivery-lane-source";
import { TASK } from "./task-names";
import type {
  AnalysisLaneSource,
  AnalysisLogger,
  AnalysisTickDeps,
  ConfiguredSummariser,
} from "./tasks/analysis-tick";
import { runAnalysisTick } from "./tasks/analysis-tick";
import type { DeliveryLaneSource, DeliveryPosterFor } from "./tasks/delivery-tick";
import { runDeliveryTick } from "./tasks/delivery-tick";
import { heartbeatMessage } from "./tasks/heartbeat";
import { runOnboardingAnalysis } from "./tasks/onboarding-analysis";
import { runSessionSourcePoll } from "./tasks/session-source-poll";

/**
 * The process-wide database pool and parsed environment, built on first use rather than
 * at import time. `taskList` is a module constant that tests and the registry check
 * import for its shape alone. Constructing a pool the moment this module is imported
 * would open a socket for every one of them.
 */
let resources: { db: ScopedDb; env: ServerEnv } | null = null;

function resolveResources(): { db: ScopedDb; env: ServerEnv } {
  if (resources === null) {
    const env = parseServerEnv(process.env);
    resources = { env, db: createDb(env.DATABASE_URL) };
  }
  return resources;
}

/** The two effects the delivery tick cannot construct for itself: where to post (per
 * organization), and which projects are due. */
type DeliveryComposition = {
  posterFor: DeliveryPosterFor;
  lanes: DeliveryLaneSource;
};

/**
 * THE ONE DOOR TO A BOT TOKEN, and this factory is the only thing that opens it
 * (AD-13, AD-20, ADD §5).
 *
 * `createSlackDeliveryPoster` binds ONE workspace's bearer token at
 * construction and `PostRequest` carries no organization, so a single poster
 * cannot serve a multi-org installation. This returns a poster PER TENANT
 * CONTEXT instead — the same factory shape `deliveriesFor` and the analysis
 * lane's three repository factories already use.
 *
 * ── THE CREDENTIAL IS KEYED BY THE CONTEXT AND BY NOTHING ELSE (D7) ─────────
 * `createSlackConnectionsRepo(db, ctx)` takes the organization at construction
 * and `openCredentialForOrg` accepts no id, so there is no route by which a
 * value travelling with a message could select a credential. The envelope is
 * opened under `slackCredentialAad(ctx)` — one argument, and it is a context,
 * so passing a project id is a compile error rather than an envelope that
 * writes fine and fails at delivery time, per customer, silently.
 *
 * ── `null` IS AN ANSWER, A THROW IS A FAULT, AND THEY STAY APART ────────────
 * `null` means this organization has no active connection — never connected, or
 * revoked between the lane read and the post. The tick skips that lane, logs it,
 * and counts it apart from failures.
 *
 * A DATABASE FAULT IS DELIBERATELY NOT CAUGHT HERE. Turning "the store stopped
 * answering" into `null` would read as "this customer has no Slack" and would
 * stop their delivery silently for as long as the fault lasted. Letting it
 * escape puts it in the tick's per-lane isolation, where it is logged and
 * counted as an error — visible, isolated, and still harmless to every sibling
 * lane (D8).
 *
 * ── THE KEY IS RESOLVED ONCE, AT COMPOSITION ────────────────────────────────
 * `resolveCredentialKey` is the shipped insecure-defaults gate, INHERITED here
 * rather than re-implemented. It is resolved once per process rather than per
 * lane so a misconfigured installation says so once instead of once per
 * organization per tick — and it fails CLOSED: with no usable key, no poster is
 * ever built and nothing is posted anywhere.
 *
 * Exported so the composition suite can drive the per-organization absence path
 * against a real database without reaching into a module-private closure.
 */
export function makePosterFor(db: ScopedDb, env: ServerEnv): DeliveryPosterFor {
  const resolution = resolveCredentialKey(env);

  if (!resolution.ok) {
    console.error(
      `delivery composition: the credential key could not be resolved (${resolution.reason}), so ` +
        `no delivery channel can be opened on this installation until it is configured`,
    );
    return () => Promise.resolve(null);
  }

  const key = resolution.key;

  return async (ctx) => {
    const opened = await createSlackConnectionsRepo(db, ctx).openCredentialForOrg(key);

    if (opened === null) {
      // No active connection for this organization. An ordinary answer, and the
      // tick's own log line is where it is said — repeating it here would print
      // twice per lane per tick.
      return null;
    }

    if (!opened.ok) {
      // A stored envelope this installation can no longer open — a rotated key,
      // a restored backup, a row written under a different key id. FAILS
      // CLOSED, and names the REASON and never the ciphertext: reconnecting the
      // channel is the one action that fixes it.
      console.error(
        `delivery composition: org ${ctx.organizationId} has a stored delivery credential this ` +
          `installation cannot open (${opened.reason}) — it must be reconnected`,
      );
      return null;
    }

    // The decrypted token lives exactly here, for the lifetime of one poster,
    // and travels one function call into the adapter that speaks to the vendor.
    // It is never logged, never persisted, and never attached to a result: every
    // sentence the adapter can return comes from its own fixed table.
    return createSlackDeliveryPoster({ botToken: opened.value }, { fetch: globalThis.fetch });
  };
}

/**
 * The delivery lane's runtime composition — THE WIRE, LANDED (O-008 AD-14),
 * and still `null` on an installation with no channel connected.
 *
 * BOTH HALVES ARE REQUIRED LITERALLY (AC-O12). An installation that has
 * connected Slack gets a real lane source and a real per-organization poster
 * factory; an installation with none gets `null` and the graceful-absence line
 * below, forever and correctly. Self-host is first-class: `docker compose up`
 * from a clean clone, with no Slack anywhere, must reach a working pipeline,
 * and a worker that crash-looped because nobody connected a channel would take
 * the analysis pipeline down over an optional feature.
 *
 * THE GATE IS A SYSTEM EXISTENCE QUERY, and it is org-agnostic on purpose: it
 * answers a question about the INSTALLATION, asked from a composition root that
 * runs with no user and no tenant context to pass. The PER-ORGANIZATION
 * question is a different one and is answered one level down, by `makePosterFor`
 * returning `null` for an organization whose connection is gone.
 *
 * `is_active` is part of that question rather than an optimisation: `deactivate`
 * keeps the row so history survives a reconnect, so a predicate that merely
 * counted rows would report a connected installation forever after the first
 * disconnect.
 */
async function resolveDeliveryComposition(): Promise<DeliveryComposition | null> {
  const { db, env } = resolveResources();

  if (!(await existsAnyActiveSlackConnection(db))) {
    return null;
  }

  return {
    lanes: createDeliveryLaneSource({
      db,
      // The console pair rather than a Graphile helper because this composition
      // happens once per process, outside any task closure; the per-tick logger
      // the handler receives still carries every lane-level line.
      logger: {
        info: (message) => console.info(message),
        error: (message) => console.error(message),
      },
    }),
    posterFor: makePosterFor(db, env),
  };
}

/**
 * The two effects the analysis tick cannot construct for itself: which projects have
 * gate-passed candidates waiting, and (only if this installation configured one) the
 * port that writes them up in plain English.
 */
type AnalysisComposition = {
  /**
   * `null` ⇒ no written-explanation capability is configured here, and that is a
   * decision this function takes rather than a failure anything catches.
   * `runAnalysisTick` accepts the null, selects `floor_no_key_configured` before it
   * claims anything, and therefore makes zero model calls. See the header below for why
   * the branch has to live at this end of the wire.
   */
  summariser: ConfiguredSummariser | null;
  lanes: AnalysisLaneSource;
};

/**
 * The no-key branch. It lives at this end of the wire and nowhere else.
 *
 * `null` iff `env.ANTHROPIC_API_KEY` is absent. That branch selects the lane; it never
 * tries a port and swallows the failure. With no key there is no provider constructed
 * and no port passed, so a candidate reaches `floor_no_key_configured` before the cap
 * is claimed and the count of model calls attempted is structurally zero, not zero
 * because an error was caught, zero because nothing was ever called.
 * `packages/adapters/__tests__/anthropic/probe.test.ts:181-203` is why it has to be
 * this way round: `createAnthropic` does not throw without a key, and neither does
 * obtaining a model from it, so the absence would otherwise surface as a failed call at
 * the network edge. Billed as a cap claim, reported as `floor_model_call_failed`, and
 * telling a self-hoster their model call broke when in truth they simply never
 * configured one.
 *
 * This is the self-host promise `packages/shared/src/env.ts:31-39` and
 * `.env.example:36-41` already made in writing: `docker compose up` from a clean clone,
 * with no key anywhere, must reach a working pipeline. Every finding still ships,
 * carrying its numbers, with no written explanation attached. A worker that
 * crash-looped because no model key was configured would take the whole analysis
 * pipeline down over an optional feature.
 *
 * The API key is read only here. It is never logged, never persisted, never echoed into
 * an error message and never handed to the task body, which reads no environment
 * variable by any route. It travels exactly one function call, into
 * `createAnthropicModel` (`@growthmind/adapters`), which is where the SDK lives. NO
 * file under `worker/` may import `ai` or `@ai-sdk/anthropic`, and passing the bare
 * model id string instead would typecheck and then resolve through the Vercel AI
 * Gateway rather than Anthropic. What reaches a run row is the resolved model ID, which
 * is configuration, not a credential.
 *
 * The model id is resolved here and hardcoded nowhere: configuration first, then the
 * one default that lives beside the adapter that speaks to the vendor. The same
 * resolved id goes to the provider, to the port, and to the lane beside the port, so
 * the id a run row names is always the id the call addressed. On every path, including
 * the defensive one where the port throws and no result comes back to read an id off.
 * Returning the port alone is what used to leave that path writing a null
 * `resolved_model_id` beside a non-zero `model_calls_attempted`, contradicting both
 * columns' documented rule; the pairing is `ConfiguredSummariser` and it exists so the
 * two cannot separate.
 *
 * `outputSchema` is core's, injected. `packages/adapters` may never import
 * `packages/core`, so the anti-invention shape keeps one home and this is the seam
 * where the two meet.
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
 * Which projects have candidates to consider. The wire, landed (closing add / R-9's
 * TODO exactly where it said the change would happen, and nowhere else).
 *
 * `createAnalysisLaneSource` is the adapter this port waited for: every project with an
 * active connection, its corpus read over the producer's trailing window, both T1
 * detectors run, every proposal through the evidence gate, and the survivors assembled
 * into one lane per project. From this line on, the tick's graceful-absence log means
 * "no projects connected", never "no producer written".
 *
 * The logger here is the console pair rather than a Graphile helper because this
 * composition happens once per process, outside any task closure; the per-tick logger
 * the handler receives still carries every lane-level line.
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
 * The analysis lane's runtime composition — REAL ON EVERY INSTALLATION, since
 * O-012 landed the producer this port was waiting for.
 *
 * The two halves are resolved independently above and they fail differently, on
 * purpose. A missing lane source means there is nothing to analyse and the tick has no
 * work at all. A missing API key means there is work and it will be done. The
 * deterministic floor writes every finding, carrying its numbers, with no written
 * explanation attached. Collapsing those into one "not configured" would throw away the
 * distinction the whole lane's vocabulary exists to keep.
 *
 * The lane source is resolved first so that an installation with nothing to analyse
 * never constructs a provider it would not use.
 *
 * ── THE `null` BRANCH IS UNREACHABLE TODAY, AND STAYS ANYWAY ────────────────
 * `resolveAnalysisLanes()` returns `createAnalysisLaneSource` unconditionally,
 * so on this tree this function never answers `null` and the tick's
 * graceful-absence line is dead code. That is a STATEMENT OF FACT rather than a
 * TODO: the port is nullable because the shape "the composition root decides
 * whether a capability exists" is the shape all three compositions in this file
 * share, and narrowing it would make the tick's absence branch un-writable the
 * next time a lane source legitimately cannot be built. What used to be true
 * here — "this tick analyses nothing on any installation" — is not; the tick
 * reads a real corpus, runs both detectors, and persists real findings.
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
 * The analysis lane's dependencies, assembled once for both of its callers: the hourly
 * tick and the onboarding trigger.
 *
 * One assembly rather than two, and the reason is financial. The fast path respects the
 * single-writer index and the cap ledger or it does not ship, because a cap-bypassing
 * trigger is a financial commitment. A second hand-written deps object beside this one
 * is exactly how a cap silently diverges: one call site gets
 * `COLDSTART_MODEL_CALL_CAP` and the other gets whatever somebody typed on the day, and
 * nothing fails. There is one list, so there is one ceiling.
 *
 * `AnalysisTickDeps` and `OnboardingAnalysisDeps` are the same shape by construction,
 * both being `AnalysisLaneDeps` plus a lane source, so this function's return type
 * serves both without a cast.
 */
function analysisDepsFor(composed: AnalysisComposition, logger: AnalysisLogger): AnalysisTickDeps {
  const { db } = resolveResources();

  return {
    lanes: composed.lanes,
    // `null` means the no-key lane, decided at `resolveSummariser`. The task body never
    // learns whether a key exists; it learns only whether it was handed a port.
    summariser: composed.summariser,
    // The two repositories and the ledger, org-scoped per lane from the context the
    // handler builds out of the lane row, never from a payload. The one call to each
    // `create*` lives here, beside the pool it needs.
    findingsFor: (ctx) => createFindingsRepo(db, ctx),
    runsFor: (ctx) => createAnalysisRunsRepo(db, ctx),
    ledgerFor: (ctx) => createSignatureLedgerService(db, ctx),
    // Policy, injected, and both ceilings travel together. A spend limit is a property
    // of the lane that spends, so both come from ./analysis-cap.ts through here and
    // neither leaks into `packages/db`, whose claim takes them as parameters. The
    // organisation-wide one supplies the bound the per-project one is missing: nothing
    // limits how many projects an organisation creates.
    projectCap: COLDSTART_MODEL_CALL_CAP,
    organizationCap: ORG_MODEL_CALL_CAP,
    now: () => new Date(),
    logger,
  };
}

/**
 * The task registry, the only place task names meet handlers. Handlers stay
 * queue-agnostic (plain functions in ./tasks); the thin closures here adapt them to
 * Graphile Worker's signature. worker/src/registry.test.ts asserts this list and task
 * never drift apart.
 */
export const taskList: TaskList = {
  [TASK.HEARTBEAT]: (_payload, helpers) => {
    helpers.logger.info(heartbeatMessage(new Date()));
    return Promise.resolve();
  },
  // The only queue-aware line in the poll path. Every effect the handler has. The
  // clock, sleeping, the network, randomness, the logger. Is assembled here and
  // injected, which is what lets the wire proof drive the same plain function this
  // closure calls, with fakes, and prove the chain end to end.
  //
  // There is no payload: the task is cron-triggered, and the handler derives its tenant
  // scope from each claimed connection row instead.
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
      // THE ONBOARDING FAST PATH'S ENQUEUE, and the only place in this codebase
      // that knows a project id means a queued job (AD-11). The poll hands over
      // a project id through a port; this closure is what turns it into work,
      // which is why the poll file holds no queue type.
      requestAnalysis: {
        requestForProject: async ({ projectId }) => {
          // `addJob`, SINGULAR, and that is load-bearing rather than stylistic:
          // graphile-worker's BULK `addJobs` declares `jobKeyMode?: never`, so a
          // later refactor that batched these calls would compile and would
          // silently drop the mode — and with it the collapsing this whole
          // trigger's volume argument rests on.
          //
          // `jobKeyMode: "preserve_run_at"`, NEVER `"replace"` and NEVER
          // `"unsafe_dedupe"`:
          //   - `replace` re-stamps `run_at` FORWARD on every trigger, so a
          //     founder generating a burst of broken requests would watch the
          //     analysis slide away from them on a screen with a clock on it.
          //   - `unsafe_dedupe` was MEASURED against a running holder and DROPS
          //     the trigger — losing exactly the late-window failure this sprint
          //     exists to catch.
          //   - `preserve_run_at` collapses N pending asks for one project into
          //     one job that still fires when the FIRST ask arrived.
          await helpers.addJob(
            TASK.ANALYSIS_ONBOARDING,
            { projectId },
            {
              jobKey: `${TASK.ANALYSIS_ONBOARDING}:${projectId}`,
              jobKeyMode: "preserve_run_at",
            },
          );
        },
      },
    });
  },
  // The only queue-aware line in the delivery path, and the only place a concrete
  // poster is ever chosen. The handler takes the poster and the lane source as ports,
  // so this closure is where a vendor could be named and the task file is where it
  // never can be.
  //
  // There is no payload: the task is cron-triggered, and each lane's tenant scope comes
  // from the lane row the source read.
  [TASK.DELIVERY_TICK]: async (_payload, helpers) => {
    const composed = await resolveDeliveryComposition();

    if (composed === null) {
      // Graceful absence, said out loud once per tick rather than swallowed. A silent
      // return here would be indistinguishable from a lane that ran and found nothing.
      // The one distinction this vocabulary exists to keep.
      helpers.logger.info(
        "delivery tick: no delivery channel is connected on this installation, so there is nothing to post",
      );
      return;
    }

    const { db } = resolveResources();

    await runDeliveryTick({
      lanes: composed.lanes,
      // The ledger, org-scoped per lane from the context the handler builds out of the
      // lane row, never from a payload.
      deliveriesFor: (ctx) => createDeliveriesRepo(db, ctx),
      // The poster, resolved PER LANE from the lane's own context (AD-13) —
      // never one instance shared across organizations, because a Slack poster
      // binds one workspace's token at construction and a `PostRequest` carries
      // no organization to correct it with.
      posterFor: composed.posterFor,
      now: () => new Date(),
      logger: helpers.logger,
    });
  },
  // The only queue-aware line in the analysis path, and the only place a model vendor
  // could ever be named. `runAnalysisTick` takes the lane source and the summariser as
  // ports and imports neither `ai` nor `@ai-sdk/anthropic`. The whole SDK surface is
  // reachable from `@growthmind/adapters` alone.
  //
  // There is no payload: the task is cron-triggered, and the handler reads none by any
  // route. A stronger guarantee than parsing a value cron never sends, and the same
  // shape both ticks above use. Each lane's tenant scope comes from the lane row the
  // source read, never from anything a caller supplies.
  [TASK.ANALYSIS_TICK]: async (_payload, helpers) => {
    const composed = resolveAnalysisComposition();

    if (composed === null) {
      // Graceful absence, said out loud once per tick rather than swallowed. A silent
      // return here would be indistinguishable from a tick that ran and found no
      // project due. The one distinction this lane's whole vocabulary exists to keep.
      helpers.logger.info(
        "analysis tick: no analysis lane is wired on this installation, so there is nothing to check",
      );
      return;
    }

    await runAnalysisTick(analysisDepsFor(composed, helpers.logger));
  },
  // THE ONBOARDING FAST PATH (O-008 AD-11b). The SAME lane the hourly tick
  // above runs, asked for ONE project, seconds after a founder's own broken
  // request reached us.
  //
  // QUEUED, NEVER CRONNED — deliberately absent from `crontab` below. Its one
  // producer is the poll handler's `requestAnalysis` closure, which is also the
  // only place the job key and its mode are named.
  //
  // THIS HANDLER TAKES A PAYLOAD, and it is the only one in this file that does.
  // It is passed STRAIGHT THROUGH as `unknown`: `runOnboardingAnalysis` parses
  // it with a `.strict()` schema declaring a project id and refusing everything
  // else, so there is no organization id to trust and no user id to impersonate,
  // and parsing it here as well would be a second boundary that could disagree
  // with the first.
  [TASK.ANALYSIS_ONBOARDING]: async (payload, helpers) => {
    const composed = resolveAnalysisComposition();

    if (composed === null) {
      // Graceful absence, in the trigger's own vocabulary. It names the trigger, so a
      // reader can tell a fast-path absence from the hourly tick's, and it names the
      // floor, because the one thing this path may never do is fail toward silence:
      // nothing here is written, nothing is suppressed, and the project's ordinary
      // hourly turn is untouched.
      helpers.logger.info(
        "analysis onboarding: no analysis lane is wired on this installation, so this trigger did nothing and the hourly check is unaffected",
      );
      return;
    }

    await runOnboardingAnalysis(analysisDepsFor(composed, helpers.logger), payload);
  },
};

/**
 * Cron lines, one per scheduled task. `?fill` backfills runs missed while the worker
 * was down. The reason Graphile Worker was chosen: a skipped rollup would otherwise be
 * a permanent hole in a retention curve.
 *
 * The poll schedule carries NO `?fill`, deliberately. Its own claim is time-based
 * (`is_active AND next_poll_at <= now`), so a connection that went unpolled while the
 * worker was down is simply overdue and is claimed by the next ordinary tick.
 * Backfilling would queue a burst of redundant ticks that the claim would immediately
 * collapse into one anyway.
 *
 * `crontab` is multi-line from here on. The registry test parses it line by line. If it
 * ever stops handling that, extend the parser rather than collapsing these back onto
 * one line.
 */
/**
 * The delivery tick carries NO `?fill` either, and for a sharper reason than the
 * poll's: a backfilled burst of delivery ticks is a burst of posts. The lane's pacing
 * (one open finding at a time, a weekly ceiling) would collapse them, but the guarantee
 * must not rest on that. A scheduler whose restraint depends on a downstream check is
 * one bug away from posting a week of findings in a second. A tick missed while the
 * worker was down means a finding goes out fifteen minutes late, which is not a fact
 * anybody can observe.
 *
 * Every fifteen minutes, not daily: the cadence is not the pacing. `decideDelivery` is
 * what decides whether anything goes out, and it is deliberately unaware of the clock
 * beyond the instant it is handed. A frequent tick only means a finding reaches the
 * founder promptly once the previous one is answered, which is the product behaviour
 * the backpressure is for, rather than a queue that drains on a timetable.
 */
/**
 * The analysis tick carries NO `?fill`, and here the reason stops being about tidiness
 * and starts being about money: A backfilled burst of analysis ticks is a burst of
 * model calls. Twelve hours of downtime would queue twelve ticks that all fire at once,
 * each one free to spend a project's whole cap, and the bill for a worker restart is
 * not a thing anybody should be able to run up by accident. The per-project cap and the
 * run row's single-writer index would collapse most of that, but a spend ceiling that
 * only holds because something downstream collapsed a burst is not a ceiling, it is a
 * coincidence, and it is one bug away from being a real invoice.
 *
 * Hourly, not every fifteen minutes: a check that reads a window of sessions has
 * nothing new to say four times an hour, and every tick that finds nothing still opens
 * and closes a run. A tick missed while the worker was down means a project is checked
 * an hour late, which costs a founder nothing observable.
 */
export const crontab = [
  `*/15 * * * * ${TASK.HEARTBEAT} ?fill=1d`,
  `* * * * * ${TASK.SESSION_SOURCE_POLL_SCHEDULE}`,
  `*/15 * * * * ${TASK.DELIVERY_TICK}`,
  `0 * * * * ${TASK.ANALYSIS_TICK}`,
].join("\n");
