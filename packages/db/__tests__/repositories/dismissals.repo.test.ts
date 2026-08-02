import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import { createDismissalsRepo } from "../../src/repositories/dismissals.repo";
import { createFindingSignaturesRepo } from "../../src/repositories/finding-signatures.repo";
import * as schema from "../../src/schema";
import { createSignatureLedgerService } from "../../src/services/signature-ledger.service";
import type { SignatureHex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner, seedProject } from "../helpers/fixtures";

function testSignature(hex: string): SignatureHex {
  return hex as unknown as SignatureHex;
}

async function seedLedgerRow(
  db: TestDb,
  org: { organizationId: string; ctx: Parameters<typeof createFindingSignaturesRepo>[1] },
  params: { projectId: string; signature: SignatureHex; surface: string; seenAt: Date },
): Promise<void> {
  const ledger = createFindingSignaturesRepo(db, org.ctx);
  await ledger.upsertSeen({
    projectId: params.projectId,
    signature: params.signature,
    symptomClass: "broken",
    surface: params.surface,
    signatureTupleVersion: 1,
    evidenceShapeVersion: 1,
    surfaceNormalisationVersion: 1,
    seenAt: params.seenAt,
  });
}

describe("dismissals repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("writes one dismissal row and returns the same result when the dismissal path is called twice with the same payload", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-dismiss-twice",
      userName: "Owner Dismiss Twice",
      email: "owner-dismiss-twice@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-dismiss-twice",
    });
    const service = createSignatureLedgerService(db, org.ctx);
    const repo = createDismissalsRepo(db, org.ctx);
    const payload = {
      projectId: project.id,
      findingId: "finding-checkout-twice-0001",
      signature: testSignature("d".repeat(64)),
      action: "not_useful" as const,
      dismissedByUserId: org.userId,
    };

    const first = await service.recordDismissal(payload);

    const second = await service.recordDismissal(payload);

    expect(second.id).toBe(first.id);
    expect(second.dismissedAt.getTime()).toBe(first.dismissedAt.getTime());

    const found = await repo.findFor(payload.findingId, payload.action);
    expect(found?.id).toBe(first.id);
  });

  it("rejects a second dismissal row inserted directly for the same (organization_id, finding_id, action) — enforced by the unique index, not by convention", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-dismiss-index",
      userName: "Owner Dismiss Index",
      email: "owner-dismiss-index@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-dismiss-index",
    });
    const findingId = "finding-checkout-index-0001";
    const action = "not_useful" as const;

    const [firstRow] = await db
      .insert(schema.dismissals)
      .values({
        id: randomUUID(),
        organizationId: org.organizationId,
        projectId: project.id,
        findingId,
        signature: "e".repeat(64),
        action,
        dismissedByUserId: org.userId,
        dismissedAt: new Date("2026-07-31T09:00:00.000Z"),
      })
      .returning();

    if (!firstRow) {
      throw new Error("setup: direct insert of the first dismissal row returned no row");
    }

    let caught: unknown;
    try {
      await db.insert(schema.dismissals).values({
        id: randomUUID(),
        organizationId: org.organizationId,
        projectId: project.id,
        findingId,
        signature: "f".repeat(64),
        action,
        dismissedByUserId: org.userId,
        dismissedAt: new Date("2026-07-31T09:05:00.000Z"),
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
      /dismissals_org_finding_action_key|duplicate key|unique constraint/i,
    );

    const repo = createDismissalsRepo(db, org.ctx);
    const survivor = await repo.findFor(findingId, action);
    expect(survivor?.id).toBe(firstRow.id);
  });

  it("should stamp dismissed_at on the ledger row in the same transaction as the dismissal row", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-dismiss-stamp",
      userName: "Owner Dismiss Stamp",
      email: "owner-dismiss-stamp@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-dismiss-stamp",
    });
    const signature = testSignature("2".repeat(64));
    await seedLedgerRow(db, org, {
      projectId: project.id,
      signature,
      surface: "/checkout/stamp",
      seenAt: new Date("2026-07-30T08:00:00.000Z"),
    });

    const ledger = createFindingSignaturesRepo(db, org.ctx);
    const repo = createDismissalsRepo(db, org.ctx);

    const before = await ledger.findBySignature(project.id, signature);
    expect(before?.dismissedAt).toBeNull();

    const service = createSignatureLedgerService(db, org.ctx);
    const dismissal = await service.recordDismissal({
      projectId: project.id,
      findingId: "finding-checkout-stamp-0001",
      signature,
      action: "not_useful",
      dismissedByUserId: org.userId,
    });

    const dismissalRow = await repo.findFor("finding-checkout-stamp-0001", "not_useful");
    expect(dismissalRow?.id).toBe(dismissal.id);

    const after = await ledger.findBySignature(project.id, signature);
    expect(after?.dismissedAt).not.toBeNull();
    expect(after?.dismissedAt?.getTime()).toBe(dismissal.dismissedAt.getTime());

    const allDismissals = await db
      .select()
      .from(schema.dismissals)
      .where(eq(schema.dismissals.organizationId, org.organizationId));
    expect(allDismissals).toHaveLength(1);
  });

  it("should not move dismissed_at when the same dismissal replays", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-dismiss-coalesce",
      userName: "Owner Dismiss Coalesce",
      email: "owner-dismiss-coalesce@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-dismiss-coalesce",
    });
    const signature = testSignature("3".repeat(64));
    await seedLedgerRow(db, org, {
      projectId: project.id,
      signature,
      surface: "/checkout/coalesce",
      seenAt: new Date("2026-07-30T08:00:00.000Z"),
    });

    const service = createSignatureLedgerService(db, org.ctx);
    const ledger = createFindingSignaturesRepo(db, org.ctx);
    const payload = {
      projectId: project.id,
      findingId: "finding-checkout-coalesce-0001",
      signature,
      action: "not_useful" as const,
      dismissedByUserId: org.userId,
    };

    await service.recordDismissal(payload);
    const firstStamp = (await ledger.findBySignature(project.id, signature))?.dismissedAt;
    expect(firstStamp).toBeInstanceOf(Date);
    if (!firstStamp) throw new Error("setup: the first dismissal left no ledger stamp");

    await Bun.sleep(10);
    const beforeReplay = new Date();
    expect(beforeReplay.getTime()).toBeGreaterThan(firstStamp.getTime());

    await service.recordDismissal(payload);

    const secondStamp = (await ledger.findBySignature(project.id, signature))?.dismissedAt;
    expect(secondStamp?.getTime()).toBe(firstStamp.getTime());

    const allDismissals = await db
      .select()
      .from(schema.dismissals)
      .where(eq(schema.dismissals.organizationId, org.organizationId));
    expect(allDismissals).toHaveLength(1);
  });

  it("should keep the dismissal row when its author's user row is deleted", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-dismiss-author-deleted",
      userName: "Owner Dismiss Author Deleted",
      email: "owner-dismiss-author-deleted@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-dismiss-author-deleted",
    });
    const service = createSignatureLedgerService(db, org.ctx);
    const repo = createDismissalsRepo(db, org.ctx);
    const payload = {
      projectId: project.id,
      findingId: "finding-author-deleted-0001",
      signature: testSignature("1".repeat(64)),
      action: "not_useful" as const,
      dismissedByUserId: org.userId,
    };

    const dismissal = await service.recordDismissal(payload);
    expect(dismissal.dismissedByUserId).toBe(org.userId);

    await db.delete(schema.user).where(eq(schema.user.id, org.userId));

    const survivor = await repo.findFor(payload.findingId, payload.action);
    expect(survivor?.id).toBe(dismissal.id);

    expect(survivor?.dismissedByUserId).toBeNull();
    expect(survivor?.dismissedAt.getTime()).toBe(dismissal.dismissedAt.getTime());

    const decision = await service.consultSignature(project.id, payload.signature);
    expect(decision).toEqual({ decision: "suppress", reason: "dismissed" });
  });
});
