// AD-4's SIX-READER TABLE, AS A TEST. Wave 0, task 0.4.
//
// One row of `slack_connections` with `channel_id` NULL is the whole subject of
// this file. After migration 0010 that row means two things at once, and they
// are not the same thing:
//
//   A WORKSPACE IS ATTACHED — the OAuth callback stored a real bot token, so
//   the org has a Slack installation and the founder is mid-flow.
//
//   NOTHING CAN BE DELIVERED — no channel has been chosen, so there is no
//   address to post to.
//
// Every reader of that row must distinguish the two. A reader that treats the
// row as "connected" because the row exists tells a founder they are done when
// they are not; a reader that treats it as "not connected" loses the workspace
// and re-asks for a token the org already gave us. The ADD's table
// (add-first-run-zero-hunting.md, AD-4) enumerates the six sites and says which
// of them change. This file is that table's enforcement.
//
// THE ROW WITH A CUSTOMER-VISIBLE BLAST RADIUS is the last one: the delivery
// lane's channel read. `channel_id` is a `text` column that stops being NOT
// NULL while every consumer downstream still types it `string`. A poster handed
// `null` where it expects a channel does not throw — it interpolates, and the
// value that reaches Slack's API is the four characters `null`. That is a D5
// persisted-shape bug that writes nothing to a log, fails no test, and is
// visible only to the customer whose findings stopped arriving.
//
// WHAT THIS FILE FOUND THAT THE ADD's TABLE DOES NOT LIST. There is a SEVENTH
// reader: `apps/web/app/api/first-run/slack/test/route.ts:92,98` reads
// `connection.channelId` off `getActiveForOrg()` and hands it straight to the
// poster and to `describeTestPostOutcome`. The whole point of AD-4 is that a
// connection can now exist with no channel, and the mid-OAuth window is exactly
// when a founder presses "send a test message". It is enumerated in
// `CHANNEL_READERS` below alongside the lane, and task 4.4's "find every
// existing read of the channel in the delivery path" owns it.
//
// WHY THE FIXTURE IS RAW SQL. `slackConnections.channelId` is `.notNull()` on
// this tree, so drizzle's insert type refuses `null` — a typed insert would be
// a COMPILE error, and a Wave 0 suite that does not typecheck is broken rather
// than red (§9 standing rule 2). The raw insert typechecks and fails at RUNTIME
// with Postgres 23502, which is the honest red: the migration has not landed.
// `onboarding-contract.ts` states the same reasoning for its own raw reads.
//
// WHAT IS EXPECTED TO PASS TODAY, and it is labelled row by row: the REGRESSION
// BASELINE. A fully-connected row and a no-connection org must behave exactly as
// they do now, before and after AD-4. Those rows are green on this tree by
// design — they are what proves the reds below are about the NULL channel and
// not about a broken fixture, a broken test bed, or a mis-wired assertion.

