// Wave 0C (red), signature-ledger, T-DB-18 (idempotence), plus the schema-level
// companion proving the unique index (not a convention) is what enforces it.
//
// The write lives in the service, not this repository (`recordDismissal` performs the
// dismissal insert and the ledger's `dismissed_at` stamp in one transaction on a `tx`
// handle, because `ScopedDb`'s union has no `.transaction`-callback overload that
// narrows to a repository factory. See `dismissals.repo.ts`'s own header). This suite
// drives the write through `createSignatureLedgerService`'s `recordDismissal` and reads
// back through `createDismissalsRepo`'s public contract. Except in the second test,
// whose entire point is the unique index itself, asserted with a raw insert directly
// against the real migration, independent of the repository or service layer.
//
// Implemented: `recordDismissal` and every method here run real logic. No stub throws
// remain in this suite's path.
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

/** The ledger row a dismissal is supposed to stamp. Seeded through the repository's own
 * `upsertSeen` (the exact path the analysis lane uses) because `recordDismissal`'s
 * stamp legitimately matches zero rows when no ledger row exists yet, and a test that
 * skipped this would assert nothing about the stamp at all. */
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
    // Called a second time with the identical payload. An external retry (a Slack
    // webhook redelivery) or a human double-click, not a distinct dismissal.
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

    // A generic stub throw cannot satisfy this. This insert never touches the
    // (not-yet-implemented) repository or service at all. The refusal has to come from
    // real SQL naming the duplicate key. drizzle-orm wraps the driver's error as
    // `.cause`; the outer message is only "Failed query:..", so the constraint
    // name/reason lives on the cause.
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

  // T-DB-19. `recordDismissal` opens one transaction and performs two writes
  // in it: the `dismissals` insert and the ledger's `dismissed_at` stamp. The first
  // test in this suite proves the insert; nothing proved the second write lands with
  // it. If the stamp were dropped, moved outside the transaction, or aimed at the wrong
  // predicate, the dismissal row would still exist and every existing assertion here
  // would stay green, while the ledger's fast path silently never fired.
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

    // Non-vacuity: the ledger row exists and is not dismissed before the call, so the
    // assertion below cannot be satisfied by a pre-existing stamp.
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

    // Write 1, the durable record of the customer's decision.
    const dismissalRow = await repo.findFor("finding-checkout-stamp-0001", "not_useful");
    expect(dismissalRow?.id).toBe(dismissal.id);

    // Write 2, the denormalised fast path, landed with it. Same instant, not merely
    // non-null: both writes descend from the one `now` the transaction opened with, so
    // an equal timestamp is what "same transaction" looks like from the outside.
    const after = await ledger.findBySignature(project.id, signature);
    expect(after?.dismissedAt).not.toBeNull();
    expect(after?.dismissedAt?.getTime()).toBe(dismissal.dismissedAt.getTime());

    const allDismissals = await db
      .select()
      .from(schema.dismissals)
      .where(eq(schema.dismissals.organizationId, org.organizationId));
    expect(allDismissals).toHaveLength(1);
  });

  // T-DB-20. The first test in this suite asserts the dismissal row's instant is stable
  // on replay, but that is `onConflictDoNothing` doing the work, and it would hold even
  // if the ledger stamp were a plain `set({ dismissedAt: now })`. The untested line is
  // `signature-ledger.service.ts`'s `dismissed_at = coalesce(dismissed_at, $now)`: drop
  // the `coalesce` and a webhook redelivery silently moves a permanent suppression's
  // instant forward, which is exactly the clock a future "resurface after N days"
  // policy would key on.
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

    // The two calls must happen at two different instants, or `coalesce` and a bare
    // overwrite are indistinguishable. `recordDismissal` mints its own `now` internally
    // with no injectable clock, so the only lever is real elapsed time, and the
    // assertion below proves the wall clock actually advanced past the first stamp
    // before the replay ran, rather than assuming it.
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

  // T-DB-21 (post-sprint audit Finding 3). The migration declares `dismissed_by_user_id
  // … ON DELETE set null`. A dismissal must outlive its author. Nothing exercised this
  // until now: a future schema edit that flipped `set null` to `cascade` would silently
  // un-suppress every dismissal an ex-employee ever made, with no error, and would ship
  // green without this test.
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

    // Delete the author's user row directly. The exact event `set null` (never
    // `cascade`) is declared against.
    await db.delete(schema.user).where(eq(schema.user.id, org.userId));

    const survivor = await repo.findFor(payload.findingId, payload.action);
    expect(survivor?.id).toBe(dismissal.id);
    // The attribution is lost (`set null`) but the suppression is not. The row and its
    // `dismissedAt` survive the author's deletion.
    expect(survivor?.dismissedByUserId).toBeNull();
    expect(survivor?.dismissedAt.getTime()).toBe(dismissal.dismissedAt.getTime());

    // And the part that actually matters. A surviving row is only bookkeeping; what the
    // customer is owed is that the finding stays suppressed. This asserts the effect,
    // not the artefact. Consulting the same signature after the author's deletion must
    // still decide `suppress` / `dismissed`, never fall back to a delivery. A cascade
    // (or any read path that joined through `user`) would silently re-deliver every
    // finding a departed employee ever dismissed, and every assertion above would still
    // pass.
    const decision = await service.consultSignature(project.id, payload.signature);
    expect(decision).toEqual({ decision: "suppress", reason: "dismissed" });
  });
});
