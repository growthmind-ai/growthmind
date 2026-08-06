import { afterEach, beforeEach, expect, test } from "bun:test";

import { createDeliveriesRepo } from "@growthmind/db";
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
  type DeliveryLane,
  type DeliveryTickSummary,
} from "../src/tasks/delivery-tick";
import {
  createRecordingDeliveryLogger,
  createRecordingPosterFor,
  seedSlackConnection,
  slackTestServerEnv,
  type MirrorDeliveryTickDeps,
  type MirrorMakePosterFor,
} from "./helpers/onboarding-delivery-fixtures";
import { seedPollableWorkspace } from "./helpers/wire-fixtures";

const PREFIX = "o008c-";
const NOW = new Date("2026-08-01T12:00:00.000Z");

const OWNER_COMPOSITION = "ADD Wave 5 (worker/src/index.ts — resolveDeliveryComposition, AD-14)";
const OWNER_TICK = "ADD Wave 4 (worker/src/tasks/delivery-tick.ts — posterFor, AD-13)";
const OWNER_SCHEMA = "ADD Wave 2 (packages/db/src/schema/slack-connections.ts, AD-8)";

const INDEX_SOURCE_PATH = "worker/src/index.ts";
const TICK_SOURCE_PATH = "worker/src/tasks/delivery-tick.ts";

const GRACEFUL_ABSENCE_LINE =
  "no delivery channel is connected on this installation, so there is nothing to post";

type MirrorRunDeliveryTick = (deps: MirrorDeliveryTickDeps) => Promise<DeliveryTickSummary>;

const loadRunDeliveryTick = (): Promise<MirrorRunDeliveryTick> =>
  loadUnderConstruction<MirrorRunDeliveryTick>({
    modulePath: underConstructionSpecifier("worker/src/tasks/delivery-tick"),
    exportName: "runDeliveryTick",
    ownedBy: OWNER_TICK,
  });

const loadMakePosterFor = (): Promise<MirrorMakePosterFor> =>
  loadUnderConstruction<MirrorMakePosterFor>({
    modulePath: underConstructionSpecifier("worker/src/index"),
    exportName: "makePosterFor",
    ownedBy: OWNER_COMPOSITION,
  });

function isExistenceGated(source: string): boolean {
  return source.includes("existsAnyActiveSlackConnection");
}

function resolvesBothHalves(source: string): boolean {
  return (
    source.includes("createDeliveryLaneSource") &&
    source.includes("posterFor") &&
    !/\bposter:\s*composed\.poster\b/.test(source)
  );
}

const PLANTED_UNGATED_COMPOSITION = `
  async function resolveDeliveryComposition() {
    const { db, env } = resolveResources();
    return { lanes: createDeliveryLaneSource({ db, logger }), posterFor: makePosterFor(db, env) };
  }
`;

const PLANTED_HALF_COMPOSITION = `
  async function resolveDeliveryComposition() {
    if (!(await existsAnyActiveSlackConnection(db))) return null;
    return { lanes: createDeliveryLaneSource({ db, logger }) };
  }
  await runDeliveryTick({ lanes: composed.lanes, poster: composed.poster });
`;

const CLEAN_COMPOSITION = `
  async function resolveDeliveryComposition() {
    const { db, env } = resolveResources();
    if (!(await existsAnyActiveSlackConnection(db))) {
      return null;
    }
    return { lanes: createDeliveryLaneSource({ db, logger }), posterFor: makePosterFor(db, env) };
  }
  helpers.logger.info(
    "delivery tick: ${GRACEFUL_ABSENCE_LINE}",
  );
`;

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

function laneFor(input: {
  organizationId: string;
  organizationName: string;
  projectId: string;
  channelId: string;
}): DeliveryLane {
  return {
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    projectId: input.projectId,
    channelId: input.channelId,
    deliveredThisWeek: 0,

    candidates: [],
  };
}

test("an installation with no slack connection still resolves null and logs graceful absence", () => {
  expect(isExistenceGated(PLANTED_UNGATED_COMPOSITION)).toBe(false);
  expect(isExistenceGated(CLEAN_COMPOSITION)).toBe(true);
  expect(CLEAN_COMPOSITION).toContain(GRACEFUL_ABSENCE_LINE);
  expect(PLANTED_UNGATED_COMPOSITION).not.toContain(GRACEFUL_ABSENCE_LINE);

  const source = readSourceUnderConstruction({
    repoRelativePath: INDEX_SOURCE_PATH,
    ownedBy: OWNER_COMPOSITION,
  });

  expect(source).toContain(GRACEFUL_ABSENCE_LINE);

  assertUnderConstruction(isExistenceGated(source), {
    contract:
      "resolveDeliveryComposition gated on existsAnyActiveSlackConnection(db), returning null " +
      "when no connection exists (AD-14, AC-O12 second half)",
    ownedBy: OWNER_COMPOSITION,
  });

  expect(source).toMatch(/async function resolveDeliveryComposition/);
});

