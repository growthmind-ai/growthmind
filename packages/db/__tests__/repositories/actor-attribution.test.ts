import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import { API_KEY_ACTOR_ROLE, createApiKeysRepo } from "../../src/repositories/api-keys.repo";
import { createProjectConnectionsRepo } from "../../src/repositories/project-connections.repo";
import { createSlackConnectionsRepo } from "../../src/repositories/slack-connections.repo";
import { createWriteKeysRepo } from "../../src/repositories/write-keys.repo";
import * as schema from "../../src/schema";
import {
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  seedProject,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("attribution");

const CONNECTED_AT = new Date("2026-08-05T09:00:00.000Z");

describe("the credential and connection writes name the person who made them", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function org(label: string) {
    return seedOrgWithOwner(db, {
      orgName: NAMES.orgName(label),
      userName: NAMES.userName(label),
      email: NAMES.email(label),
    });
  }

  it("stamps the minting member on an api key", async () => {
    const seeded = await org("api-key");

    const minted = await createApiKeysRepo(db, seeded.ctx).mint({ name: "an agent" });

    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, minted.key.id));

    expect(row?.createdByUserId).toBe(seeded.userId);
  });

  it("stamps the minting member on a write key", async () => {
    const seeded = await org("write-key");
    const project = await seedProject(db, {
      organizationId: seeded.organizationId,
      name: NAMES.projectName("write-key"),
    });

    const minted = await createWriteKeysRepo(db, seeded.ctx).mint({
      projectId: project.id,
      kind: "standard",
    });

    const [row] = await db
      .select()
      .from(schema.writeKeys)
      .where(eq(schema.writeKeys.id, minted.key.id));

    expect(row?.createdByUserId).toBe(seeded.userId);
  });

  it("stamps the connecting member on an analytics connection", async () => {
    const seeded = await org("analytics");
    const project = await seedProject(db, {
      organizationId: seeded.organizationId,
      name: NAMES.projectName("analytics"),
    });

    const connection = await createProjectConnectionsRepo(db, seeded.ctx).insertActive({
      projectId: project.id,
      sourceKind: "posthog",
      host: "https://eu.posthog.example.invalid",
      sourceProjectId: "12345",
      credentialCiphertext: "v1.deadbeef.aaaa.bbbb.cccc",
      credentialKeyId: "deadbeef",
      health: "healthy",
      connectedAt: CONNECTED_AT,
      nextPollAt: CONNECTED_AT,
    });

    const [row] = await db
      .select()
      .from(schema.projectConnections)
      .where(eq(schema.projectConnections.id, connection.id));

    expect(row?.connectedByUserId).toBe(seeded.userId);
  });

  it("stamps the connecting member on a slack connection with no argument to carry it", async () => {
    const seeded = await org("slack");

    const connection = await createSlackConnectionsRepo(db, seeded.ctx).insertActive({
      channelId: "C01AB2CD3EF",
      credentialCiphertext: "v1.deadbeef.aaaa.bbbb.cccc",
      credentialKeyId: "deadbeef",
      connectedAt: CONNECTED_AT,
    });

    const [row] = await db
      .select()
      .from(schema.slackConnections)
      .where(eq(schema.slackConnections.id, connection.id));

    expect(row?.connectedByUserId).toBe(seeded.userId);
  });
});

describe("a machine principal writes no user id, because its actor is not a user row", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("mints against an api-key context without tripping the foreign key", async () => {
    const seeded = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("machine"),
      userName: NAMES.userName("machine"),
      email: NAMES.email("machine"),
    });

    // What `resolveApiKeyPrincipal` hands downstream: the org is real, the actor is a
    // synthetic string standing in for a key.
    const principal = {
      userId: "api-key:00000000-0000-4000-8000-000000000000",
      organizationId: seeded.organizationId,
      organizationName: seeded.organizationName,
      role: API_KEY_ACTOR_ROLE,
    };

    const minted = await createApiKeysRepo(db, principal).mint({ name: "minted by a key" });

    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, minted.key.id));

    expect(row?.createdByUserId).toBeNull();
  });

  // The reason the null above is load-bearing rather than cosmetic: had the field been
  // written from `ctx.userId`, this is the error the mint would have raised.
  it("proves the synthetic actor id could not have been stored", async () => {
    const seeded = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("fk"),
      userName: NAMES.userName("fk"),
      email: NAMES.email("fk"),
    });

    const attempt = async (): Promise<void> => {
      await db.insert(schema.apiKeys).values({
        organizationId: seeded.organizationId,
        name: "written the wrong way",
        keyHash: `hash-${seeded.organizationId}`,
        keyPrefix: "gm_live_x",
        createdByUserId: "api-key:00000000-0000-4000-8000-000000000000",
      });
    };

    await expect(attempt()).rejects.toThrow();
  });
});
