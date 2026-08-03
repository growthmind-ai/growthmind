import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  credentialAad,
  encryptSecret,
  keyIdOf,
  type CredentialKey,
  type TenantContext,
} from "@growthmind/shared";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import type { ScopedDb } from "../../src/repositories/types";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../../src/testing";
import { seedOrgWithOwner } from "../../src/testing";
import type { CreateSlackConnectionsRepo } from "../helpers/onboarding-contract";

const NAMES = laneNames("o008g");

const OWNER_SYSTEM = "ADD Wave 2 (packages/db/src/system/index.ts, AD-14 precedent map)";
const OWNER_REPO =
  "ADD Wave 2 (packages/db/src/repositories/slack-connections.repo.ts, AD-8/AD-20)";

type ExistsAnyActiveSlackConnection = (db: ScopedDb) => Promise<boolean>;

const loadExists = (): Promise<ExistsAnyActiveSlackConnection> =>
  loadUnderConstruction<ExistsAnyActiveSlackConnection>({
    modulePath: underConstructionSpecifier("packages/db/src/system/index"),
    exportName: "existsAnyActiveSlackConnection",
    ownedBy: OWNER_SYSTEM,
  });

const loadCreateRepo = (): Promise<CreateSlackConnectionsRepo> =>
  loadUnderConstruction<CreateSlackConnectionsRepo>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/slack-connections.repo"),
    exportName: "createSlackConnectionsRepo",
    ownedBy: OWNER_REPO,
  });

const KEY: CredentialKey = { bytes: Uint8Array.from({ length: 32 }, (_, index) => index) };

const CHANNEL_ID = "C01AB2CD3EF";
const CONNECTED_AT = new Date("2026-08-01T09:00:00.000Z");

interface SeededOrg {
  readonly organizationId: string;
  readonly ctx: TenantContext;
  readonly ownerUserId: string;
}

async function seedOrg(db: TestDb, label: string): Promise<SeededOrg> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });

  return { organizationId: org.organizationId, ctx: org.ctx, ownerUserId: org.userId };
}

async function connect(
  db: TestDb,
  createRepo: CreateSlackConnectionsRepo,
  org: SeededOrg,
  channelId: string = CHANNEL_ID,
): Promise<string> {
  const inserted = await createRepo(db, org.ctx).insertActive({
    channelId,
    credentialCiphertext: encryptSecret(
      "xoxb-not-a-real-token",
      KEY,
      credentialAad(org.organizationId, "slack"),
    ),
    credentialKeyId: keyIdOf(KEY),
    connectedByUserId: org.ownerUserId,
    connectedAt: CONNECTED_AT,
  });

  return inserted.id;
}

describe("existsAnyActiveSlackConnection — the installation's delivery gate (AD-14)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("an installation with no connection row at all answers false", async () => {
    const exists = await loadExists();

    expect(await exists(db)).toBe(false);
  });

  test("one active connection anywhere in the installation answers true", async () => {
    const exists = await loadExists();
    const createRepo = await loadCreateRepo();
    const org = await seedOrg(db, "one-active");

    await connect(db, createRepo, org);

    expect(await exists(db)).toBe(true);
  });

  test("an installation whose only connection is deactivated answers false", async () => {
    const exists = await loadExists();
    const createRepo = await loadCreateRepo();

    const { db: solo, close: closeSolo } = await createTestDb();
    try {
      const org = await seedOrg(solo, "only-deactivated");

      const id = await connect(solo, createRepo, org);
      await createRepo(solo, org.ctx).deactivate(id);

      expect(await exists(solo)).toBe(false);

      expect(await createRepo(solo, org.ctx).getActiveForOrg()).toBeNull();
    } finally {
      await closeSolo();
    }
  });

  test("a second organization connecting does not throw and still answers true", async () => {
    const exists = await loadExists();
    const createRepo = await loadCreateRepo();
    const first = await seedOrg(db, "multi-a");
    const second = await seedOrg(db, "multi-b");

    await connect(db, createRepo, first);
    await connect(db, createRepo, second, "C09ZZ9ZZ9ZZ");

    expect(await exists(db)).toBe(true);
  });

  test("one org's disconnect does not switch off delivery for the installation", async () => {
    const exists = await loadExists();
    const createRepo = await loadCreateRepo();
    const staying = await seedOrg(db, "staying");
    const leaving = await seedOrg(db, "leaving");

    await connect(db, createRepo, staying);
    const leavingId = await connect(db, createRepo, leaving, "C08YY8YY8YY");

    await createRepo(db, leaving.ctx).deactivate(leavingId);

    expect(await exists(db)).toBe(true);

    expect(await createRepo(db, staying.ctx).getActiveForOrg()).not.toBeNull();
    expect(await createRepo(db, leaving.ctx).getActiveForOrg()).toBeNull();
  });
});