import { createSlackConnectionsRepo, sql } from "@growthmind/db";
import { listOrgsWithActiveSlackConnection } from "@growthmind/db/system";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import {
  ALL_ONBOARDING_MESSAGES,
  SLACK_SKIPPED_NOTICE,
  canArm,
  nextBlocker,
  type SetupFacts,
  type StagePersistedFacts,
  type TenantContext,
} from "@growthmind/shared";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { seedOrgWithOwner, seedProject } from "../../../../packages/db/__tests__/helpers/fixtures";
import {
  readPgFailure,
  readRawRows,
} from "../../../../packages/db/__tests__/helpers/onboarding-contract";
import {
  assertUnderConstruction,
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import { buildFirstRunStatus } from "../../lib/first-run/status";
import { blankComments, readExisting } from "./helpers/first-run-source";

// ---------------------------------------------------------------------------
// Owners — every red names the task that must satisfy it
// ---------------------------------------------------------------------------

const TASK_3_1 = "ADD Wave 3, task 3.1 (migration 0010 + the schema's nullable channel_id)";
const TASK_4_3 = "ADD Wave 3/4, task 4.3 (apps/web/lib/first-run/status.ts — AD-4's table)";
const TASK_4_4 = "ADD Wave 4, task 4.4 (packages/db/src/services/delivery-channel-guard.ts)";
const TASK_6_3 = "ADD Wave 6, task 6.3 (apps/web/components/first-run/FirstRunClient.tsx)";

// ---------------------------------------------------------------------------
// Fixture naming — this suite's own lane
// ---------------------------------------------------------------------------
//
// Four suites under `apps/web/__tests__/` boot their own PGlite and seed their
// own users. `db-lane-fixtures.ts` earned this convention the hard way: two
// suites colliding on one reused `user.email` read as a correct red and was not.
// Every name below carries this file's own token.

const LANE = "web-fr-nullchan";
const nameFor = (label: string): string => `${LANE}-${label}`;
const emailFor = (label: string): string => `${LANE}-${label}@example.com`;

/** Envelope-SHAPED and deliberately not openable. This repository is public and
 *  no fixture in it will ever carry usable key material. */
const CIPHERTEXT = "v1.00000000.aaaa.bbbb.cccc";
const CREDENTIAL_KEY_ID = "00000000";

/** A real-looking Slack channel id, for the lane that HAS one. */
const CHANNEL_ID = "C01AB2CD3EF";

const CONNECTED_AT = new Date("2026-08-01T09:00:00.000Z");

/**
 * No milestone has happened. Held FIXED across every row so the only thing that
 * varies between them is the Slack connection — this suite is about one column,
 * and a fixture that also moved the stage would make every red ambiguous.
 */
const NO_MILESTONES: StagePersistedFacts = Object.freeze({
  armedAt: null,
  retrievedAt: null,
  readingAt: null,
  endedAt: null,
  runStatus: null,
  runOutcome: null,
  finding: null,
});

// ---------------------------------------------------------------------------
// The contract mirrors — declared here because the tree does not carry them yet
// ---------------------------------------------------------------------------

/**
 * The three fields AD-4 and AD-6 add to the status payload (ADD §Core
 * Abstractions). `FirstRunStatusPayload` does not declare them on this tree, so
 * every row below reads the payload as a record and asserts PRESENCE first,
 * with a named diagnostic. Reading an undeclared property directly would be a
 * TS2339 that takes the typecheck gate down.
 */
const NEW_PAYLOAD_FIELD = "slackWorkspaceAttached";

/**
 * The guard task 4.4 creates, and the shape that makes it hard to misuse.
 *
 * IT TAKES THE CONNECTION, NOT A BARE STRING, for the reason
 * `slackCredentialAad(ctx)` takes a `TenantContext` rather than an id
 * (`packages/db/src/schema/slack-connections.ts:82`): a bare `string | null`
 * parameter accepts any string in scope, and the value that gets handed to it
 * by mistake is exactly the one that was never the channel. Written as a TYPE
 * PREDICATE — `connection is T & { channelId: string }` — the caller needs no
 * non-null assertion afterwards, which is what stops a `!` being the thing that
 * re-opens this hole one refactor later.
 */
type IsDeliveryTarget = (connection: { readonly channelId: string | null }) => boolean;

const GUARD_MODULE = "packages/db/src/services/delivery-channel-guard";
const GUARD_EXPORT = "isDeliveryTarget";

const loadGuard = (): Promise<IsDeliveryTarget> =>
  loadUnderConstruction<IsDeliveryTarget>({
    modulePath: underConstructionSpecifier(GUARD_MODULE),
    exportName: GUARD_EXPORT,
    ownedBy: TASK_4_4,
  });

/**
 * Every site in the delivery path that reads a channel off a connection row.
 *
 * Task 4.4's instruction is explicit about the shape of the fix: "route every
 * such read through this guard — do NOT add a null check at each call site,
 * which is the shape that gets missed at the next one." So this manifest is the
 * mechanical form of that instruction, and the scan below asks each file to
 * name the guard rather than asking it to contain a null check.
 */
const CHANNEL_READERS: readonly { path: string; reads: string }[] = Object.freeze([
  {
    path: "worker/src/delivery-lane-source.ts",
    // Two reads in one file, and the second is the quiet one: `findFor` keys the
    // delivery ledger on `(finding, channel)`, so a null channel does not error
    // — it matches no row, and the tick concludes the finding was never sent.
    reads:
      "`channelId: organization.channelId` (the lane's address) AND `deliveries.findFor(finding.id, organization.channelId)` (the dedup key)",
  },
  {
    path: "apps/web/app/api/first-run/slack/test/route.ts",
    // THE READER AD-4's TABLE DOES NOT LIST. See this file's header.
    reads: "`connection.channelId` handed to `buildTestPostMessage` and `describeTestPostOutcome`",
  },
]);

// ---------------------------------------------------------------------------
// The bed — three orgs, three Slack situations
// ---------------------------------------------------------------------------

interface Lane {
  readonly organizationId: string;
  readonly userId: string;
  readonly ctx: TenantContext;
  readonly projectId: string;
}

let db: TestDb;
let close: () => Promise<void>;

/** A workspace attached with NO channel chosen. The subject of this file. */
let attached: Lane;
/** A channel chosen. The REGRESSION BASELINE — must behave exactly as today. */
let connected: Lane;
/** Nothing connected at all. The other half of the baseline. */
let bare: Lane;

async function seedLane(label: string): Promise<Lane> {
  const org = await seedOrgWithOwner(db, {
    orgName: nameFor(`org-${label}`),
    userName: nameFor(`user-${label}`),
    email: emailFor(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: nameFor(`project-${label}`),
  });

  return {
    organizationId: org.organizationId,
    userId: org.userId,
    ctx: org.ctx,
    projectId: project.id,
  };
}

beforeAll(async () => {
  const handle = await createTestDb();
  db = handle.db;
  close = handle.close;

  attached = await seedLane("attached");
  connected = await seedLane("connected");
  bare = await seedLane("bare");

  // The BASELINE connection goes in through the real repository, not a raw
  // insert: it has to be the row the shipped write path actually produces, or
  // "unchanged" would be a claim about a fixture rather than about production.
  await createSlackConnectionsRepo(db, connected.ctx).insertActive({
    channelId: CHANNEL_ID,
    credentialCiphertext: CIPHERTEXT,
    credentialKeyId: CREDENTIAL_KEY_ID,
    connectedByUserId: connected.userId,
    connectedAt: CONNECTED_AT,
  });

  // The NULL-channel row is NOT seeded here. It cannot be written on this tree,
  // and a `beforeAll` that threw would replace every row's own named diagnostic
  // with one shared hook failure — including the regression rows, which have
  // nothing to do with it. It is resolved lazily, per row, below.
});

afterAll(async () => {
  await close?.();
});

// ---------------------------------------------------------------------------
// The fixture that cannot be written yet
// ---------------------------------------------------------------------------

let pendingNullChannel: Promise<string> | null = null;

/**
 * Insert a `slack_connections` row for `attached` with `channel_id` NULL, and
 * turn the migration's absence into a NAMED red rather than a bare 23502.
 *
 * Memoized, so the twelve rows that need it pay for one insert and all receive
 * the same diagnostic while it is absent.
 */
function nullChannelConnection(): Promise<string> {
  pendingNullChannel ??= insertNullChannelConnection();
  return pendingNullChannel;
}

/**
 * The DRIVER's own clause, without drizzle's `Failed query: … params: …` echo.
 *
 * `readPgFailure` joins every wrapper's message so nothing is lost, and for this
 * table the outermost one carries the bound values — including the credential
 * envelope, which is exactly what `SlackConnectionWriteError` exists to keep out
 * of a thrown value (`slack-connections.repo.ts:147`). The fixture's envelope is
 * a public literal that opens nothing, so this is legibility rather than safety:
 * the last clause is the sentence a reader needs and the echo is 400 characters
 * of noise in front of it.
 */
function driverClauseOf(message: string): string {
  const clauses = message.split(" | ");
  return clauses[clauses.length - 1] ?? message;
}

async function insertNullChannelConnection(): Promise<string> {
  const id = randomUUID();

  try {
    await readRawRows(
      db,
      sql`INSERT INTO slack_connections
            (id, organization_id, channel_id, credential_ciphertext, credential_key_id,
             is_active, connected_by_user_id, connected_at)
          VALUES (${id}, ${attached.organizationId}, NULL, ${CIPHERTEXT}, ${CREDENTIAL_KEY_ID},
                  true, ${attached.userId}, ${CONNECTED_AT.toISOString()})`,
    );
  } catch (error) {
    const failure = readPgFailure(error);
    const isNotNullViolation =
      failure.code === "23502" || /null value in column|not-null/i.test(failure.message);

    if (isNotNullViolation) {
      throw new Error(
        `NOT IMPLEMENTED YET: slack_connections.channel_id is still NOT NULL on this tree, so a ` +
          `workspace cannot be attached before a channel is chosen — which is the entire state ` +
          `the OAuth path creates (AD-4, migration 0010). It is created by ${TASK_3_1}. This is ` +
          `a Wave 0 red for the RIGHT reason: the column that must accept NULL refuses it. ` +
          `Postgres said: ${driverClauseOf(failure.message)}`,
        // The chain is kept so a failure that is NOT the expected 23502 — a
        // driver change, a renamed column — still carries its own stack. Safe
        // here and NOT safe in `SlackConnectionWriteError`, whose header explains
        // the difference: a cause chain re-prints drizzle's bound parameters, and
        // in production one of those is a customer's sealed bot token. The
        // envelope in this fixture is a public literal that opens nothing.
        { cause: error },
      );
    }

    throw error;
  }

  return id;
}

// ---------------------------------------------------------------------------
// Reading the payload, and deriving the chain's facts from it
// ---------------------------------------------------------------------------

/** The status payload as a plain record — see `NEW_PAYLOAD_FIELD`. */
async function statusFor(lane: Lane): Promise<Record<string, unknown>> {
  const payload = await buildFirstRunStatus({
    db,
    ctx: lane.ctx,
    projectId: lane.projectId,
    facts: NO_MILESTONES,
    findingUnavailable: false,
  });

  return payload as unknown as Record<string, unknown>;
}

/**
 * `SetupFacts`, derived from the payload exactly as `FirstRunClient.tsx` does
 * after task 6.3.
 *
 * `analyticsAttached` IS HELD TRUE, and that is the isolation this suite needs
 * rather than a convenience. `canArm` is `analyticsAttached && deliveryResolved`,
 * so pinning the analytics half true makes a `canArm` red mean one thing and one
 * thing only: delivery is not resolved. With it false, the arm gate would be
 * closed for a reason that has nothing to do with the channel, and the row would
 * pass against a build that got AD-4 completely wrong.
 *
 * `armedAt` is null for the same reason — the chain's last link must not be the
 * one answering.
 */
function setupFactsFrom(payload: Record<string, unknown>): SetupFacts {
  return {
    analyticsAttached: true,
    workspaceAttached: payload[NEW_PAYLOAD_FIELD] === true,
    deliveryResolved:
      (payload.channelId ?? null) !== null || (payload.slackSkippedAt ?? null) !== null,
    armedAt: null,
  };
}

/** Assert the widened payload is present before any row reads it, so an absent
 *  contract says so in its own words rather than as `expect(undefined)`. */
function requireWidenedPayload(payload: Record<string, unknown>): void {
  assertUnderConstruction(NEW_PAYLOAD_FIELD in payload, {
    contract: `the first-run status payload carries \`${NEW_PAYLOAD_FIELD}\` — AD-4's producer for SetupFacts.workspaceAttached, which has had no producer since the blocker chain shipped`,
    ownedBy: TASK_4_3,
  });
}

/** A production file's source with every comment blanked, so a scan can never
 *  be satisfied by a header that merely MENTIONS the thing it requires. */
function codeOf(repoRelativePath: string): string {
  return blankComments(readExisting(repoRelativePath).source);
}

// ---------------------------------------------------------------------------
// AD-4's migration — the state the whole table describes has to be writable
// ---------------------------------------------------------------------------

describe("a workspace can be attached before a channel is chosen (AD-4, migration 0010)", () => {
  test("slack_connections accepts a row whose channel_id is NULL", async () => {
    const id = await nullChannelConnection();

    const rows = await readRawRows(
      db,
      sql`SELECT channel_id, is_active FROM slack_connections WHERE id = ${id}`,
    );

    expect(rows).toHaveLength(1);
    // NULL, and NOT the empty string — a sentinel would make "no channel" and
    // "a channel named nothing" the same value, which is the collapse this
    // whole file exists to prevent.
    expect(rows[0]?.channel_id).toBeNull();
    // The row is ACTIVE. A half-connected workspace is not a deactivated one:
    // the token is real, `getActiveForOrg` must find it, and the partial unique
    // index still holds one active connection per org.
    expect(rows[0]?.is_active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Readers 1-3 — the status payload (apps/web/lib/first-run/status.ts)
// ---------------------------------------------------------------------------

describe("the status payload, for a workspace with no channel (AD-4 rows 1-4)", () => {
  test("status.channelId is null — there is no address, and the payload says so", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);

    // AD-4 row 1: unchanged. `slack?.channelId ?? null` already answers this
    // correctly once the column is nullable, and the row exists to prove the
    // NULL survives the read rather than becoming `undefined` or `"null"`.
    expect(payload.channelId).toBeNull();
  });

  test("status.slackNotice is the degraded notice, not null — THE READER THAT SILENTLY BREAKS", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);

    // AD-4 row 2, and the one that fails without a compile error anywhere.
    // `slackNotice` derives from `slack === null` today, so an attached
    // workspace with no channel produces `null` — meaning NO NOTICE — and the
    // screen tells a founder nothing at all while nothing can be delivered.
    // It must become `slack === null || slack.channelId === null`.
    expect(payload.slackNotice).not.toBeNull();
  });

  test("the degraded notice is a shipped sentence, never authored at the call site", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);

    // B3 / FR-O22: every customer-facing string lives in
    // `packages/shared/src/onboarding/messages.ts` and is registered in
    // `ALL_ONBOARDING_MESSAGES`, or the plain-English audit never sees it.
    // Asserted as MEMBERSHIP rather than as one literal, so task 4.3 may mint a
    // sentence specific to this state — it just may not invent one inline.
    expect(typeof payload.slackNotice).toBe("string");
    expect(ALL_ONBOARDING_MESSAGES).toContain(payload.slackNotice as string);
  });

  test("status.slackWorkspaceAttached is true — the workspace is not lost", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);
    requireWidenedPayload(payload);

    // AD-4 row 4. `slack !== null`, never `channelId !== null`. Without it the
    // screen cannot tell "no Slack at all" from "Slack is attached, pick a
    // channel", and re-asks for a token the org has already given us.
    expect(payload[NEW_PAYLOAD_FIELD]).toBe(true);
  });

  test("StepSequenceFacts.slackConnected stays false — step 3 is not done on a workspace alone", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);

    // AD-4 row 3: unchanged. `apps/web/app/(first-run)/first-run/page.tsx:128`
    // derives `slackConnected: status.channelId !== null`, and "connected" still
    // means A CHANNEL EXISTS. Widening it to mean "a workspace exists" would
    // mark step 3 done and collapse the sequence over a state that delivers
    // nothing — the same collapse row 2 is about, one surface along.
    expect(payload.channelId !== null).toBe(false);
  });

  test("slackWorkspaceAttached is false with no connection and true with a channel", async () => {
    const none = await statusFor(bare);
    const full = await statusFor(connected);
    requireWidenedPayload(none);
    requireWidenedPayload(full);

    // The new field's other two states, and this row is what makes the one above
    // worth anything: without them `slackWorkspaceAttached` could be the constant
    // `true` and every assertion about it would still be green.
    expect(none[NEW_PAYLOAD_FIELD]).toBe(false);
    expect(full[NEW_PAYLOAD_FIELD]).toBe(true);
  });
});

