// signature-ledger, "Integration tests, packages/db" T-DB-1 through T-DB-5, plus the
// org-scoping companion That decision requires of every new table, and post-sprint
// audit Finding 3 (T-DB-4, T-DB-5 were never written against the real implementation).
//
// `createFindingSignaturesRepo`'s methods run real logic. Each test below asserts the
// atomic-upsert property exists specifically to guarantee: the same signature recorded
// twice is one row with `times_seen` incremented IN SQL, never a check-then-create and
// never a read-then-write race, and that the watermark columns (`last_seen_at`,
// `delivered_at`) never move backwards or re-fire on a replay.
//
// This suite is about the repository's atomicity and scoping, not the brand's
// validation (see `hex.test.ts` for that contract), so a well-formed hex literal is
// cast to `SignatureHex` directly rather than routed through `signatureHex`'s
// constructor.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  carryForwardValues,
  createFindingSignaturesRepo,
  type UpsertSeenInput,
} from "../../src/repositories/finding-signatures.repo";
import { createSignatureLedgerService } from "../../src/services/signature-ledger.service";
import type { SignatureHex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner, seedProject } from "../helpers/fixtures";

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

    // One row, not two. Settled by the unique index, never a prior read.
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

    // Two "writers" racing the same upsert. If the increment were read-then-write
    // instead of an atomic `SET times_seen = times_seen + 1`, this interleaving would
    // lose one of the two increments.
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

    // Org A's own scoped read must find only org A's row for this signature. A foreign
    // org's identical signature widens nothing.
    const foundFromA = await repoA.findBySignature(projectA.id, sharedSignature);
    expect(foundFromA?.id).toBe(rowA.id);
    expect(foundFromA?.organizationId).toBe(orgA.organizationId);
  });

  // T-DB-3, the add calls the `set`-clause omission this guards "the single most
  // dangerous line in the sprint" (`finding-signatures.repo.ts:158-162`). Nothing else
  // in the suite fails if `deliveredAt`, `dismissedAt`, or `firstSeenAt` are added back
  // to `upsertSeen`'s `onConflictDoUpdate.set`: every other test records a signature
  // that was never delivered and never dismissed, so clearing those columns is
  // invisible. This one records the full lifecycle first and then re-records. The
  // ordinary steady state, a finding seen again by a later analysis run after it was
  // already delivered and already dismissed forever.
  //
  // The dismissal is stamped through `recordDismissal` (the only write path that sets
  // `dismissed_at`) rather than by a direct update, so the value being protected here
  // got there the way production puts it there.
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

    // 1. Seen.
    await repo.upsertSeen(makeUpsertInput(project.id, { signature, seenAt: firstSeenAt }));
    // 2. Delivered.
    await repo.markDelivered(project.id, signature, deliveredAt);
    // 3. Dismissed forever, org-wide, by a real member.
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
    // Stamped as `now` inside `recordDismissal`'s transaction, so the exact instant is
    // captured here rather than asserted against a literal. The point below is that it
    // does not move, not what it is.
    const stampedDismissedAt = beforeReRecord?.dismissedAt;
    expect(stampedDismissedAt).toBeInstanceOf(Date);

    // 4. The same signature seen again by a later analysis run.
    const reRecorded = await repo.upsertSeen(
      makeUpsertInput(project.id, { signature, seenAt: laterSeenAt }),
    );

    // The re-record does its own job...
    expect(reRecorded.timesSeen).toBe(2);
    expect(reRecorded.lastSeenAt.getTime()).toBe(laterSeenAt.getTime());
    // ...and touches none of the lifetime state. Exact values, not truthiness: an
    // `excluded.*` in the `set` clause would overwrite `first_seen_at` with a non-null
    // later date and still read as "set".
    expect(reRecorded.deliveredAt?.getTime()).toBe(deliveredAt.getTime());
    expect(reRecorded.firstSeenAt.getTime()).toBe(firstSeenAt.getTime());
    expect(reRecorded.dismissedAt?.getTime()).toBe(stampedDismissedAt?.getTime());

    // And the persisted row agrees with what the upsert returned.
    const persisted = await repo.findBySignature(project.id, signature);
    expect(persisted?.deliveredAt?.getTime()).toBe(deliveredAt.getTime());
    expect(persisted?.dismissedAt?.getTime()).toBe(stampedDismissedAt?.getTime());
    expect(persisted?.firstSeenAt.getTime()).toBe(firstSeenAt.getTime());
    expect(persisted?.timesSeen).toBe(2);
  });

  // T-DB-4 (post-sprint audit Finding 3).
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
    // An older analysis run's result arrives after the newer one. The exact
    // out-of-order replay `greatest` exists to guard against.
    const afterOlderReplay = await repo.upsertSeen(
      makeUpsertInput(project.id, { signature, seenAt: olderSeenAt }),
    );

    expect(afterOlderReplay.lastSeenAt.getTime()).toBe(newerSeenAt.getTime());
  });

  // T-DB-5 (post-sprint audit Finding 3. "this one matters most": the never-twice
  // guarantee, previously called at most once anywhere in the suite).
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
    // Marked delivered a second time, with a later timestamp. The replay
    // `coalesce` exists to guard against.
    const second = await repo.markDelivered(project.id, signature, secondDeliveredAt);

    expect(first?.deliveredAt?.getTime()).toBe(firstDeliveredAt.getTime());
    expect(second?.deliveredAt?.getTime()).toBe(firstDeliveredAt.getTime());
  });

  // Review: carry-forward used to exist as two hand-copied upserts. This repository's
  // (tested, uncalled) and `recordAncestry`'s (shipped, untested), and they had already
  // diverged. The values are now built here, once, and both call sites pass the same
  // object through their own query builder. This test pins that one object.
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

    // The lifetime state exists to preserve. A dismissal survives a re-key because
    // the ledger row carried it.
    expect(values.deliveredAt).toEqual(oldRow.deliveredAt);
    expect(values.dismissedAt).toEqual(oldRow.dismissedAt);
    expect(values.timesSeen).toBe(4);
    expect(values.firstSeenAt).toEqual(oldRow.firstSeenAt);
    // Provenance travels too, the new row must be a fully valid ledger row, never a
    // partial one.
    expect(values.symptomClass).toBe("broken");
    expect(values.surface).toBe("/checkout");
    expect(values.surfaceNormalisationVersion).toBe(2);
    // The new identity, not the old one.
    expect(values.signature).toBe("b".repeat(64));
    expect(values.projectId).toBe("project-new");
    // / `no-org-param.test.ts`: the org is named literally at each call site beside the
    // spread, never carried by this helper.
    expect("organizationId" in values).toBe(false);
  });
});
