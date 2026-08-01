// `existsAnyActiveSlackConnection` — AD-14's existence gate, driven against
// real SQL. Wave 0g, ADOPTED ORPHAN. Fixture seed prefix `o008g-`.
//
// ###########################################################################
// # THIS FILE HAS NO ADD §9 ROW, AND THAT IS WHY IT EXISTS.
// #
// # Wave 0e wrote the two `resolveDeliveryComposition` rows in
// # `worker/__tests__/delivery-composition.test.ts` and flagged their own
// # limit, verbatim: "It CANNOT catch a gate that is present and wrong — an
// # `existsAnyActiveSlackConnection` whose SQL is inverted would pass this
// # row. That query's own behaviour is Wave 2's, provable against
// # `createTestDb()` in `packages/db/__tests__/system/`, and 0f/0g should carry
// # a row there. FLAGGED."
// #
// # `resolveDeliveryComposition` is module-private in `worker/src/index.ts` and
// # reaches its database through a real `pg.Pool`, so those two rows had to be
// # SOURCE SCANS. A source scan proves the gate is CALLED. Nothing in the 208
// # proves it is RIGHT.
// #
// # Wave 0f was offered this row and handed it back explicitly ("it needs real
// # SQL against `createTestDb()` in a package I do not own"). It is taken here.
// # It is a **209th row**, named as an addition to the ADD's count rather than
// # smuggled into it.
// ###########################################################################
//
// WHAT AN INVERTED PREDICATE COSTS, WHICH IS WHY THIS IS WORTH A FILE.
// AC-O12 is the self-host promise: an installation with no Slack connection
// gets a graceful absence log and a `null` composition, forever, silently and
// correctly. Invert the predicate and BOTH ends break at once — every
// self-hoster with no Slack starts resolving a real poster factory and the tick
// begins reporting lane errors instead of honest absence, while every customer
// who HAS connected Slack gets `null` and never receives a finding. Neither
// failure throws. Neither fails a type. And the row that was supposed to catch
// it reports green, because the string `existsAnyActiveSlackConnection` is
// right there in the source.
//
// SCOPE, STATED BECAUSE IT IS EASY TO GET BACKWARDS. This function is
// **ORG-AGNOSTIC BY CONTRACT** — AD-14's call site is `existsAnyActiveSlackConnection(db)`
// with no tenant context, and the precedent map pairs it with
// `listAnalysableProjects`, the other org-agnostic system read behind the
// `"./system"` subpath. It answers a question about the INSTALLATION, not about
// an organization, and the rows below assert exactly that: an active connection
// in ANY org makes it true. **A row asserting per-org scoping here would be
// inventing a contract the ADD does not declare** — the per-org address is
// resolved one layer out, by `createDeliveryLaneSource` reading the channel off
// the connection row (AD-15), which is where the D7 question actually lands.
//
// EVERY ROW IS RED TODAY. Wave 2 owns both the table (`slack_connections`,
// migration `0009_*`) and the export. `packages/db/src/system/index.ts` EXISTS
// and does not export this function yet, so the loader's namespace lookup is
// what produces the named diagnostic rather than a resolution failure.
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
import { laneNames } from "../helpers/db-lane-fixtures";
import { seedOrgWithOwner } from "../helpers/fixtures";
import type { CreateSlackConnectionsRepo } from "../helpers/onboarding-contract";

const NAMES = laneNames("o008g");

const OWNER_SYSTEM = "ADD Wave 2 (packages/db/src/system/index.ts, AD-14 precedent map)";
const OWNER_REPO =
  "ADD Wave 2 (packages/db/src/repositories/slack-connections.repo.ts, AD-8/AD-20)";

/**
 * AD-14's call shape, mirrored: ONE argument, and it is the database.
 *
 * The arity is the contract. A signature that grew a `ctx` would mean the gate
 * had quietly become per-organization, and `resolveDeliveryComposition` — which
 * runs in a worker with no user and no tenant context — would have nothing to
 * pass it.
 */
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

/**
 * A deterministic 32-byte AES key for the envelope column.
 *
 * NOT REAL KEY MATERIAL, and it never can be — this repository is public
 * (`AGENTS.md`), so no fixture in it will ever carry a usable secret. The same
 * shape `slack-connections.repo.test.ts` uses, for the same reason.
 */
