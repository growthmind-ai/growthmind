// `readChannelView` is what binds /channel to the org's own rows — four reads joined under
// one tenant context — and nothing exercised it. Two things are proved here: the join stays
// inside the boundary, and a read that failed never comes back wearing the shape of a
// workspace where nothing has happened yet.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createDeliveriesRepo,
  createSlackConnectionsRepo,
  sha256Hex,
  type ScopedDb,
} from "@growthmind/db";
import {
  createTestDb,
  PLACEHOLDER_CREDENTIAL_CIPHERTEXT,
  PLACEHOLDER_CREDENTIAL_KEY_ID,
  seedOrgWithOwner,
  seedProject,
  type SeededOrgWithOwner,
  type TestDb,
} from "@growthmind/db/testing";

import { RENDERED_MESSAGE_VERSION, type RenderedMessage } from "@growthmind/shared";

import { readChannelView } from "../../components/channel/read";
import { parkTable } from "../helpers/parked-table";

const NOW = new Date("2026-08-05T12:00:00.000Z");

const CHANNEL = "C0FIN9K2X";

const RENDERED: RenderedMessage = {
  version: RENDERED_MESSAGE_VERSION,
  blocks: [{ kind: "section", text: "*/settings/team*\nInvites fail silently." }],
  text: "/settings/team",
  legibility: { characters: 40, lines: 2 },
};

interface SeededOrg {
  readonly org: SeededOrgWithOwner;
  readonly projectId: string;
  readonly deliveryIds: readonly string[];
}

async function seedOrgWithRecord(
  db: TestDb,
  label: string,
  findings: readonly string[],
): Promise<SeededOrg> {
  const org = await seedOrgWithOwner(db, {
    orgName: `web-channel-${label}`,
    userName: `web-channel-${label}`,
    email: `web-channel-${label}@example.com`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `web-channel-${label}`,
  });

  await createSlackConnectionsRepo(db, org.ctx).insertActive({
    channelId: CHANNEL,
    credentialCiphertext: PLACEHOLDER_CREDENTIAL_CIPHERTEXT,
    credentialKeyId: PLACEHOLDER_CREDENTIAL_KEY_ID,
    connectedAt: new Date("2026-08-01T00:00:00.000Z"),
  });

  const deliveries = createDeliveriesRepo(db, org.ctx);
  const deliveryIds: string[] = [];

  for (const findingId of findings) {
    const claimed = await deliveries.claimForPost({
      projectId: project.id,
      findingId,
      signature: sha256Hex(`apps/web channel:${findingId}`),
      channelId: CHANNEL,
      claimedAt: new Date("2026-08-05T11:00:00.000Z"),
      staleClaimsBefore: new Date("2026-08-05T10:00:00.000Z"),
    });

    if (!claimed.claimed) throw new Error(`seed: ${findingId} was not claimed`);
    deliveryIds.push(claimed.delivery.id);
  }

  return { org, projectId: project.id, deliveryIds };
}

function viewFor(db: ScopedDb, seeded: SeededOrg) {
  return readChannelView({
    db,
    ctx: seeded.org.ctx,
    projectId: seeded.projectId,
    nowMs: NOW.getTime(),
  });
}

describe("the record one organization can see", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("every card is this organization's, and no id belonging to the other one appears", async () => {
    const mine = await seedOrgWithRecord(db, "mine", ["mine-a", "mine-b"]);
    const theirs = await seedOrgWithRecord(db, "theirs", ["theirs-a", "theirs-b"]);

    const view = await viewFor(db, mine);
    const ids = view.cards.map((card) => card.id);

    expect(ids.toSorted()).toEqual([...mine.deliveryIds].toSorted());
    for (const id of theirs.deliveryIds) {
      expect(ids).not.toContain(id);
    }

    expect(view.counts.total).toBe(2);
    expect(view.connection.kind).toBe("delivering");
  });
});

