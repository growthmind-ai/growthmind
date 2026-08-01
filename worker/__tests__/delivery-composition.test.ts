// O-008 Wave 0e, task 0e.3 — DELIVERY COMPOSITION. ADD §9, 5 rows
// (AD-13, AD-14, FR-O12).
//
// SELF-HOST IS FIRST-CLASS, AND THAT IS THE WHOLE SUBJECT OF THIS FILE. An
// installation with no Slack at all must reach a working pipeline (AGENTS.md),
// and the existing graceful-absence log is that installation's honest answer.
// AC-O12 requires BOTH halves literally: a real composition when Slack is
// connected, and STILL `null` WITH THE LOG when it is not. Per-org absence on a
// multi-org installation is a different question and is handled one level down
// by AD-13's `null` resolution — rows 4 and 5.
//
// ###########################################################################
// # WHY `posterFor` AND NOT A SINGLE `poster` (ADD correction C-C).
// #
// # `createSlackDeliveryPoster` binds ONE workspace's bearer token AT
// # CONSTRUCTION (`const authorization = \`Bearer ${config.botToken}\``), and
// # `PostRequest` carries `channelId`, `blocks`, `fallbackText` and NO
// # ORGANIZATION. So one poster instance can serve exactly one org's token
// # while `runDeliveryTick` iterates lanes across EVERY org.
// #
// # THE REJECTED ALTERNATIVE — a dispatching poster mapping `channelId` → org
// # — is a D7 hazard BY CONSTRUCTION: it would key a CREDENTIAL LOOKUP on a
// # value that TRAVELS WITH THE MESSAGE. The credential is resolved from the
// # TENANT CONTEXT, never from anything the message carries. Row 3 is that
// # sentence made checkable.
// #
// # NOTE: this contradicts the PRD's claim that `worker/src/index.ts` "is the
// # only place that changes for the wire". The PRD is wrong; see ADD C-C.
// ###########################################################################
//
// =========================================================================
// REQUIRES-REAL-POSTGRES — READ THIS BEFORE MARKING ROWS 1 AND 2 GREEN.
//
// `resolveDeliveryComposition` is MODULE-PRIVATE in `worker/src/index.ts`
// (AD-14 declares it as a bare `async function`, and ADD §5 gives Wave 5
// exclusive ownership of that file). It reaches its database through
// `resolveResources()`, which builds a `pg.Pool` from `DATABASE_URL` — and
// `createTestDb()` is PGlite, in-process WASM with NO SOCKET. So the only
// behavioural route to rows 1 and 2 is `taskList[TASK.DELIVERY_TICK]` against
// a REAL Postgres, isolated in its own database.
//
// Rows 1 and 2 are therefore written STRUCTURALLY here — a source scan with
// both mandatory controls — and their behavioural half is NOT written. That is
// a deliberate, named trade rather than a gap discovered later:
//   - The structural row bites on every mechanism AC-O12 names (the existence
//     gate, the `null` return, the verbatim log line), so a Wave 5 that
//     forgets one fails here.
//   - It CANNOT catch a gate that is present and wrong — an
//     `existsAnyActiveSlackConnection` whose SQL is inverted would pass this
//     row. That query's own behaviour is Wave 2's, provable against
//     `createTestDb()` in `packages/db/__tests__/system/`, and 0f/0g should
//     carry a row there. FLAGGED.
// =========================================================================
//
// FIXTURE SEED PREFIX: `o008c-`.
import { afterEach, beforeEach, expect, test } from "bun:test";

