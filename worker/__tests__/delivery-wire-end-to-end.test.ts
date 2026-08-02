import { afterEach, beforeEach, expect, test } from "bun:test";

import { createDeliveriesRepo, schema } from "@growthmind/db";
import { SYSTEM_ACTOR_ROLE } from "@growthmind/db/system";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import { tenantContextSchema, type TenantContext } from "@growthmind/shared";

import {
  assertUnderConstruction,
  loadUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  DELIVERY_ACTOR_ID,
  type DeliveryLaneSource,
  type DeliveryLogger,
  type DeliveryTickSummary,
} from "../src/tasks/delivery-tick";
import {
  createRecordingDeliveryLogger,
  createRecordingPoster,
  seedFinding,
  seedSlackConnection,
  tableUnderConstruction,
  type MirrorDeliveryTickDeps,
  type RecordingPoster,
} from "./helpers/onboarding-delivery-fixtures";
import { seedPollableWorkspace, type SeededWorkspace } from "./helpers/wire-fixtures";

const PREFIX = "o008e-";
const NOW = new Date("2026-08-01T12:00:00.000Z");

const OWNER_SOURCE = "ADD Wave 4 (worker/src/delivery-lane-source.ts, AD-15)";
const OWNER_TICK = "ADD Wave 4 (worker/src/tasks/delivery-tick.ts — posterFor, AD-13)";
const OWNER_SCHEMA = "ADD Wave 2 (packages/db/src/schema/slack-connections.ts, AD-8)";

const TICK_SOURCE_PATH = "worker/src/tasks/delivery-tick.ts";
const LANE_SOURCE_PATH = "worker/src/delivery-lane-source.ts";

const CHANNEL_A = "C0AAAAAAAAA";
const CHANNEL_B = "C0BBBBBBBBB";

type MirrorCreateDeliveryLaneSource = (deps: {
  readonly db: TestDb;
  readonly logger: DeliveryLogger;
}) => DeliveryLaneSource;

const loadCreateDeliveryLaneSource = (): Promise<MirrorCreateDeliveryLaneSource> =>
  loadUnderConstruction<MirrorCreateDeliveryLaneSource>({
    modulePath: underConstructionSpecifier("worker/src/delivery-lane-source"),
    exportName: "createDeliveryLaneSource",
    ownedBy: OWNER_SOURCE,
  });

type MirrorRunDeliveryTick = (deps: MirrorDeliveryTickDeps) => Promise<DeliveryTickSummary>;

const loadRunDeliveryTick = (): Promise<MirrorRunDeliveryTick> =>
  loadUnderConstruction<MirrorRunDeliveryTick>({
    modulePath: underConstructionSpecifier("worker/src/tasks/delivery-tick"),
    exportName: "runDeliveryTick",
    ownedBy: OWNER_TICK,
  });

function requirePosterForContract(): void {
  const source = readSourceUnderConstruction({
    repoRelativePath: TICK_SOURCE_PATH,
    ownedBy: OWNER_TICK,
  });

  assertUnderConstruction(source.includes("posterFor"), {
    contract:
      "DeliveryTickDeps.posterFor: (ctx: TenantContext) => Promise<DeliveryPoster | null> (AD-13)",
    ownedBy: OWNER_TICK,
  });
}

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

function contextFor(organizationId: string, organizationName: string): TenantContext {
  return tenantContextSchema.parse({
    userId: DELIVERY_ACTOR_ID,
    organizationId,
    organizationName,
    role: SYSTEM_ACTOR_ROLE,
  });
}

interface SeededOrg {
  workspace: SeededWorkspace;
  ctx: TenantContext;
  channelId: string;
  findingId: string;
}