describe("a read that failed is never the shape of a workspace where nothing has happened", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("an unreadable record is not an empty one, and says nothing about the connection", async () => {
    const seeded = await seedOrgWithRecord(db, "record-unread", ["a"]);

    const unread = await parkTable(db, "deliveries", () => viewFor(db, seeded));
    const populated = await viewFor(db, seeded);

    expect(unread.unread.record).toBe(true);
    expect(unread.cards).toEqual([]);
    expect(populated.unread.record).toBe(false);
    expect(populated.cards.length).toBe(1);

    // The page reads `unread.record` before it reads the card count, so these two cannot
    // paint the same thing — which is the whole defect this suite exists for.
    expect(unread).not.toEqual(populated);

    // The connection read answered, and its answer survives its neighbour's failure.
    expect(unread.connection).toEqual({ kind: "delivering", channel: "the connected channel" });

    // Nothing is claimed over a denominator nobody could count.
    expect(unread.counts.total).toBe(0);
    expect(unread.truncatedAt).toBeNull();
  });

  test("an unreadable record is still not an empty one when the workspace genuinely is empty", async () => {
    const empty = await seedOrgWithRecord(db, "record-unread-empty", []);

    const unread = await parkTable(db, "deliveries", () => viewFor(db, empty));
    const genuinely = await viewFor(db, empty);

    expect(genuinely.unread.record).toBe(false);
    expect(genuinely.cards).toEqual([]);
    expect(unread.unread.record).toBe(true);
    expect(unread).not.toEqual(genuinely);
  });

  test("an unreadable connection is not a disconnected one, so nothing is offered to reconnect", async () => {
    const seeded = await seedOrgWithRecord(db, "connection-unread", ["a"]);

    const unread = await parkTable(db, "slack_connections", () => viewFor(db, seeded));

    expect(unread.connection).toEqual({ kind: "unavailable" });
    expect(unread.connection.kind).not.toBe("disconnected");
    expect(unread.connection.kind).not.toBe("never_connected");

    // The record read answered, so the cards it produced are untouched by the failure beside it.
    expect(unread.cards.length).toBe(1);
    expect(unread.unread.record).toBe(false);
  });

  test("both reads failing is still stated, and never the invitation to connect Slack", async () => {
    const seeded = await seedOrgWithRecord(db, "both-unread", ["a"]);

    const unread = await parkTable(db, "slack_connections", () =>
      parkTable(db, "deliveries", () => viewFor(db, seeded)),
    );

    expect(unread.connection).toEqual({ kind: "unavailable" });
    expect(unread.unread.record).toBe(true);
  });

  test("a dismissal we could not read leaves the card standing and says the line may be missing", async () => {
    const seeded = await seedOrgWithRecord(db, "dismissal-unread", ["a"]);
    await createDeliveriesRepo(db, seeded.org.ctx).markPosted({
      findingId: "a",
      channelId: CHANNEL,
      postedAt: new Date("2026-08-05T11:01:00.000Z"),
      messageRef: "1754390460.000100",
      renderedMessage: RENDERED,
    });

    const unread = await parkTable(db, "dismissals", () => viewFor(db, seeded));
    const read = await viewFor(db, seeded);

    expect(unread.unread.dismissals).toBe(true);
    expect(read.unread.dismissals).toBe(false);

    // The record itself answered, so the card is still there and still says it was posted.
    expect(unread.cards.length).toBe(1);
    expect(unread.cards[0]?.state).toBe("posted");
  });

  test("a lane we could not read is not a project that has never been checked", async () => {
    const seeded = await seedOrgWithRecord(db, "lane-unread", ["a"]);

    const unread = await parkTable(db, "delivery_decisions", () => viewFor(db, seeded));
    const never = await viewFor(db, seeded);

    // Never checked is a line that says "nothing is wrong". A failed read must not borrow it.
    expect(never.lane?.head).toBe("We have not looked yet.");
    expect(unread.lane).toBeNull();
    expect(unread.unread.lane).toBe(true);
    expect(unread.unread.laneHistory).toBe(true);
  });
});
