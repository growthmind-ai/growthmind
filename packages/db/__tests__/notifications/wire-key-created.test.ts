// D11 wire for ADD §4.1: the REAL mint() is the emitter of key_created, and the payload
// arm carries nothing — the strongest available form of "the emit cannot see the secret",
// asserted against the stored row and the payload rather than a code review (AC-11).
// RED in Wave 0: mint() does not emit yet.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { buildKeyCreatedDedupKey, hashApiKeyMaterial } from "@growthmind/shared";

import { createApiKeysRepo } from "../../src/repositories/api-keys.repo";
import { notifications } from "../../src/schema/notifications";
import {
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("wire-key-created");

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function seedOrg(label: string): Promise<SeededOrgWithOwner> {
  return seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
}

async function keyCreatedRows(organizationId: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.organizationId, organizationId), eq(notifications.type, "key_created")),
    );
}

test("minting a key emits one act_now notification carrying neither the raw key nor its hash", async () => {
  const org = await seedOrg("mint");

  const minted = await createApiKeysRepo(db, org.ctx).mint({ name: "wire agent" });

  const rows = await keyCreatedRows(org.organizationId);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("mint() emitted no key_created notification");

  expect(row.subjectKind).toBe("agent_key");
  expect(row.subjectId).toBe(minted.key.id);
  expect(row.actorUserId).toBe(org.userId);
  expect(row.dedupKey).toBe(buildKeyCreatedDedupKey(minted.key.id));

  // The payload arm carries nothing but its discriminant, so there is no field the secret
  // could ever ride in.
  expect(row.payload).toEqual({ type: "key_created", v: 1 });

  const serialisedRow = JSON.stringify(row);
  const serialisedPayload = JSON.stringify(row.payload);
  for (const serialised of [serialisedRow, serialisedPayload]) {
    expect(serialised).not.toContain(minted.raw);
    expect(serialised).not.toContain(hashApiKeyMaterial(minted.raw));
  }
});

test("a second mint is a second fact, not a conflict — per-mint dedup on the minted key id", async () => {
  const org = await seedOrg("mint-again");
  const repo = createApiKeysRepo(db, org.ctx);

  const first = await repo.mint({ name: "wire agent one" });
  const second = await repo.mint({ name: "wire agent two" });

  const rows = await keyCreatedRows(org.organizationId);
  expect(rows).toHaveLength(2);

  const dedupKeys = rows.map((row) => row.dedupKey).toSorted();
  expect(dedupKeys).toEqual(
    [buildKeyCreatedDedupKey(first.key.id), buildKeyCreatedDedupKey(second.key.id)].toSorted(),
  );
});
