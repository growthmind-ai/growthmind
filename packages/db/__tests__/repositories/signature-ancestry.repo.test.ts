// Wave 0C (RED) — signature-ledger (O-006), ADD §7 T-DB-9 through T-DB-15
// (D-3(b), D-10, D3, D5's boundary cases).
//
// The edge insert a caller would reach through `recordAncestry`
// (`signature-ledger.service.ts`) is itself part of a transactional Wave 0B
// stub, so every chain below is seeded with a DIRECT insert against the
// real, already-applied `signature_ancestry` migration — that is the
// "arrange" step, never the assertion (the same discipline
// `db-lane-fixtures.ts` documents for its own lane's seeders). Every
// assertion about RESOLUTION goes through `createSignatureAncestryRepo`'s
// public `resolve`/`forwardEdge` methods, which are Wave 0B stubs that
// throw "not implemented" unconditionally — so every resolution test below
// fails today for that reason, and stays meaningful once Wave 4 fills the
// walk in.
//
// T-DB-9 (the empty-table case) is NEVER CUT: it is the MVP's actual
// production state (Ruling 1 — nothing re-keys `surface_id` yet), and an
// untested empty mechanism will not work the day a later outcome's
// surface-derivation swap needs it.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  ANCESTRY_RESOLUTION_MAX_HOPS,
  type AncestryReason,
  type TenantContext,
} from "@growthmind/shared";

import { createSignatureAncestryRepo } from "../../src/repositories/signature-ancestry.repo";
import * as schema from "../../src/schema";
import type { SignatureHex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner, seedProject } from "../helpers/fixtures";

/** 64 lowercase hex chars, distinct per `n` (`n` < 256). NOT a real sha256
 * digest — `resolve`'s contract under test here is about identity chains,
 * not about `sha256Hex`'s own provenance (see `hex.test.ts` for that). */
function testSignature(n: number): SignatureHex {
  const byte = n.toString(16).padStart(2, "0");
  return byte.repeat(32) as unknown as SignatureHex;
}

const REASON: AncestryReason = "surface_rename";
const RECORDED_AT = new Date("2026-07-31T09:00:00.000Z");

interface Scope {
  organizationId: string;
  projectId: string;
  ctx: TenantContext;
}

async function seedScope(db: TestDb, label: string): Promise<Scope> {
  const org = await seedOrgWithOwner(db, {
    orgName: `acme-ancestry-${label}`,
    userName: `Owner Ancestry ${label}`,
    email: `owner-ancestry-${label}@acme.example`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `checkout-ancestry-${label}`,
  });
  return { organizationId: org.organizationId, projectId: project.id, ctx: org.ctx };
}

/** Seeds a forward-edge CHAIN `signatures[0] -> signatures[1] -> ... ->
 * signatures[n-1]` directly against the real migration — `recordAncestry`'s
 * own write path is a transactional stub and cannot do this yet. */
async function seedChain(
  db: TestDb,
  scope: Pick<Scope, "organizationId" | "projectId">,
  signatures: readonly SignatureHex[],
): Promise<void> {
  for (let i = 0; i < signatures.length - 1; i += 1) {
    await db.insert(schema.signatureAncestry).values({
      id: randomUUID(),
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      oldSignature: signatures[i]!,
      newSignature: signatures[i + 1]!,
      reason: REASON,
      recordedAt: RECORDED_AT,
    });
  }
}