describe("REGRESSION BASELINE — the payload for the two rows AD-4 does not change", () => {
  // These are expected to PASS on this tree. They are what proves the reds
  // above are about the NULL channel and not about a broken bed.

  test("a fully connected org still reports its channel and no notice", async () => {
    const payload = await statusFor(connected);

    expect(payload.channelId).toBe(CHANNEL_ID);
    // Delivery is resolved, so there is nothing degraded to say.
    expect(payload.slackNotice).toBeNull();
  });

  test("an org with no connection at all still reports the skipped notice", async () => {
    const payload = await statusFor(bare);

    expect(payload.channelId).toBeNull();
    // FR-O14, unchanged: derived from the ABSENCE of an active connection, so it
    // survives a reload and a later disconnect by construction.
    expect(payload.slackNotice).toBe(SLACK_SKIPPED_NOTICE);
  });
});

// ---------------------------------------------------------------------------
// Readers 5-6 — the blocker chain and the arm gate
// ---------------------------------------------------------------------------

describe("the setup chain, for a workspace with no channel (AD-4 rows 4-5)", () => {
  test("SetupFacts.deliveryResolved is false — a workspace is not somewhere to deliver", async () => {
    await nullChannelConnection();
    const facts = setupFactsFrom(await statusFor(attached));

    // AD-4 row 5: unchanged, and it must STAY unchanged. `deliveryResolved` is
    // `channelId !== null || skipped`, and the tempting edit once
    // `slackWorkspaceAttached` exists is to fold it in here too — which would
    // resolve delivery for an org that has no address, open the arm gate, and
    // start a wait whose result goes nowhere.
    expect(facts.deliveryResolved).toBe(false);
  });

  test("canArm is false — the watch is not offered when nothing could be delivered", async () => {
    await nullChannelConnection();
    const facts = setupFactsFrom(await statusFor(attached));

    // The trap `canArm` was written to close: "Start watching" rendered at all
    // times, stamping a clock origin over a setup that cannot finish. With
    // `analyticsAttached` pinned true (see `setupFactsFrom`), a false here means
    // exactly one thing — delivery is unresolved.
    expect(canArm(facts)).toBe(false);
  });

  test("the chain names `channel` — the mid-OAuth window finally has a sentence", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);
    requireWidenedPayload(payload);

    // THE PAYOFF OF ROW 4. `SetupFacts.workspaceAttached` has had no producer
    // since the chain shipped, so the `channel` link was unreachable and its
    // sentence has never rendered for anyone. With a real producer, the founder
    // sitting between consent and channel choice reads one next action instead
    // of an empty panel.
    expect(nextBlocker(setupFactsFrom(payload))?.id).toBe("channel");
  });

  test("REGRESSION BASELINE: a fully connected org resolves delivery and can arm", async () => {
    const facts = setupFactsFrom(await statusFor(connected));

    expect(facts.deliveryResolved).toBe(true);
    expect(canArm(facts)).toBe(true);
    // `arm`, NOT `null`: this lane is unarmed, so the chain's last link is the
    // one still unmet. Asserting `null` here would be asserting that setup is
    // finished AND the watch has been started, which is a different fact and
    // would make the row red for a reason that has nothing to do with AD-4.
    expect(nextBlocker(facts)?.id).toBe("arm");
  });
});

