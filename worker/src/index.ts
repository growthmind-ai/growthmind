import type { TaskList } from "graphile-worker";

import {
  DEFAULT_COLDSTART_MODEL,
  createBusinessResearcher,
  createColdstartModel,
  createSessionSummariser,
  createSlackDeliveryPoster,
  fetchSite,
} from "@growthmind/adapters";
import { modelSummaryOutputSchema } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import {
  createAnalysisRunsRepo,
  createDb,
  createDeliveriesRepo,
  createFindingPayloadsRepo,
  createFindingsRepo,
  createGrowthContextRepo,
  createSignatureLedgerService,
  createSlackConnectionsRepo,
  createSurfaceObservationsService,
} from "@growthmind/db";
import {
  SYSTEM_ACTOR,
  existsAnyActiveSlackConnection,
  findAnalysableProject,
  systemContextFor,
} from "@growthmind/db/system";
import type { WorkerEnv } from "@growthmind/shared";
import {
  bindingReadOutputSchema,
  businessResearchPayloadSchema,
  logger,
  parseWorkerEnv,
  resolveCredentialKey,
  shapingReadOutputSchema,
} from "@growthmind/shared";

import { COLDSTART_MODEL_CALL_CAP, ORG_MODEL_CALL_CAP } from "./analysis-cap";
import { createAnalysisLaneSource } from "./analysis-lane-source";
import { createDeliveryLaneSource } from "./delivery-lane-source";
import { createGrowthContextLaneSource } from "./growth-context-lane-source";

import { TASK } from "./task-names";
import { taskLoggerFor } from "./task-logger";
import type {
  AnalysisLaneSource,
  AnalysisLogger,
  AnalysisTickDeps,
  ConfiguredSummariser,
} from "./tasks/analysis-tick";
import { runAnalysisTick } from "./tasks/analysis-tick";
import type { DeliveryLaneSource, DeliveryPosterFor } from "./tasks/delivery-tick";
import { runGrowthContextTick } from "./tasks/growth-context-tick";
import { runBusinessResearch, type BusinessResearcherPort } from "./tasks/business-research";
import { runDeliveryTick } from "./tasks/delivery-tick";
import { heartbeatMessage } from "./tasks/heartbeat";
import { runOnboardingAnalysis } from "./tasks/onboarding-analysis";
import { runProviderInterestTick } from "./tasks/provider-interest-tick";
import { runSessionSourcePoll } from "./tasks/session-source-poll";

let resources: { db: ScopedDb; env: WorkerEnv } | null = null;

function resolveResources(): { db: ScopedDb; env: WorkerEnv } {
  if (resources === null) {
    const env = parseWorkerEnv(process.env);
    resources = { env, db: createDb(env.DATABASE_URL) };
  }
  return resources;
}

type DeliveryComposition = {
  posterFor: DeliveryPosterFor;
  lanes: DeliveryLaneSource;
};

export function makePosterFor(db: ScopedDb, env: WorkerEnv): DeliveryPosterFor {
  const resolution = resolveCredentialKey(env);

  if (!resolution.ok) {
    logger.error(
      `delivery composition: the credential key could not be resolved (${resolution.reason}), so ` +
        `no delivery channel can be opened on this installation until it is configured`,
    );
    return () => Promise.resolve(null);
  }

  const key = resolution.key;

  return async (ctx) => {
    const opened = await createSlackConnectionsRepo(db, ctx).openCredentialForOrg(key);

    if (opened === null) {
      return null;
    }

    if (!opened.ok) {
      logger.error(
        `delivery composition: org ${ctx.organizationId} has a stored delivery credential this ` +
          `installation cannot open (${opened.reason}) — it must be reconnected`,
      );
      return null;
    }

    return createSlackDeliveryPoster({ botToken: opened.value }, { fetch: globalThis.fetch });
  };
}

async function resolveDeliveryComposition(): Promise<DeliveryComposition | null> {
  const { db, env } = resolveResources();

  if (!(await existsAnyActiveSlackConnection(db))) {
    return null;
  }

  return {
    lanes: createDeliveryLaneSource({ db, logger: taskLoggerFor(logger) }),
    posterFor: makePosterFor(db, env),
  };
}

type AnalysisComposition = {
  summariser: ConfiguredSummariser | null;
  lanes: AnalysisLaneSource;
};

function resolveSummariser(env: WorkerEnv): ConfiguredSummariser | null {
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey === undefined) {
    return null;
  }

  const resolvedModelId = env.GROWTHMIND_COLDSTART_MODEL ?? DEFAULT_COLDSTART_MODEL;

  return {
    port: createSessionSummariser({
      model: createColdstartModel({ apiKey, resolvedModelId }),
      resolvedModelId,
      outputSchema: modelSummaryOutputSchema,
    }),
    resolvedModelId,
  };
}

// Absent key, absent researcher: the task records "no model configured" rather than
// leaving a person watching a spinner that will never resolve.
function resolveBusinessResearcher(env: WorkerEnv): BusinessResearcherPort | null {
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey === undefined) {
    return null;
  }

  const resolvedModelId = env.GROWTHMIND_COLDSTART_MODEL ?? DEFAULT_COLDSTART_MODEL;

  return createBusinessResearcher({
    model: createColdstartModel({ apiKey, resolvedModelId }),
    resolvedModelId,
    bindingSchema: bindingReadOutputSchema,
    shapingSchema: shapingReadOutputSchema,
  });
}