describe("signature ancestry repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // T-DB-9 — NEVER CUT, the MVP-production state.
  it("resolves to the input signature against an EMPTY ancestry table", async () => {
    const scope = await seedScope(db, "empty");
    const repo = createSignatureAncestryRepo(db, scope.ctx);
    const input = testSignature(1);

    const resolution = await repo.resolve(input);

    expect(resolution).toEqual({ resolution: "resolved", signature: input, hops: 0 });
  });

  it("resolves a one-hop chain to the terminal signature", async () => {
    const scope = await seedScope(db, "one-hop");
    const chain = [testSignature(10), testSignature(11)];
    await seedChain(db, scope, chain);
    const repo = createSignatureAncestryRepo(db, scope.ctx);

    const resolution = await repo.resolve(chain[0]!);

    expect(resolution).toEqual({ resolution: "resolved", signature: chain[1], hops: 1 });
  });

  it("resolves a multi-hop chain to the terminal signature", async () => {
    const scope = await seedScope(db, "multi-hop");
    const chain = [testSignature(20), testSignature(21), testSignature(22), testSignature(23)];
    await seedChain(db, scope, chain);
    const repo = createSignatureAncestryRepo(db, scope.ctx);

    const resolution = await repo.resolve(chain[0]!);

    expect(resolution).toEqual({ resolution: "resolved", signature: chain[3], hops: 3 });
  });

  // T-DB-11 — the depth-cap boundary: exactly at the cap still resolves.
  it("resolves an 8-hop chain to the terminal signature (the depth-cap boundary)", async () => {
    const scope = await seedScope(db, "eight-hop");
    const chain = Array.from({ length: ANCESTRY_RESOLUTION_MAX_HOPS + 1 }, (_, i) =>
      testSignature(30 + i),
    );
    await seedChain(db, scope, chain);
    const repo = createSignatureAncestryRepo(db, scope.ctx);

    const resolution = await repo.resolve(chain[0]!);

    expect(resolution).toEqual({
      resolution: "resolved",
      signature: chain[chain.length - 1],
      hops: ANCESTRY_RESOLUTION_MAX_HOPS,
    });
  });

  // T-DB-12 — one hop past the cap must degrade cleanly, never hang.
  it("returns unresolvable with cause depth_cap for a 9-hop chain", async () => {
    const scope = await seedScope(db, "nine-hop");
    const chain = Array.from({ length: ANCESTRY_RESOLUTION_MAX_HOPS + 2 }, (_, i) =>
      testSignature(50 + i),
    );
    await seedChain(db, scope, chain);
    const repo = createSignatureAncestryRepo(db, scope.ctx);

    const resolution = await repo.resolve(chain[0]!);

    expect(resolution).toEqual({ resolution: "unresolvable", cause: "depth_cap" });
  });

  // T-DB-13 — a self-edge is the smallest possible cycle.
  it("returns unresolvable with cause cycle for a self-edge", async () => {
    const scope = await seedScope(db, "self-edge");
    const signature = testSignature(70);
    await db.insert(schema.signatureAncestry).values({
      id: randomUUID(),
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      oldSignature: signature,
      newSignature: signature,
      reason: REASON,
      recordedAt: RECORDED_AT,
    });
    const repo = createSignatureAncestryRepo(db, scope.ctx);

    const resolution = await repo.resolve(signature);

    expect(resolution).toEqual({ resolution: "unresolvable", cause: "cycle" });
  });

  // T-DB-14 — a longer loop must be detected too, not just the trivial case.
  it("returns unresolvable with cause cycle for a two-node loop", async () => {
    const scope = await seedScope(db, "two-node-cycle");
    const a = testSignature(60);
    const b = testSignature(61);
    await db.insert(schema.signatureAncestry).values([
      {
        id: randomUUID(),
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        oldSignature: a,
        newSignature: b,
        reason: REASON,
        recordedAt: RECORDED_AT,
      },
      {
        id: randomUUID(),
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        oldSignature: b,
        newSignature: a,
        reason: REASON,
        recordedAt: RECORDED_AT,
      },
    ]);
    const repo = createSignatureAncestryRepo(db, scope.ctx);

    const resolution = await repo.resolve(a);

    expect(resolution).toEqual({ resolution: "unresolvable", cause: "cycle" });
  });

  // T-DB-15 — impossible BY THE INDEX, not by convention.
  it("rejects a second forward edge for the same old_signature — enforced by the unique index, not by convention", async () => {
    const scope = await seedScope(db, "unique-index");
    const oldSignature = testSignature(80);
    const firstNew = testSignature(81);
    const secondNew = testSignature(82);

    await db.insert(schema.signatureAncestry).values({
      id: randomUUID(),
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      oldSignature,
      newSignature: firstNew,
      reason: REASON,
      recordedAt: RECORDED_AT,
    });

    let caught: unknown;
    try {
      await db.insert(schema.signatureAncestry).values({
        id: randomUUID(),
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        oldSignature,
        newSignature: secondNew,
        reason: REASON,
        recordedAt: RECORDED_AT,
      });
    } catch (error) {
      caught = error;
    }

    // Real SQL, not the stub: this insert never touches the repository
    // under test at all. drizzle-orm wraps the driver's error as `.cause`;
    // the outer message is only "Failed query: ...", so the constraint
    // name/reason lives on the cause.
    expect(caught).toBeDefined();
    const causeMessage =
      caught instanceof Error && caught.cause instanceof Error
        ? caught.cause.message
        : String(caught);
    expect(causeMessage).toMatch(
      /signature_ancestry_org_old_signature_key|duplicate key|unique constraint/i,
    );

    // The repository read-back is what makes this test RED today:
    // `forwardEdge` is itself a Wave 0B stub, so this call throws "not
    // implemented" even though the constraint check above already ran
    // against real SQL.
    const repo = createSignatureAncestryRepo(db, scope.ctx);
    const survivor = await repo.forwardEdge(oldSignature);
    expect(survivor?.newSignature).toBe(firstNew);
  });
});