describe("the client derives the chain's facts from the payload (D11 — the wire)", () => {
  const CLIENT = "apps/web/components/first-run/FirstRunClient.tsx";

  test("FirstRunClient reads slackWorkspaceAttached rather than re-deriving it from channelId", () => {
    const code = codeOf(CLIENT);

    // A producer test and a consumer test do not prove the wire between them.
    // `status.ts` computing the flag and the chain accepting it are both green
    // today with nothing connecting the two — the flag would be computed on
    // every request and read by nobody, and the `channel` link would stay
    // unreachable exactly as it is now. This scan is the wire.
    expect(code).toContain(NEW_PAYLOAD_FIELD);
  });

  test("deliveryResolved keeps both of its halves and neither is the workspace flag", () => {
    const line = codeOf(CLIENT)
      .split("\n")
      .find((candidate) => candidate.includes("deliveryResolved:"));

    if (line === undefined) {
      throw new Error(
        `${CLIENT} no longer assigns \`deliveryResolved\`, so the chain's arm gate has no input. ` +
          `AD-4 row 5 says this reader is UNCHANGED. ${TASK_6_3} owns this file.`,
      );
    }

    // The two persisted facts that resolve delivery, and the one that does not.
    // Written as a scan because the failure it guards is an EDIT: task 6.3
    // touches the line above this one, and folding the new flag in here is the
    // single change that would let a channel-less org arm.
    expect(line).toContain("channelId");
    expect(line).toContain("slackSkippedAt");
    expect(line).not.toContain(NEW_PAYLOAD_FIELD);
  });
});

