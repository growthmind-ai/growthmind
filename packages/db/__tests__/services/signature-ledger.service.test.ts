// Wave 0C (RED) — O-006 signature-ledger, T3's TDD-contract task.
// ADD tasks/signature-ledger/add.md §7 — T-DB-6, T-DB-7, T-DB-22, T-DB-23, and
// "The end-to-end persistence wire" (T-E2E-1, MANDATORY, NEVER CUT).
//
// `createSignatureLedgerService` and every method it returns are typed-stub
// throws today (`packages/db/src/services/signature-ledger.service.ts`):
// `computeFindingSignature` dispatches for real but calls `signatureTuple`
// (`@growthmind/core`) and `sha256Hex` (`../../src/signatures/hex`), both of
// which throw "not implemented" — so every test below fails RED on that
// throw, not on a missing import. That is the point: these are the failing
// tests a later wave implements against.
//
// THE MANDATORY WIRE TEST (T-E2E-1) drives the REAL repository/service entry
// points against a real PGlite instance (`createTestDb()`, every migration
// replayed) — no fake repository anywhere in it. A producer test plus a
// consumer test does not prove the wire between them; this sprint has no
// production caller yet (O-007 is concurrent/unbuilt), so this test IS the
// wire. It proves the LEDGER decides suppress end to end — it does NOT prove
// "no second delivery was sent", which needs O-007's scheduler and is out of
// scope here (ADD §8 trade-off 9).
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";

import {
  candidateFindingSchema,
  EVIDENCE_SHAPE_SERIALISERS,
  EVIDENCE_SHAPE_VERSION,
  measuredCount,
  PROOF_PREDICATE_VERSION,
  THRESHOLD_RULE_SET_VERSION,
  traceEntry,
  type AnalysisWindow,
  type CandidateFinding,
} from "@growthmind/core";

import {
  computeFindingSignature,
  createSignatureLedgerService,
  type ComputeFindingSignatureInput,
} from "../../src/services/signature-ledger.service";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import {
  makeTenantContext,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUser,
} from "../helpers/fixtures";

const NAMES = laneNames("sl");

/** The suite's only instant — no clock, no randomness (test-requirements.md). */
const FIXTURE_NOW = new Date("2026-06-01T12:00:00.000Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function windowEndingAt(now: Date): AnalysisWindow {
  return { start: new Date(now.getTime() - SEVEN_DAYS_MS), end: now };
}

/** A real, branded count — 12 of 28 kept sessions, nothing set aside. Built
 * through `measuredCount()` (the only constructor) because a structurally
 * identical literal is not a `MeasuredCount` (FR-10). */
function fixtureCount(now: Date) {
  return measuredCount({
    numerator: 12,
    denominator: 28,
    unit: "sessions",
    timeframe: windowEndingAt(now),
    basis: { totalInWindow: 28, kept: 28, setAside: [] },
  });
}

/**
 * A representative, valid `CandidateFinding` — a clean `broken` claim that
 * passed at its first rung (no downgrade), so `claimedClass === finalClass`
 * and `isReachableClass` never has to be argued with. Built from
 * `@growthmind/core`'s own PUBLIC exports only (never its `src/` internals —
 * `packages/db` consumes core the same way any other package would), so a
 * failure here is attributable to the signature-ledger service, not to a
 * borrowed test-only builder.
 */
function buildCandidate(now: Date, overrides: Record<string, unknown> = {}): CandidateFinding {
  return candidateFindingSchema.parse({
    detector: "funnel_dropoff",
    claimedClass: "broken",
    finalClass: "broken",
    trace: [
      traceEntry({
        class: "broken",
        predicate: "broken_failure_correlated",
        predicateVersion: PROOF_PREDICATE_VERSION,
        satisfied: true,
      }),
    ],
    counts: [fixtureCount(now)],
    timeframe: windowEndingAt(now),
    surface: "/checkout",
    surfaceNormalisationVersion: 2,
    evidenceShape: GOLDEN_EVIDENCE_SHAPE,
    evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
    thresholdRuleSetVersion: THRESHOLD_RULE_SET_VERSION,
    ranking: { sampleSize: fixtureCount(now), confidenceBasis: "threshold_met" },
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
    ...overrides,
  });
}

// ── The W0-5 golden fixture (tasks/signature-ledger/probes.md) ──────────────
//
// The EXACT 163-byte literal `evidenceShape()` produced for the pinned probe
// input (detector "funnel_dropoff", surface "/checkout",
// surfaceNormalisationVersion 2, signals [struggle, failure_uncorrelated,
// struggle] de-duplicated and sorted, symptomClass "broken", v1). Hardcoded
// here rather than computed by calling `evidenceShape()` again: O-005 owns
// that module, and this file must not take on a live dependency on its
// current behaviour to reproduce a value the probe already committed.
const GOLDEN_EVIDENCE_SHAPE =
  '{"detector":"funnel_dropoff","signalKinds":["failure_uncorrelated","struggle"],' +
  '"surface":"/checkout","surfaceNormalisationVersion":2,"symptomClass":"broken","v":1}';

