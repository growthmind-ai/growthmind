// Wave 0C (RED) — signature-ledger (O-006), ADD §7 T-DB-18 (D4 idempotence,
// FR-C f), plus the schema-level companion proving the unique index — not a
// convention — is what enforces it.
//
// The WRITE lives in the SERVICE, not this repository (D-8: `recordDismissal`
// performs the dismissal insert and the ledger's `dismissed_at` stamp in one
// transaction on a `tx` handle, because `ScopedDb`'s union has no
// `.transaction`-callback overload that narrows to a repository factory —
// see `dismissals.repo.ts`'s own header). This suite drives the write
// through `createSignatureLedgerService`'s `recordDismissal` and reads back
// through `createDismissalsRepo`'s public contract — except in the second
// test, whose ENTIRE POINT is the unique index itself, which the
// schema/migration already applies for real; see that test's own note on
// why it still runs RED today.
//
// `recordDismissal`'s body is a Wave 0B stub that throws "not implemented"
// unconditionally, so the first test fails on that alone today.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createDismissalsRepo } from "../../src/repositories/dismissals.repo";
import * as schema from "../../src/schema";
import { createSignatureLedgerService } from "../../src/services/signature-ledger.service";
import type { SignatureHex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner, seedProject } from "../helpers/fixtures";

function testSignature(hex: string): SignatureHex {
  return hex as unknown as SignatureHex;
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
    // Called a SECOND time with the IDENTICAL payload — an external retry
    // (a Slack webhook redelivery) or a human double-click, not a distinct
    // dismissal.
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

    // A generic stub throw cannot satisfy this — this insert never touches
    // the (not-yet-implemented) repository or service at all. The refusal
    // has to come from real SQL naming the duplicate key. drizzle-orm wraps
    // the driver's error as `.cause`; the outer message is only "Failed
    // query: ...", so the constraint name/reason lives on the cause.
    expect(caught).toBeDefined();
    const causeMessage =
      caught instanceof Error && caught.cause instanceof Error
        ? caught.cause.message
        : String(caught);
    expect(causeMessage).toMatch(
      /dismissals_org_finding_action_key|duplicate key|unique constraint/i,
    );

    // The repository read-back is what makes this test RED today: `findFor`
    // is itself a Wave 0B stub, so this call throws "not implemented" even
    // though the constraint check above already ran against real SQL.
    const repo = createDismissalsRepo(db, org.ctx);
    const survivor = await repo.findFor(findingId, action);
    expect(survivor?.id).toBe(firstRow.id);
  });
});
