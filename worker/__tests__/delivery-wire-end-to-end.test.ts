// The delivery wire end to end — real entry point, real database, real lane source,
// real SQL — faked at exactly one seam: the poster, the only effect that leaves the
// process. A fake anywhere else and this file proves nothing.
import { afterEach, beforeEach, expect, test } from "bun:test";

import { DELIVERY_CLAIM_TTL_MS } from "@growthmind/core";
import { createDeliveriesRepo, schema, signatureHex } from "@growthmind/db";
import { SYSTEM_ACTOR_ROLE } from "@growthmind/db/system";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import {
  deliveryFailureSentence,
  tenantContextSchema,
  type TenantContext,
} from "@growthmind/shared";

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
  /** `null` is the AD-4 half-connected row — see `SeedSlackConnectionParams`. */
  channelId: string | null;
  findingId: string;
}

async function seedOrgWithFinding(input: {
  label: string;
  channelId: string | null;
  context?: readonly string[];
  surface?: string;
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
    surface: input.surface ?? `/checkout/${input.label}`,
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

// A `TestDb` that delegates every call and counts reads of the `deliveries` table.
// It wraps the db rather than faking a `DeliveriesRepo` because the lane source builds
// its own repo from the handle it is given — the db is the only seam it has — and it
// delegates rather than stubs so "zero lanes" stays a statement about real SQL. The
// table is matched by reference: `worker` declares no `drizzle-orm` of its own.
interface LedgerWatch {
  readonly db: TestDb;
  reads(): number;
}

// Module scope, not a closure — the lint rule exists for helpers recreated on every
// property read. A `Proxy` `get` trap hands back an unbound function, and a method
// that lost `this` would stop being a real database.
function bindIfCallable(owner: object, value: unknown): unknown {
  return typeof value === "function"
    ? (value as (...args: unknown[]) => unknown).bind(owner)
    : value;
}

function watchLedgerReads(real: TestDb): LedgerWatch {
  let reads = 0;

  const watched = new Proxy(real as object, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (property !== "select" || typeof value !== "function") {
        return bindIfCallable(target, value);
      }

      return (...args: unknown[]): unknown => {
        const builder = (value as (...a: unknown[]) => unknown).apply(target, args) as object;

        return new Proxy(builder, {
          get(builderTarget, builderProperty) {
            const inner = Reflect.get(builderTarget, builderProperty) as unknown;
            if (builderProperty !== "from" || typeof inner !== "function") {
              return bindIfCallable(builderTarget, inner);
            }

            return (table: unknown): unknown => {
              if (table === schema.deliveries) reads += 1;
              return (inner as (t: unknown) => unknown).call(builderTarget, table);
            };
          },
        });
      };
    },
  }) as TestDb;

  return { db: watched, reads: () => reads };
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

  // The reason is the lane's own sentence, built from `result.code`, not the fake's
  // message echoed back: the closed union is what keeps a vendor body out of the column.
  expect(deliveries[0]?.failureReason).toBe(deliveryFailureSentence("channel_unavailable"));
  expect(deliveries[0]?.failureReason).not.toBe("The channel is gone.");
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

test("an organization with a workspace and no channel yields no lane and no ledger read", async () => {
  const createDeliveryLaneSource = await loadCreateDeliveryLaneSource();

  // Fully furnished in every other respect — project, persisted finding, active
  // connection with a real sealed token — so a green here is about the guard rather
  // than about an org with nothing to send.
  const attached = await seedOrgWithFinding({ label: "attached", channelId: null });

  const logger = createRecordingDeliveryLogger();
  const watch = watchLedgerReads(db);
  const lanes = createDeliveryLaneSource({ db: watch.db, logger });

  expect(await lanes.listDueLanes(NOW)).toEqual([]);

  // AD-4 row 7 as the thing that must not happen: a null channel does not error in
  // `findFor`, it matches no row, so `isSpokenFor` answers false and the tick re-sends
  // the backlog. The compiler carries the real guarantee; this names the invariant so a
  // later refactor that widened either type "to handle the null" still fails here.
  expect(watch.reads()).toBe(0);

  // `info`, not `error`: mid-setup is not a fault, but the silence must be answerable.
  expect(logger.infos.some((line) => line.includes(attached.workspace.organizationId))).toBe(true);
  expect(logger.errors).toEqual([]);

  // The control, through the same lane source and watcher. Without it both assertions
  // above pass against a broken population read, a watcher that counts nothing, or a
  // guard that refuses every organization on the installation.
  const connected = await seedOrgWithFinding({ label: "chosen", channelId: CHANNEL_A });
  const produced = await lanes.listDueLanes(NOW);

  expect(produced.map((lane) => lane.organizationId)).toEqual([connected.workspace.organizationId]);
  expect(produced[0]?.channelId).toBe(CHANNEL_A);
  expect(watch.reads()).toBeGreaterThan(0);
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

// The offender lives in the surface path, not in the persisted text: a dirty-text row no
// longer reaches this lane at all (ADD Decision 6), so the subject here is the residue only
// the composed artifact carries — surface path, labels, block formatting.
const COMPOSED_ONLY_OFFENDER = "/orders-123456789012";

test("a residual-PII block holds the post back and marks the delivery, not the finding", async () => {
  const org = await seedOrgWithFinding({
    label: "payment",
    channelId: CHANNEL_A,
    surface: COMPOSED_ONLY_OFFENDER,
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

  expect(deliveries[0]?.failureReason ?? "").not.toContain(COMPOSED_ONLY_OFFENDER);
  expect((deliveries[0]?.failureReason ?? "").length).toBeGreaterThan(0);
});

// The delivery half of the channel re-point. Moving a chosen channel forks the dedup key
// `(finding, channel)`, so against the new address every earlier finding reads as never
// delivered and the whole backlog posts again. The cutover is what stops that, and it stops
// nothing unless this lane reads it — a stamp nobody consults is the D11 shape.
// `findings.created_at` is a database default, not the seeded `at`, and the gate compares
// against exactly that column — so the cutover has to be built from the persisted row.
async function moveChannelTo(channelId: string, cutoverAt: Date): Promise<void> {
  await db
    .update(tableUnderConstruction("slackConnections", OWNER_SCHEMA))
    .set({ channelId, deliveryCutoverAt: cutoverAt });
}

async function persistedFindingCreatedAt(): Promise<Date> {
  const [row] = await findingRows();
  if (row === undefined) {
    throw new Error("the fixture seeded no finding");
  }
  return row.createdAt;
}

test("a finding older than the cutover is not replayed into the channel that replaced its own", async () => {
  const createDeliveryLaneSource = await loadCreateDeliveryLaneSource();
  const org = await seedOrgWithFinding({ label: "moved", channelId: CHANNEL_A });

  const logger = createRecordingDeliveryLogger();
  const lanes = createDeliveryLaneSource({ db, logger });

  // Undelivered and deliverable BEFORE the move, so a green below is about the cutover
  // rather than about a lane that had nothing to send in the first place.
  const [before] = await lanes.listDueLanes(NOW);
  expect(before?.candidates.map((candidate) => candidate.findingId)).toEqual([org.findingId]);

  const createdAt = await persistedFindingCreatedAt();
  await moveChannelTo(CHANNEL_B, new Date(createdAt.getTime() + 60_000));

  const [after] = await lanes.listDueLanes(NOW);
  expect(after?.channelId).toBe(CHANNEL_B);
  expect(after?.candidates).toEqual([]);
});

test("a finding exactly at the cutover instant stays with the channel that received it", async () => {
  // The boundary the comparison turns on. `<=`, not `<`: the move happens after the finding
  // was already deliverable to the old address, so an equal timestamp belongs to the old one.
  const createDeliveryLaneSource = await loadCreateDeliveryLaneSource();
  await seedOrgWithFinding({ label: "boundary", channelId: CHANNEL_A });

  await moveChannelTo(CHANNEL_B, await persistedFindingCreatedAt());

  const logger = createRecordingDeliveryLogger();
  const [lane] = await createDeliveryLaneSource({ db, logger }).listDueLanes(NOW);

  expect(lane?.candidates).toEqual([]);
});

test("a finding made after the cutover still goes to the channel that replaced the old one", async () => {
  // The other direction, which is the whole point of allowing the move: suppressing the
  // backlog must not suppress the product.
  const createDeliveryLaneSource = await loadCreateDeliveryLaneSource();
  const org = await seedOrgWithFinding({ label: "later", channelId: CHANNEL_A });

  const createdAt = await persistedFindingCreatedAt();
  await moveChannelTo(CHANNEL_B, new Date(createdAt.getTime() - 60_000));

  const logger = createRecordingDeliveryLogger();
  const [lane] = await createDeliveryLaneSource({ db, logger }).listDueLanes(NOW);

  expect(lane?.channelId).toBe(CHANNEL_B);
  expect(lane?.candidates.map((candidate) => candidate.findingId)).toEqual([org.findingId]);
});

test("a connection that has never moved holds nothing back", async () => {
  // `null` is the overwhelmingly common row, and a predicate that treated it as "suppress
  // everything" would silently stop every installation delivering.
  const createDeliveryLaneSource = await loadCreateDeliveryLaneSource();
  const org = await seedOrgWithFinding({ label: "never-moved", channelId: CHANNEL_A });

  const logger = createRecordingDeliveryLogger();
  const [lane] = await createDeliveryLaneSource({ db, logger }).listDueLanes(NOW);

  expect(lane?.candidates.map((candidate) => candidate.findingId)).toEqual([org.findingId]);
});

// The other half of the abandoned-lease fix. Clearing the lane's `openFindingIds` unblocks
// the PROJECT; without this the finding itself stays `pending` forever and is never a
// candidate again — unblocked and unsendable, which reads as "delivery works" while the one
// finding that was mid-flight when the tick died is silently dropped for good.
async function claimAndAbandon(org: SeededOrg, claimedAt: Date): Promise<void> {
  const [row] = await findingRows();
  if (row === undefined) {
    throw new Error("the fixture seeded no finding");
  }

  const claim = await createDeliveriesRepo(db, org.ctx).claimForPost({
    projectId: org.workspace.projectId,
    findingId: org.findingId,
    signature: signatureHex(row.signature),
    channelId: CHANNEL_A,
    claimedAt,
    staleClaimsBefore: new Date(claimedAt.getTime() - 1),
  });

  expect(claim.claimed).toBe(true);
}

test("a claim still in flight keeps its finding out of the candidate list", async () => {
  const createDeliveryLaneSource = await loadCreateDeliveryLaneSource();
  const org = await seedOrgWithFinding({ label: "in-flight", channelId: CHANNEL_A });

  await claimAndAbandon(org, new Date(NOW.getTime() - 60_000));

  const logger = createRecordingDeliveryLogger();
  const [lane] = await createDeliveryLaneSource({ db, logger }).listDueLanes(NOW);

  expect(lane?.candidates).toEqual([]);
});

test("a finding whose claim was abandoned becomes deliverable again", async () => {
  const createDeliveryLaneSource = await loadCreateDeliveryLaneSource();
  const org = await seedOrgWithFinding({ label: "abandoned", channelId: CHANNEL_A });

  await claimAndAbandon(org, new Date(NOW.getTime() - DELIVERY_CLAIM_TTL_MS - 60_000));

  const logger = createRecordingDeliveryLogger();
  const [lane] = await createDeliveryLaneSource({ db, logger }).listDueLanes(NOW);

  expect(lane?.candidates.map((candidate) => candidate.findingId)).toEqual([org.findingId]);
});

test("a tick recovers a project whose delivery was stuck behind an abandoned claim", async () => {
  // The whole bug, end to end through the real entry point: before the fix this posted
  // nothing, on this tick and on every tick after it, for the life of the installation.
  const org = await seedOrgWithFinding({ label: "recovered", channelId: CHANNEL_A });

  await claimAndAbandon(org, new Date(NOW.getTime() - DELIVERY_CLAIM_TTL_MS - 60_000));

  const poster = createRecordingPoster();
  const { summary } = await runTheTick(poster);

  expect(summary.posted).toBe(1);
  expect(poster.posted).toHaveLength(1);
  expect(poster.posted[0]?.channelId).toBe(CHANNEL_A);
});