describe("computeFindingSignature — the one real digest (ADD D-1, T-DB-6)", () => {
  // T-DB-6.
  it("reproduces a committed golden hex digest for the W0-5 fixture input", () => {
    const input: ComputeFindingSignatureInput = {
      projectId: "00000000-0000-4000-8000-000000000001",
      surface: "/checkout",
      symptomClass: "broken",
      evidenceShape: GOLDEN_EVIDENCE_SHAPE,
    };

    // Pinned in the implementation wave by actually running
    // `computeFindingSignature(input)` once `signatureTuple` and `sha256Hex`
    // were implemented, and capturing the exact 64-char lowercase hex digest
    // it printed (`bun test packages/db/__tests__/services/signature-ledger.service.test.ts
    // -t "reproduces a committed golden hex digest"`) — never guessed. This is
    // the one and only place in the codebase that pins a real sha256 digest
    // end to end (tuple string from `@growthmind/core` + hash from
    // `packages/db`).
    const GOLDEN_SIGNATURE_HEX = "c3a43b5e321594016abb50d0f33a8d37013b5101dca1f6c39bddbe5daa672297";

    // `computeFindingSignature` returns a branded `SignatureHex`; widening to
    // `string` here is a safe upcast (every `SignatureHex` IS a `string`) and
    // avoids fabricating a brand no constructor outside `hex.ts` may produce.
    expect(computeFindingSignature(input) as string).toBe(GOLDEN_SIGNATURE_HEX);
  });
});

