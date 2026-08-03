import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { schema } from "@growthmind/db";
import type { PersistFindingInput } from "@growthmind/db";
import { createAnalysisRunsRepo, createFindingsRepo } from "@growthmind/db";
import type { TestDb } from "@growthmind/db/testing";
import {
  credentialAad,
  encryptSecret,
  keyIdOf,
  parseWorkerEnv,
  type CredentialKey,
} from "@growthmind/shared";
import type {
  DeliveryPoster,
  PostFailureCode,
  PostRequest,
  PostResult,
  WorkerEnv,
  TenantContext,
} from "@growthmind/shared";

import { assertUnderConstruction } from "../../../packages/shared/__tests__/onboarding/module-under-construction";
import type {
  DeliveriesRepoFor,
  DeliveryLaneSource,
  DeliveryLogger,
} from "../../src/tasks/delivery-tick";

export type MirrorDeliveryPosterFor = (ctx: TenantContext) => Promise<DeliveryPoster | null>;

export interface MirrorDeliveryTickDeps {
  lanes: DeliveryLaneSource;
  deliveriesFor: DeliveriesRepoFor;
  posterFor: MirrorDeliveryPosterFor;
  now: () => Date;
  logger: DeliveryLogger;
}

export interface MirrorDeliveryComposition {
  lanes: DeliveryLaneSource;
  posterFor: MirrorDeliveryPosterFor;
}

export type MirrorResolveDeliveryComposition = () => Promise<MirrorDeliveryComposition | null>;

export type MirrorMakePosterFor = (db: unknown, env: unknown) => MirrorDeliveryPosterFor;

export type AnyTable = Parameters<TestDb["insert"]>[0];

export function tableUnderConstruction(name: string, ownedBy: string): AnyTable {
  const table = (schema as unknown as Record<string, unknown>)[name];

  assertUnderConstruction(table !== undefined, {
    contract: `the \`${name}\` table on the @growthmind/db schema barrel`,
    ownedBy,
  });

  return table as AnyTable;
}

export const SLACK_TEST_KEY: CredentialKey = {
  bytes: Uint8Array.from({ length: 32 }, (_, index) => index),
};

export const FAKE_BOT_TOKEN = "xoxb-fixture-only-never-a-real-token";

export function slackTestServerEnv(): WorkerEnv {
  return parseWorkerEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://fake:fake@localhost:5432/fake",
    BETTER_AUTH_SECRET: "o008-fixture-only-secret-not-a-real-one",
    GROWTHMIND_ENCRYPTION_KEY: Buffer.from(SLACK_TEST_KEY.bytes).toString("base64"),
  });
}

export function slackEnvelopeFor(organizationId: string): { ciphertext: string; keyId: string } {
  return {
    ciphertext: encryptSecret(
      FAKE_BOT_TOKEN,
      SLACK_TEST_KEY,
      credentialAad(organizationId, "slack"),
    ),
    keyId: keyIdOf(SLACK_TEST_KEY),
  };
}

export interface SeedSlackConnectionParams {
  organizationId: string;
  /** `null` is a state, not an omission (AD-4): active workspace, no channel chosen. */
  channelId: string | null;
  isActive?: boolean;
  connectedAt?: Date;
}

export async function seedSlackConnection(
  db: TestDb,
  params: SeedSlackConnectionParams,
  ownedBy: string,
): Promise<{ id: string; channelId: string | null }> {
  const envelope = slackEnvelopeFor(params.organizationId);
  const id = randomUUID();

  await db.insert(tableUnderConstruction("slackConnections", ownedBy)).values({
    id,
    organizationId: params.organizationId,
    channelId: params.channelId,
    credentialCiphertext: envelope.ciphertext,
    credentialKeyId: envelope.keyId,
    isActive: params.isActive ?? true,
    connectedAt: params.connectedAt ?? new Date(),
  } as never);

  return { id, channelId: params.channelId };
}

export interface SeedFindingParams {
  projectId: string;
  surface?: string;
  headline?: string;
  context?: readonly string[];
  signature?: string;
  at: Date;
}

const SEEDED_KEPT_SESSIONS = 28;

function seededCounts(at: Date): PersistFindingInput["counts"] {
  const timeframe = { start: new Date(at.getTime() - 7 * 24 * 60 * 60 * 1_000), end: at };
  const basis = { totalInWindow: SEEDED_KEPT_SESSIONS, kept: SEEDED_KEPT_SESSIONS, setAside: [] };

  return [
    {
      numerator: SEEDED_KEPT_SESSIONS,
      denominator: SEEDED_KEPT_SESSIONS,
      unit: "sessions",
      timeframe,
      basis,
    },
    { numerator: 3, denominator: SEEDED_KEPT_SESSIONS, unit: "sessions", timeframe, basis },
  ];
}

