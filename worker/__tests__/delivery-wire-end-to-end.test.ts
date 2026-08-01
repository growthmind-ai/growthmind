// O-008 Wave 0e, task 0e.4 — THE DELIVERY WIRE, END TO END. ADD §9, 7 rows
// (FR-O12, FR-O13, EC-O11, AC-O21).
//
// ###########################################################################
// # THE D11 PROOF. MANDATORY. NEVER CUT.
// #
// # AT BRANCH BASE, `worker/src/index.ts:87-89` IS LITERALLY:
// #
// #     function resolveDeliveryComposition(): DeliveryComposition | null {
// #       return null;
// #     }
// #
// # The delivery tick has logged "there is nothing to post" every fifteen
// # minutes, FOREVER, on every installation. O-007 shipped the scheduler, the
// # renderer, the residual scanner, the deliveries ledger and the poster port
// # — all of it green, all of it proven AGAINST FAKES, and none of it
// # reachable. That is the reason every subsystem from O-003 to O-012 is
// # currently unreachable, and this file is what stops it being true forever.
// #
// # SO: REAL ENTRY POINT (`runDeliveryTick`), REAL `createTestDb()`, REAL
// # `createDeliveryLaneSource`, REAL `createDeliveriesRepo`, REAL SQL. FAKES
// # ARE INJECTED AT EXACTLY ONE SEAM — the poster, because posting is the one
// # effect that leaves the process. A row that reached past the entry point,
// # or that faked the lane source, would be another producer-plus-consumer
// # pair and would prove nothing this file exists to prove.
// ###########################################################################
//
// FR-O13 IS A TENANCY REQUIREMENT WEARING A DATA-FLOW COSTUME. A channel id
// that can arrive on a payload is a way to post ONE ORG'S FINDING INTO ANOTHER
// ORG'S CHANNEL. Reading it off the lane's own row makes that IMPOSSIBLE rather
// than FORBIDDEN — rows 4, 5 and 6 are the three faces of that one sentence.
//
// WHAT IS RED TODAY AND WHY. `worker/src/delivery-lane-source.ts` is ADD Wave
// 4's, `slack_connections` is ADD Wave 2's, and `DeliveryTickDeps.posterFor` is
// AD-13's. Three different absences, each converted into a NAMED diagnostic
// naming its own owner — never a bare TS2307, ENOENT, or `relation does not
// exist`.
//
// FIXTURE SEED PREFIX: `o008e-`.
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

// ===========================================================================
// The loaders
// ===========================================================================

/** AD-15 / ADD §5's Wave 4 table — `createDeliveryLaneSource({ db, logger })`.
 *  The deps shape mirrors `createAnalysisLaneSource`, which is the established
 *  precedent for a lane-source factory in this package. */
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

/** AD-13's deps change, named before any row drives the tick — see the twin of
 *  this function in `delivery-composition.test.ts` for why a bare
 *  `expect([]).toHaveLength(1)` is not an acceptable Wave 0 red. */
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

// ===========================================================================
// Fixtures
// ===========================================================================

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

/**
 * One org with a project, a live Slack connection, and one deliverable finding
 * — every row of it written through REAL SQL.
 *
 * `label` distinguishes the surfaces so a message posted for org A is
 * recognisable in org B's channel by its CONTENT and not only by its channel
 * id: row 5's leak would otherwise be invisible if both orgs' findings rendered
 * identically.
 */
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

/**
 * THE REAL ENTRY POINT, with the real lane source and the real ledger. The
 * poster is the ONE fake, and it is the registration seam by definition: it is
 * the only dependency whose effect leaves this process.
 */
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
    // ONE poster instance per org, resolved from the TENANT CONTEXT and never
    // from the message (AD-13). This closure is the whole of the fake seam.
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

// ###########################################################################
// Row 1 — THE WIRE ITSELF.
// ###########################################################################
test("a persisted finding reaches the channel through runDeliveryTick's real entry point", async () => {
  const org = await seedOrgWithFinding({ label: "payment", channelId: CHANNEL_A });
  const poster = createRecordingPoster();

  const { summary } = await runTheTick(poster);

  // IT POSTED. Not "the lane was considered", not "a row was written" — the
  // message left through the port, which is the single fact that has never been
  // true on any installation of this product.
  expect(summary.posted).toBe(1);
  expect(poster.posted).toHaveLength(1);

  // TO THE RIGHT CHANNEL, with real content.
  expect(poster.posted[0]?.channelId).toBe(CHANNEL_A);
  expect((poster.posted[0]?.fallbackText ?? "").length).toBeGreaterThan(0);

  // AND THE LEDGER RECORDED IT, through real SQL under the org's own filter.
  const deliveries = await deliveryRows();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.status).toBe("posted");
  expect(deliveries[0]?.findingId).toBe(org.findingId);
  expect(deliveries[0]?.organizationId).toBe(org.workspace.organizationId);
  expect(deliveries[0]?.channelId).toBe(CHANNEL_A);
});

