import type { TaskList } from "graphile-worker";

import {
  DEFAULT_COLDSTART_MODEL,
  createBusinessResearcher,
  createCauseExplainer,
  createColdstartModel,
  createRecordingNarrator,
  createSessionSummariser,
  createSlackDeliveryPoster,
  fetchSite,
} from "@growthmind/adapters";
import { modelSummaryOutputSchema, narrationOutputSchema } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import {
  createAnalysisRunsRepo,
  createCauseClaimsRepo,
  createDb,
  createDeliveriesRepo,
  createDivergencePointsRepo,
  createFindingPayloadsRepo,
  createFindingsRepo,
  createGrowthContextRepo,
  createRecordingSummariesRepo,
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
  causeModelOutputSchema,
  logger,
  parseWorkerEnv,
  resolveCredentialKey,
  audienceReducePayloadSchema,
  audienceReductionOutputSchema,
  shapingReadOutputSchema,
} from "@growthmind/shared";

import { COLDSTART_MODEL_CALL_CAP, ORG_MODEL_CALL_CAP } from "./analysis-cap";
import { createAnalysisLaneSource } from "./analysis-lane-source";
import { createDeliveryLaneSource } from "./delivery-lane-source";
import { createGrowthContextLaneSource } from "./growth-context-lane-source";
import { createReplayLaneSource, makeReplaySourceFor } from "./replay-lane-source";
import { RECORDINGS_NARRATED_PER_LANE, RECORDINGS_PULLED_PER_TICK_CEILING } from "./analysis-cap";
import { runReplayNarrationTick } from "./tasks/replay-narration-tick";
import type { ConfiguredNarrator } from "./tasks/narrator-deps";

import { TASK } from "./task-names";
import { taskLoggerFor } from "./task-logger";
import type {
  AnalysisLaneSource,
  AnalysisLogger,
  AnalysisTickDeps,
  ConfiguredCauseExplainer,
  ConfiguredSummariser,
} from "./tasks/analysis-tick";
import { runAnalysisTick } from "./tasks/analysis-tick";
import type { DeliveryLaneSource, DeliveryPosterFor } from "./tasks/delivery-tick";
import { runGrowthContextTick } from "./tasks/growth-context-tick";
import { runBusinessResearch, type BusinessResearcherPort } from "./tasks/business-research";
import { runReduceAudience } from "./tasks/reduce-audience";
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
    lanes: createDeliveryLaneSource({
      db,
      logger: taskLoggerFor(logger),
      ledgerFor: (ctx) => createSignatureLedgerService(db, ctx),
    }),
    posterFor: makePosterFor(db, env),
  };
}

type AnalysisComposition = {
  summariser: ConfiguredSummariser | null;
  causeExplainer: ConfiguredCauseExplainer | null;
  lanes: AnalysisLaneSource;
};

// Both-or-neither, in one place: a Bedrock key is scoped to the region it was minted
// for, so a token without a region cannot be called and a region without a token
// configures nothing. Either way the caller reports "no model configured".
function resolveColdstartModel(
  env: WorkerEnv,
): { model: ReturnType<typeof createColdstartModel>; resolvedModelId: string } | null {
  const apiKey = env.AWS_BEARER_TOKEN_BEDROCK;
  const region = env.AWS_REGION;
  if (apiKey === undefined || region === undefined) {
    return null;
  }

  const resolvedModelId = env.GROWTHMIND_COLDSTART_MODEL ?? DEFAULT_COLDSTART_MODEL;

  return { model: createColdstartModel({ apiKey, region, resolvedModelId }), resolvedModelId };
}

function resolveSummariser(env: WorkerEnv): ConfiguredSummariser | null {
  const coldstart = resolveColdstartModel(env);
  if (coldstart === null) {
    return null;
  }

  return {
    port: createSessionSummariser({
      model: coldstart.model,
      resolvedModelId: coldstart.resolvedModelId,
      outputSchema: modelSummaryOutputSchema,
    }),
    resolvedModelId: coldstart.resolvedModelId,
  };
}

// Mirrors resolveSummariser exactly (ADD Decision 7) — the cause stage reuses the
// same coldstart model resolution, never a model provider config of its own.
function resolveCauseExplainer(env: WorkerEnv): ConfiguredCauseExplainer | null {
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey === undefined) {
    return null;
  }

  const resolvedModelId = env.GROWTHMIND_COLDSTART_MODEL ?? DEFAULT_COLDSTART_MODEL;

  return {
    port: createCauseExplainer({
      model: createColdstartModel({ apiKey, resolvedModelId }),
      resolvedModelId,
      outputSchema: causeModelOutputSchema,
    }),
    resolvedModelId,
  };
}