import { createDeliveriesRepo } from "@growthmind/db";
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
  DELIVERY_ACTOR_ROLE,
  type DeliveryLane,
  type DeliveryTickSummary,
} from "../src/tasks/delivery-tick";
import {
  createRecordingDeliveryLogger,
  createRecordingPosterFor,
  seedSlackConnection,
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

/**
 * AC-O12's log line, VERBATIM. It is the honest answer a self-hosted
 * installation with no Slack gets, and the reason the tick is not a silent
 * no-op — so it is pinned as a literal rather than matched loosely.
 */
const GRACEFUL_ABSENCE_LINE =
  "no delivery channel is connected on this installation, so there is nothing to post";

// ===========================================================================
// The loaders
// ===========================================================================

type MirrorRunDeliveryTick = (deps: MirrorDeliveryTickDeps) => Promise<DeliveryTickSummary>;

/**
 * `runDeliveryTick` SHIPS TODAY, so this loader always resolves — the absence
 * it guards is the DEPS SHAPE, checked separately below. Loading rather than
 * statically importing is what keeps the suite typechecking against AD-13's
 * `posterFor` on a tree whose handler still declares `poster`.
 */
const loadRunDeliveryTick = (): Promise<MirrorRunDeliveryTick> =>
  loadUnderConstruction<MirrorRunDeliveryTick>({
    modulePath: underConstructionSpecifier("worker/src/tasks/delivery-tick"),
    exportName: "runDeliveryTick",
    ownedBy: OWNER_TICK,
  });

/**
 * AD-14 line 451's `makePosterFor(db, env)`.
 *
 * UNDER-SPECIFIED, FLAGGED RATHER THAN GUESSED. AD-14 shows this factory inside
 * `resolveDeliveryComposition`'s body without saying whether it is exported.
 * Row 4 needs it reachable: the per-org absence path reads a
 * `slack_connections` row, which `createTestDb()` CAN serve — but only if the
 * factory takes its `db` as a parameter and can be called from a test.
 *
 * SO THIS ROW ASKS WAVE 5 FOR ONE EXPORT, and the trade is named here rather
 * than discovered in Wave 5: export `makePosterFor` (row 4 runs on PGlite, no
 * real Postgres anywhere in this suite), or keep it private (row 4 becomes a
 * REQUIRES-REAL-POSTGRES integration test alongside rows 1 and 2). The first is
 * strictly cheaper and matches how `runAnalysisLane` was extracted in AD-9 for
 * exactly this reason.
 */
const loadMakePosterFor = (): Promise<MirrorMakePosterFor> =>
  loadUnderConstruction<MirrorMakePosterFor>({
    modulePath: underConstructionSpecifier("worker/src/index"),
    exportName: "makePosterFor",
    ownedBy: OWNER_COMPOSITION,
  });

// ===========================================================================
// Source scanners, with their MANDATORY controls (ADD §9 standing rule 1)
// ===========================================================================

/** AD-14: the composition is gated on a SYSTEM EXISTENCE QUERY and returns
 *  `null` when nothing is connected. */
function isExistenceGated(source: string): boolean {
  return source.includes("existsAnyActiveSlackConnection");
}

/** AD-14: the composition hands back BOTH halves — the lane source and the
 *  per-org poster factory. A composition returning one is a composition that
 *  cannot deliver. */
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

/** The same derivation the tick itself uses (D7): from the row being processed,
 *  through the one accepted schema, under the delivery actor. */
function contextFor(organizationId: string, organizationName: string): TenantContext {
  return tenantContextSchema.parse({
    userId: DELIVERY_ACTOR_ID,
    organizationId,
    organizationName,
    role: DELIVERY_ACTOR_ROLE,
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
    // No candidates: rows 3 and 5 are about WHETHER AND HOW THE POSTER IS
    // RESOLVED, and a lane whose poster is null must be skipped BEFORE it
    // claims anything (AD-13: "resolves the poster once per lane… BEFORE it
    // claims"). A candidate here would let a row pass for a second reason.
    candidates: [],
  };
}

// ###########################################################################
// Row 1 — AC-O12's SECOND half. REQUIRES-REAL-POSTGRES for its behavioural leg.
// ###########################################################################
test("an installation with no slack connection still resolves null and logs graceful absence", () => {
  // BOTH CONTROLS FIRST (§9 standing rule 1). A scanner that matched nothing
  // would report green forever, and this row is the self-host promise.
  expect(isExistenceGated(PLANTED_UNGATED_COMPOSITION)).toBe(false);
  expect(isExistenceGated(CLEAN_COMPOSITION)).toBe(true);
  expect(CLEAN_COMPOSITION).toContain(GRACEFUL_ABSENCE_LINE);
  expect(PLANTED_UNGATED_COMPOSITION).not.toContain(GRACEFUL_ABSENCE_LINE);

  const source = readSourceUnderConstruction({
    repoRelativePath: INDEX_SOURCE_PATH,
    ownedBy: OWNER_COMPOSITION,
  });

  // THE LOG LINE, VERBATIM AND STILL THERE. It survives the wire landing —
  // AC-O12 requires an installation with no Slack to keep getting this exact
  // sentence, not a shorter one and not silence.
  expect(source).toContain(GRACEFUL_ABSENCE_LINE);

  // THE EXISTENCE GATE. Without it the composition would return a real poster
  // factory on an installation that has no connection at all, and the tick
  // would start reporting lane errors instead of honest absence.
  assertUnderConstruction(isExistenceGated(source), {
    contract:
      "resolveDeliveryComposition gated on existsAnyActiveSlackConnection(db), returning null " +
      "when no connection exists (AD-14, AC-O12 second half)",
    ownedBy: OWNER_COMPOSITION,
  });

  // AND IT IS ASYNC — the existence query is awaited, so a Wave 5 that added
  // the gate without making the function async could not compile it anyway,
  // but the row states the shape AD-14 declares.
  expect(source).toMatch(/async function resolveDeliveryComposition/);
});

// ###########################################################################
// Row 2 — AC-O12's FIRST half.
// ###########################################################################
test("an installation with a slack connection resolves a poster factory and a lane source", () => {
  // CONTROLS FIRST. The half-composition offender is the realistic failure: a
  // Wave 5 that wires the lane source and forgets the poster factory, leaving
  // the tick's `poster` field reading a value nothing produces (D11).
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

  // THE HANDLER PASSES THE FACTORY THROUGH, not a single poster. This is the
  // line AD-13 changes at the call site, and the one a `poster: composed.poster`
  // left behind would silently keep compiling against a stale deps shape.
  expect(source).toContain("posterFor");
  expect(source).not.toMatch(/\bposter:\s*composed\.poster\b/);
});

/**
 * The AD-13 deps change, asserted as a CONTRACT before any row drives the tick.
 *
 * `runDeliveryTick` ships today and takes `poster: DeliveryPoster`. Handed
 * AD-13's `posterFor` instead, it simply never resolves one — and every
 * assertion downstream fails as `expect([]).toHaveLength(2)`, which reads as a
 * broken fixture rather than an unwritten contract. This turns that into a red
 * that names the field, the signature and the wave that owns it.
 *
 * A SOURCE SCAN AND NOT A RUNTIME PROBE, deliberately: the deps are a
 * TypeScript interface with no runtime representation, so there is nothing to
 * inspect on the value itself.
 */
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

// ###########################################################################
// Row 3 — AD-13. THE CREDENTIAL COMES FROM THE TENANT CONTEXT.
// ###########################################################################
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

  // THE RESOLVER'S PARAMETERS, ENUMERATED. Exactly one argument reached it.
  expect(posterFor.calls).toHaveLength(1);
  expect(posterFor.calls[0]).toHaveLength(1);

  const [received] = posterFor.calls[0] as [TenantContext];

  // AND THAT ARGUMENT IS A TENANT CONTEXT — it PARSES as one, so this is a
  // statement about the shipped schema rather than about a duck-typed object
  // that happens to carry an org id.
  expect(() => tenantContextSchema.parse(received)).not.toThrow();
  expect(received.organizationId).toBe(organizationId);

  // NO CHANNEL ID ANYWHERE IN THE RESOLVER'S INPUT. A channel id reaching the
  // credential lookup is the D7 shape C-C rejected: a credential keyed on a
  // value that travels with the message. Serialised whole rather than
  // field-checked, so a channel smuggled onto a nested property is caught too.
  expect(JSON.stringify(received)).not.toContain("channelId");
  expect(JSON.stringify(received)).not.toContain("C0AAAAAAAAA");
});

