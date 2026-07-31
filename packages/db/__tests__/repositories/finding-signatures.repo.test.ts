// signature-ledger (O-006), ADD §7 "Integration tests — packages/db"
// T-DB-1 through T-DB-5 (D6, D-9, D4), plus the org-scoping companion D-10
// requires of every new table, and post-sprint audit Finding 3 (T-DB-4,
// T-DB-5 were never written against the real implementation).
//
// `createFindingSignaturesRepo`'s methods run real logic — each test below
// asserts the ATOMIC-UPSERT property D-9 exists specifically to guarantee:
// the same signature recorded twice is ONE row with `times_seen` incremented
// IN SQL, never a check-then-create and never a read-then-write race, and
// that the watermark columns (`last_seen_at`, `delivered_at`) never move
// backwards or re-fire on a replay.
//
// This suite is about the repository's atomicity and scoping, not the
// brand's validation (see `hex.test.ts` for that contract), so a
// well-formed hex literal is cast to `SignatureHex` directly rather than
// routed through `signatureHex`'s constructor.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  carryForwardValues,
  createFindingSignaturesRepo,
  type UpsertSeenInput,
} from "../../src/repositories/finding-signatures.repo";
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

    // One row, not two — settled by the unique index, never a prior read.
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

    // Two "writers" racing the same upsert. If the increment were
    // read-then-write instead of an atomic `SET times_seen = times_seen +
    // 1`, this interleaving would lose one of the two increments.
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

    // Org A's own scoped read must find only org A's row for this
    // signature — a foreign org's identical signature widens nothing.
    const foundFromA = await repoA.findBySignature(projectA.id, sharedSignature);
    expect(foundFromA?.id).toBe(rowA.id);
    expect(foundFromA?.organizationId).toBe(orgA.organizationId);
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
    // An OLDER analysis run's result arrives AFTER the newer one — the exact
    // out-of-order replay `greatest(...)` exists to guard against.
    const afterOlderReplay = await repo.upsertSeen(
      makeUpsertInput(project.id, { signature, seenAt: olderSeenAt }),
    );

    expect(afterOlderReplay.lastSeenAt.getTime()).toBe(newerSeenAt.getTime());
  });

  // T-DB-5 (post-sprint audit Finding 3 — "this one matters most": the
  // never-twice guarantee, previously called at most once anywhere in the
  // suite).
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
    // Marked delivered a SECOND time, with a LATER timestamp — the replay
    // `coalesce(...)` exists to guard against.
    const second = await repo.markDelivered(project.id, signature, secondDeliveredAt);

    expect(first?.deliveredAt?.getTime()).toBe(firstDeliveredAt.getTime());
    expect(second?.deliveredAt?.getTime()).toBe(firstDeliveredAt.getTime());
  });

  // Review CR-12: carry-forward used to exist as two hand-copied upserts —
  // this repository's (tested, uncalled) and `recordAncestry`'s (shipped,
  // untested) — and they had already diverged. The values are now built here,
  // once, and both call sites pass the SAME object through their own query
  // builder. This test pins that one object.
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

    // The lifetime state D-3(a) exists to preserve — a dismissal survives a
    // re-key because the ledger row carried it.
    expect(values.deliveredAt).toEqual(oldRow.deliveredAt);
    expect(values.dismissedAt).toEqual(oldRow.dismissedAt);
    expect(values.timesSeen).toBe(4);
    expect(values.firstSeenAt).toEqual(oldRow.firstSeenAt);
    // Provenance travels too — the new row must be a fully valid ledger row,
    // never a partial one.
    expect(values.symptomClass).toBe("broken");
    expect(values.surface).toBe("/checkout");
    expect(values.surfaceNormalisationVersion).toBe(2);
    // The NEW identity, not the old one.
    expect(values.signature).toBe("b".repeat(64));
    expect(values.projectId).toBe("project-new");
    // D-B / `no-org-param.test.ts`: the org is named literally at each call
    // site beside the spread, never carried by this helper.
    expect("organizationId" in values).toBe(false);
  });
});
