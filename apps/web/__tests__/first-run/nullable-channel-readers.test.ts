// A NULL channel_id means BOTH at once: a workspace is attached, and nothing can be delivered. Every reader below has to distinguish the two.

import { createSlackConnectionsRepo, sql } from "@growthmind/db";
import { listOrgsWithActiveSlackConnection } from "@growthmind/db/system";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import {
  ALL_ONBOARDING_MESSAGES,
  SLACK_CHANNEL_PICK_PROMPT,
  SLACK_SKIPPED_NOTICE,
  canArm,
  nextBlocker,
  type SetupFacts,
  type StagePersistedFacts,
  type TenantContext,
} from "@growthmind/shared";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { seedOrgWithOwner, seedProject } from "@growthmind/db/testing";
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

const TASK_3_1 = "ADD Wave 3, task 3.1 (migration 0010 + the schema's nullable channel_id)";
const TASK_4_3 = "ADD Wave 3/4, task 4.3 (apps/web/lib/first-run/status.ts — AD-4's table)";
const TASK_4_4 = "ADD Wave 4, task 4.4 (packages/db/src/services/delivery-channel-guard.ts)";
const TASK_6_3 = "ADD Wave 6, task 6.3 (apps/web/components/first-run/FirstRunClient.tsx)";

const LANE = "web-fr-nullchan";
const nameFor = (label: string): string => `${LANE}-${label}`;
const emailFor = (label: string): string => `${LANE}-${label}@example.com`;

const CIPHERTEXT = "v1.00000000.aaaa.bbbb.cccc";
const CREDENTIAL_KEY_ID = "00000000";

const CHANNEL_ID = "C01AB2CD3EF";

const CONNECTED_AT = new Date("2026-08-01T09:00:00.000Z");

const NO_MILESTONES: StagePersistedFacts = Object.freeze({
  armedAt: null,
  retrievedAt: null,
  readingAt: null,
  endedAt: null,
  runStatus: null,
  runOutcome: null,
  finding: null,
});

// Read as a record, not as a declared field: the payload does not declare these yet, and a direct read is a TS2339 that takes the typecheck gate down.
const NEW_PAYLOAD_FIELD = "slackWorkspaceAttached";

type IsDeliveryTarget = (connection: { readonly channelId: string | null }) => boolean;

const GUARD_MODULE = "packages/db/src/services/delivery-channel-guard";
const GUARD_EXPORT = "isDeliveryTarget";

const loadGuard = (): Promise<IsDeliveryTarget> =>
  loadUnderConstruction<IsDeliveryTarget>({
    modulePath: underConstructionSpecifier(GUARD_MODULE),
    exportName: GUARD_EXPORT,
    ownedBy: TASK_4_4,
  });

const CHANNEL_READERS: readonly { path: string; reads: string }[] = Object.freeze([
  {
    path: "worker/src/delivery-lane-source.ts",
    reads:
      "`channelId: organization.channelId` (the lane's address) AND `deliveries.findFor(finding.id, organization.channelId)` (the dedup key)",
  },
  {
    path: "apps/web/app/api/first-run/slack/test/route.ts",
    reads: "`connection.channelId` handed to `buildTestPostMessage` and `describeTestPostOutcome`",
  },
]);

interface Lane {
  readonly organizationId: string;
  readonly userId: string;
  readonly ctx: TenantContext;
  readonly projectId: string;
}

let db: TestDb;
let close: () => Promise<void>;

let attached: Lane;
let connected: Lane;
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

  await createSlackConnectionsRepo(db, connected.ctx).insertActive({
    channelId: CHANNEL_ID,
    credentialCiphertext: CIPHERTEXT,
    credentialKeyId: CREDENTIAL_KEY_ID,
    connectedByUserId: connected.userId,
    connectedAt: CONNECTED_AT,
  });

  // The NULL-channel row is NOT seeded here: it cannot be written on this tree, and a throwing beforeAll would replace every row's named diagnostic with one hook failure.
});

afterAll(async () => {
  await close?.();
});

let pendingNullChannel: Promise<string> | null = null;

function nullChannelConnection(): Promise<string> {
  pendingNullChannel ??= insertNullChannelConnection();
  return pendingNullChannel;
}

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
        { cause: error },
      );
    }

    throw error;
  }

  return id;
}

async function statusFor(lane: Lane): Promise<Record<string, unknown>> {
  const payload = await buildFirstRunStatus({
    db,
    ctx: lane.ctx,
    projectId: lane.projectId,
    facts: { ...NO_MILESTONES, findingId: null, findingUnavailable: false },
  });

  return payload as unknown as Record<string, unknown>;
}

