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

/** The channel chosen AFTER consent, on the OAuth path. Deliberately not
 *  `CHANNEL_ID`: an attach row that asserted the value it started from would
 *  pass against a repository that stamped nothing. */
const PICKED_CHANNEL = "C07PICKED01";

/** The address a SECOND attach tries to move the row to. Distinct from both of
 *  the above, so "the stored channel did not change" is an assertion about this
 *  value never landing rather than about two names that happen to match. */
const MOVED_CHANNEL = "C08MOVED002";

/** Slack's own name for the workspace, as the OAuth exchange reports it. */
const WORKSPACE_NAME = "Fixture workspace";

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

/** Removes comments so prose about a credential cannot be read as a
 *  declaration. Same approach as `no-org-param.test.ts:59-61`. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * A public name that could hand a caller credential material.
 *
 * MENTIONS a credential AND IS NOT A WRITE. Both halves are load-bearing.
 * Without the first, nothing is ever flagged; without the second,
 * `updateCredential` — which O-003's PostHog repository ships, and which takes
 * an envelope IN and returns a credential-free summary — reads as a door, and
 * Wave 2 gets a red for copying the pattern it was told to copy. A door is
 * something that RETURNS the secret, and the write verbs below cannot.
 */
const CREDENTIAL_DOOR = /credential|token|secret/i;
const WRITE_VERB = /^(?:update|set|insert|write|store|persist|rotate|replace|clear|delete|remove)/;

function isCredentialDoor(name: string): boolean {
  return CREDENTIAL_DOOR.test(name) && !WRITE_VERB.test(name);
}

/**
 * The names a module offers to the rest of the codebase: every exported
 * function, and every method declared on an exported interface.
 *
 * Written this way rather than as a grep over every `name(` in the file
 * because the invariant is about the module's SURFACE. A module-private
 * `decryptStoredCredential` helper is an implementation detail with no caller
 * outside the file; an exported one is a second door. The brace walk is the
 * trimmed form of `no-org-param.test.ts:110-144`'s collector — that file's
 * version also captures parameter lists, which nothing here needs.
 */
