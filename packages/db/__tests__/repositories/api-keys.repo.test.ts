import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import {
  API_KEY_DISPLAY_PREFIX_LENGTH,
  API_KEY_PREFIX,
  hashApiKeyMaterial,
  isApiKeyFormat,
  isWriteKeyFormat,
} from "@growthmind/shared";

import {
  createApiKeysRepo,
  resolveApiKeyPrincipal,
  API_KEY_ACTOR_PREFIX,
  API_KEY_ACTOR_ROLE,
} from "../../src/repositories/api-keys.repo";
import {
  createWriteKeysRepo,
  resolveWriteKeyForIngest,
} from "../../src/repositories/write-keys.repo";
import * as schema from "../../src/schema";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../../src/testing";
import { seedOrgWithOwner, seedProject } from "../../src/testing";

const NAMES = laneNames("apikey");

describe("api-keys repository and resolver", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("should mint material that resolves back to the organization that minted it", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("round-trip"),
      userName: NAMES.userName("round-trip"),
      email: NAMES.email("round-trip"),
    });

    const minted = await createApiKeysRepo(db, org.ctx).mint({ name: "round-trip agent" });

    expect(isApiKeyFormat(minted.raw)).toBe(true);

    expect(await resolveApiKeyPrincipal(db, minted.raw)).toEqual({
      userId: `${API_KEY_ACTOR_PREFIX}${minted.key.id}`,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: API_KEY_ACTOR_ROLE,
    });
  });

  it("should persist only a digest and a display prefix, never the material", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("persistence"),
      userName: NAMES.userName("persistence"),
      email: NAMES.email("persistence"),
    });

    const minted = await createApiKeysRepo(db, org.ctx).mint({ name: "persistence agent" });

    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, minted.key.id));
    if (!row) {
      throw new Error("expected mint to persist an api_keys row");
    }

    expect(row.keyHash).toBe(hashApiKeyMaterial(minted.raw));
    expect(row.keyPrefix).toBe(minted.raw.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH));

    const persisted = JSON.stringify(row);
    expect(persisted).not.toContain(minted.raw);
    expect(persisted).not.toContain(minted.raw.slice(API_KEY_DISPLAY_PREFIX_LENGTH));
    expect(row.keyHash).not.toBe(minted.raw);
  });

  it("should return metadata carrying neither the hash nor the material", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("dto"),
      userName: NAMES.userName("dto"),
      email: NAMES.email("dto"),
    });

    const minted = await createApiKeysRepo(db, org.ctx).mint({ name: "dto agent" });

    const keys = Object.keys(minted.key);
    expect(keys).not.toContain("keyHash");
    expect(keys).not.toContain("raw");
    expect(Object.values(minted.key).some((value) => value === minted.raw)).toBe(false);
    expect(JSON.stringify(minted.key)).not.toContain(minted.raw);

    expect(minted.key.organizationId).toBe(org.organizationId);
    expect(minted.key.name).toBe("dto agent");
    expect(minted.key.keyPrefix).toBe(minted.raw.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH));
    expect(minted.key.revokedAt).toBeNull();
  });

  it("should stop resolving once revoked, in the same query that finds it", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("revoke-live"),
      userName: NAMES.userName("revoke-live"),
      email: NAMES.email("revoke-live"),
    });
    const repo = createApiKeysRepo(db, org.ctx);
    const minted = await repo.mint({ name: "revoke-live agent" });

    expect((await resolveApiKeyPrincipal(db, minted.raw))?.organizationId).toBe(org.organizationId);

    const revoked = await repo.revoke(minted.key.id);
    expect(revoked?.id).toBe(minted.key.id);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);

    expect(await resolveApiKeyPrincipal(db, minted.raw)).toBeNull();

    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, minted.key.id));
    expect(row).toBeDefined();
    expect(row?.revokedAt).toBeInstanceOf(Date);
    expect(row?.keyHash).toBe(hashApiKeyMaterial(minted.raw));
  });

  it("should keep the first revocation's timestamp when the same key is revoked again", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("double-revoke"),
      userName: NAMES.userName("double-revoke"),
      email: NAMES.email("double-revoke"),
    });
    const repo = createApiKeysRepo(db, org.ctx);
    const minted = await repo.mint({ name: "double-revoke agent" });

    const first = await repo.revoke(minted.key.id);
    const firstAt = first?.revokedAt;
    expect(firstAt).toBeInstanceOf(Date);
    if (!(firstAt instanceof Date)) {
      throw new Error("expected the first revoke to stamp revokedAt");
    }

    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = await repo.revoke(minted.key.id);

    expect(second?.id).toBe(minted.key.id);

    expect(second?.revokedAt?.getTime()).toBe(firstAt.getTime());

    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, minted.key.id));
    expect(row?.revokedAt?.getTime()).toBe(firstAt.getTime());

    expect(Date.now() - firstAt.getTime()).toBeGreaterThanOrEqual(25);

    expect(await resolveApiKeyPrincipal(db, minted.raw)).toBeNull();
  });

  it("should report nothing revoked for another organization's key id", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("foreign-revoke-a"),
      userName: NAMES.userName("foreign-revoke-a"),
      email: NAMES.email("foreign-revoke-a"),
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("foreign-revoke-b"),
      userName: NAMES.userName("foreign-revoke-b"),
      email: NAMES.email("foreign-revoke-b"),
    });

    const minted = await createApiKeysRepo(db, orgA.ctx).mint({ name: "foreign-revoke agent" });

    expect(await createApiKeysRepo(db, orgB.ctx).revoke(minted.key.id)).toBeNull();

    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, minted.key.id));
    expect(row?.revokedAt).toBeNull();
    expect((await resolveApiKeyPrincipal(db, minted.raw))?.organizationId).toBe(
      orgA.organizationId,
    );
  });

  it("should report nothing revoked for an id that never existed", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("absent-revoke"),
      userName: NAMES.userName("absent-revoke"),
      email: NAMES.email("absent-revoke"),
    });

    const result = await createApiKeysRepo(db, org.ctx).revoke(randomUUID());

    expect(result).toBeNull();
  });

  it("should resolve two live credentials in one organization independently", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("two-live"),
      userName: NAMES.userName("two-live"),
      email: NAMES.email("two-live"),
    });
    const repo = createApiKeysRepo(db, org.ctx);

    const first = await repo.mint({ name: "two-live agent one" });
    const second = await repo.mint({ name: "two-live agent two" });

    expect(first.raw).not.toBe(second.raw);
    expect((await resolveApiKeyPrincipal(db, first.raw))?.userId).toBe(
      `${API_KEY_ACTOR_PREFIX}${first.key.id}`,
    );
    expect((await resolveApiKeyPrincipal(db, second.raw))?.userId).toBe(
      `${API_KEY_ACTOR_PREFIX}${second.key.id}`,
    );

    await repo.revoke(first.key.id);

    expect(await resolveApiKeyPrincipal(db, first.raw)).toBeNull();
    expect((await resolveApiKeyPrincipal(db, second.raw))?.organizationId).toBe(org.organizationId);
  });

  it("should never reach the database for malformed material", async () => {
    const dead = await createTestDb();
    await dead.close();

    expect(await resolveApiKeyPrincipal(dead.db, "not-a-key")).toBeNull();
    expect(await resolveApiKeyPrincipal(dead.db, "")).toBeNull();

    const wellFormedUnknown = `${API_KEY_PREFIX}${"a".repeat(43)}`;
    expect(isApiKeyFormat(wellFormedUnknown)).toBe(true);
    await expect(resolveApiKeyPrincipal(dead.db, wellFormedUnknown)).rejects.toThrow(/api_keys/);
  });

  it("should resolve nothing for a genuinely minted ingest key", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("ingest-key"),
      userName: NAMES.userName("ingest-key"),
      email: NAMES.email("ingest-key"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("ingest-key"),
    });

    const ingest = await createWriteKeysRepo(db, org.ctx).mint({
      projectId: project.id,
      kind: "standard",
    });

    expect(await resolveApiKeyPrincipal(db, ingest.raw)).toBeNull();

    expect(isWriteKeyFormat(ingest.raw)).toBe(true);
    expect(await resolveWriteKeyForIngest(db, ingest.raw)).toEqual({
      projectId: project.id,
      organizationId: org.organizationId,
      kind: "standard",
    });
  });

  it("should scope every mint to the acting context's organization", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("scoped-mint-a"),
      userName: NAMES.userName("scoped-mint-a"),
      email: NAMES.email("scoped-mint-a"),
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("scoped-mint-b"),
      userName: NAMES.userName("scoped-mint-b"),
      email: NAMES.email("scoped-mint-b"),
    });

    const mintedByA = await createApiKeysRepo(db, orgA.ctx).mint({ name: "scoped-mint agent" });
    expect(mintedByA.key.organizationId).toBe(orgA.organizationId);

    const repoB = createApiKeysRepo(db, orgB.ctx);
    expect(await repoB.revoke(mintedByA.key.id)).toBeNull();

    expect((await repoB.list()).map((key) => key.id)).not.toContain(mintedByA.key.id);
  });

  it("should list this organization's keys as metadata only, revoked rows included", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("list-a"),
      userName: NAMES.userName("list-a"),
      email: NAMES.email("list-a"),
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("list-b"),
      userName: NAMES.userName("list-b"),
      email: NAMES.email("list-b"),
    });
    const repoA = createApiKeysRepo(db, orgA.ctx);

    const live = await repoA.mint({ name: "list agent live" });
    const dead = await repoA.mint({ name: "list agent revoked" });
    await repoA.revoke(dead.key.id);
    const foreign = await createApiKeysRepo(db, orgB.ctx).mint({ name: "list agent foreign" });

    const listed = await repoA.list();
    const ids = listed.map((key) => key.id);

    expect(ids).toContain(live.key.id);
    expect(ids).toContain(dead.key.id);
    expect(ids).not.toContain(foreign.key.id);
    expect(listed.find((key) => key.id === dead.key.id)?.revokedAt).toBeInstanceOf(Date);
    expect(listed.find((key) => key.id === live.key.id)?.revokedAt).toBeNull();

    for (const key of listed) {
      expect(Object.keys(key)).not.toContain("keyHash");
    }
    expect(JSON.stringify(listed)).not.toContain(live.raw);
    expect(JSON.stringify(listed)).not.toContain(dead.raw);
  });

  it("answers no principal for a key that no row hashes to", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("principal"),
      userName: NAMES.userName("principal"),
      email: NAMES.email("principal"),
    });
    const repo = createApiKeysRepo(db, org.ctx);

    expect(await resolveApiKeyPrincipal(db, "not-a-key")).toBeNull();
    expect(await resolveApiKeyPrincipal(db, `${API_KEY_PREFIX}${"a".repeat(43)}`)).toBeNull();

    const live = await repo.mint({ name: "principal agent" });
    const principal = await resolveApiKeyPrincipal(db, live.raw);

    expect(principal?.organizationId).toBe(org.organizationId);
    expect(principal?.organizationName).toBe(org.organizationName);
    expect(principal?.userId).toBe(`${API_KEY_ACTOR_PREFIX}${live.key.id}`);
    expect(principal?.role).toBe(API_KEY_ACTOR_ROLE);

    const revoked = await repo.mint({ name: "principal agent revoked" });
    await repo.revoke(revoked.key.id);
    expect(await resolveApiKeyPrincipal(db, revoked.raw)).toBeNull();
  });
});