// analyticsAttached is pinned true and armedAt null, so a red on canArm or on the blocker chain can mean one thing only: delivery is not resolved.
function setupFactsFrom(payload: Record<string, unknown>): SetupFacts {
  return {
    analyticsAttached: true,
    workspaceAttached: payload[NEW_PAYLOAD_FIELD] === true,
    deliveryResolved:
      (payload.channelId ?? null) !== null || (payload.slackSkippedAt ?? null) !== null,
    armedAt: null,
  };
}

function requireWidenedPayload(payload: Record<string, unknown>): void {
  assertUnderConstruction(NEW_PAYLOAD_FIELD in payload, {
    contract: `the first-run status payload carries \`${NEW_PAYLOAD_FIELD}\` — AD-4's producer for SetupFacts.workspaceAttached, which has had no producer since the blocker chain shipped`,
    ownedBy: TASK_4_3,
  });
}

/** Comments blanked, so a scan can never be satisfied by a header that merely MENTIONS the thing it requires. */
function codeOf(repoRelativePath: string): string {
  return blankComments(readExisting(repoRelativePath).source);
}

describe("a workspace can be attached before a channel is chosen (AD-4, migration 0010)", () => {
  test("slack_connections accepts a row whose channel_id is NULL", async () => {
    const id = await nullChannelConnection();

    const rows = await readRawRows(
      db,
      sql`SELECT channel_id, is_active FROM slack_connections WHERE id = ${id}`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.channel_id).toBeNull();
    expect(rows[0]?.is_active).toBe(true);
  });
});

describe("the status payload, for a workspace with no channel (AD-4 rows 1-4)", () => {
  test("status.channelId is null — there is no address, and the payload says so", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);

    expect(payload.channelId).toBeNull();
  });

  test("status.slackNotice is the degraded notice, not null — THE READER THAT SILENTLY BREAKS", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);

    expect(payload.slackNotice).not.toBeNull();
  });

  test("the degraded notice is a shipped sentence, never authored at the call site", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);

    expect(typeof payload.slackNotice).toBe("string");
    expect(ALL_ONBOARDING_MESSAGES).toContain(payload.slackNotice as string);
  });

  test("status.slackWorkspaceAttached is true — the workspace is not lost", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);
    requireWidenedPayload(payload);

    expect(payload[NEW_PAYLOAD_FIELD]).toBe(true);
  });

  test("StepSequenceFacts.slackConnected stays false — step 3 is not done on a workspace alone", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);

    expect(payload.channelId !== null).toBe(false);
  });

  test("slackWorkspaceAttached is false with no connection and true with a channel", async () => {
    const none = await statusFor(bare);
    const full = await statusFor(connected);
    requireWidenedPayload(none);
    requireWidenedPayload(full);

    // Control - without these two states slackWorkspaceAttached could be the constant true and every assertion about it would still be green.
    expect(none[NEW_PAYLOAD_FIELD]).toBe(false);
    expect(full[NEW_PAYLOAD_FIELD]).toBe(true);
  });
});

describe("REGRESSION BASELINE — the payload for the two rows AD-4 does not change", () => {
  // Control - these PASS today; they prove the reds above are about the NULL channel and not about a broken bed.

  test("a fully connected org still reports its channel and no notice", async () => {
    const payload = await statusFor(connected);

    expect(payload.channelId).toBe(CHANNEL_ID);
    expect(payload.slackNotice).toBeNull();
  });

  test("an org with no connection at all still reports the skipped notice", async () => {
    const payload = await statusFor(bare);

    expect(payload.channelId).toBeNull();
    expect(payload.slackNotice).toBe(SLACK_SKIPPED_NOTICE);
  });
});

describe("a SENTINEL channel is the same absence as a NULL one, on every surface", () => {
  // `isDeliveryTarget` has refused "null"/"undefined"/""/whitespace since AD-4,
  // and `readLandingDeliveryTarget` and the settings read both consult it. The
  // status payload did not, so one org read step 3 as done on the setup screen
  // and "no Slack channel is connected" on the other two — and the settings link
  // on `/`, gated on the address being absent, hid from exactly those users.
  const SENTINELS: readonly string[] = ["null", "undefined", "   "];

  for (const sentinel of SENTINELS) {
    test(`a channel_id of ${JSON.stringify(sentinel)} yields no address and the pick prompt`, async () => {
      const lane = await seedLane(`sentinel-${sentinel.trim() === "" ? "blank" : sentinel}`);

      await readRawRows(
        db,
        sql`INSERT INTO slack_connections
              (id, organization_id, channel_id, credential_ciphertext, credential_key_id,
               is_active, connected_by_user_id, connected_at)
            VALUES (${randomUUID()}, ${lane.organizationId}, ${sentinel}, ${CIPHERTEXT},
                    ${CREDENTIAL_KEY_ID}, true, ${lane.userId}, ${CONNECTED_AT.toISOString()})`,
      );

      const payload = await statusFor(lane);

      expect(payload.channelId).toBeNull();
      expect(payload.slackNotice).toBe(SLACK_CHANNEL_PICK_PROMPT);
      expect(payload[NEW_PAYLOAD_FIELD]).toBe(true);
    });
  }

  test("REGRESSION BASELINE: a real address still reads as one", async () => {
    const payload = await statusFor(connected);

    expect(payload.channelId).toBe(CHANNEL_ID);
    expect(payload.slackNotice).toBeNull();
  });
});