function resolveAnalysisLanes(): AnalysisLaneSource | null {
  const { db } = resolveResources();
  return createAnalysisLaneSource({ db, logger: taskLoggerFor(logger) });
}

function resolveAnalysisComposition(): AnalysisComposition | null {
  const lanes = resolveAnalysisLanes();
  if (lanes === null) {
    return null;
  }

  const { env } = resolveResources();

  return { summariser: resolveSummariser(env), lanes };
}

function analysisDepsFor(
  composed: AnalysisComposition,
  analysisLogger: AnalysisLogger,
): AnalysisTickDeps {
  const { db } = resolveResources();

  return {
    lanes: composed.lanes,

    summariser: composed.summariser,

    findingsFor: (ctx) => createFindingsRepo(db, ctx),
    payloadsFor: (ctx) => createFindingPayloadsRepo(db, ctx),
    runsFor: (ctx) => createAnalysisRunsRepo(db, ctx),
    ledgerFor: (ctx) => createSignatureLedgerService(db, ctx),

    projectCap: COLDSTART_MODEL_CALL_CAP,
    organizationCap: ORG_MODEL_CALL_CAP,
    now: () => new Date(),
    logger: analysisLogger,
  };
}

const businessResearchHandler: NonNullable<TaskList[string]> = async (payload, helpers) => {
  const { db, env } = resolveResources();
  const taskLogger = taskLoggerFor(logger);

  const parsed = businessResearchPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    helpers.logger.error("business research: a job arrived with a payload this task cannot read");
    return;
  }

  const project = await findAnalysableProject(db, parsed.data.projectId);
  if (project === null) {
    taskLogger.error(
      `business research: project ${parsed.data.projectId} has no readable organization, so nothing was read`,
    );
    return;
  }

  await runBusinessResearch(
    {
      growthFor: (ctx) => createGrowthContextRepo(db, ctx),
      fetchSite: (domain) => fetchSite({ fetch: globalThis.fetch }, domain),
      researcher: resolveBusinessResearcher(env),
      now: () => new Date(),
      logger: taskLogger,
    },
    {
      ctx: systemContextFor(SYSTEM_ACTOR.BUSINESS_RESEARCH, project),
      projectId: parsed.data.projectId,
    },
  );
};

export const taskList: TaskList = {
  [TASK.HEARTBEAT]: (_payload, helpers) => {
    helpers.logger.info(heartbeatMessage(new Date()));
    return Promise.resolve();
  },

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

      requestAnalysis: {
        requestForProject: async ({ projectId }) => {
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

  [TASK.DELIVERY_TICK]: async (_payload, helpers) => {
    const composed = await resolveDeliveryComposition();

    if (composed === null) {
      helpers.logger.info(
        "delivery tick: no delivery channel is connected on this installation, so there is nothing to post",
      );
      return;
    }

    const { db } = resolveResources();

    await runDeliveryTick({
      lanes: composed.lanes,

      deliveriesFor: (ctx) => createDeliveriesRepo(db, ctx),

      posterFor: composed.posterFor,
      now: () => new Date(),
      logger: helpers.logger,
    });
  },

  [TASK.ANALYSIS_TICK]: async (_payload, helpers) => {
    const composed = resolveAnalysisComposition();

    if (composed === null) {
      helpers.logger.info(
        "analysis tick: no analysis lane is wired on this installation, so there is nothing to check",
      );
      return;
    }

    await runAnalysisTick(analysisDepsFor(composed, helpers.logger));
  },

  [TASK.ANALYSIS_ONBOARDING]: async (payload, helpers) => {
    const composed = resolveAnalysisComposition();

    if (composed === null) {
      helpers.logger.info(
        "analysis onboarding: no analysis lane is wired on this installation, so this trigger did nothing and the hourly check is unaffected",
      );
      return;
    }

    await runOnboardingAnalysis(analysisDepsFor(composed, helpers.logger), payload);
  },

  [TASK.GROWTH_CONTEXT_TICK]: async () => {
    const { db } = resolveResources();
    const taskLogger = taskLoggerFor(logger);

    await runGrowthContextTick({
      lanes: createGrowthContextLaneSource({ db, logger: taskLogger }),
      observationsFor: (ctx) => createSurfaceObservationsService(db, ctx),
      growthFor: (ctx) => createGrowthContextRepo(db, ctx),
      now: () => new Date(),
      logger: taskLogger,
    });
  },

  [TASK.BUSINESS_RESEARCH]: businessResearchHandler,

  [TASK.BUSINESS_RESEARCH_BEFORE_RENAME]: businessResearchHandler,

  [TASK.PROVIDER_INTEREST_TICK]: async (_payload, helpers) => {
    const { db, env } = resolveResources();

    await runProviderInterestTick({
      db,
      env,
      fetch: globalThis.fetch,
      logger: helpers.logger,
      now: () => new Date(),
    });
  },
};

export const crontab = [
  `*/15 * * * * ${TASK.HEARTBEAT} ?fill=1d`,
  `* * * * * ${TASK.SESSION_SOURCE_POLL_SCHEDULE}`,
  `*/15 * * * * ${TASK.DELIVERY_TICK}`,
  `0 * * * * ${TASK.ANALYSIS_TICK}`,
  `* * * * * ${TASK.PROVIDER_INTEREST_TICK}`,
  `30 3 * * * ${TASK.GROWTH_CONTEXT_TICK}`,
].join("\n");
