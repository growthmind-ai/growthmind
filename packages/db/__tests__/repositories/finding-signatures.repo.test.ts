import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  carryForwardValues,
  createFindingSignaturesRepo,
  type UpsertSeenInput,
} from "../../src/repositories/finding-signatures.repo";
import { createSignatureLedgerService } from "../../src/services/signature-ledger.service";
import type { SignatureHex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner, seedProject } from "../../src/testing";

function testSignature(hex: string): SignatureHex {
  return hex as unknown as SignatureHex;
}

const SEEN_AT = new Date("2026-07-31T09:00:00.000Z");

function makeUpsertInput(
  projectId: string,
  overrides: Partial<UpsertSeenInput> = {},
): UpsertSeenInput {
  return {
    projectId,
    signature: testSignature("a".repeat(64)),
    symptomClass: "broken",
    surface: "/checkout",
    signatureTupleVersion: 1,
    evidenceShapeVersion: 1,
    surfaceNormalisationVersion: 2,
    seenAt: SEEN_AT,
    ...overrides,
  };
}

describe("finding signatures repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("creates one row and increments times_seen to 2 when the same signature is recorded twice", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-upsert-twice",
      userName: "Owner Upsert Twice",
      email: "owner-upsert-twice@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-upsert-twice",
    });
    const repo = createFindingSignaturesRepo(db, org.ctx);
    const input = makeUpsertInput(project.id);

    const first = await repo.upsertSeen(input);
    const second = await repo.upsertSeen(input);

    expect(second.id).toBe(first.id);
    expect(second.timesSeen).toBe(2);

    const found = await repo.findBySignature(project.id, input.signature);
    expect(found?.id).toBe(first.id);
    expect(found?.timesSeen).toBe(2);
  });

  it("increments times_seen in SQL under two interleaved concurrent writers with no lost update", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-upsert-concurrent",
      userName: "Owner Upsert Concurrent",
      email: "owner-upsert-concurrent@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-upsert-concurrent",
    });
    const repo = createFindingSignaturesRepo(db, org.ctx);
    const input = makeUpsertInput(project.id, { signature: testSignature("b".repeat(64)) });

    await Promise.all([repo.upsertSeen(input), repo.upsertSeen(input)]);

    const found = await repo.findBySignature(project.id, input.signature);
    expect(found?.timesSeen).toBe(2);
  });

  it("keeps the same signature under a different org as a separate row", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "acme-upsert-org-a",
      userName: "Owner Upsert Org A",
      email: "owner-upsert-org-a@acme.example",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "acme-upsert-org-b",
      userName: "Owner Upsert Org B",
      email: "owner-upsert-org-b@acme.example",
    });
    const projectA = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "checkout-upsert-org-a",
    });
    const projectB = await seedProject(db, {
      organizationId: orgB.organizationId,
      name: "checkout-upsert-org-b",
    });
    const repoA = createFindingSignaturesRepo(db, orgA.ctx);
    const repoB = createFindingSignaturesRepo(db, orgB.ctx);
    const sharedSignature = testSignature("c".repeat(64));

    const rowA = await repoA.upsertSeen(
      makeUpsertInput(projectA.id, { signature: sharedSignature }),
    );
    const rowB = await repoB.upsertSeen(
      makeUpsertInput(projectB.id, { signature: sharedSignature }),
    );

    expect(rowA.id).not.toBe(rowB.id);
    expect(rowA.timesSeen).toBe(1);
    expect(rowB.timesSeen).toBe(1);

    const foundFromA = await repoA.findBySignature(projectA.id, sharedSignature);
    expect(foundFromA?.id).toBe(rowA.id);
    expect(foundFromA?.organizationId).toBe(orgA.organizationId);
  });

  it("should not clear delivered_at, dismissed_at, or first_seen_at when a delivered-and-dismissed signature is re-recorded", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-lifecycle-preserved",
      userName: "Owner Lifecycle Preserved",
      email: "owner-lifecycle-preserved@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-lifecycle-preserved",
    });
    const repo = createFindingSignaturesRepo(db, org.ctx);
    const service = createSignatureLedgerService(db, org.ctx);
    const signature = testSignature("f".repeat(64));

    const firstSeenAt = new Date("2026-07-01T09:00:00.000Z");
    const deliveredAt = new Date("2026-07-02T09:00:00.000Z");
    const laterSeenAt = new Date("2026-07-20T09:00:00.000Z");

    await repo.upsertSeen(makeUpsertInput(project.id, { signature, seenAt: firstSeenAt }));

    await repo.markDelivered(project.id, signature, deliveredAt);

    await service.recordDismissal({
      projectId: project.id,
      findingId: "finding-lifecycle-preserved",
      signature,
      action: "not_useful",
      dismissedByUserId: org.userId,
    });

    const beforeReRecord = await repo.findBySignature(project.id, signature);
    expect(beforeReRecord?.deliveredAt?.getTime()).toBe(deliveredAt.getTime());
    expect(beforeReRecord?.firstSeenAt.getTime()).toBe(firstSeenAt.getTime());

    const stampedDismissedAt = beforeReRecord?.dismissedAt;
    expect(stampedDismissedAt).toBeInstanceOf(Date);

    const reRecorded = await repo.upsertSeen(
      makeUpsertInput(project.id, { signature, seenAt: laterSeenAt }),
    );

    expect(reRecorded.timesSeen).toBe(2);
    expect(reRecorded.lastSeenAt.getTime()).toBe(laterSeenAt.getTime());

    expect(reRecorded.deliveredAt?.getTime()).toBe(deliveredAt.getTime());
    expect(reRecorded.firstSeenAt.getTime()).toBe(firstSeenAt.getTime());
    expect(reRecorded.dismissedAt?.getTime()).toBe(stampedDismissedAt?.getTime());

    const persisted = await repo.findBySignature(project.id, signature);
    expect(persisted?.deliveredAt?.getTime()).toBe(deliveredAt.getTime());
    expect(persisted?.dismissedAt?.getTime()).toBe(stampedDismissedAt?.getTime());
    expect(persisted?.firstSeenAt.getTime()).toBe(firstSeenAt.getTime());
    expect(persisted?.timesSeen).toBe(2);
  });

  it("should not move last_seen_at backwards when an older analysis run replays out of order", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-upsert-out-of-order",
      userName: "Owner Upsert Out Of Order",
      email: "owner-upsert-out-of-order@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-upsert-out-of-order",
    });
    const repo = createFindingSignaturesRepo(db, org.ctx);
    const signature = testSignature("d".repeat(64));

    const newerSeenAt = new Date("2026-07-31T10:00:00.000Z");
    const olderSeenAt = new Date("2026-07-31T09:00:00.000Z");

    await repo.upsertSeen(makeUpsertInput(project.id, { signature, seenAt: newerSeenAt }));

    const afterOlderReplay = await repo.upsertSeen(
      makeUpsertInput(project.id, { signature, seenAt: olderSeenAt }),
    );

    expect(afterOlderReplay.lastSeenAt.getTime()).toBe(newerSeenAt.getTime());
  });

  it("should not move delivered_at when delivery is marked twice", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-delivered-twice",
      userName: "Owner Delivered Twice",
      email: "owner-delivered-twice@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-delivered-twice",
    });
    const repo = createFindingSignaturesRepo(db, org.ctx);
    const signature = testSignature("e".repeat(64));
    await repo.upsertSeen(makeUpsertInput(project.id, { signature }));

    const firstDeliveredAt = new Date("2026-07-31T11:00:00.000Z");
    const secondDeliveredAt = new Date("2026-07-31T12:00:00.000Z");

    const first = await repo.markDelivered(project.id, signature, firstDeliveredAt);

    const second = await repo.markDelivered(project.id, signature, secondDeliveredAt);

    expect(first?.deliveredAt?.getTime()).toBe(firstDeliveredAt.getTime());
    expect(second?.deliveredAt?.getTime()).toBe(firstDeliveredAt.getTime());
  });

  it("carries the old ledger row's provenance and lifetime state onto the new signature without naming an organization", () => {
    const oldRow = {
      id: "row-old",
      organizationId: "org-should-not-appear",
      projectId: "project-old",
      signature: "a".repeat(64),
      symptomClass: "broken" as const,
      surface: "/checkout",
      signatureTupleVersion: 1,
      evidenceShapeVersion: 1,
      surfaceNormalisationVersion: 2,
      firstSeenAt: new Date("2026-07-01T09:00:00.000Z"),
      lastSeenAt: new Date("2026-07-20T09:00:00.000Z"),
      timesSeen: 4,
      deliveredAt: new Date("2026-07-02T09:00:00.000Z"),
      dismissedAt: new Date("2026-07-03T09:00:00.000Z"),
      createdAt: new Date("2026-07-01T09:00:00.000Z"),
    };

    const values = carryForwardValues({
      projectId: "project-new",
      newSignature: testSignature("b".repeat(64)),
      oldRow,
    });

    expect(values.deliveredAt).toEqual(oldRow.deliveredAt);
    expect(values.dismissedAt).toEqual(oldRow.dismissedAt);
    expect(values.timesSeen).toBe(4);
    expect(values.firstSeenAt).toEqual(oldRow.firstSeenAt);

    expect(values.symptomClass).toBe("broken");
    expect(values.surface).toBe("/checkout");
    expect(values.surfaceNormalisationVersion).toBe(2);

    expect(values.signature).toBe("b".repeat(64));
    expect(values.projectId).toBe("project-new");

    expect("organizationId" in values).toBe(false);
  });
});