// ###########################################################################
// Row 2 — D4 idempotency THROUGH THE DELIVERIES CLAIM.
// ###########################################################################
test("the same tick run twice posts once", async () => {
  await seedOrgWithFinding({ label: "payment", channelId: CHANNEL_A });
  const poster = createRecordingPoster();

  await runTheTick(poster);
  await runTheTick(poster);

  // ONE POST, TWO TICKS. The guarantee is a property of the unique index the
  // claim runs against, not of the order this fixture happens to run in — a
  // retried Graphile Worker job, an overlapping tick, and a backfill all reduce
  // to exactly this sequence.
  expect(poster.posted).toHaveLength(1);

  const deliveries = await deliveryRows();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.status).toBe("posted");
});

// ###########################################################################
// Row 3 — D8.
// ###########################################################################
test("a poster failure leaves the finding row intact and the delivery row terminal", async () => {
  const org = await seedOrgWithFinding({ label: "payment", channelId: CHANNEL_A });
  const poster = createRecordingPoster({
    fails: { code: "channel_unavailable", message: "The channel is gone." },
  });

  const { summary } = await runTheTick(poster);

  expect(summary.posted).toBe(0);
  expect(summary.failed).toBe(1);

  // THE FINDING SURVIVES. A delivery that could not go out is a fact about
  // Slack, never about the finding — destroying the artifact because the
  // courier failed is the D8 cleanup class at its worst.
  const findings = await findingRows();
  expect(findings).toHaveLength(1);
  expect(findings[0]?.id).toBe(org.findingId);

  // AND THE DELIVERY ROW IS TERMINAL, never left `pending`. A stuck `pending`
  // jams this project's lane forever behind the claim's own unique index.
  const deliveries = await deliveryRows();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.status).toBe("failed");
  expect(deliveries[0]?.failureReason).toBe("The channel is gone.");
});

// ###########################################################################
// Row 4 — FR-O13. THE CHANNEL IS READ, NEVER SUPPLIED.
// ###########################################################################
test("the channel id comes from the stored connection row and no caller can supply one", async () => {
  const createDeliveryLaneSource = await loadCreateDeliveryLaneSource();

  // THE LANE SOURCE'S INPUTS, ENUMERATED. The factory takes `{ db, logger }`
  // and `listDueLanes` takes an instant — there is nowhere for a channel to
  // enter, which is what makes a cross-org post IMPOSSIBLE rather than merely
  // forbidden.
  const laneSourceSource = readSourceUnderConstruction({
    repoRelativePath: LANE_SOURCE_PATH,
    ownedBy: OWNER_SOURCE,
  });
  expect(laneSourceSource).toContain("channelId");
  // The channel is READ from the connection row, so the source must name the
  // column it reads it from. A source that mentioned `channelId` only as an
  // output field would be building it from somewhere else.
  expect(laneSourceSource).toMatch(/channel_?[Ii]d/);

  const org = await seedOrgWithFinding({ label: "payment", channelId: CHANNEL_A });

  const logger = createRecordingDeliveryLogger();
  const lanes = createDeliveryLaneSource({ db, logger });
  const [lane] = await lanes.listDueLanes(NOW);

  // `listDueLanes` was handed ONE argument — an instant — and produced a lane
  // carrying this org's own stored channel.
  expect(lanes.listDueLanes).toHaveLength(1);
  expect(lane?.channelId).toBe(CHANNEL_A);
  expect(lane?.organizationId).toBe(org.workspace.organizationId);

  // CHANGE THE ROW, CHANGE THE CHANNEL. This is what makes the assertion above
  // a statement about the READ rather than about a constant that happens to
  // match the fixture.
  await db.delete(tableUnderConstruction("slackConnections", OWNER_SCHEMA));
  await seedSlackConnection(
    db,
    { organizationId: org.workspace.organizationId, channelId: CHANNEL_B },
    OWNER_SCHEMA,
  );

  const [relanded] = await lanes.listDueLanes(NOW);
  expect(relanded?.channelId).toBe(CHANNEL_B);
});