async function seedOrgWithFinding(input: {
  label: string;
  channelId: string;
  context?: readonly string[];
}): Promise<SeededOrg> {
  const workspace = await seedPollableWorkspace(db, {
    prefix: `${PREFIX}${input.label}-`,
    now: NOW,
  });
  const ctx = contextFor(workspace.organizationId, workspace.organizationName);

  await seedSlackConnection(
    db,
    { organizationId: workspace.organizationId, channelId: input.channelId },
    OWNER_SCHEMA,
  );

  const finding = await seedFinding(db, ctx, {
    projectId: workspace.projectId,
    surface: `/checkout/${input.label}`,
    headline: `The ${input.label} step is losing sessions`,
    ...(input.context === undefined ? {} : { context: input.context }),
    at: NOW,
  });

  return { workspace, ctx, channelId: input.channelId, findingId: finding.findingId };
}

async function runTheTick(poster: RecordingPoster): Promise<{
  summary: DeliveryTickSummary;
  logger: ReturnType<typeof createRecordingDeliveryLogger>;
}> {
  const runDeliveryTick = await loadRunDeliveryTick();
  const createDeliveryLaneSource = await loadCreateDeliveryLaneSource();
  requirePosterForContract();

  const logger = createRecordingDeliveryLogger();

  const summary = await runDeliveryTick({
    lanes: createDeliveryLaneSource({ db, logger }),
    deliveriesFor: (ctx) => createDeliveriesRepo(db, ctx),

    posterFor: () => Promise.resolve(poster),
    now: () => NOW,
    logger,
  });

  return { summary, logger };
}

async function deliveryRows() {
  return db.select().from(schema.deliveries);
}

async function findingRows() {
  return db.select().from(schema.findings);
}

test("a persisted finding reaches the channel through runDeliveryTick's real entry point", async () => {
  const org = await seedOrgWithFinding({ label: "payment", channelId: CHANNEL_A });
  const poster = createRecordingPoster();

  const { summary } = await runTheTick(poster);

  expect(summary.posted).toBe(1);
  expect(poster.posted).toHaveLength(1);

  expect(poster.posted[0]?.channelId).toBe(CHANNEL_A);
  expect((poster.posted[0]?.fallbackText ?? "").length).toBeGreaterThan(0);

  const deliveries = await deliveryRows();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.status).toBe("posted");
  expect(deliveries[0]?.findingId).toBe(org.findingId);
  expect(deliveries[0]?.organizationId).toBe(org.workspace.organizationId);
  expect(deliveries[0]?.channelId).toBe(CHANNEL_A);
});

test("the same tick run twice posts once", async () => {
  await seedOrgWithFinding({ label: "payment", channelId: CHANNEL_A });
  const poster = createRecordingPoster();

  await runTheTick(poster);
  await runTheTick(poster);

  expect(poster.posted).toHaveLength(1);

  const deliveries = await deliveryRows();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.status).toBe("posted");
});

test("a poster failure leaves the finding row intact and the delivery row terminal", async () => {
  const org = await seedOrgWithFinding({ label: "payment", channelId: CHANNEL_A });
  const poster = createRecordingPoster({
    fails: { code: "channel_unavailable", message: "The channel is gone." },
  });

  const { summary } = await runTheTick(poster);

  expect(summary.posted).toBe(0);
  expect(summary.failed).toBe(1);

  const findings = await findingRows();
  expect(findings).toHaveLength(1);
  expect(findings[0]?.id).toBe(org.findingId);

  const deliveries = await deliveryRows();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.status).toBe("failed");
  expect(deliveries[0]?.failureReason).toBe("The channel is gone.");
});

