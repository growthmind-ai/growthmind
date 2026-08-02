import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { and, eq, sql } from "drizzle-orm";

import {
  ANCESTRY_RESOLUTION_MAX_HOPS,
  type AncestryReason,
  type TenantContext,
} from "@growthmind/shared";

import {
  createFindingSignaturesRepo,
  type UpsertSeenInput,
} from "../../src/repositories/finding-signatures.repo";
import { createSignatureAncestryRepo } from "../../src/repositories/signature-ancestry.repo";
import * as schema from "../../src/schema";
import { createSignatureLedgerService } from "../../src/services/signature-ledger.service";
import type { SignatureHex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner, seedProject } from "../helpers/fixtures";

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

function makeSeen(projectId: string, signature: SignatureHex, seenAt: Date): UpsertSeenInput {
  return {
    projectId,
    signature,
    symptomClass: "broken",
    surface: "/checkout",
    signatureTupleVersion: 1,
    evidenceShapeVersion: 1,
    surfaceNormalisationVersion: 2,
    seenAt,
  };
}

async function ledgerRowsFor(db: TestDb, scope: Scope) {
  return db
    .select()
    .from(schema.findingSignatures)
    .where(
      and(
        eq(schema.findingSignatures.organizationId, scope.organizationId),
        eq(schema.findingSignatures.projectId, scope.projectId),
      ),
    );
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

    expect(caught).toBeDefined();
    const causeMessage =
      caught instanceof Error && caught.cause instanceof Error
        ? caught.cause.message
        : String(caught);
    expect(causeMessage).toMatch(
      /signature_ancestry_org_old_signature_key|duplicate key|unique constraint/i,
    );

    const repo = createSignatureAncestryRepo(db, scope.ctx);
    const survivor = await repo.forwardEdge(oldSignature);
    expect(survivor?.newSignature).toBe(firstNew);
  });

  it("should carry first_seen_at, times_seen, delivered_at, and dismissed_at forward onto the new signature when ancestry is recorded", async () => {
    const scope = await seedScope(db, "carry-forward");
    const ledger = createFindingSignaturesRepo(db, scope.ctx);
    const service = createSignatureLedgerService(db, scope.ctx);
    const oldSignature = testSignature(90);
    const newSignature = testSignature(91);

    const oldFirstSeen = new Date("2026-07-01T09:00:00.000Z");
    const oldLastSeen = new Date("2026-07-09T09:00:00.000Z");
    const oldDelivered = new Date("2026-07-02T09:00:00.000Z");
    const newFirstSeen = new Date("2026-07-10T09:00:00.000Z");
    const newLastSeen = new Date("2026-07-15T09:00:00.000Z");
    const newDelivered = new Date("2026-07-12T09:00:00.000Z");

    await ledger.upsertSeen(makeSeen(scope.projectId, oldSignature, oldFirstSeen));
    await ledger.upsertSeen(
      makeSeen(scope.projectId, oldSignature, new Date("2026-07-05T09:00:00.000Z")),
    );
    await ledger.upsertSeen(makeSeen(scope.projectId, oldSignature, oldLastSeen));
    await ledger.markDelivered(scope.projectId, oldSignature, oldDelivered);
    await service.recordDismissal({
      projectId: scope.projectId,
      findingId: "finding-carry-forward",
      signature: oldSignature,
      action: "not_useful",
      dismissedByUserId: null,
    });

    await ledger.upsertSeen(makeSeen(scope.projectId, newSignature, newFirstSeen));
    await ledger.upsertSeen(makeSeen(scope.projectId, newSignature, newLastSeen));
    await ledger.markDelivered(scope.projectId, newSignature, newDelivered);

    const oldBefore = await ledger.findBySignature(scope.projectId, oldSignature);
    expect(oldBefore?.timesSeen).toBe(3);

    const oldDismissedAt = oldBefore?.dismissedAt;
    expect(oldDismissedAt).toBeInstanceOf(Date);

    await service.recordAncestry({
      projectId: scope.projectId,
      oldSignature,
      newSignature,
      reason: REASON,
    });

    const carried = await ledger.findBySignature(scope.projectId, newSignature);
    expect(carried?.firstSeenAt.getTime()).toBe(oldFirstSeen.getTime());
    expect(carried?.timesSeen).toBe(5);
    expect(carried?.deliveredAt?.getTime()).toBe(newDelivered.getTime());
    expect(carried?.dismissedAt?.getTime()).toBe(oldDismissedAt?.getTime());
    expect(carried?.lastSeenAt.getTime()).toBe(newLastSeen.getTime());

    const oldAfter = await ledger.findBySignature(scope.projectId, oldSignature);
    expect(oldAfter?.id).toBe(oldBefore!.id);
    expect(oldAfter?.timesSeen).toBe(3);
    expect(oldAfter?.firstSeenAt.getTime()).toBe(oldFirstSeen.getTime());
    expect(oldAfter?.lastSeenAt.getTime()).toBe(oldLastSeen.getTime());
    expect(oldAfter?.deliveredAt?.getTime()).toBe(oldDelivered.getTime());
    expect(oldAfter?.dismissedAt?.getTime()).toBe(oldDismissedAt?.getTime());

    const rows = await ledgerRowsFor(db, scope);
    expect(rows).toHaveLength(2);
  });

  it("should leave both the ancestry edge and the ledger unchanged when the carry-forward half of the transaction fails", async () => {
    const scope = await seedScope(db, "atomicity");
    const ledger = createFindingSignaturesRepo(db, scope.ctx);
    const service = createSignatureLedgerService(db, scope.ctx);
    const oldSignature = testSignature(100);
    const newSignature = testSignature(101);

    const oldFirstSeen = new Date("2026-07-01T09:00:00.000Z");
    const oldDelivered = new Date("2026-07-02T09:00:00.000Z");

    await ledger.upsertSeen(makeSeen(scope.projectId, oldSignature, oldFirstSeen));
    await ledger.markDelivered(scope.projectId, oldSignature, oldDelivered);
    const oldBefore = await ledger.findBySignature(scope.projectId, oldSignature);
    expect(oldBefore).not.toBeNull();

    await db.execute(
      sql.raw(
        `alter table finding_signatures add constraint t_db_17_block_carry_forward ` +
          `check (signature <> '${newSignature}')`,
      ),
    );

    let caught: unknown;
    try {
      await service.recordAncestry({
        projectId: scope.projectId,
        oldSignature,
        newSignature,
        reason: REASON,
      });
    } catch (error) {
      caught = error;
    } finally {
      await db.execute(
        sql.raw(`alter table finding_signatures drop constraint t_db_17_block_carry_forward`),
      );
    }

    expect(caught).toBeDefined();

    const repo = createSignatureAncestryRepo(db, scope.ctx);
    expect(await repo.forwardEdge(oldSignature)).toBeNull();

    expect(await repo.resolve(oldSignature)).toEqual({
      resolution: "resolved",
      signature: oldSignature,
      hops: 0,
    });

    expect(await ledger.findBySignature(scope.projectId, newSignature)).toBeNull();
    const oldAfter = await ledger.findBySignature(scope.projectId, oldSignature);
    expect(oldAfter?.id).toBe(oldBefore!.id);
    expect(oldAfter?.timesSeen).toBe(1);
    expect(oldAfter?.firstSeenAt.getTime()).toBe(oldFirstSeen.getTime());
    expect(oldAfter?.deliveredAt?.getTime()).toBe(oldDelivered.getTime());
    expect(oldAfter?.dismissedAt).toBeNull();

    const rows = await ledgerRowsFor(db, scope);
    expect(rows).toHaveLength(1);
  });
});
