// AD-8 / AD-20 / FR-O10 — `slack_connections`. Wave 0d, task 0d.2. ADD §9, 7 rows.
//
// P-4 IS THE PERSONA THIS FILE PROTECTS: the teammate who set nothing up. The
// Slack connection is ORG-scoped, not actor-scoped, and every row below is a
// different way of saying so — a teammate reads it, a teammate loses it when
// anyone revokes it, and another organization never sees it at all.
//
// ###########################################################################
// # THE BOT TOKEN NEVER LEAVES THIS REPOSITORY, AND "NEVER" IS ENUMERATED
// #
// # `project_connections.repo.ts:8-12` already states the discipline for the
// # PostHog credential: no method returns credential material; the worker
// # reads the ciphertext through ONE named, org-keyed function that is
// # greppable by design. AD-8 and §5's Wave 2 table apply the same shape here
// # — `getActiveForOrg` / `insertActive` / `deactivate` return a
// # credential-free summary, and `openCredentialForOrg` is the single door.
// #
// # THE ROW AS §9 WORDS IT ("the bot token is returned by no repository
// # method") AND §5's METHOD LIST ARE IN TENSION, and it is resolved here in
// # the open rather than by picking one: the SUMMARY methods are enumerated
// # and must carry neither credential column, and a second leg asserts the
// # door is exactly ONE export and is named. Enumerating "no method at all"
// # would have forbidden the method §5 requires; asserting nothing would have
// # let a second, quieter door open later.
// ###########################################################################
//
// EVERY ROW IS RED TODAY: `packages/db/src/repositories/slack-connections.repo.ts`,
// `packages/db/src/schema/slack-connections.ts` and migration `0009_*` are all
// ADD Wave 2's. The loader turns that into a NAMED diagnostic rather than a
// TS2307 that would take the typecheck gate down.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  credentialAad,
  decryptSecret,
  encryptSecret,
  keyIdOf,
  type CredentialKey,
} from "@growthmind/shared";
import { sql } from "drizzle-orm";

import {
  loadUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import { makeTenantContext, seedMember, seedOrgWithOwner, seedUser } from "../helpers/fixtures";
import {
  captureRejection,
  readPgFailure,
  readRawScalar,
  type CreateSlackConnectionsRepo,
  type SlackConnectionSummary,
} from "../helpers/onboarding-contract";

const NAMES = laneNames("slack-conn");

const OWNER = "ADD Wave 2 (packages/db/src/repositories/slack-connections.repo.ts, AD-8/AD-20)";

const REPO_SOURCE_PATH = "packages/db/src/repositories/slack-connections.repo.ts";

const loadCreateRepo = (): Promise<CreateSlackConnectionsRepo> =>
  loadUnderConstruction<CreateSlackConnectionsRepo>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/slack-connections.repo"),
    exportName: "createSlackConnectionsRepo",
    ownedBy: OWNER,
  });

/**
 * A deterministic 32-byte AES key for the envelope rows.
 *
 * NOT REAL KEY MATERIAL, and it never can be: this repository is public
 * (AGENTS.md), so no fixture in it will ever carry a usable secret. The bytes
 * are `0..31` rather than all-zero so the "the key id is not a prefix of the
 * key material" assertion is testing something — an all-zero key encodes to a
 * long run of `A`s in base64, which would make any near-miss look like a pass.
 *
 * Built as a bare `CredentialKey` rather than through `resolveCredentialKey`,
 * exactly as `connections.service.test.ts:62` does, because the env gate is not
 * what this file is about.
 */
const KEY: CredentialKey = { bytes: Uint8Array.from({ length: 32 }, (_, index) => index) };

/** Shaped like a Slack bot token so a leak would be recognisable in a diff,
 *  and obviously invalid so it can never authenticate anywhere. */
const BOT_TOKEN = "xoxb-fixture-only-never-a-real-token";

const CHANNEL_ID = "C01AB2CD3EF";

const CONNECTED_AT = new Date("2026-08-01T09:00:00.000Z");

