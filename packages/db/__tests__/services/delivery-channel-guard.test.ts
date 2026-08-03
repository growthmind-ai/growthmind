// B-036's hinge: the guard here and the predicate in `@growthmind/shared` held the
// same three strings independently, in two packages, and nothing failed if they
// drifted. This suite is the thing that fails.
//
// It also drives the THIRD home — `attachChannel`'s fill guard, which is SQL and
// cannot call a predicate. Matching `channel_id IS NULL` alone left a row holding
// "null" permanently unfillable, with no disconnect control anywhere in the app.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { isDeliveryAddress } from "@growthmind/shared";

import { createSlackConnectionsRepo } from "../../src/repositories/slack-connections.repo";
import { isDeliveryTarget } from "../../src/services/delivery-channel-guard";
import { createTestDb, laneNames, seedOrgWithOwner, type TestDb } from "../../src/testing";
import { readRawRows } from "../helpers/onboarding-contract";
import { sql } from "drizzle-orm";

const NAMES = laneNames("delivery-address");

const CIPHERTEXT = "v1.00000000.aaaa.bbbb.cccc";
const CREDENTIAL_KEY_ID = "00000000";
const CONNECTED_AT = new Date("2026-08-01T09:00:00.000Z");

const REAL_CHANNEL = "C01AB2CD3EF";
const OTHER_CHANNEL = "C09ZY8XW7VU";

const CORPUS: readonly (string | null)[] = [
  null,
  "",
  " ",
  "   ",
  "\t",
  "null",
  "NULL",
  " null ",
  "undefined",
  "UNDEFINED",
  REAL_CHANNEL,
  `  ${REAL_CHANNEL}  `,
  "general",
  "C0NULL123",
];

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  const handle = await createTestDb();
  db = handle.db;
  close = handle.close;
});

afterAll(async () => {
  await close?.();
});

async function seedConnectionWith(label: string, channelId: string | null) {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });

  await readRawRows(
    db,
    sql`INSERT INTO slack_connections
          (id, organization_id, channel_id, credential_ciphertext, credential_key_id,
           is_active, connected_by_user_id, connected_at)
        VALUES (${randomUUID()}, ${org.organizationId}, ${channelId}, ${CIPHERTEXT},
                ${CREDENTIAL_KEY_ID}, true, ${org.userId}, ${CONNECTED_AT.toISOString()})`,
  );

  return org;
}

describe("the guard and the shared predicate cannot disagree (B-036)", () => {
  test("every value in the corpus gets the same answer from both", () => {
    for (const value of CORPUS) {
      const shared = isDeliveryAddress(value);
      const guard = isDeliveryTarget({ channelId: value });

      expect(`${JSON.stringify(value)} shared=${shared} guard=${guard}`).toBe(
        `${JSON.stringify(value)} shared=${shared} guard=${shared}`,
      );
    }
  });

  test("the corpus contains both answers, so agreement is not vacuous", () => {
    const answers = CORPUS.map((value) => isDeliveryAddress(value));

    expect(answers).toContain(true);
    expect(answers).toContain(false);
  });

  test("the guard narrows, so a caller needs no non-null assertion", () => {
    const connection = { channelId: REAL_CHANNEL as string | null, id: "row" };

    if (!isDeliveryTarget(connection)) {
      throw new Error("unreachable — a real channel is a delivery target");
    }

    const address: string = connection.channelId;
    expect(address).toBe(REAL_CHANNEL);
  });
});

describe("attachChannel fills anything that is not yet an address, and moves nothing that is", () => {
  for (const [index, sentinel] of ["null", "undefined", "   ", ""].entries()) {
    test(`a row holding ${JSON.stringify(sentinel)} can still be given a real channel`, async () => {
      const org = await seedConnectionWith(`fill-${index}`, sentinel);
      const repo = createSlackConnectionsRepo(db, org.ctx);

      const filled = await repo.attachChannel(REAL_CHANNEL);

      expect(filled?.channelId).toBe(REAL_CHANNEL);
      expect(isDeliveryTarget({ channelId: filled?.channelId ?? null })).toBe(true);
    });
  }

  test("a NULL row is still filled — the case the guard already handled", async () => {
    const org = await seedConnectionWith("fill-null-column", null);

    expect(
      (await createSlackConnectionsRepo(db, org.ctx).attachChannel(REAL_CHANNEL))?.channelId,
    ).toBe(REAL_CHANNEL);
  });

  test("a chosen address is never moved — widening the fill must not become a re-point", async () => {
    // The delivery dedup key is `(organization_id, finding_id, channel_id)`. Moving a
    // chosen channel forks every recorded identity and replays the org's backlog.
    const org = await seedConnectionWith("no-repoint", REAL_CHANNEL);
    const repo = createSlackConnectionsRepo(db, org.ctx);

    expect(await repo.attachChannel(OTHER_CHANNEL)).toBeNull();
    expect((await repo.getActiveForOrg())?.channelId).toBe(REAL_CHANNEL);
  });

  test("the fill is organization-scoped — one org's attach leaves another's row alone", async () => {
    const mine = await seedConnectionWith("scope-mine", null);
    const theirs = await seedConnectionWith("scope-theirs", null);

    await createSlackConnectionsRepo(db, mine.ctx).attachChannel(REAL_CHANNEL);

    expect(
      (await createSlackConnectionsRepo(db, theirs.ctx).getActiveForOrg())?.channelId,
    ).toBeNull();
  });
});