const KEY: CredentialKey = {
  key: Buffer.from(Array.from({ length: 32 }, (_, index) => index)),
  keyId: "",
} as unknown as CredentialKey;

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

/** Insert one active connection for an org, through the real repository. */
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

  // --- row 1 ---------------------------------------------------------------
  test("an installation with no connection row at all answers false", async () => {
    const exists = await loadExists();

    // The self-host baseline, and the ONLY state a fresh `docker compose up`
    // is ever in. AC-O12 turns this answer into the graceful-absence log; get
    // it wrong and every self-hoster's worker starts reporting lane errors on
    // its first tick, before they have connected anything to report on.
    expect(await exists(db)).toBe(false);
  });

  // --- row 2 ---------------------------------------------------------------
  test("one active connection anywhere in the installation answers true", async () => {
    const exists = await loadExists();
    const createRepo = await loadCreateRepo();
    const org = await seedOrg(db, "one-active");

    await connect(db, createRepo, org);

    expect(await exists(db)).toBe(true);
  });

  // --- row 3 ---------------------------------------------------------------
  //
  // THE ROW THAT CATCHES THE INVERSION. Rows 1 and 2 are both satisfied by a
  // predicate that merely counts rows — `SELECT EXISTS (SELECT 1 FROM
  // slack_connections)` passes both and is wrong. This one does not: a
  // deactivated connection is a ROW THAT EXISTS and a connection that does not.
  test("an installation whose only connection is deactivated answers false", async () => {
    const exists = await loadExists();
    const createRepo = await loadCreateRepo();
    const org = await seedOrg(db, "only-deactivated");

    const id = await connect(db, createRepo, org);
    await createRepo(db, org.ctx).deactivate(id);

    // The row is still there — `deactivate` flips `is_active`, it does not
    // delete history, exactly as FR-O9's "everything already collected is kept"
    // requires one table over. So a predicate that forgets `is_active` reports
    // a connected installation forever after the first disconnect, and every
    // finding is composed against a credential nobody can use.
    expect(await exists(db)).toBe(false);

    // ...and the org's own read agrees, so this is a fact about the data rather
    // than about one query's opinion of it.
    expect(await createRepo(db, org.ctx).getActiveForOrg()).toBeNull();
  });

  // --- row 4 ---------------------------------------------------------------
  test("a second organization connecting does not throw and still answers true", async () => {
    const exists = await loadExists();
    const createRepo = await loadCreateRepo();
    const first = await seedOrg(db, "multi-a");
    const second = await seedOrg(db, "multi-b");

    await connect(db, createRepo, first);
    await connect(db, createRepo, second, "C09ZZ9ZZ9ZZ");

    // D3, and it is a real hazard rather than a formality: the partial unique
    // index is `(organization_id) WHERE is_active`, so MANY active rows across
    // MANY orgs is the normal, correct state of any multi-tenant installation.
    // A gate written as `SELECT ... INTO one row` or `.single()` throws there,
    // and it throws in the composition root at worker boot — taking delivery
    // down for every customer on the installation the moment the second one
    // connects.
    expect(await exists(db)).toBe(true);
  });

  // --- row 5 ---------------------------------------------------------------
  test("one org's disconnect does not switch off delivery for the installation", async () => {
    const exists = await loadExists();
    const createRepo = await loadCreateRepo();
    const staying = await seedOrg(db, "staying");
    const leaving = await seedOrg(db, "leaving");

    await connect(db, createRepo, staying);
    const leavingId = await connect(db, createRepo, leaving, "C08YY8YY8YY");

    await createRepo(db, leaving.ctx).deactivate(leavingId);

    // The complement of row 3, and the reason the gate is org-AGNOSTIC. It asks
    // "is delivery worth composing on this installation at all", and one
    // organization revoking its token is not an answer to that question. A
    // predicate that latched on the most recent write — or that resolved an
    // implicit "current" org — would silence every other customer's findings on
    // a disconnect they had nothing to do with.
    expect(await exists(db)).toBe(true);

    // And the two orgs' own reads still disagree with each other, which is what
    // makes the assertion above a claim about the INSTALLATION rather than a
    // coincidence of one org's state.
    expect(await createRepo(db, staying.ctx).getActiveForOrg()).not.toBeNull();
    expect(await createRepo(db, leaving.ctx).getActiveForOrg()).toBeNull();
  });
});