/** AD-20: the AAD's second argument is the LITERAL `"slack"`, never a project
 *  id — this connection is org-scoped and has no project. */
function slackEnvelopeFor(organizationId: string): string {
  return encryptSecret(BOT_TOKEN, KEY, credentialAad(organizationId, "slack"));
}

interface OrgWithTeammate {
  organizationId: string;
  owner: ReturnType<typeof makeTenantContext>;
  ownerUserId: string;
  teammate: ReturnType<typeof makeTenantContext>;
}

/**
 * An org with an owner AND a second member who set nothing up (P-4). Almost
 * every row below needs the teammate: an org-scoped resource that only its
 * creator can read is the D1 flagship bug, and a suite with one actor cannot
 * see it.
 */
async function seedOrgWithTeammate(db: TestDb, label: string): Promise<OrgWithTeammate> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const mate = await seedUser(db, {
    name: NAMES.userName(`${label}-mate`),
    email: NAMES.email(`${label}-mate`),
  });
  await seedMember(db, {
    organizationId: org.organizationId,
    userId: mate.id,
    role: "member",
  });

  return {
    organizationId: org.organizationId,
    owner: org.ctx,
    ownerUserId: org.userId,
    teammate: makeTenantContext({
      userId: mate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    }),
  };
}

async function readCredentialColumn(
  db: TestDb,
  connectionId: string,
  column: "credential_ciphertext" | "credential_key_id",
): Promise<unknown> {
  const query =
    column === "credential_ciphertext"
      ? sql`select credential_ciphertext from slack_connections where id = ${connectionId}`
      : sql`select credential_key_id from slack_connections where id = ${connectionId}`;
  return readRawScalar(db, query);
}

