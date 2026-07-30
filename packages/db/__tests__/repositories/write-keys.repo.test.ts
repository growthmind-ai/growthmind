// Wave 0 (RED): write-keys repository contract — packages/db/__tests__/repositories/write-keys.repo.test.ts
// tasks/tenancy-app-shell/add.md — Wave 0 Contract Checklist, "Repository tests" section.
//
// Every assertion here targets the PUBLIC contract of `createWriteKeysRepo`
// and `resolveWriteKeyForIngest` (packages/db/src/repositories/write-keys.repo.ts)
// against REAL SQL via PGlite (D-D) — a fake repository would prove nothing
// about the tenant-scoping this ADD (D-B/D-F) commits to.
//
// Both `createWriteKeysRepo(...).mint/listByProject/revoke` and
// `resolveWriteKeyForIngest` are currently typed-stub throws ("not
// implemented"), so every test below fails now by construction. Tests that
// need a *specific* failure reason (not just "it threw") catch the error and
// assert on content that the generic stub message cannot satisfy, so a
// later wave's real implementation is what turns these green — not a vaguer
// "did it throw" check that the stub would already satisfy today.
import { randomBytes, createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import { WRITE_KEY_PREFIX, type WriteKeyKind } from "@growthmind/shared";

import { createWriteKeysRepo, resolveWriteKeyForIngest } from "../../src/repositories/write-keys.repo";
import type { ScopedDb } from "../../src/repositories/types";
import * as schema from "../../src/schema";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner } from "../helpers/fixtures";

/**
 * Local helper (out of scope for this agent to build a real `ProjectsRepo`
 * — it is a stub too): inserts a `projects` row directly, stamping
 * `organizationId`, so write-key tests have a real project to mint against.
 */
async function seedProject(
  db: ScopedDb,
  params: { organizationId: string; name: string },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.projects)
    .values({ organizationId: params.organizationId, name: params.name })
    .returning();

  if (!row) {
    throw new Error("seedProject: insert returned no row");
  }

  return { id: row.id };
}

/**
 * Produces raw material in the exact shape D-F commits to: `WRITE_KEY_PREFIX`
 * + 43 base64url chars (256-bit random). Computed locally rather than through
 * the still-stubbed production generator, since these tests seed `write_keys`
 * rows directly and only need a plausible, well-formed raw key.
 */
