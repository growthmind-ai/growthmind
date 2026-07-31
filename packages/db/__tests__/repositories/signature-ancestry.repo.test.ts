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

/** A complete `upsertSeen` input for the carry-forward fixtures below — the
 * ledger half of D-3(a) needs REAL ledger rows on both sides of an ancestry
 * edge, and `upsertSeen` is the only public way to make one. */
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

/** Every ledger row in one org/project, so a carry-forward can be asserted to
 * have produced no EXTRA rows and destroyed no existing one. */
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

  // T-DB-16 — D-3(a)'s carry-forward, asserted through `recordAncestry` (the
  // SHIPPED call site, on `tx`) against a target signature that ALREADY has
  // its own ledger row. That case is the one `CARRY_FORWARD_SET` exists for:
  // with an empty target the upsert is a plain insert and `least` / `+` /
  // `coalesce` never combine anything, so an empty-target-only test proves
  // none of the four columns' semantics. Here both sides are populated and
  // each of the four is pinned in the direction that can actually be wrong:
  //   first_seen_at = least(new 07-10, old 07-01)  -> the OLDER, old's
  //   times_seen    = 2 + 3                        -> the SUM
  //   delivered_at  = coalesce(new 07-12, old …)   -> the EXISTING one
  //   dismissed_at  = coalesce(null, old …)        -> the OLD one, which is
  //                                                   the whole D12 remedy: a
  //                                                   dismissal survives a
  //                                                   re-key.
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

    // OLD identity: seen three times, delivered, then dismissed forever.
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

    // NEW identity: already recorded naturally twice and delivered, never
    // dismissed — the common case (the pipeline saw the re-keyed finding
    // before anything noticed the re-key).
    await ledger.upsertSeen(makeSeen(scope.projectId, newSignature, newFirstSeen));
    await ledger.upsertSeen(makeSeen(scope.projectId, newSignature, newLastSeen));
    await ledger.markDelivered(scope.projectId, newSignature, newDelivered);

    const oldBefore = await ledger.findBySignature(scope.projectId, oldSignature);
    expect(oldBefore?.timesSeen).toBe(3);
    // Stamped as `now` inside `recordDismissal`'s transaction — captured, not
    // asserted against a literal; what matters is that it TRAVELS.
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

    // D-3(a) point 3: the OLD row is LEFT IN PLACE, untouched, as the audit
    // trail — a carry-forward that moved or cleared it would destroy the only
    // record of what the identity used to be.
    const oldAfter = await ledger.findBySignature(scope.projectId, oldSignature);
    expect(oldAfter?.id).toBe(oldBefore!.id);
    expect(oldAfter?.timesSeen).toBe(3);
    expect(oldAfter?.firstSeenAt.getTime()).toBe(oldFirstSeen.getTime());
    expect(oldAfter?.lastSeenAt.getTime()).toBe(oldLastSeen.getTime());
    expect(oldAfter?.deliveredAt?.getTime()).toBe(oldDelivered.getTime());
    expect(oldAfter?.dismissedAt?.getTime()).toBe(oldDismissedAt?.getTime());

    // Exactly two rows — the carry-forward UPSERTS onto the existing new row,
    // it never mints a third identity.
    const rows = await ledgerRowsFor(db, scope);
    expect(rows).toHaveLength(2);
  });

  // T-DB-17 — D-8's atomicity, which `signature-ledger.service.ts:663-669`
  // asserts in a COMMENT ("succeed together or not at all") and nothing
  // executes. A committed edge with no carry-forward is the worst reachable
  // state in this sprint: `resolve` would route every future consult to a new
  // signature whose row does not carry the dismissal, silently un-suppressing
  // a permanent customer decision with no error anywhere.
  //
  // The failure is forced with REAL SQL — a CHECK constraint added to
  // `finding_signatures` for the duration of this test that rejects the new
  // signature's value — not by faking a repository or stubbing the driver.
  // The edge insert runs first and succeeds; the carry-forward insert then
  // violates the constraint, and Postgres' own rollback is what the
  // assertions below inspect.
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

    // The forced failure. Scoped to ONE signature value, so no other row in
    // this shared PGlite instance can violate it, and dropped in `finally` so
    // no later test inherits it.
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

    // The call fails loudly — a caller must never be told an ancestry mapping
    // was recorded when it was not.
    expect(caught).toBeDefined();

    // NEITHER half survived. The edge is gone...
    const repo = createSignatureAncestryRepo(db, scope.ctx);
    expect(await repo.forwardEdge(oldSignature)).toBeNull();
    // ...so a stale pre-re-key signature still resolves to itself, exactly as
    // it did before the failed attempt.
    expect(await repo.resolve(oldSignature)).toEqual({
      resolution: "resolved",
      signature: oldSignature,
      hops: 0,
    });

    // ...and the ledger is untouched: no row was minted for the new
    // signature, and the old row's state is bit-for-bit what it was.
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