test("an installation with a slack connection resolves a poster factory and a lane source", () => {
  expect(resolvesBothHalves(PLANTED_HALF_COMPOSITION)).toBe(false);
  expect(resolvesBothHalves(CLEAN_COMPOSITION)).toBe(true);

  const source = readSourceUnderConstruction({
    repoRelativePath: INDEX_SOURCE_PATH,
    ownedBy: OWNER_COMPOSITION,
  });

  assertUnderConstruction(resolvesBothHalves(source), {
    contract:
      "resolveDeliveryComposition returning BOTH halves — { lanes: createDeliveryLaneSource(...), " +
      "posterFor: makePosterFor(db, env) } (AD-14, AC-O12 first half)",
    ownedBy: OWNER_COMPOSITION,
  });

  expect(source).toContain("posterFor");
  expect(source).not.toMatch(/\bposter:\s*composed\.poster\b/);
});

function requirePosterForContract(): void {
  const tickSource = readSourceUnderConstruction({
    repoRelativePath: TICK_SOURCE_PATH,
    ownedBy: OWNER_TICK,
  });

  assertUnderConstruction(tickSource.includes("posterFor"), {
    contract:
      "DeliveryTickDeps.posterFor: (ctx: TenantContext) => Promise<DeliveryPoster | null>, " +
      "resolved once per lane BEFORE the claim (AD-13)",
    ownedBy: OWNER_TICK,
  });
}

test("posterFor resolves a poster from the tenant context, never from the message", async () => {
  const runDeliveryTick = await loadRunDeliveryTick();
  requirePosterForContract();

  const organizationId = "o008c-org-ctx";
  const posterFor = createRecordingPosterFor({ connectedOrgIds: [organizationId] });
  const logger = createRecordingDeliveryLogger();

  await runDeliveryTick({
    lanes: {
      listDueLanes: () =>
        Promise.resolve([
          laneFor({
            organizationId,
            organizationName: "Acme",
            projectId: "o008c-project",
            channelId: "C0AAAAAAAAA",
          }),
        ]),
    },
    deliveriesFor: (ctx) => createDeliveriesRepo(db, ctx),
    posterFor: posterFor.posterFor,
    now: () => NOW,
    logger,
  });

  expect(posterFor.calls).toHaveLength(1);
  expect(posterFor.calls[0]).toHaveLength(1);

  const [received] = posterFor.calls[0] as [TenantContext];

  expect(() => tenantContextSchema.parse(received)).not.toThrow();
  expect(received.organizationId).toBe(organizationId);

  expect(JSON.stringify(received)).not.toContain("channelId");
  expect(JSON.stringify(received)).not.toContain("C0AAAAAAAAA");
});

test("posterFor returns null for an org whose connection was deactivated", async () => {
  const makePosterFor = await loadMakePosterFor();

  const workspace = await seedPollableWorkspace(db, { prefix: PREFIX, now: NOW });
  const ctx = contextFor(workspace.organizationId, workspace.organizationName);

  await seedSlackConnection(
    db,
    { organizationId: workspace.organizationId, channelId: "C0LIVEAAAAA" },
    OWNER_SCHEMA,
  );

  const posterFor = makePosterFor(db, slackTestServerEnv());

  expect(await posterFor(ctx)).not.toBeNull();

  await db.delete(await activeSlackConnectionsTable());

  expect(await posterFor(ctx)).toBeNull();
});

async function activeSlackConnectionsTable() {
  const { tableUnderConstruction } = await import("./helpers/onboarding-delivery-fixtures");
  return tableUnderConstruction("slackConnections", OWNER_SCHEMA);
}

test("a lane whose poster resolves null is skipped, not failed", async () => {
  const runDeliveryTick = await loadRunDeliveryTick();
  requirePosterForContract();

  const connected = "o008c-org-connected";
  const disconnected = "o008c-org-disconnected";

  const posterFor = createRecordingPosterFor({ connectedOrgIds: [connected] });
  const logger = createRecordingDeliveryLogger();

  const summary = await runDeliveryTick({
    lanes: {
      listDueLanes: () =>
        Promise.resolve([
          laneFor({
            organizationId: disconnected,
            organizationName: "Gone",
            projectId: "o008c-project-gone",
            channelId: "C0GONEAAAAA",
          }),
          laneFor({
            organizationId: connected,
            organizationName: "Acme",
            projectId: "o008c-project-live",
            channelId: "C0LIVEAAAAA",
          }),
        ]),
    },
    deliveriesFor: (ctx) => createDeliveriesRepo(db, ctx),
    posterFor: posterFor.posterFor,
    now: () => NOW,
    logger,
  });

  expect(summary.lanesConsidered).toBe(2);

  expect(summary.lanesErrored).toBe(0);
  expect(summary.failed).toBe(0);

  expect(posterFor.calls).toHaveLength(2);

  expect(logger.lines().some((line) => line.includes(disconnected))).toBe(true);
});