// ---------------------------------------------------------------------------
// Reader 6 — the delivery lane. THE ROW THAT SHIPS SILENT CORRUPTION.
// ---------------------------------------------------------------------------

describe("the delivery guard refuses a connection with no channel (AD-4 row 6)", () => {
  test("a connection whose channelId is null is not a delivery target", async () => {
    const isDeliveryTarget = await loadGuard();

    expect(isDeliveryTarget({ channelId: null })).toBe(false);
  });

  test("a stringified null is not a delivery target either — THE CORRUPTION ROW", async () => {
    const isDeliveryTarget = await loadGuard();

    // `text` columns and template interpolation are how `null` becomes the four
    // characters `null`, and Slack's API answers a request for channel "null"
    // with an ordinary error the tick logs and retries. Nothing upstream throws.
    // These four are every shape that mistake takes on the way to the poster.
    for (const shape of ["null", "undefined", "", "   "]) {
      expect(`${shape}:${isDeliveryTarget({ channelId: shape })}`).toBe(`${shape}:false`);
    }
  });

  test("a real channel id IS a delivery target — the guard is not vacuously closed", async () => {
    const isDeliveryTarget = await loadGuard();

    // Without this row a guard that returned `false` unconditionally would pass
    // every assertion above and silently stop every customer's findings.
    expect(isDeliveryTarget({ channelId: CHANNEL_ID })).toBe(true);
  });
});

