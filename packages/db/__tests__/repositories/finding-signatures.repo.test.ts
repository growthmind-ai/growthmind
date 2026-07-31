// Wave 0C (RED) — signature-ledger (O-006), ADD §7 "Integration tests —
// packages/db" T-DB-1 and T-DB-2 (D6, D-9), plus the org-scoping companion
// D-10 requires of every new table.
//
// `createFindingSignaturesRepo`'s methods are Wave 0B stubs — every body
// throws "not implemented" unconditionally — so every test below fails
// today for the simplest possible reason: the call itself rejects. They
// stay meaningful once Wave 4 fills the repo in, because each one asserts
// the ATOMIC-UPSERT property D-9 exists specifically to guarantee: the same
// signature recorded twice is ONE row with `times_seen` incremented IN SQL,
// never a check-then-create and never a read-then-write race.
//
// `signatureHex`/`sha256Hex` (`../../src/signatures/hex`) are themselves
// Wave 0B stubs — see `hex.test.ts` for their own contract. This suite is
// about the repository's atomicity and scoping, not the brand's
// validation, so a well-formed hex literal is cast to `SignatureHex`
// directly rather than routed through the (not yet implemented)
// constructor.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
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
});