// Absent key, absent researcher: the task records "no model configured" rather than
// leaving a person watching a spinner that will never resolve.
function resolveBusinessResearcher(env: WorkerEnv): BusinessResearcherPort | null {
  const coldstart = resolveColdstartModel(env);
  if (coldstart === null) {
    return null;
  }

  return createBusinessResearcher({
    model: coldstart.model,
    resolvedModelId: coldstart.resolvedModelId,
    bindingSchema: bindingReadOutputSchema,
    shapingSchema: shapingReadOutputSchema,
    audienceSchema: audienceReductionOutputSchema,
  });
}

function resolveNarrator(env: WorkerEnv): ConfiguredNarrator | null {
  const coldstart = resolveColdstartModel(env);
  if (coldstart === null) {
    return null;
  }

  return {
    port: createRecordingNarrator({
      model: coldstart.model,
      resolvedModelId: coldstart.resolvedModelId,
      outputSchema: narrationOutputSchema,
    }),
    resolvedModelId: coldstart.resolvedModelId,
  };
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

  return { summariser: resolveSummariser(env), causeExplainer: resolveCauseExplainer(env), lanes };
}

function analysisDepsFor(
  composed: AnalysisComposition,
  analysisLogger: AnalysisLogger,
): AnalysisTickDeps {
  const { db } = resolveResources();

  return {
    lanes: composed.lanes,

    summariser: composed.summariser,
    causeExplainer: composed.causeExplainer,

    findingsFor: (ctx) => createFindingsRepo(db, ctx),
    payloadsFor: (ctx) => createFindingPayloadsRepo(db, ctx),
    runsFor: (ctx) => createAnalysisRunsRepo(db, ctx),
    ledgerFor: (ctx) => createSignatureLedgerService(db, ctx),
    causeClaimsFor: (ctx) => createCauseClaimsRepo(db, ctx),
    divergencePointsFor: (ctx) => createDivergencePointsRepo(db, ctx),
    recordingSummariesFor: (ctx) => createRecordingSummariesRepo(db, ctx),

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

const reduceAudienceHandler: NonNullable<TaskList[string]> = async (payload, helpers) => {
  const { db, env } = resolveResources();
  const taskLogger = taskLoggerFor(logger);

  const parsed = audienceReducePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    helpers.logger.error("reduce audience: a job arrived with a payload this task cannot read");
    return;
  }

  const project = await findAnalysableProject(db, parsed.data.projectId);
  if (project === null) {
    taskLogger.error(
      `reduce audience: project ${parsed.data.projectId} has no readable organization, so nothing was reduced`,
    );
    return;
  }

  await runReduceAudience(
    {
      growthFor: (ctx) => createGrowthContextRepo(db, ctx),
      researcher: resolveBusinessResearcher(env),
      logger: taskLogger,
    },
    {
      ctx: systemContextFor(SYSTEM_ACTOR.REDUCE_AUDIENCE, project),
      projectId: parsed.data.projectId,
      statement: parsed.data.statement,
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

  [TASK.REPLAY_NARRATION_TICK]: async (_payload, helpers) => {
    const { db, env } = resolveResources();
    const taskLogger = taskLoggerFor(logger);

    await runReplayNarrationTick({
      lanes: createReplayLaneSource({ db, logger: taskLogger }),
      sourceFor: makeReplaySourceFor(db, resolveCredentialKey(env), globalThis.fetch),
      summariesFor: (ctx) => createRecordingSummariesRepo(db, ctx),
      contextFor: (lane) => systemContextFor(SYSTEM_ACTOR.REPLAY_NARRATION_TICK, lane),
      narrator: resolveNarrator(env),
      perProjectCap: RECORDINGS_NARRATED_PER_LANE,
      perTickCap: RECORDINGS_PULLED_PER_TICK_CEILING,
      listPages: 2,
      logger: helpers.logger,
    });
  },

  [TASK.BUSINESS_RESEARCH]: businessResearchHandler,

  [TASK.REDUCE_AUDIENCE]: reduceAudienceHandler,

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
  `*/10 * * * * ${TASK.REPLAY_NARRATION_TICK}`,
].join("\n");