function makeRawKeyMaterial(): string {
  return `${WRITE_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Mirrors D-F's "key_hash = SHA-256 hex" independently of the stubbed
 * `hashWriteKeyMaterial`, so seeding does not depend on unimplemented code. */
function hashMaterial(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Inserts a `write_keys` row directly (bypassing the stubbed `mint`), so
 * `resolveWriteKeyForIngest` and DTO-shape tests have real rows to read. */
async function seedWriteKey(
  db: ScopedDb,
  params: {
    organizationId: string;
    projectId: string;
    kind: WriteKeyKind;
    raw: string;
    revokedAt?: Date | null;
  },
): Promise<typeof schema.writeKeys.$inferSelect> {
  const [row] = await db
    .insert(schema.writeKeys)
    .values({
      organizationId: params.organizationId,
      projectId: params.projectId,
      kind: params.kind,
      keyHash: hashMaterial(params.raw),
      keyPrefix: params.raw.slice(0, 12),
      revokedAt: params.revokedAt ?? null,
    })
    .returning();

  if (!row) {
    throw new Error("seedWriteKey: insert returned no row");
  }

  return row;
}

describe("write-keys repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("mint returns raw material exactly once and persists only hash and prefix", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "Mint Org",
      userName: "Mint Owner",
      email: "mint-owner@example.com",
    });
    const project = await seedProject(db, { organizationId: org.organizationId, name: "Mint Project" });
    const repo = createWriteKeysRepo(db, org.ctx);

    const minted = await repo.mint({ projectId: project.id, kind: "standard" });

    expect(minted.raw.startsWith(WRITE_KEY_PREFIX)).toBe(true);

    const [row] = await db.select().from(schema.writeKeys).where(eq(schema.writeKeys.id, minted.key.id));
    if (!row) {
      throw new Error("expected mint to persist a write_keys row");
    }

    // FR-7: the persisted row must contain no substring of the raw material
    // beyond its 12-char prefix — never the tail that makes the key usable.
    const tail = minted.raw.slice(12);
    const persisted = JSON.stringify(row);
    expect(persisted.includes(tail)).toBe(false);
    expect(row.keyHash).not.toBe(minted.raw);
    expect(row.keyPrefix).toBe(minted.raw.slice(0, 12));
  });

  it("minted row is stamped with both organization id and project id and visible to its scoped read", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "Stamp Org",
      userName: "Stamp Owner",
      email: "stamp-owner@example.com",
    });
    const project = await seedProject(db, { organizationId: org.organizationId, name: "Stamp Project" });
    const repo = createWriteKeysRepo(db, org.ctx);

    const minted = await repo.mint({ projectId: project.id, kind: "standard" });

    expect(minted.key.organizationId).toBe(org.organizationId);
    expect(minted.key.projectId).toBe(project.id);

    const listed = await repo.listByProject(project.id);
    expect(listed.some((key) => key.id === minted.key.id)).toBe(true);
  });

  it("mint rejects a project id belonging to another organization", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Foreign Project Org A",
      userName: "Foreign Project Owner A",
      email: "foreign-project-owner-a@example.com",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "Foreign Project Org B",
      userName: "Foreign Project Owner B",
      email: "foreign-project-owner-b@example.com",
    });
    const projectA = await seedProject(db, { organizationId: orgA.organizationId, name: "Org A Project" });
    const repoB = createWriteKeysRepo(db, orgB.ctx);

    let caught: unknown;
    try {
      await repoB.mint({ projectId: projectA.id, kind: "standard" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    // FR-8(d): a client-supplied project id from a foreign org must be
    // rejected for THAT reason — a generic "not implemented" stub message
    // does not satisfy this, so this assertion stays red until mint()
    // actually verifies project ownership before minting.
    expect((caught as Error).message).toMatch(/organization|project|not found|belong/i);

    const rows = await db.select().from(schema.writeKeys).where(eq(schema.writeKeys.projectId, projectA.id));
    expect(rows).toHaveLength(0);
  });

  it("resolveWriteKeyForIngest finds an active key by hash and returns project, organization, and kind", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "Resolve Org",
      userName: "Resolve Owner",
      email: "resolve-owner@example.com",
    });
    const project = await seedProject(db, { organizationId: org.organizationId, name: "Resolve Project" });
    const raw = makeRawKeyMaterial();
    await seedWriteKey(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      kind: "standard",
      raw,
    });

    const resolved = await resolveWriteKeyForIngest(db, raw);

    expect(resolved).toEqual({
      projectId: project.id,
      organizationId: org.organizationId,
      kind: "standard",
    });
  });

  it("revoked keys do not resolve", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "Revoked Key Org",
      userName: "Revoked Key Owner",
      email: "revoked-key-owner@example.com",
    });
    const project = await seedProject(db, { organizationId: org.organizationId, name: "Revoked Key Project" });
    const raw = makeRawKeyMaterial();
    await seedWriteKey(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      kind: "standard",
      raw,
      revokedAt: new Date(),
    });

    const resolved = await resolveWriteKeyForIngest(db, raw);
    expect(resolved).toBeNull();
  });

  it("unknown and malformed presented keys resolve to null — never a default project", async () => {
    const wellFormedButUnknown = `${WRITE_KEY_PREFIX}${"a".repeat(43)}`;

    expect(await resolveWriteKeyForIngest(db, wellFormedButUnknown)).toBeNull();
    expect(await resolveWriteKeyForIngest(db, "not-a-real-key")).toBeNull();
    expect(await resolveWriteKeyForIngest(db, "")).toBeNull();
  });

  it("two active keys on one project resolve independently to the same project", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "Multi Key Org",
      userName: "Multi Key Owner",
      email: "multi-key-owner@example.com",
    });
    const project = await seedProject(db, { organizationId: org.organizationId, name: "Multi Key Project" });
    const rawA = makeRawKeyMaterial();
    const rawB = makeRawKeyMaterial();
    await seedWriteKey(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      kind: "standard",
      raw: rawA,
    });
    await seedWriteKey(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      kind: "simulation",
      raw: rawB,
    });

    const resolvedA = await resolveWriteKeyForIngest(db, rawA);
    const resolvedB = await resolveWriteKeyForIngest(db, rawB);

    expect(resolvedA?.projectId).toBe(project.id);
    expect(resolvedB?.projectId).toBe(project.id);
  });

  it("revoke keyed on (org, id) affects 0 rows for a foreign org's key", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Revoke Org A",
      userName: "Revoke Owner A",
      email: "revoke-owner-a@example.com",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "Revoke Org B",
      userName: "Revoke Owner B",
      email: "revoke-owner-b@example.com",
    });
    const project = await seedProject(db, { organizationId: orgA.organizationId, name: "Revoke Project" });
    const raw = makeRawKeyMaterial();
    const seeded = await seedWriteKey(db, {
      organizationId: orgA.organizationId,
      projectId: project.id,
      kind: "standard",
      raw,
    });

    const repoB = createWriteKeysRepo(db, orgB.ctx);
    const result = await repoB.revoke(seeded.id);
    expect(result).toBeNull();

    const [freshRow] = await db.select().from(schema.writeKeys).where(eq(schema.writeKeys.id, seeded.id));
    if (!freshRow) {
      throw new Error("expected the foreign org's revoke attempt to leave the row in place");
    }
    // No silent success: the key must genuinely still be active, not just
    // "the repo returned null while secretly revoking it anyway".
    expect(freshRow.revokedAt).toBeNull();
  });

  it("key metadata DTO exposes neither key hash nor raw material", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "DTO Org",
      userName: "DTO Owner",
      email: "dto-owner@example.com",
    });
    const project = await seedProject(db, { organizationId: org.organizationId, name: "DTO Project" });
    const raw = makeRawKeyMaterial();
    await seedWriteKey(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      kind: "standard",
      raw,
    });

    const repo = createWriteKeysRepo(db, org.ctx);
    const keys = await repo.listByProject(project.id);

    expect(keys).toHaveLength(1);
    const dto = keys[0];
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain(raw);
    expect(Object.keys(dto)).not.toContain("keyHash");
  });
});
