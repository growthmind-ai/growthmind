// Wave 0 mirrors of the O-051 job 2 contracts (ADD D-2/D-3/D-4/D-8). The loaders cast to
// these types, so a Wave 3 signature drift fails at runtime rather than here — the same
// discipline helpers/onboarding-contract.ts already carries.
import {
  credentialAad,
  encryptSecret,
  keyIdOf,
  NOTIFICATION_DISPATCH_TASK,
  NOTIFICATION_RESCUE_TASK,
  notificationDispatchPayloadSchema,
  type CredentialKey,
  type DeliveryPoster,
  type NotificationDispatchPayload,
  type PostFailureCode,
  type PostRequest,
  type PostResult,
  type TenantContext,
} from "@growthmind/shared";

import { eq, sql } from "drizzle-orm";

import {
  assertUnderConstruction,
  loadModuleUnderConstruction,
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { createSlackConnectionsRepo } from "../../src/repositories/slack-connections.repo";
import { notifications } from "../../src/schema/notifications";
import { slackConnections } from "../../src/schema/slack-connections";
import { capturedJobs, type CapturedJob, type TestDb } from "../../src/testing";
import type { SeededOrgWithOwner } from "../../src/testing";

export const HEALTH_OWNER = "O-051 task 3.1 (slack-connections.repo.ts recordHealth, ADD D-3)";

export const RESCUE_TASK_OWNER =
  "O-051 task 3.3 (worker/src/tasks/notification-rescue.ts, ADD D-4)";

export const DIGEST_TASK_OWNER =
  "O-051 task 3.3 (worker/src/tasks/notification-digest.ts, ADD D-8)";

export const DISPATCH_OWNER =
  "O-051 task 3.3 (worker/src/tasks/notification-dispatch.ts, ADD §4.4)";

// ADD D-3, verbatim: both health edges live inside one repository method, and the first
// statement's returned row is the gate.
export interface RecordSlackHealthInput {
  readonly health: "healthy" | "failing";
  readonly reasonCode: PostFailureCode | null;
  readonly reasonMessage: string | null;
  readonly checkedAt: Date;
}

export type SlackHealthTransition = "entered_failing" | "recovered" | "none";

export type RecordSlackHealth = (input: RecordSlackHealthInput) => Promise<SlackHealthTransition>;

export function recordHealthOf(repo: object): RecordSlackHealth {
  const candidate = (repo as { recordHealth?: unknown }).recordHealth;

  assertUnderConstruction(typeof candidate === "function", {
    contract: "SlackConnectionsRepo.recordHealth(input): Promise<SlackHealthTransition>",
    ownedBy: HEALTH_OWNER,
  });

  return (candidate as RecordSlackHealth).bind(repo);
}

export interface MirrorTaskLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const silentLogger: MirrorTaskLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface MirrorNotificationDispatchDeps {
  readonly db: TestDb;
  readonly posterFor: (ctx: TenantContext) => Promise<DeliveryPoster | null>;
  readonly logger: MirrorTaskLogger;
}

export type RunNotificationDispatch = (
  payload: unknown,
  deps: MirrorNotificationDispatchDeps,
) => Promise<void>;

export const loadDispatch = (): Promise<RunNotificationDispatch> =>
  loadUnderConstruction<RunNotificationDispatch>({
    modulePath: underConstructionSpecifier("worker/src/tasks/notification-dispatch"),
    exportName: "runNotificationDispatch",
    ownedBy: DISPATCH_OWNER,
  });

export interface MirrorWorkerDeps {
  readonly db: TestDb;
  readonly now: () => Date;
  readonly logger: MirrorTaskLogger;
}

export type RunNotificationRescue = (payload: unknown, deps: MirrorWorkerDeps) => Promise<void>;

export const loadRescue = (): Promise<RunNotificationRescue> =>
  loadUnderConstruction<RunNotificationRescue>({
    modulePath: underConstructionSpecifier("worker/src/tasks/notification-rescue"),
    exportName: "runNotificationRescue",
    ownedBy: RESCUE_TASK_OWNER,
  });

export type RunNotificationDigest = (deps: MirrorWorkerDeps) => Promise<void>;

export const loadDigest = (): Promise<RunNotificationDigest> =>
  loadUnderConstruction<RunNotificationDigest>({
    modulePath: underConstructionSpecifier("worker/src/tasks/notification-digest"),
    exportName: "runNotificationDigest",
    ownedBy: DIGEST_TASK_OWNER,
  });

export interface RecordingPoster {
  readonly poster: DeliveryPoster;
  readonly posted: PostRequest[];
}

export function loudPoster(): RecordingPoster {
  const posted: PostRequest[] = [];
  return {
    posted,
    poster: {
      post(request: PostRequest): Promise<PostResult> {
        posted.push(request);
        return Promise.resolve({ ok: true, messageRef: `o051-ref-${String(posted.length)}` });
      },
    },
  };
}

export function refusingPoster(code: PostFailureCode): RecordingPoster {
  const posted: PostRequest[] = [];
  return {
    posted,
    poster: {
      post(request: PostRequest): Promise<PostResult> {
        posted.push(request);
        return Promise.resolve({
          ok: false,
          code,
          message: "fixture: the channel refused this post",
        });
      },
    },
  };
}

export function dispatchJobsOf(jobs: readonly CapturedJob[]): readonly CapturedJob[] {
  return jobs.filter((job) => job.task === NOTIFICATION_DISPATCH_TASK);
}

export function dispatchPayloadOf(job: CapturedJob): NotificationDispatchPayload {
  return notificationDispatchPayloadSchema.parse(job.payload);
}

export function rescueJobKeyFor(organizationId: string): string {
  return `${NOTIFICATION_RESCUE_TASK}:${organizationId}`;
}

export function rescueJobsFor(
  jobs: readonly CapturedJob[],
  organizationId: string,
): readonly CapturedJob[] {
  return jobs.filter(
    (job) =>
      job.task === NOTIFICATION_RESCUE_TASK &&
      (job.payload as { organizationId?: string } | null)?.organizationId === organizationId,
  );
}

// Runs every queued dispatch job against one poster. `swallowThrows` is for the retryable
// arm only — D-2 makes a retryable failure THROW after its receipt is committed, and that
// throw is the contract rather than a fault of the drive.
export async function runAllDispatchJobs(
  db: TestDb,
  poster: DeliveryPoster | null,
  options: { readonly swallowThrows?: boolean } = {},
): Promise<void> {
  const run = await loadDispatch();

  for (const job of dispatchJobsOf(await capturedJobs(db))) {
    const attempt = run(job.payload, {
      db,
      posterFor: () => Promise.resolve(poster),
      logger: silentLogger,
    });

    await (options.swallowThrows === true ? attempt.catch(() => undefined) : attempt);
  }
}

// The worker workspace declares no drizzle-orm dependency, so its suites reach the few
// operator-needing reads and writes through these helpers rather than importing the ORM.
export async function slackConnectionRowFor(db: TestDb, organizationId: string) {
  const [row] = await db
    .select()
    .from(slackConnections)
    .where(eq(slackConnections.organizationId, organizationId));

  if (!row) {
    throw new Error(`o051-contracts: organization ${organizationId} holds no Slack connection row`);
  }
  return row;
}

export async function setSlackConnectionFields(
  db: TestDb,
  organizationId: string,
  set: Partial<typeof slackConnections.$inferInsert>,
): Promise<void> {
  await db
    .update(slackConnections)
    .set(set)
    .where(eq(slackConnections.organizationId, organizationId));
}

// Production stamps a summary row on the DB clock, after the worker-clock instant its
// gather ended at; a suite recreates that ordering by restamping, because the test DB's
// own clock sits days from the simulated due day.
export async function setNotificationCreatedAt(
  db: TestDb,
  notificationId: string,
  createdAt: Date,
): Promise<void> {
  await db.update(notifications).set({ createdAt }).where(eq(notifications.id, notificationId));
}

// A fault every recordHealth edge must hit — the column each health write stamps — without
// touching any other table, so a dispatch test can break exactly the health write.
export async function dropSlackHealthCheckedAt(db: TestDb): Promise<void> {
  await db.execute(sql`alter table slack_connections drop column health_checked_at`);
}

export async function restoreSlackHealthCheckedAt(db: TestDb): Promise<void> {
  await db.execute(sql`alter table slack_connections add column health_checked_at timestamptz`);
}

const FIXTURE_CREDENTIAL_KEY: CredentialKey = {
  bytes: Uint8Array.from({ length: 32 }, (_, index) => index),
};

// `channelId: null` is the OAuth half-connected state: a workspace with no delivery
// target yet, which is what `attachChannel` later fills.
export async function connectSlackChannel(
  db: TestDb,
  org: SeededOrgWithOwner,
  channelId: string | null,
): Promise<{ readonly connectionId: string }> {
  const row = await createSlackConnectionsRepo(db, org.ctx).insertActive({
    channelId,
    workspaceName: "O-051 fixture workspace",
    credentialCiphertext: encryptSecret(
      "xoxb-fixture-only-never-a-real-token",
      FIXTURE_CREDENTIAL_KEY,
      credentialAad(org.organizationId, "slack"),
    ),
    credentialKeyId: keyIdOf(FIXTURE_CREDENTIAL_KEY),
    connectedAt: new Date("2026-08-01T09:00:00.000Z"),
  });

  return { connectionId: row.id };
}

// The poll harness the drained-cursor drive borrows from worker/__tests__ — loaded by file
// URL so packages/db keeps no static edge onto the worker workspace.
export interface WirePollFixtures {
  testServerEnv(): unknown;
  encryptTestCredential(params: { env: unknown; organizationId: string; projectId: string }): {
    ciphertext: string;
    keyId: string;
  };
  seedProjectWithConnection(
    db: TestDb,
    params: {
      prefix: string;
      now: Date;
      organizationId: string;
      sourceProjectId?: string;
      watermarkAt?: Date | null;
      backfillBefore?: string | null;
      credentialFor?: (ids: { organizationId: string; projectId: string }) => {
        ciphertext: string;
        keyId: string;
      };
    },
  ): Promise<{ projectId: string; connectionId: string; sourceProjectId: string; host: string }>;
  createFakePostHog(options: {
    events?: (request: {
      url: URL;
      after: string | null;
      before: string | null;
      callIndex: number;
    }) => { results: unknown[]; next: string | null };
  }): { fetch: unknown; eventsCalls(): unknown[] };
  fakeEvent(params: {
    id?: string;
    distinctId: string | null;
    occurredAt: Date;
    sessionId?: string | null;
    pathname?: string | null;
  }): Record<string, unknown>;
  createFakeClock(start: Date): {
    now: () => Date;
    sleep: (ms: number) => Promise<void>;
    advance: (ms: number) => void;
  };
  createPollDeps(params: { db: TestDb; fetch: unknown; clock: unknown }): unknown;
  nextCursorUrl(params: { sourceProjectId: string; before: Date }): string;
}

export const loadWirePollFixtures = async (): Promise<WirePollFixtures> =>
  (await loadModuleUnderConstruction({
    modulePath: underConstructionSpecifier("worker/__tests__/helpers/wire-fixtures"),
    ownedBy: "already shipped (worker/__tests__/helpers/wire-fixtures.ts)",
  })) as unknown as WirePollFixtures;

export type RunSessionSourcePoll = (deps: unknown) => Promise<unknown>;

export const loadSessionSourcePoll = (): Promise<RunSessionSourcePoll> =>
  loadUnderConstruction<RunSessionSourcePoll>({
    modulePath: underConstructionSpecifier("worker/src/tasks/session-source-poll"),
    exportName: "runSessionSourcePoll",
    ownedBy: "already shipped (worker/src/tasks/session-source-poll.ts)",
  });

// The B-005 drained shape: a stale backfill cursor, nothing new forward, an exhausted
// backward walk — the one pass whose cursor clear is ADD §4.2's emit gate.
export async function drainBackfillCursor(
  db: TestDb,
  org: SeededOrgWithOwner,
  now: Date,
): Promise<{ readonly connectionId: string }> {
  const fixtures = await loadWirePollFixtures();
  const runPoll = await loadSessionSourcePoll();

  const env = fixtures.testServerEnv();
  const sourceProjectId = `o051-drained-${org.organizationId.slice(0, 8)}`;

  const seeded = await fixtures.seedProjectWithConnection(db, {
    prefix: "o051-",
    now,
    organizationId: org.organizationId,
    sourceProjectId,
    watermarkAt: now,
    backfillBefore: fixtures.nextCursorUrl({
      sourceProjectId,
      before: new Date(now.getTime() - 20 * 60_000),
    }),
    credentialFor: (ids) => fixtures.encryptTestCredential({ env, ...ids }),
  });

  const posthog = fixtures.createFakePostHog({ events: () => ({ results: [], next: null }) });
  const clock = fixtures.createFakeClock(now);

  await runPoll(fixtures.createPollDeps({ db, fetch: posthog.fetch, clock }));

  return { connectionId: seeded.connectionId };
}