describe("the setup chain, for a workspace with no channel (AD-4 rows 4-5)", () => {
  test("SetupFacts.deliveryResolved is false — a workspace is not somewhere to deliver", async () => {
    await nullChannelConnection();
    const facts = setupFactsFrom(await statusFor(attached));

    expect(facts.deliveryResolved).toBe(false);
  });

  test("canArm is false — the watch is not offered when nothing could be delivered", async () => {
    await nullChannelConnection();
    const facts = setupFactsFrom(await statusFor(attached));

    expect(canArm(facts)).toBe(false);
  });

  test("the chain names `channel` — the mid-OAuth window finally has a sentence", async () => {
    await nullChannelConnection();
    const payload = await statusFor(attached);
    requireWidenedPayload(payload);

    expect(nextBlocker(setupFactsFrom(payload))?.id).toBe("channel");
  });

  test("REGRESSION BASELINE: a fully connected org resolves delivery and can arm", async () => {
    const facts = setupFactsFrom(await statusFor(connected));

    expect(facts.deliveryResolved).toBe(true);
    expect(canArm(facts)).toBe(true);
    expect(nextBlocker(facts)?.id).toBe("arm");
  });
});

describe("the client derives the chain's facts from the payload (D11 — the wire)", () => {
  const CLIENT = "apps/web/components/first-run/FirstRunClient.tsx";

  test("FirstRunClient reads slackWorkspaceAttached rather than re-deriving it from channelId", () => {
    const code = codeOf(CLIENT);

    // D11 - status.ts computing the flag and the chain accepting it are both green with nothing connecting them; this scan is the wire.
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

    // A scan because the failure it guards is an EDIT - folding the new flag into this line is the single change that would let a channel-less org arm.
    expect(line).toContain("channelId");
    expect(line).toContain("slackSkippedAt");
    expect(line).not.toContain(NEW_PAYLOAD_FIELD);
  });
});

describe("the delivery guard refuses a connection with no channel (AD-4 row 6)", () => {
  test("a connection whose channelId is null is not a delivery target", async () => {
    const isDeliveryTarget = await loadGuard();

    expect(isDeliveryTarget({ channelId: null })).toBe(false);
  });

  test("a stringified null is not a delivery target either — THE CORRUPTION ROW", async () => {
    const isDeliveryTarget = await loadGuard();

    for (const shape of ["null", "undefined", "", "   "]) {
      expect(`${shape}:${isDeliveryTarget({ channelId: shape })}`).toBe(`${shape}:false`);
    }
  });

  test("a real channel id IS a delivery target — the guard is not vacuously closed", async () => {
    const isDeliveryTarget = await loadGuard();

    // Control - without it a guard that returned false unconditionally would pass every assertion above.
    expect(isDeliveryTarget({ channelId: CHANNEL_ID })).toBe(true);
  });
});

describe("the delivery lane's population, over a workspace with no channel", () => {
  test("the null-channel org yields no delivery target, and the connected one still does", async () => {
    await nullChannelConnection();
    const isDeliveryTarget = await loadGuard();

    const population = await listOrgsWithActiveSlackConnection(db);
    const postable = population
      .filter((row) => isDeliveryTarget(row as unknown as { readonly channelId: string | null }))
      .map((row) => row.organizationId);

    expect(postable).not.toContain(attached.organizationId);
    // Control - without it an empty population (a broken read, a wrong filter) would pass the assertion above.
    expect(postable).toContain(connected.organizationId);
  });

  test("the reader never stringifies a NULL channel into the four characters null", async () => {
    await nullChannelConnection();

    // Scoped to the three lanes this suite seeds. The sentinel suite above writes
    // rows that genuinely hold "null" as data, and over the whole population this
    // assertion could no longer tell a coerced NULL from an honest sentinel —
    // which is the one thing it is here to catch.
    const seeded = new Set([attached, connected, bare].map((lane) => lane.organizationId));

    const channels = (await listOrgsWithActiveSlackConnection(db))
      .filter((row) => seeded.has(row.organizationId))
      .map((row) => (row as unknown as Record<string, unknown>).channelId);

    expect(channels).not.toContain("null");
    expect(channels).not.toContain("undefined");
    // Control - the connected org's real channel is still here, so the two assertions above cannot be green on an empty list.
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