test("the channel id comes from the stored connection row and no caller can supply one", async () => {
  const createDeliveryLaneSource = await loadCreateDeliveryLaneSource();

  const laneSourceSource = readSourceUnderConstruction({
    repoRelativePath: LANE_SOURCE_PATH,
    ownedBy: OWNER_SOURCE,
  });
  expect(laneSourceSource).toContain("channelId");

  expect(laneSourceSource).toMatch(/channel_?[Ii]d/);

  const org = await seedOrgWithFinding({ label: "payment", channelId: CHANNEL_A });

  const logger = createRecordingDeliveryLogger();
  const lanes = createDeliveryLaneSource({ db, logger });
  const [lane] = await lanes.listDueLanes(NOW);

  expect(lanes.listDueLanes.length).toBe(1);
  expect(lane?.channelId).toBe(CHANNEL_A);
  expect(lane?.organizationId).toBe(org.workspace.organizationId);

  await db.delete(tableUnderConstruction("slackConnections", OWNER_SCHEMA));
  await seedSlackConnection(
    db,
    { organizationId: org.workspace.organizationId, channelId: CHANNEL_B },
    OWNER_SCHEMA,
  );

  const [relanded] = await lanes.listDueLanes(NOW);
  expect(relanded?.channelId).toBe(CHANNEL_B);
});

test("a finding in org A never reaches org B's channel", async () => {
  const orgA = await seedOrgWithFinding({ label: "alpha", channelId: CHANNEL_A });
  const orgB = await seedOrgWithFinding({ label: "beta", channelId: CHANNEL_B });

  const poster = createRecordingPoster();
  await runTheTick(poster);

  expect(poster.posted).toHaveLength(2);

  const toA = poster.posted.filter((request) => request.channelId === CHANNEL_A);
  const toB = poster.posted.filter((request) => request.channelId === CHANNEL_B);
  expect(toA).toHaveLength(1);
  expect(toB).toHaveLength(1);

  expect(JSON.stringify(toA[0])).toContain("/checkout/alpha");
  expect(JSON.stringify(toA[0])).not.toContain("/checkout/beta");
  expect(JSON.stringify(toB[0])).toContain("/checkout/beta");
  expect(JSON.stringify(toB[0])).not.toContain("/checkout/alpha");

  const deliveries = await deliveryRows();
  const rowA = deliveries.find((row) => row.organizationId === orgA.workspace.organizationId);
  const rowB = deliveries.find((row) => row.organizationId === orgB.workspace.organizationId);
  expect(rowA?.channelId).toBe(CHANNEL_A);
  expect(rowB?.channelId).toBe(CHANNEL_B);
  expect(rowA?.findingId).toBe(orgA.findingId);
  expect(rowB?.findingId).toBe(orgB.findingId);
});

test("two orgs each receive their own finding in their own channel through one tick", async () => {
  await seedOrgWithFinding({ label: "alpha", channelId: CHANNEL_A });
  await seedOrgWithFinding({ label: "beta", channelId: CHANNEL_B });

  const poster = createRecordingPoster();
  const { summary } = await runTheTick(poster);

  expect(summary.lanesConsidered).toBe(2);
  expect(summary.posted).toBe(2);
  expect(summary.failed).toBe(0);
  expect(summary.lanesErrored).toBe(0);

  expect(new Set(poster.posted.map((request) => request.channelId))).toEqual(
    new Set([CHANNEL_A, CHANNEL_B]),
  );
});

test("a residual-PII block holds the post back and marks the delivery, not the finding", async () => {
  const org = await seedOrgWithFinding({
    label: "payment",
    channelId: CHANNEL_A,
    context: [`Sessions from buyer@${PREFIX}northwind-shop.example left without finishing.`],
  });

  const poster = createRecordingPoster();
  const { summary } = await runTheTick(poster);

  expect(poster.posted).toEqual([]);
  expect(summary.blockedByPii).toBe(1);
  expect(summary.posted).toBe(0);

  const deliveries = await deliveryRows();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.status).toBe("failed");
  expect(deliveries[0]?.findingId).toBe(org.findingId);

  const findings = await findingRows();
  expect(findings).toHaveLength(1);
  expect(findings[0]?.id).toBe(org.findingId);

  expect(deliveries[0]?.failureReason ?? "").not.toContain("buyer@");
  expect((deliveries[0]?.failureReason ?? "").length).toBeGreaterThan(0);
});