function publicSurfaceNames(source: string): Set<string> {
  const clean = stripComments(source);
  const names = new Set<string>();

  for (const match of clean.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)) {
    if (match[1]) names.add(match[1]);
  }

  const interfaceHead = /export\s+interface\s+\w+[^{]*\{/g;
  let head: RegExpExecArray | null = interfaceHead.exec(clean);
  while (head !== null) {
    let depth = 0;
    let end = clean.length;
    for (let i = head.index + head[0].length - 1; i < clean.length; i += 1) {
      const char = clean[i];
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = clean.slice(head.index + head[0].length, end);
    for (const method of body.matchAll(/(\w+)\s*(?:<[^>]*>)?\s*\(/g)) {
      if (method[1]) names.add(method[1]);
    }
    head = interfaceHead.exec(clean);
  }

  return names;
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
    // the PostHog key. A second PUBLIC reader added later would leave the
    // enumeration above true and the guarantee false.
    //
    // THE PUBLIC SURFACE ONLY (exported functions + exported interface
    // members), never every function in the file. A private helper is not a
    // door, and flagging one would push Wave 2 into renaming correct code.
    const source = readSourceUnderConstruction({
      repoRelativePath: REPO_SOURCE_PATH,
      ownedBy: OWNER,
    });
    const doors = [...publicSurfaceNames(source)].filter(isCredentialDoor).toSorted();
    expect(doors).toEqual(["openCredentialForOrg"]);
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

  // -------------------------------------------------------------------------
  // AD-4 — the write side of the half-connected window
  //
  // The reader side is enumerated in
  // `apps/web/__tests__/first-run/nullable-channel-readers.test.ts`. These rows
  // are the other half: the state has to be WRITABLE, and the channel has to be
  // fillable later without a payload ever naming a row.
  // -------------------------------------------------------------------------

  // --- row 8 ---------------------------------------------------------------
  test("a workspace can be attached with no channel, and the row is active", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "attach-null");

    const inserted = await createSlackConnectionsRepo(db, org.owner).insertActive({
      channelId: null,
      workspaceName: WORKSPACE_NAME,
      credentialCiphertext: slackEnvelopeFor(org.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    expect(inserted.channelId).toBeNull();

    // NULL IN THE COLUMN, not the empty string. A sentinel would make "no
    // channel" and "a channel named nothing" the same value, and every reader
    // downstream would have to know which one this table chose.
    expect(
      await readRawScalar(
        db,
        sql`select channel_id from slack_connections where id = ${inserted.id}`,
      ),
    ).toBeNull();

    // AND IT IS ACTIVE. A half-connected workspace is not a deactivated one —
    // the token is real, so `getActiveForOrg` must find it and the org's one
    // active slot is taken. A row that were inactive here would leave the next
    // consent creating a second installation instead of being refused.
    expect(inserted.isActive).toBe(true);
    expect((await createSlackConnectionsRepo(db, org.teammate).getActiveForOrg())?.id).toBe(
      inserted.id,
    );
  });

  // --- row 9 ---------------------------------------------------------------
  test("attachChannel fills this org's active row, and every member sees the channel", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "attach-fill");

    const inserted = await createSlackConnectionsRepo(db, org.owner).insertActive({
      channelId: null,
      workspaceName: WORKSPACE_NAME,
      credentialCiphertext: slackEnvelopeFor(org.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    const attached = await createSlackConnectionsRepo(db, org.owner).attachChannel(PICKED_CHANNEL);

    // The SAME row, not a second one — the partial unique index would refuse a
    // second active connection anyway, so an implementation that inserted here
    // would fail loudly; this asserts it did the quiet correct thing instead.
    expect(attached?.id).toBe(inserted.id);
    expect(attached?.channelId).toBe(PICKED_CHANNEL);

    // ORG-SCOPED, like every other read on this table (D1). The founder who
    // picked the channel is not the only person whose findings now have an
    // address.
    const served = await createSlackConnectionsRepo(db, org.teammate).getActiveForOrg();
    expect(served?.channelId).toBe(PICKED_CHANNEL);

    // THE WORKSPACE NAME SURVIVED THE ATTACH. `.set({ channelId })` writes one
    // column; a `.set(summary)` written by whoever touches this next would
    // silently blank the name the OAuth exchange paid a round trip for.
    expect(served?.workspaceName).toBe(WORKSPACE_NAME);
  });

  // --- row 10 --------------------------------------------------------------
  test("attachChannel cannot reach another organization's row, and says so when there is none", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const orgA = await seedOrgWithTeammate(db, "attach-tenant-a");
    const orgB = await seedOrgWithTeammate(db, "attach-tenant-b");

    await createSlackConnectionsRepo(db, orgA.owner).insertActive({
      channelId: null,
      workspaceName: WORKSPACE_NAME,
      credentialCiphertext: slackEnvelopeFor(orgA.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: orgA.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    // D7, AND THE REASON THE SIGNATURE TAKES NO CONNECTION ID. Org B holds the
    // only thing a request body can carry — a channel — and there is no
    // parameter through which it could name org A's row. `null` because org B
    // has no active connection of its own, which is the honest answer rather
    // than a silent success.
    expect(
      await createSlackConnectionsRepo(db, orgB.owner).attachChannel(PICKED_CHANNEL),
    ).toBeNull();

    // Org A's row is untouched — still half-connected, still waiting for its
    // own founder to pick. Without this line the row above would pass against
    // an implementation that wrote to A and returned null by accident.
    expect(
      (await createSlackConnectionsRepo(db, orgA.owner).getActiveForOrg())?.channelId,
    ).toBeNull();
  });

  // --- row 11 --------------------------------------------------------------
  test("attachChannel touches only the ACTIVE row and returns no credential material", async () => {
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "attach-inactive");
    const repo = createSlackConnectionsRepo(db, org.owner);
    const envelope = slackEnvelopeFor(org.organizationId);

    const first = await repo.insertActive({
      channelId: CHANNEL_ID,
      workspaceName: WORKSPACE_NAME,
      credentialCiphertext: envelope,
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });
    await repo.deactivate(first.id);

    const second = await repo.insertActive({
      channelId: null,
      workspaceName: WORKSPACE_NAME,
      credentialCiphertext: envelope,
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    const attached = await repo.attachChannel(PICKED_CHANNEL);
    expect(attached?.id).toBe(second.id);

    // THE DEACTIVATED ROW IS HISTORY AND STAYS AS IT WAS. `is_active` is half
    // of this update's WHERE clause; drop it and one org's reconnect rewrites
    // the channel of every connection it ever had, which is the audit trail
    // quietly becoming fiction.
    expect(
      await readRawScalar(db, sql`select channel_id from slack_connections where id = ${first.id}`),
    ).toBe(CHANNEL_ID);

    // The same enumeration row 2 applies to the other three summary methods —
    // a `.returning()` hands back the whole row, including both credential
    // columns, so this method is one careless spread away from being a door.
    const keys = Object.keys(attached as object);
    expect(keys).not.toContain("credentialCiphertext");
    expect(keys).not.toContain("credentialKeyId");
    const serialised = JSON.stringify(attached);
    expect(serialised).not.toContain(envelope);
    expect(serialised).not.toContain(BOT_TOKEN);
  });

  // --- row 12 --------------------------------------------------------------
  test("attachChannel fills an empty address once, and never moves a chosen one", async () => {
    // ###################################################################
    // # THE SECOND ATTACH IS THE WHOLE ROW (security audit M-3, D12).
    // #
    // # The delivery ledger's identity is `(organization_id, finding_id,
    // # channel_id)` — `deliveries.repo.ts` conflicts `claimForPost` on
    // # exactly that tuple. So a channel that MOVES forks every delivery this
    // # organization ever recorded: `findFor` answers null for the whole
    // # history, every finding already sent reads as never sent, and the
    // # weekly budget restarts. Nothing raises; the customer just receives
    // # their entire backlog again.
    // #
    // # `insertActive` is refused by the partial unique index. There is no
    // # index that can refuse an UPDATE to a different value, so the predicate
    // # in the statement is the only thing holding this line, and this row is
    // # the only thing holding the predicate.
    // ###################################################################
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "attach-once");
    const repo = createSlackConnectionsRepo(db, org.owner);

    const inserted = await repo.insertActive({
      channelId: null,
      workspaceName: WORKSPACE_NAME,
      credentialCiphertext: slackEnvelopeFor(org.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    // THE FILL SUCCEEDS. Without this leg the refusal below would pass against
    // a method that attached nothing, ever.
    const first = await repo.attachChannel(PICKED_CHANNEL);
    expect(first?.id).toBe(inserted.id);
    expect(first?.channelId).toBe(PICKED_CHANNEL);

    // THE SECOND ATTACH MATCHES ZERO ROWS. `null` is the same answer a caller
    // already gets for "this organization has no active connection": the
    // repository reports that it wrote nothing and stays out of deciding what
    // that means for a person (the route reads the row and says which).
    expect(await repo.attachChannel(MOVED_CHANNEL)).toBeNull();

    // AND THE STORED VALUE DID NOT MOVE. This is the row that catches a partial
    // fix — a statement that wrote the new channel and returned nothing (a
    // dropped `.returning()`, a guard applied to the result rather than to the
    // WHERE clause) passes the null assertion above and has already forked every
    // delivery identity by the time anyone reads it.
    expect(
      await readRawScalar(
        db,
        sql`select channel_id from slack_connections where id = ${inserted.id}`,
      ),
    ).toBe(PICKED_CHANNEL);

    // Read back through the repository too, by a DIFFERENT member: what the
    // teammate's screen would show is the original channel, not the attempt.
    expect((await createSlackConnectionsRepo(db, org.teammate).getActiveForOrg())?.channelId).toBe(
      PICKED_CHANNEL,
    );
  });

  // --- row 13 --------------------------------------------------------------
  test("a reconnect after disconnecting is attachable again", async () => {
    // THE GUARD IS ON THE ROW, NOT ON THE ORGANIZATION. Once-only means once
    // per connection: an org that disconnects and connects again gets a fresh
    // half-connected row and must be able to finish setup. A guard written as
    // "this organization has ever chosen a channel" would leave the reconnect
    // permanently unfinishable, with a picker that refuses everything.
    const createSlackConnectionsRepo = await loadCreateRepo();
    const org = await seedOrgWithTeammate(db, "attach-again");
    const repo = createSlackConnectionsRepo(db, org.owner);

    const first = await repo.insertActive({
      channelId: CHANNEL_ID,
      workspaceName: WORKSPACE_NAME,
      credentialCiphertext: slackEnvelopeFor(org.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });
    await repo.deactivate(first.id);

    const second = await repo.insertActive({
      channelId: null,
      workspaceName: WORKSPACE_NAME,
      credentialCiphertext: slackEnvelopeFor(org.organizationId),
      credentialKeyId: keyIdOf(KEY),
      connectedByUserId: org.ownerUserId,
      connectedAt: CONNECTED_AT,
    });

    const attached = await repo.attachChannel(PICKED_CHANNEL);
    expect(attached?.id).toBe(second.id);
    expect(attached?.channelId).toBe(PICKED_CHANNEL);

    // The disconnected row keeps the address it had. History stays history.
    expect(
      await readRawScalar(db, sql`select channel_id from slack_connections where id = ${first.id}`),
    ).toBe(CHANNEL_ID);
  });
});

// ===========================================================================
// PLANTED-OFFENDER CONTROL — GREEN BY DESIGN, AND NOT A CONTRACT ROW.
//
// The ADD's standing rule: every scanner ships one, because a collector whose
// pattern silently matches nothing turns its invariant into decoration. Row 2's
// door check is the contract row; these three prove it can see, and can refuse.
// ===========================================================================

/** A module offering exactly the surface §5's Wave 2 table describes. */
const CLEAN_SURFACE_FIXTURE = `
  export interface SlackConnectionsRepo {
    getActiveForOrg(): Promise<SlackConnectionSummary | null>;
    insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary>;
    deactivate(id: string): Promise<SlackConnectionSummary | null>;
    openCredentialForOrg(key: CredentialKey): Promise<DecryptResult | null>;
  }
  export function createSlackConnectionsRepo(db: ScopedDb, ctx: TenantContext) {
    async function decryptStoredCredential(row: SlackConnectionRow) { return row; }
    return { async getActiveForOrg() { return decryptStoredCredential; } };
  }
`;

/** THE PLANTED OFFENDER: a SECOND public reader beside the named door. Every
 *  runtime enumeration in row 2 still passes with this in the file. */
const SECOND_DOOR_FIXTURE = `
  export interface SlackConnectionsRepo {
    getActiveForOrg(): Promise<SlackConnectionSummary | null>;
    openCredentialForOrg(key: CredentialKey): Promise<DecryptResult | null>;
    botTokenFor(id: string): Promise<string | null>;
  }
`;

describe("planted-offender control — proving the one-door check bites", () => {
  test("the collector reads the public surface and finds only the named door", () => {
    const names = publicSurfaceNames(CLEAN_SURFACE_FIXTURE);

    // Anti-vacuity: it really did collect the interface members and the
    // exported factory, so an empty door list below means something.
    expect(names.has("getActiveForOrg")).toBe(true);
    expect(names.has("createSlackConnectionsRepo")).toBe(true);
    // …and the module-PRIVATE helper is not surface, so it is not a door.
    expect(names.has("decryptStoredCredential")).toBe(false);

    expect([...names].filter(isCredentialDoor).toSorted()).toEqual(["openCredentialForOrg"]);
  });

  test("the collector flags a second public reader beside the named door", () => {
    expect(
      [...publicSurfaceNames(SECOND_DOOR_FIXTURE)].filter(isCredentialDoor).toSorted(),
    ).toEqual(["botTokenFor", "openCredentialForOrg"]);
  });

  test("a credential WRITE on the shipped PostHog repository is not read as a door", () => {
    // The precedent, not a fixture. `project-connections.repo.ts` ships
    // `updateCredential` — it takes an envelope IN and returns a credential-free
    // summary — and its real reader lives in `src/system/`, outside the
    // repository layer. If this file were read as carrying a door, Wave 2 would
    // get a red for copying the pattern it was told to copy.
    const precedent = readSourceUnderConstruction({
      repoRelativePath: "packages/db/src/repositories/project-connections.repo.ts",
      ownedBy: "already shipped (O-003)",
    });
    const names = publicSurfaceNames(precedent);
    expect(names.has("updateCredential")).toBe(true);
    expect([...names].filter(isCredentialDoor)).toEqual([]);
  });
});