describe("signature ledger service — real persistence (ADD §7, §8)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // ── T-E2E-1 — MANDATORY, NEVER CUT ─────────────────────────────────────
  it("records, delivers, suppresses, dismisses, and stays suppressed for a teammate through the real repository entry points", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("e2e"),
      userName: NAMES.userName("e2e-owner"),
      email: NAMES.email("e2e-owner"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("e2e"),
    });

    // (e) the teammate — composed by hand, no one-call teammate helper
    // exists (W0-6): `seedUser` + `seedMember` + `makeTenantContext`.
    const teammate = await seedUser(db, {
      name: NAMES.userName("e2e-teammate"),
      email: NAMES.email("e2e-teammate"),
    });
    await seedMember(db, {
      organizationId: org.organizationId,
      userId: teammate.id,
      role: "member",
    });
    const teammateCtx = makeTenantContext({
      userId: teammate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    });

    const ownerService = createSignatureLedgerService(db, org.ctx);
    const teammateService = createSignatureLedgerService(db, teammateCtx);

    const candidate = buildCandidate(FIXTURE_NOW);

    // (b) step 1 — recordSignature: a ledger row exists with times_seen = 1.
    const first = await ownerService.recordSignature(project.id, candidate);
    expect(first.record.timesSeen).toBe(1);

    // step 2 — consultSignature: deliver / seen_not_delivered.
    const beforeDelivery = await ownerService.consultSignature(project.id, candidate);
    expect(beforeDelivery).toEqual({ decision: "deliver", reason: "seen_not_delivered" });

    // step 3 — markSignatureDelivered: delivered_at set.
    const delivered = await ownerService.markSignatureDelivered(project.id, first.signature);
    expect(delivered).not.toBeNull();
    expect(delivered?.deliveredAt).not.toBeNull();

    // (c) step 4 — recordSignature for the SAME candidate again: one row,
    // times_seen = 2, delivered_at unchanged (D-9's most dangerous line).
    const second = await ownerService.recordSignature(project.id, candidate);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.timesSeen).toBe(2);
    expect(second.record.deliveredAt).toEqual(delivered?.deliveredAt ?? null);

    // step 5 — consultSignature: suppress / already_delivered (FR-16 c).
    const afterRedelivery = await ownerService.consultSignature(project.id, candidate);
    expect(afterRedelivery).toEqual({ decision: "suppress", reason: "already_delivered" });

    // (d) step 6 — recordDismissal, then consult: suppress / dismissed
    // (FR-16 d).
    const dismissal = await ownerService.recordDismissal({
      projectId: project.id,
      findingId: "finding-e2e-checkout-001",
      signature: first.signature,
      action: "not_useful",
      dismissedByUserId: org.userId,
    });
    const afterDismissal = await ownerService.consultSignature(project.id, candidate);
    expect(afterDismissal).toEqual({ decision: "suppress", reason: "dismissed" });

    // (e) step 7 — the TEAMMATE's context consults: suppress / dismissed
    // (FR-16 e / D1). A dismissal is org-wide, not owner-only.
    const teammateConsult = await teammateService.consultSignature(project.id, candidate);
    expect(teammateConsult).toEqual({ decision: "suppress", reason: "dismissed" });

    // (f) step 8 — recordDismissal called a SECOND time with the same
    // payload: one row, same result (FR-16 f).
    const dismissalAgain = await ownerService.recordDismissal({
      projectId: project.id,
      findingId: "finding-e2e-checkout-001",
      signature: first.signature,
      action: "not_useful",
      dismissedByUserId: org.userId,
    });
    expect(dismissalAgain.id).toBe(dismissal.id);
    expect(dismissalAgain.dismissedAt).toEqual(dismissal.dismissedAt);
  });

  // T-DB-7.
  it("should suppress the new signature when the dismissal was recorded against the old one", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("rename"),
      userName: NAMES.userName("rename-owner"),
      email: NAMES.email("rename-owner"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("rename"),
    });
    const service = createSignatureLedgerService(db, org.ctx);

    // The identity churn this test is about: a surface rename from
    // "/checkout" to "/pay" (ADD §7's own naming for this exact case).
    const oldCandidate = buildCandidate(FIXTURE_NOW, { surface: "/checkout" });
    const newCandidate = buildCandidate(FIXTURE_NOW, { surface: "/pay" });

    const oldRecorded = await service.recordSignature(project.id, oldCandidate);
    await service.recordDismissal({
      projectId: project.id,
      findingId: "finding-rename-001",
      signature: oldRecorded.signature,
      action: "not_useful",
      dismissedByUserId: org.userId,
    });

    const newRecorded = await service.recordSignature(project.id, newCandidate);
    await service.recordAncestry({
      projectId: project.id,
      oldSignature: oldRecorded.signature,
      newSignature: newRecorded.signature,
      reason: "surface_rename",
    });

    // The dismissal was recorded against the OLD signature; carry-forward
    // (ADD D-3a) must make the NEW signature suppress too, because the
    // ledger row carried the dismissal forward, not because a read path
    // searched backwards for it.
    const decision = await service.consultSignature(project.id, newCandidate);
    expect(decision).toEqual({ decision: "suppress", reason: "dismissed" });
  });

  // T-DB-23.
  it("should resolve a stale pre-re-key signature forward before stamping a dismissal", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("stale"),
      userName: NAMES.userName("stale-owner"),
      email: NAMES.email("stale-owner"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("stale"),
    });
    const service = createSignatureLedgerService(db, org.ctx);

    const oldCandidate = buildCandidate(FIXTURE_NOW, { surface: "/checkout" });
    const newCandidate = buildCandidate(FIXTURE_NOW, { surface: "/pay" });

    const oldRecorded = await service.recordSignature(project.id, oldCandidate);
    const newRecorded = await service.recordSignature(project.id, newCandidate);
    await service.recordAncestry({
      projectId: project.id,
      oldSignature: oldRecorded.signature,
      newSignature: newRecorded.signature,
      reason: "surface_rename",
    });

    // A caller holding the STALE pre-re-key signature — e.g. a Slack
    // interaction payload minted before the churn (ADD D-3(b), D-4
    // late/duplicate delivery) — dismisses by signature. The write path must
    // resolve it FORWARD onto the live row before stamping, never silently
    // stamp a signature nothing consults anymore.
    const dismissal = await service.recordDismissal({
      projectId: project.id,
      findingId: "finding-stale-001",
      signature: oldRecorded.signature,
      action: "not_useful",
      dismissedByUserId: org.userId,
    });
    expect(dismissal.signature).toBe(newRecorded.signature);

    const decision = await service.consultSignature(project.id, newCandidate);
    expect(decision).toEqual({ decision: "suppress", reason: "dismissed" });
  });

  // T-DB-22.
  it("should surface an unknown evidence_shape version as suppress with reason unknown_shape_version rather than throwing to the caller", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("unknown-version"),
      userName: NAMES.userName("unknown-version-owner"),
      email: NAMES.email("unknown-version-owner"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("unknown-version"),
    });
    const service = createSignatureLedgerService(db, org.ctx);

    // No serialiser is registered for this version — computed rather than
    // hardcoded so a future version bump can't accidentally make this a
    // registered (and therefore non-doubt) version.
    const unregisteredVersion = Math.max(...EVIDENCE_SHAPE_SERIALISERS.keys()) + 1;

    // A surface that LOOKS like it carries a live token — the leak this
    // assertion exists to catch is exactly this kind of value reaching a log
    // line (evidence-shape.ts's own redaction rule, restated for this
    // service's one catch boundary).
    const secretSurface = "/reset-password?token=should-never-reach-a-log-line";

    const candidate = buildCandidate(FIXTURE_NOW, {
      surface: secretSurface,
      evidenceShapeVersion: unregisteredVersion,
    });

    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const decision = await service.consultSignature(project.id, candidate);

      // The doubt path — suppress, never a thrown error reaching the caller
      // (D5/D8, D10's fail-toward-suppress inversion).
      expect(decision).toEqual({ decision: "suppress", reason: "unknown_shape_version" });

      // Whatever WAS logged (if anything) must never contain the raw
      // surface value — only the version number may be logged (the service's
      // own header comment: "logged with the version only, never the
      // surface value").
      for (const call of errorSpy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(secretSurface);
        }
      }
    } finally {
      errorSpy.mockRestore();
    }
  });
});