describe("the delivery lane's population, over a workspace with no channel", () => {
  test("the null-channel org yields no delivery target, and the connected one still does", async () => {
    await nullChannelConnection();
    const isDeliveryTarget = await loadGuard();

    // The unscoped population read the tick quantifies over — every org with an
    // ACTIVE Slack connection on this installation. The half-connected org is
    // active by design (its token is real), so it is in this list or it is
    // excluded by the read; either answer is correct, and neither may produce a
    // postable address.
    const population = await listOrgsWithActiveSlackConnection(db);
    const postable = population
      .filter((row) => isDeliveryTarget(row as unknown as { readonly channelId: string | null }))
      .map((row) => row.organizationId);

    expect(postable).not.toContain(attached.organizationId);
    // The positive control, in the same row: without it an empty population —
    // a broken read, a wrong filter — would pass the assertion above.
    expect(postable).toContain(connected.organizationId);
  });

  test("no organization in the population carries a stringified channel", async () => {
    await nullChannelConnection();

    const channels = (await listOrgsWithActiveSlackConnection(db)).map(
      (row) => (row as unknown as Record<string, unknown>).channelId,
    );

    // The value the poster interpolates. If AD-4's migration lands and this read
    // coerces instead of carrying the NULL through, the corruption is already
    // downstream of every guard.
    expect(channels).not.toContain("null");
    expect(channels).not.toContain("undefined");
    // The connected org's real channel is still here, so the two assertions
    // above cannot be green because the list is empty.
    expect(channels).toContain(CHANNEL_ID);
  });
});

describe("every delivery-path channel read routes through the one guard (task 4.4)", () => {
  for (const reader of CHANNEL_READERS) {
    test(`${reader.path} consults ${GUARD_EXPORT}`, () => {
      const code = codeOf(reader.path);

      if (!code.includes(GUARD_EXPORT)) {
        throw new Error(
          `${reader.path} reads a channel off a connection row — ${reader.reads} — and does not ` +
            `consult \`${GUARD_EXPORT}\`. After AD-4 that value is \`string | null\`, and a reader ` +
            `that still believes it cannot be null posts to the four characters "null" with no ` +
            `error anywhere. Task 4.4's instruction is that every such read goes through ONE ` +
            `guard rather than a null check per call site, "which is the shape that gets missed ` +
            `at the next one". ${TASK_4_4} owns it.`,
        );
      }

      expect(code).toContain(GUARD_EXPORT);
    });
  }
});
