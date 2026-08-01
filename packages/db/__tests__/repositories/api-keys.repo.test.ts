// Wave 0 (red), `mcp-read-credential`, "Integration tests: repository and resolver
// (PGlite, lane `apikey`, `fixtures.ts`)", all 11 rows.
//
// Subject: `packages/db/src/repositories/api-keys.repo.ts` and the `api_keys` table.
// Neither exists yet, so this suite is red at module resolution until Wave 2. That IS
// the stated reason.
//
// Lane discipline: this is the `packages/db` lane, so seeding goes through
// `__tests__/helpers/fixtures.ts` against `createTestDb`'s PGlite instance, not
// `apps/web/__tests__/tenancy/helpers/auth-fixture.ts`, which is the other lane and
// does not exist from here. Fixture names carry the lane prefix `apikey` so a parallel
// suite can never collide on `organization.slug` or `user.email`.
//
// Every assertion targets the public contract (`createApiKeysRepo`,
// `resolveApiKeyForRead`) against real SQL. A fake repository would prove nothing about
// the tenant scoping and the revocation predicate this sprint turns on.
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

import { createApiKeysRepo, resolveApiKeyForRead } from "../../src/repositories/api-keys.repo";
import {
  createWriteKeysRepo,
  resolveWriteKeyForIngest,
} from "../../src/repositories/write-keys.repo";
import * as schema from "../../src/schema";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import { seedOrgWithOwner, seedProject } from "../helpers/fixtures";

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

    // The other half of the cross-lane loop opens: `packages/shared`'s material suite
    // proves the format accepts mint-shaped material; this proves a genuinely minted
    // key is that shape.
    expect(isApiKeyFormat(minted.raw)).toBe(true);

    expect(await resolveApiKeyForRead(db, minted.raw)).toEqual({
      organizationId: org.organizationId,
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

    // No column carries the material, not the whole string, and not the tail that is
    // the part actually worth stealing. The display prefix is the only fragment of the
    // key allowed to survive the write.
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

    // A `...row` spread at the DTO boundary would leak `keyHash` with nothing else
    // failing. This is the row that notices (write-keys.repo.ts:28-41).
    const keys = Object.keys(minted.key);
    expect(keys).not.toContain("keyHash");
    expect(keys).not.toContain("raw");
    expect(Object.values(minted.key).some((value) => value === minted.raw)).toBe(false);
    expect(JSON.stringify(minted.key)).not.toContain(minted.raw);

    // Not vacuous: the DTO really does carry the metadata it is supposed to.
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

    // Non-vacuity: it really did resolve before the revoke.
    expect(await resolveApiKeyForRead(db, minted.raw)).toEqual({
      organizationId: org.organizationId,
    });

    const revoked = await repo.revoke(minted.key.id);
    expect(revoked?.id).toBe(minted.key.id);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);

    expect(await resolveApiKeyForRead(db, minted.raw)).toBeNull();

    // The `null` above must be the `isNull(revokedAt)` predicate sharing one `where`
    // with the hash lookup, not a delete, and not a second query or a post-filter (a
    // post-filter would make revoked and unknown keys distinguishable by time even when
    // the answers match).
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

    // Real elapsed time between the two calls. Without it two statements microseconds
    // apart could agree by accident and this row would pass against the very bug it
    // exists to catch.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = await repo.revoke(minted.key.id);

    // Two operators racing to kill a leaked key is the ordinary case. The second one is
    // still told the key is revoked. That is true, and an error here would be a worse
    // answer than the truth.
    expect(second?.id).toBe(minted.key.id);
    // …but the one audit fact this table holds about a leaked credential (when it
    // stopped working) is not rewritten by the later call.
    expect(second?.revokedAt?.getTime()).toBe(firstAt.getTime());

    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, minted.key.id));
    expect(row?.revokedAt?.getTime()).toBe(firstAt.getTime());

    // Non-vacuity: the clock genuinely moved between the two revokes, so a plain
    // `revokedAt: new Date` assignment would have failed both assertions above rather
    // than passing by coincidence.
    expect(Date.now() - firstAt.getTime()).toBeGreaterThanOrEqual(25);

    // And the key is still revoked for the only consumer that matters.
    expect(await resolveApiKeyForRead(db, minted.raw)).toBeNull();
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

    // Zero rows matched must mean zero rows changed. The retro's
    // zero-row-write-reported-as-success class, inverted: here the report is honest and
    // the row must be untouched to prove it.
    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, minted.key.id));
    expect(row?.revokedAt).toBeNull();
    expect(await resolveApiKeyForRead(db, minted.raw)).toEqual({
      organizationId: orgA.organizationId,
    });
  });

  it("should report nothing revoked for an id that never existed", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("absent-revoke"),
      userName: NAMES.userName("absent-revoke"),
      email: NAMES.email("absent-revoke"),
    });

    const result = await createApiKeysRepo(db, org.ctx).revoke(randomUUID());

    // `null`, never a truthy "revoked nothing, successfully". The operator reads this
    // as an exit code.
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
    expect(await resolveApiKeyForRead(db, first.raw)).toEqual({
      organizationId: org.organizationId,
    });
    expect(await resolveApiKeyForRead(db, second.raw)).toEqual({
      organizationId: org.organizationId,
    });

    await repo.revoke(first.key.id);

    // Revoking one credential is not revoking the org.
    expect(await resolveApiKeyForRead(db, first.raw)).toBeNull();
    expect(await resolveApiKeyForRead(db, second.raw)).toEqual({
      organizationId: org.organizationId,
    });
  });

  it("should never reach the database for malformed material", async () => {
    // Its own PGlite instance, closed before use, so the suite's shared database is
    // unaffected by this row.
    const dead = await createTestDb();
    await dead.close();

    // Malformed input is refused by the format check, so no query is ever issued and a
    // dead handle cannot be noticed…
    expect(await resolveApiKeyForRead(dead.db, "not-a-key")).toBeNull();
    expect(await resolveApiKeyForRead(dead.db, "")).toBeNull();

    // …while a well-formed unknown key gets as far as the query and the dead handle
    // rejects. That asymmetry is the proof that `isApiKeyFormat` short-circuits before
    // any database access. If both branches behaved the same, this row would prove
    // nothing.
    const wellFormedUnknown = `${API_KEY_PREFIX}${"a".repeat(43)}`;
    expect(isApiKeyFormat(wellFormedUnknown)).toBe(true);
    await expect(resolveApiKeyForRead(dead.db, wellFormedUnknown)).rejects.toThrow(/api_keys/);
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

    expect(await resolveApiKeyForRead(db, ingest.raw)).toBeNull();

    // The non-vacuity half: the key is genuine, unrevoked and still admitted by its own
    // resolver, so the `null` above is the family boundary and not a junk fixture.
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

    // P1 half (cut together with the `list`): org B cannot even see it.
    expect((await repoB.list()).map((key) => key.id)).not.toContain(mintedByA.key.id);
  });

  // P1, cut together with. `list` and `revoke-api-key.ts --list` ship together or not
  // at all.
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

    // A revoked key still listed is the point: an operator needs to see that the key
    // they revoked is the one that is gone.
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
});