// ###########################################################################
// Row 4 — the PER-ORG absence path, distinct from the installation-wide one.
// ###########################################################################
test("posterFor returns null for an org whose connection was deactivated", async () => {
  const makePosterFor = await loadMakePosterFor();

  const workspace = await seedPollableWorkspace(db, { prefix: PREFIX, now: NOW });
  const ctx = contextFor(workspace.organizationId, workspace.organizationName);

  await seedSlackConnection(
    db,
    { organizationId: workspace.organizationId, channelId: "C0LIVEAAAAA" },
    OWNER_SCHEMA,
  );

  const posterFor = makePosterFor(db, undefined);

  // WHILE THE CONNECTION IS ACTIVE, a poster is resolved for this org.
  expect(await posterFor(ctx)).not.toBeNull();

  // THE ORG DISCONNECTS. AD-13's exact scenario: the connection was deactivated
  // between the lane read and the post.
  await db.delete(await activeSlackConnectionsTable());

  // NULL, NOT A THROW AND NOT A STALE POSTER. A poster built from a revoked
  // token would post nothing and report a vendor failure the customer cannot
  // act on; absence is the honest answer and the tick skips the lane for it.
  expect(await posterFor(ctx)).toBeNull();
});

/** Deferred so the named diagnostic for the absent table fires inside the test
 *  body rather than at module load, where it would take the whole file down
 *  with one red instead of five. */
async function activeSlackConnectionsTable() {
  const { tableUnderConstruction } = await import("./helpers/onboarding-delivery-fixtures");
  return tableUnderConstruction("slackConnections", OWNER_SCHEMA);
}

// ###########################################################################
// Row 5 — absence is not an error.
// ###########################################################################
test("a lane whose poster resolves null is skipped, not failed", async () => {
  const runDeliveryTick = await loadRunDeliveryTick();
  requirePosterForContract();

  const connected = "o008c-org-connected";
  const disconnected = "o008c-org-disconnected";

  // ONLY ONE ORG HAS A LIVE CONNECTION. The other is the org whose Slack was
  // revoked — a supported state on a multi-org installation, not a fault.
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

  // ABSENCE, NOT ERROR. `lanesErrored` is the number a reader uses to decide
  // whether something is broken; an org that simply has no Slack connected
  // appearing there would make every multi-org installation look permanently
  // unhealthy, and would bury the one lane that really did fail.
  expect(summary.lanesErrored).toBe(0);
  expect(summary.failed).toBe(0);

  // AND IT DID NOT FAIL THE TICK — the sibling lane was still processed.
  expect(posterFor.calls).toHaveLength(2);

  // The skip is SAID OUT LOUD. A silent skip is indistinguishable from a lane
  // that ran and found nothing, which is the one distinction this vocabulary
  // exists to keep.
  expect(logger.lines().some((line) => line.includes(disconnected))).toBe(true);
});
