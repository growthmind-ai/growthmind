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

const KEY: CredentialKey = { bytes: Uint8Array.from({ length: 32 }, (_, index) => index) };

const BOT_TOKEN = "xoxb-fixture-only-never-a-real-token";

const CHANNEL_ID = "C01AB2CD3EF";

const CONNECTED_AT = new Date("2026-08-01T09:00:00.000Z");

function slackEnvelopeFor(organizationId: string): string {
  return encryptSecret(BOT_TOKEN, KEY, credentialAad(organizationId, "slack"));
}

interface OrgWithTeammate {
  organizationId: string;
  owner: ReturnType<typeof makeTenantContext>;
  ownerUserId: string;
  teammate: ReturnType<typeof makeTenantContext>;
}

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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const CREDENTIAL_DOOR = /credential|token|secret/i;
const WRITE_VERB = /^(?:update|set|insert|write|store|persist|rotate|replace|clear|delete|remove)/;

function isCredentialDoor(name: string): boolean {
  return CREDENTIAL_DOOR.test(name) && !WRITE_VERB.test(name);
}

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

    const failure = readPgFailure(refusal);
    expect(failure.code).toBe("23505");
    expect(`${failure.constraint ?? ""} ${failure.message}`).toContain(
      "slack_connections_active_org_uidx",
    );
  });

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

      const serialised = JSON.stringify(summary);
      expect(serialised, method).not.toContain(envelope);
      expect(serialised, method).not.toContain(BOT_TOKEN);
    }

    const source = readSourceUnderConstruction({
      repoRelativePath: REPO_SOURCE_PATH,
      ownedBy: OWNER,
    });
    const doors = [...publicSurfaceNames(source)].filter(isCredentialDoor).toSorted();
    expect(doors).toEqual(["openCredentialForOrg"]);
  });

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

    expect(stored).toBe(envelope);

    const opened = decryptSecret(String(stored), KEY, credentialAad(org.organizationId, "slack"));
    expect(opened).toEqual({ ok: true, value: BOT_TOKEN });

    const lifted = decryptSecret(String(stored), KEY, credentialAad(other.organizationId, "slack"));
    expect(lifted).toEqual({ ok: false, reason: "authentication_failed" });
  });

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

    expect(storedKeyId).toMatch(/^[0-9a-f]{8}$/);
    expect(storedKeyId).toBe(keyIdOf(KEY));

    const material = Buffer.from(KEY.bytes);
    for (const encoding of ["hex", "base64", "base64url"] as const) {
      expect(material.toString(encoding)).not.toContain(storedKeyId);
    }
  });

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

    const teammateRepo = createSlackConnectionsRepo(db, org.teammate);
    expect((await teammateRepo.getActiveForOrg())?.id).toBe(inserted.id);

    await createSlackConnectionsRepo(db, org.owner).deactivate(inserted.id);

    expect(await teammateRepo.getActiveForOrg()).toBeNull();
    expect(await createSlackConnectionsRepo(db, org.owner).getActiveForOrg()).toBeNull();
  });

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

    expect(await fromB.getActiveForOrg()).toBeNull();

    expect(await fromB.deactivate(inserted.id)).toBeNull();
    expect((await createSlackConnectionsRepo(db, orgA.teammate).getActiveForOrg())?.id).toBe(
      inserted.id,
    );
  });

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

    const stampedOrg = await readRawScalar(
      db,
      sql`select organization_id from slack_connections where id = ${inserted.id}`,
    );
    expect(stampedOrg).toBe(org.organizationId);

    const served = await createSlackConnectionsRepo(db, org.teammate).getActiveForOrg();
    expect(served?.id).toBe(inserted.id);
    expect(served?.organizationId).toBe(org.organizationId);
    expect(served?.channelId).toBe(CHANNEL_ID);
  });
});

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

    expect(names.has("getActiveForOrg")).toBe(true);
    expect(names.has("createSlackConnectionsRepo")).toBe(true);

    expect(names.has("decryptStoredCredential")).toBe(false);

    expect([...names].filter(isCredentialDoor).toSorted()).toEqual(["openCredentialForOrg"]);
  });

  test("the collector flags a second public reader beside the named door", () => {
    expect(
      [...publicSurfaceNames(SECOND_DOOR_FIXTURE)].filter(isCredentialDoor).toSorted(),
    ).toEqual(["botTokenFor", "openCredentialForOrg"]);
  });

  test("a credential WRITE on the shipped PostHog repository is not read as a door", () => {
    const precedent = readSourceUnderConstruction({
      repoRelativePath: "packages/db/src/repositories/project-connections.repo.ts",
      ownedBy: "already shipped (O-003)",
    });
    const names = publicSurfaceNames(precedent);
    expect(names.has("updateCredential")).toBe(true);
    expect([...names].filter(isCredentialDoor)).toEqual([]);
  });
});