// ###########################################################################
// Row 5 — D7 ACROSS TWO SEEDED ORGS WITH TWO CONNECTIONS.
// ###########################################################################
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

  // ORG A'S SURFACE APPEARS ONLY IN ORG A'S CHANNEL. Asserted on the message
  // CONTENT rather than on the channel id alone: two lanes posting to the right
  // channels with each other's findings would satisfy a channel-only check and
  // would still be the exact leak FR-O13 exists to prevent.
  expect(JSON.stringify(toA[0])).toContain("/checkout/alpha");
  expect(JSON.stringify(toA[0])).not.toContain("/checkout/beta");
  expect(JSON.stringify(toB[0])).toContain("/checkout/beta");
  expect(JSON.stringify(toB[0])).not.toContain("/checkout/alpha");

  // AND THE LEDGER AGREES, per org, under each org's own filter.
  const deliveries = await deliveryRows();
  const rowA = deliveries.find((row) => row.organizationId === orgA.workspace.organizationId);
  const rowB = deliveries.find((row) => row.organizationId === orgB.workspace.organizationId);
  expect(rowA?.channelId).toBe(CHANNEL_A);
  expect(rowB?.channelId).toBe(CHANNEL_B);
  expect(rowA?.findingId).toBe(orgA.findingId);
  expect(rowB?.findingId).toBe(orgB.findingId);
});

// ###########################################################################
// Row 6 — AD-13'S WHOLE REASON FOR EXISTING.
// ###########################################################################
test("two orgs each receive their own finding in their own channel through one tick", async () => {
  await seedOrgWithFinding({ label: "alpha", channelId: CHANNEL_A });
  await seedOrgWithFinding({ label: "beta", channelId: CHANNEL_B });

  const poster = createRecordingPoster();
  const { summary } = await runTheTick(poster);

  // ONE TICK, TWO ORGS, TWO POSTS. A single poster bound to one workspace's
  // bearer token at construction could not do this — which is the entire
  // argument for `posterFor` and the reason correction C-C exists. A tick that
  // posted once here would be a multi-org installation silently delivering to
  // whichever org happened to be composed first.
  expect(summary.lanesConsidered).toBe(2);
  expect(summary.posted).toBe(2);
  expect(summary.failed).toBe(0);
  expect(summary.lanesErrored).toBe(0);

  expect(new Set(poster.posted.map((request) => request.channelId))).toEqual(
    new Set([CHANNEL_A, CHANNEL_B]),
  );
});

// ###########################################################################
// Row 7 — THE EXISTING GATE STILL RUNS.
// ###########################################################################
test("a residual-PII block holds the post back and marks the delivery, not the finding", async () => {
  // AN EMAIL ADDRESS IN THE GENERATED PROSE. `context[]` is the one part of a
  // rendered message that carries text nobody vetted, which is exactly what the
  // residual scanner exists for — and a finding's own numbers never look like
  // this, so a hit here has no legitimate source in this product.
  const org = await seedOrgWithFinding({
    label: "payment",
    channelId: CHANNEL_A,
    context: [`Sessions from buyer@${PREFIX}customer.example left without finishing.`],
  });

  const poster = createRecordingPoster();
  const { summary } = await runTheTick(poster);

  // NOTHING LEFT THE PROCESS. The gate runs BEFORE the post, so the offending
  // text never reaches a third party at all.
  expect(poster.posted).toEqual([]);
  expect(summary.blockedByPii).toBe(1);
  expect(summary.posted).toBe(0);

  // THE DELIVERY IS MARKED — and it is the DELIVERY, not the finding. The
  // finding is a true, evidenced artifact; only its rendering was unsafe to
  // transmit, and destroying or suppressing the finding would throw away the
  // evidence over a formatting fault.
  const deliveries = await deliveryRows();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.status).toBe("failed");
  expect(deliveries[0]?.findingId).toBe(org.findingId);

  const findings = await findingRows();
  expect(findings).toHaveLength(1);
  expect(findings[0]?.id).toBe(org.findingId);

  // AND THE REASON NAMES THE SHAPE, NEVER THE MATCH. Quoting the offending text
  // into `failure_reason` — a customer-facing column — would copy the personal
  // data into the very place we just refused to send it.
  expect(deliveries[0]?.failureReason ?? "").not.toContain("buyer@");
  expect((deliveries[0]?.failureReason ?? "").length).toBeGreaterThan(0);
});