export async function seedFinding(
  db: TestDb,
  ctx: TenantContext,
  params: SeedFindingParams,
): Promise<{ findingId: string; signature: string }> {
  const runs = createAnalysisRunsRepo(db, ctx);
  const findings = createFindingsRepo(db, ctx);

  const opened = await runs.open({ projectId: params.projectId, tickAt: params.at });
  if (!opened.opened) {
    throw new Error(`seedFinding: a run is already open for project ${params.projectId}`);
  }

  const signature =
    params.signature ?? randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64);
  const surface = params.surface ?? "/checkout/payment";

  const input: PersistFindingInput = {
    projectId: params.projectId,
    runId: opened.run.id,
    signature,
    signatureVersion: 1,

    summarySource: "model_rendered",
    headline: params.headline ?? "The payment step is losing sessions",
    context: params.context ?? ["Sessions reached the payment step and left without finishing."],
    finalClass: "confusing",
    surface,
    surfaceNormalisationVersion: 1,
    counts: seededCounts(params.at),
    confidenceBasis: "threshold_met",
    windowStart: new Date(params.at.getTime() - 7 * 24 * 60 * 60 * 1_000),
    windowEnd: params.at,
    evidenceShape: `{"detector":"funnel_dropoff","surface":"${surface}","v":1}`,
    evidenceShapeVersion: 1,

    resolvedModelId: "fixture-model-v1",
    tokensIn: null,
    tokensOut: null,
  };

  const row = await findings.persist(input);

  await runs.close({
    runId: opened.run.id,
    projectId: params.projectId,
    status: "completed",
    outcome: "produced_findings",
    stopReason: "ran_to_completion",
    finishedAt: params.at,
    modelCallsAttempted: 0,
    candidatesUnrenderable: 0,
    candidatesRefused: 0,
    resolvedModelId: null,
    tokensIn: null,
    tokensOut: null,
  } as never);

  return { findingId: row.id, signature };
}

export interface RecordingPoster extends DeliveryPoster {
  readonly posted: PostRequest[];
}

export function createRecordingPoster(
  options: {
    readonly fails?: { readonly code: PostFailureCode; readonly message: string };
    readonly throws?: boolean;
  } = {},
): RecordingPoster {
  const posted: PostRequest[] = [];
  let nextRef = 1;

  return {
    posted,
    post(request: PostRequest): Promise<PostResult> {
      posted.push(request);

      if (options.throws === true) {
        return Promise.reject(new Error("o008d-poster-threw-against-its-contract"));
      }
      if (options.fails !== undefined) {
        return Promise.resolve({
          ok: false,
          code: options.fails.code,
          message: options.fails.message,
        });
      }

      const messageRef = `o008d-ts-${String(nextRef)}`;
      nextRef += 1;
      return Promise.resolve({ ok: true, messageRef });
    },
  };
}

export interface RecordingDeliveryLogger extends DeliveryLogger {
  readonly infos: string[];
  readonly errors: string[];

  lines(): string[];
}

export function createRecordingDeliveryLogger(): RecordingDeliveryLogger {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    errors,
    lines: () => [...infos, ...errors],
    info: (message: string) => {
      infos.push(message);
    },
    error: (message: string) => {
      errors.push(message);
    },
  };
}

export interface RecordingPosterFor {
  posterFor: MirrorDeliveryPosterFor;

  readonly calls: readonly unknown[][];

  posterOf(organizationId: string): RecordingPoster | undefined;
}

export function createRecordingPosterFor(options: {
  readonly connectedOrgIds: readonly string[];
  readonly posterOptions?: Parameters<typeof createRecordingPoster>[0];
}): RecordingPosterFor {
  const calls: unknown[][] = [];
  const posters = new Map<string, RecordingPoster>();

  return {
    calls,
    posterOf: (organizationId) => posters.get(organizationId),
    posterFor: (...args: unknown[]) => {
      calls.push(args);
      const ctx = args[0] as TenantContext | undefined;
      const organizationId = ctx?.organizationId ?? "";

      if (!options.connectedOrgIds.includes(organizationId)) {
        return Promise.resolve(null);
      }

      let poster = posters.get(organizationId);
      if (poster === undefined) {
        poster = createRecordingPoster(options.posterOptions);
        posters.set(organizationId, poster);
      }
      return Promise.resolve(poster);
    },
  };
}