describe("slack_connections — the org's credential, and the teammate who set nothing up", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // --- row 1 ---------------------------------------------------------------
  test("a second active connection for one org is refused by the constraint", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "second-active");
    const repo = createSlackConnectionsRepo(db, org.owner);

    await repo.insertActive({
      channelId: CHANNEL_ID,
      credentialCiphertext: slackEnvelopeFor(org.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    const refusal = await captureRejection(() =>
      repo.insertActive({
        channelId: "C09ZZ9ZZ9ZZ",
        credentialCiphertext: slackEnvelopeFor(org.organizationId),
        credentialKeyId: keyIdOf(KEY),
        connectedByUserId: org.ownerUserId,
        connectedAt: CONNECTED_AT,
      }),
    );

    // EC-O6: BY CONSTRAINT, NEVER BY A PRIOR READ — and the Postgres code is
    // precisely what tells the two apart. A `getActiveForOrg()`-then-refuse
    // implementation produces a perfectly reasonable error with no `23505` and
    // no index name, and it loses the race the moment two members connect at
    // once (D6). Asserting the code is asserting that the DATABASE refused it.
    const failure = readPgFailure(refusal);
    expect(failure.code).toBe("23505");
    expect(`${failure.constraint ?? ""} ${failure.message}`).toContain(
      "slack_connections_active_org_uidx",
    );
  });

  // --- row 2 ---------------------------------------------------------------
  test("the bot token is returned by no repository method", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "no-token");
    const repo = createSlackConnectionsRepo(db, org.owner);
    const envelope = slackEnvelopeFor(org.organizationId);

    const inserted = await repo.insertActive({
      channelId: CHANNEL_ID,
      credentialCiphertext: envelope,
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });
    const read = await repo.getActiveForOrg();
    const deactivated = await repo.deactivate(inserted.id);

    // ENUMERATED, not sampled. Each summary method's ACTUAL runtime keys are
    // walked, because a structural type cannot refuse an extra property a
    // spread of the row would carry — and a spread is exactly how this leaks
    // (`project-connections.repo.ts:202-206`: field-by-field, never a spread).
    const summaries: [string, SlackConnectionSummary | null][] = [
      ["insertActive", inserted],
      ["getActiveForOrg", read],
      ["deactivate", deactivated],
    ];

    for (const [method, summary] of summaries) {
      expect(summary, `${method} returned nothing to enumerate`).not.toBeNull();
      const keys = Object.keys(summary as object);
      expect(keys, method).not.toContain("credentialCiphertext");
      expect(keys, method).not.toContain("credentialKeyId");

      // And no value carries it under some other name. The column could be
      // renamed on the way out and still be the same secret on the wire.
      const serialised = JSON.stringify(summary);
      expect(serialised, method).not.toContain(envelope);
      expect(serialised, method).not.toContain(BOT_TOKEN);
    }

    // THE ONE DOOR, AND IT IS SINGULAR AND NAMED. §5's Wave 2 table gives the
    // credential exactly one exit — `openCredentialForOrg()`, "composition-root
    // only" — mirroring the greppable-by-design function O-003 already uses for
    // the PostHog key. A second exported reader added later would make the
    // enumeration above true and the guarantee false.
    const source = readSourceUnderConstruction({
      repoRelativePath: REPO_SOURCE_PATH,
      ownedBy: OWNER,
    });
    const credentialReturningExports = [
      ...source.matchAll(/^\s*(?:export\s+)?(?:async\s+)?(\w+)\s*\(/gm),
    ]
      .map((match) => match[1] ?? "")
      .filter((name) => /credential|token|secret/i.test(name));
    expect(credentialReturningExports).toEqual(["openCredentialForOrg"]);
  });

  // --- row 3 ---------------------------------------------------------------
  test("the stored credential is an envelope bound to this organization", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "envelope");
    const other = await seedOrgWithTeammate(db, "envelope-other");
    const envelope = slackEnvelopeFor(org.organizationId);

    const inserted = await createSlackConnectionsRepo(db, org.owner).insertActive({
      channelId: CHANNEL_ID,
      credentialCiphertext: envelope,
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    const stored = await readCredentialColumn(db, inserted.id, "credential_ciphertext");

    // BYTE-FOR-BYTE WHAT THE CALLER SEALED. A prior audit found a CRITICAL
    // bypass where a normalising gate compared the RAW value while encryption
    // used the NORMALISED one; the persistence-layer version of that bug is a
    // repository that trims, re-cases or re-encodes the envelope on its way in.
    // The envelope's own fields are base64url, so any such touch decodes to
    // different bytes and the auth tag stops matching — silently, at poll time,
    // for one customer.
    expect(stored).toBe(envelope);

    // AD-20's binding, observed end to end: right AAD opens it…
    const opened = decryptSecret(String(stored), KEY, credentialAad(org.organizationId, "slack"));
    expect(opened).toEqual({ ok: true, value: BOT_TOKEN });

    // …and ANOTHER ORGANIZATION'S does not. A ciphertext lifted from one org's
    // row into another's fails authentication rather than decrypting — a
    // structural cross-tenant guard on the credential itself (D7), and a NAMED
    // result rather than a throw escaping into a delivery loop.
    const lifted = decryptSecret(String(stored), KEY, credentialAad(other.organizationId, "slack"));
    expect(lifted).toEqual({ ok: false, reason: "authentication_failed" });
  });

  // --- row 4 ---------------------------------------------------------------
  test("the credential key id is a fingerprint, never the key", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "fingerprint");

    const inserted = await createSlackConnectionsRepo(db, org.owner).insertActive({
      channelId: CHANNEL_ID,
      credentialCiphertext: slackEnvelopeFor(org.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    const storedKeyId = String(await readCredentialColumn(db, inserted.id, "credential_key_id"));

    // THE WIDTH IS THE POINT (`secret-box.ts:69-71`): eight hex chars is enough
    // to tell two live keys apart in a `WHERE credential_key_id = …` sweep, and
    // far too little to attack. A "key id" that grew to the key's own length
    // would be the D12 rotation story and a disclosure at the same time.
    expect(storedKeyId).toMatch(/^[0-9a-f]{8}$/);
    expect(storedKeyId).toBe(keyIdOf(KEY));

    // AND IT IS NOT THE KEY. `keyIdOf` is `sha256(bytes).slice(0, 8)` — a
    // one-way digest — so the stored value must appear nowhere in any encoding
    // of the key material. Checking all three encodings rather than one closes
    // the "we shortened the key instead of hashing it" mistake in whichever
    // form it arrives.
    const material = Buffer.from(KEY.bytes);
    for (const encoding of ["hex", "base64", "base64url"] as const) {
      expect(material.toString(encoding)).not.toContain(storedKeyId);
    }
  });

  // --- row 5 ---------------------------------------------------------------
  test("a deactivated connection is invisible to getActiveForOrg for every member", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "revoke");

    const inserted = await createSlackConnectionsRepo(db, org.owner).insertActive({
      channelId: CHANNEL_ID,
      credentialCiphertext: slackEnvelopeFor(org.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    // The teammate sees the org's connection BEFORE the revocation — without
    // this line the row below would pass against a repository that never showed
    // them anything in the first place (D2: an org-scoped resource read as
    // `where connected_by_user_id = actor` is invisible to everyone else, and
    // "invisible after revoke" is then vacuous).
    const teammateRepo = createSlackConnectionsRepo(db, org.teammate);
    expect((await teammateRepo.getActiveForOrg())?.id).toBe(inserted.id);

    await createSlackConnectionsRepo(db, org.owner).deactivate(inserted.id);

    // FR-O9: revocation is ORG-WIDE, not the actor's view. A teammate still
    // holding a live connection after the owner disconnected would keep
    // findings flowing to a workspace the org believes it has left.
    expect(await teammateRepo.getActiveForOrg()).toBeNull();
    expect(await createSlackConnectionsRepo(db, org.owner).getActiveForOrg()).toBeNull();
  });

  // --- row 6 ---------------------------------------------------------------
  test("another organization's connection is never returned", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const orgA = await seedOrgWithTeammate(db, "tenant-a");
    const orgB = await seedOrgWithTeammate(db, "tenant-b");

    const inserted = await createSlackConnectionsRepo(db, orgA.owner).insertActive({
      channelId: CHANNEL_ID,
      credentialCiphertext: slackEnvelopeFor(orgA.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: orgA.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    const fromB = createSlackConnectionsRepo(db, orgB.owner);

    // D7, the read side.
    expect(await fromB.getActiveForOrg()).toBeNull();

    // D7, the WRITE side — the half a read-only cross-tenant test misses. Org
    // B naming org A's connection id must affect zero rows and return `null`,
    // never a silent success that revokes another customer's delivery.
    expect(await fromB.deactivate(inserted.id)).toBeNull();
    expect((await createSlackConnectionsRepo(db, orgA.teammate).getActiveForOrg())?.id).toBe(
      inserted.id,
    );
  });

  // --- row 7 ---------------------------------------------------------------
  test("the table stamps organization_id directly, and every read filters on it", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "symmetry");

    const inserted = await createSlackConnectionsRepo(db, org.owner).insertActive({
      channelId: CHANNEL_ID,
      credentialCiphertext: slackEnvelopeFor(org.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    // THE STAMP — written directly onto the row, per AD-8's "Stamped directly,
    // per the `project_connections` denormalization discipline", never inferred
    // through a join to some other table.
    const stampedOrg = await readRawScalar(
      db,
      sql`select organization_id from slack_connections where id = ${inserted.id}`,
    );
    expect(stampedOrg).toBe(org.organizationId);

    // THE FILTER — the same column, under a DIFFERENT member's context. This is
    // the D2 hazard that produced the "No sessions yet at project scope, 17 at
    // org root" incident: a read narrowed by a column the write path never sets
    // matches zero rows and reads as "no data", not as an error. Nothing here
    // would raise; the screen would simply say the org has no Slack.
    const served = await createSlackConnectionsRepo(db, org.teammate).getActiveForOrg();
    expect(served?.id).toBe(inserted.id);
    expect(served?.organizationId).toBe(org.organizationId);
    expect(served?.channelId).toBe(CHANNEL_ID);
  });
});
