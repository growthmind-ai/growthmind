import { afterAll, beforeAll, describe, expect, it } from "bun:test";

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

import { and, eq } from "drizzle-orm";

import { createFindingSignaturesRepo } from "../../src/repositories/finding-signatures.repo";
import * as schema from "../../src/schema";
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

import { setLogSink, type LogRecord } from "@growthmind/shared";
const NAMES = laneNames("sl");

const FIXTURE_NOW = new Date("2026-06-01T12:00:00.000Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function windowEndingAt(now: Date): AnalysisWindow {
  return { start: new Date(now.getTime() - SEVEN_DAYS_MS), end: now };
}

function fixtureCount(now: Date) {
  return measuredCount({
    numerator: 12,
    denominator: 28,
    unit: "sessions",
    timeframe: windowEndingAt(now),
    basis: { totalInWindow: 28, kept: 28, setAside: [] },
  });
}

function buildCandidate(now: Date, overrides: Record<string, unknown> = {}): CandidateFinding {
  return candidateFindingSchema.parse({
    detector: "funnel_dropoff",

    claimSubject: "surface",
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

const GOLDEN_EVIDENCE_SHAPE =
  '{"detector":"funnel_dropoff","signalKinds":["failure_uncorrelated","struggle"],' +
  '"surface":"/checkout","surfaceNormalisationVersion":2,"symptomClass":"broken","v":1}';

describe("computeFindingSignature — the one real digest (ADD, T-DB-6)", () => {
  it("reproduces a committed golden hex digest for the W0-5 fixture input", () => {
    const input: ComputeFindingSignatureInput = {
      projectId: "00000000-0000-4000-8000-000000000001",
      surface: "/checkout",
      symptomClass: "broken",
      evidenceShape: GOLDEN_EVIDENCE_SHAPE,
    };

    const GOLDEN_SIGNATURE_HEX = "c3a43b5e321594016abb50d0f33a8d37013b5101dca1f6c39bddbe5daa672297";

    expect(computeFindingSignature(input) as string).toBe(GOLDEN_SIGNATURE_HEX);
  });
});

describe("computeFindingSignature — surface normalisation refusal (post-sprint audit Finding 4)", () => {
  it("refuses a surface that is not a normaliseUrlPath fixed point", () => {
    expect(() =>
      computeFindingSignature({
        projectId: "00000000-0000-4000-8000-000000000001",

        surface: "/reset-password?token=abc123",
        symptomClass: "broken",
        evidenceShape: GOLDEN_EVIDENCE_SHAPE,
      }),
    ).toThrow(/normaliseUrlPath fixed point/);
  });

  it("accepts a surface that is already a normaliseUrlPath fixed point", () => {
    expect(() =>
      computeFindingSignature({
        projectId: "00000000-0000-4000-8000-000000000001",
        surface: "/checkout",
        symptomClass: "broken",
        evidenceShape: GOLDEN_EVIDENCE_SHAPE,
      }),
    ).not.toThrow();
  });

  it("never echoes the offending surface value in its refusal message", () => {
    const secretSurface = "/reset-password?token=should-never-reach-a-log-line";

    let caught: unknown;
    try {
      computeFindingSignature({
        projectId: "00000000-0000-4000-8000-000000000001",
        surface: secretSurface,
        symptomClass: "broken",
        evidenceShape: GOLDEN_EVIDENCE_SHAPE,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).not.toContain(secretSurface);
    expect(message).not.toContain("token=");
    expect(message).not.toContain("should-never-reach-a-log-line");
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

    const first = await ownerService.recordSignature(project.id, candidate);
    expect(first.record.timesSeen).toBe(1);

    const beforeDelivery = await ownerService.consultSignature(project.id, candidate);
    expect(beforeDelivery).toEqual({ decision: "deliver", reason: "seen_not_delivered" });

    const delivered = await ownerService.markSignatureDelivered(project.id, first.signature);
    expect(delivered).not.toBeNull();
    expect(delivered?.deliveredAt).not.toBeNull();

    const second = await ownerService.recordSignature(project.id, candidate);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.timesSeen).toBe(2);
    expect(second.record.deliveredAt).toEqual(delivered?.deliveredAt ?? null);

    const afterRedelivery = await ownerService.consultSignature(project.id, candidate);
    expect(afterRedelivery).toEqual({ decision: "suppress", reason: "already_delivered" });

    const dismissal = await ownerService.recordDismissal({
      projectId: project.id,
      findingId: "finding-e2e-checkout-001",
      signature: first.signature,
      action: "not_useful",
      dismissedByUserId: org.userId,
    });
    const afterDismissal = await ownerService.consultSignature(project.id, candidate);
    expect(afterDismissal).toEqual({ decision: "suppress", reason: "dismissed" });

    const teammateConsult = await teammateService.consultSignature(project.id, candidate);
    expect(teammateConsult).toEqual({ decision: "suppress", reason: "dismissed" });

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

    const decision = await service.consultSignature(project.id, newCandidate);
    expect(decision).toEqual({ decision: "suppress", reason: "dismissed" });
  });

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

    const unregisteredVersion = Math.max(...EVIDENCE_SHAPE_SERIALISERS.keys()) + 1;

    const secretSurface = "/reset-password?token=should-never-reach-a-log-line";

    const candidate = buildCandidate(FIXTURE_NOW, {
      surface: secretSurface,
      evidenceShapeVersion: unregisteredVersion,
    });

    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });

    try {
      const decision = await service.consultSignature(project.id, candidate);

      expect(decision).toEqual({ decision: "suppress", reason: "unknown_shape_version" });

      for (const record of logged) {
        expect(record.message).not.toContain(secretSurface);
        expect(JSON.stringify(record.fields)).not.toContain(secretSurface);
      }
    } finally {
      restore();
    }
  });

  describe("a foreign projectId is rejected by every write entry point", () => {
    it("rejects and writes no row for recordSignature, markSignatureDelivered, recordDismissal, and recordAncestry", async () => {
      const orgA = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName("m2-a"),
        userName: NAMES.userName("m2-a-owner"),
        email: NAMES.email("m2-a-owner"),
      });
      const orgB = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName("m2-b"),
        userName: NAMES.userName("m2-b-owner"),
        email: NAMES.email("m2-b-owner"),
      });

      const foreignProject = await seedProject(db, {
        organizationId: orgB.organizationId,
        name: NAMES.projectName("m2-b"),
      });

      const ownProject = await seedProject(db, {
        organizationId: orgA.organizationId,
        name: NAMES.projectName("m2-a"),
      });

      const serviceA = createSignatureLedgerService(db, orgA.ctx);
      const candidate = buildCandidate(FIXTURE_NOW);
      const own = await serviceA.recordSignature(ownProject.id, candidate);

      const rowsFor = async (projectId: string) => ({
        ledger: (
          await db
            .select()
            .from(schema.findingSignatures)
            .where(eq(schema.findingSignatures.projectId, projectId))
        ).length,
        dismissals: (
          await db
            .select()
            .from(schema.dismissals)
            .where(eq(schema.dismissals.projectId, projectId))
        ).length,
        ancestry: (
          await db
            .select()
            .from(schema.signatureAncestry)
            .where(eq(schema.signatureAncestry.projectId, projectId))
        ).length,
      });

      expect(await rowsFor(foreignProject.id)).toEqual({
        ledger: 0,
        dismissals: 0,
        ancestry: 0,
      });

      await expect(serviceA.recordSignature(foreignProject.id, candidate)).rejects.toThrow(
        /does not belong to the caller's organization/,
      );
      await expect(
        serviceA.markSignatureDelivered(foreignProject.id, own.signature),
      ).rejects.toThrow(/does not belong to the caller's organization/);
      await expect(
        serviceA.recordDismissal({
          projectId: foreignProject.id,
          findingId: "finding-m2-foreign-001",
          signature: own.signature,
          action: "not_useful",
          dismissedByUserId: orgA.userId,
        }),
      ).rejects.toThrow(/does not belong to the caller's organization/);
      await expect(
        serviceA.recordAncestry({
          projectId: foreignProject.id,
          oldSignature: own.signature,
          newSignature: computeFindingSignature({
            projectId: foreignProject.id,
            surface: "/pay",
            symptomClass: "broken",
            evidenceShape: GOLDEN_EVIDENCE_SHAPE,
          }),
          reason: "surface_rename",
        }),
      ).rejects.toThrow(/does not belong to the caller's organization/);

      expect(await rowsFor(foreignProject.id)).toEqual({
        ledger: 0,
        dismissals: 0,
        ancestry: 0,
      });

      const ownRows = await rowsFor(ownProject.id);
      expect(ownRows.ledger).toBe(1);
      expect(ownRows.dismissals).toBe(0);
      expect(ownRows.ancestry).toBe(0);
    });

    it("rejects a projectId that exists in no organization at all", async () => {
      const org = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName("m2-unknown"),
        userName: NAMES.userName("m2-unknown-owner"),
        email: NAMES.email("m2-unknown-owner"),
      });
      const service = createSignatureLedgerService(db, org.ctx);

      await expect(
        service.recordSignature(
          "00000000-0000-4000-8000-0000000000ff",
          buildCandidate(FIXTURE_NOW),
        ),
      ).rejects.toThrow(/does not belong to the caller's organization/);
    });
  });

  describe("dismissedByUserId must be a member of the caller's organization", () => {
    it("rejects a non-member author and lands no dismissal with forged attribution", async () => {
      const orgA = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName("m1-a"),
        userName: NAMES.userName("m1-a-owner"),
        email: NAMES.email("m1-a-owner"),
      });
      const orgB = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName("m1-b"),
        userName: NAMES.userName("m1-b-owner"),
        email: NAMES.email("m1-b-owner"),
      });

      const orphan = await seedUser(db, {
        name: NAMES.userName("m1-orphan"),
        email: NAMES.email("m1-orphan"),
      });

      const project = await seedProject(db, {
        organizationId: orgA.organizationId,
        name: NAMES.projectName("m1-a"),
      });
      const service = createSignatureLedgerService(db, orgA.ctx);
      const recorded = await service.recordSignature(project.id, buildCandidate(FIXTURE_NOW));

      for (const [findingId, forgedAuthor] of [
        ["finding-m1-cross-org-001", orgB.userId],
        ["finding-m1-orphan-001", orphan.id],
      ] as const) {
        await expect(
          service.recordDismissal({
            projectId: project.id,
            findingId,
            signature: recorded.signature,
            action: "not_useful",
            dismissedByUserId: forgedAuthor,
          }),
        ).rejects.toThrow(/not a member of the caller's organization/);

        const landed = await db
          .select()
          .from(schema.dismissals)
          .where(
            and(
              eq(schema.dismissals.organizationId, orgA.organizationId),
              eq(schema.dismissals.findingId, findingId),
            ),
          );
        expect(landed).toEqual([]);
      }

      const [ledgerRow] = await db
        .select()
        .from(schema.findingSignatures)
        .where(
          and(
            eq(schema.findingSignatures.organizationId, orgA.organizationId),
            eq(schema.findingSignatures.signature, recorded.signature),
          ),
        );
      expect(ledgerRow?.dismissedAt ?? null).toBeNull();
    });

    it("accepts an explicit null author — the documented system/backfill path", async () => {
      const org = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName("m1-null"),
        userName: NAMES.userName("m1-null-owner"),
        email: NAMES.email("m1-null-owner"),
      });
      const project = await seedProject(db, {
        organizationId: org.organizationId,
        name: NAMES.projectName("m1-null"),
      });
      const service = createSignatureLedgerService(db, org.ctx);
      const recorded = await service.recordSignature(project.id, buildCandidate(FIXTURE_NOW));

      const dismissal = await service.recordDismissal({
        projectId: project.id,
        findingId: "finding-m1-null-001",
        signature: recorded.signature,
        action: "not_useful",
        dismissedByUserId: null,
      });
      expect(dismissal.dismissedByUserId).toBeNull();
    });

    it("accepts a non-owner teammate as the author ( — dismissal is org-wide, not owner-only)", async () => {
      const org = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName("m1-mate"),
        userName: NAMES.userName("m1-mate-owner"),
        email: NAMES.email("m1-mate-owner"),
      });
      const teammate = await seedUser(db, {
        name: NAMES.userName("m1-mate-teammate"),
        email: NAMES.email("m1-mate-teammate"),
      });
      await seedMember(db, {
        organizationId: org.organizationId,
        userId: teammate.id,
        role: "member",
      });

      const project = await seedProject(db, {
        organizationId: org.organizationId,
        name: NAMES.projectName("m1-mate"),
      });
      const service = createSignatureLedgerService(db, org.ctx);
      const recorded = await service.recordSignature(project.id, buildCandidate(FIXTURE_NOW));

      const dismissal = await service.recordDismissal({
        projectId: project.id,
        findingId: "finding-m1-mate-001",
        signature: recorded.signature,
        action: "not_useful",
        dismissedByUserId: teammate.id,
      });
      expect(dismissal.dismissedByUserId).toBe(teammate.id);
    });
  });

  describe("dismissal arriving before the ledger row ( multiplicity / ordering)", () => {
    async function seedDismissableProject(lane: string) {
      const org = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName(lane),
        userName: NAMES.userName(`${lane}-owner`),
        email: NAMES.email(`${lane}-owner`),
      });
      const project = await seedProject(db, {
        organizationId: org.organizationId,
        name: NAMES.projectName(lane),
      });
      const candidate = buildCandidate(FIXTURE_NOW);

      const signature = computeFindingSignature({
        projectId: project.id,
        surface: candidate.surface,
        symptomClass: candidate.finalClass,
        evidenceShape: candidate.evidenceShape,
      });

      return {
        org,
        project,
        candidate,
        signature,
        service: createSignatureLedgerService(db, org.ctx),
      };
    }

    it("stays suppressed when the signature is recorded AFTER the dismissal", async () => {
      const fx = await seedDismissableProject("order-after");

      await fx.service.recordDismissal({
        projectId: fx.project.id,
        findingId: "finding-order-after-001",
        signature: fx.signature,
        action: "not_useful",
        dismissedByUserId: fx.org.userId,
      });

      const recorded = await fx.service.recordSignature(fx.project.id, fx.candidate);
      expect(recorded.signature).toBe(fx.signature);
      expect(recorded.record.dismissedAt).toBeNull();

      expect(await fx.service.consultSignature(fx.project.id, fx.candidate)).toEqual({
        decision: "suppress",
        reason: "dismissed",
      });

      expect(await fx.service.consultSignature(fx.project.id, fx.signature)).toEqual({
        decision: "suppress",
        reason: "dismissed",
      });
    });

    it("suppresses when a dismissal exists and no ledger row was ever recorded", async () => {
      const fx = await seedDismissableProject("order-never");

      await fx.service.recordDismissal({
        projectId: fx.project.id,
        findingId: "finding-order-never-001",
        signature: fx.signature,
        action: "not_useful",
        dismissedByUserId: fx.org.userId,
      });

      const ledgerRow = await createFindingSignaturesRepo(db, fx.org.ctx).findBySignature(
        fx.project.id,
        fx.signature,
      );
      expect(ledgerRow).toBeNull();

      expect(await fx.service.consultSignature(fx.project.id, fx.candidate)).toEqual({
        decision: "suppress",
        reason: "dismissed",
      });
    });
  });

  describe("recordAncestry — carry-forward's degenerate case, and idempotence on retry", () => {
    it("records the ancestry edge and touches no ledger row when the old signature was never recorded", async () => {
      const org = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName("ancestry-never-seen"),
        userName: NAMES.userName("ancestry-never-seen-owner"),
        email: NAMES.email("ancestry-never-seen-owner"),
      });
      const project = await seedProject(db, {
        organizationId: org.organizationId,
        name: NAMES.projectName("ancestry-never-seen"),
      });
      const service = createSignatureLedgerService(db, org.ctx);
      const ledgerRepo = createFindingSignaturesRepo(db, org.ctx);

      const oldCandidate = buildCandidate(FIXTURE_NOW, { surface: "/never-seen-old" });
      const newCandidate = buildCandidate(FIXTURE_NOW, { surface: "/never-seen-new" });
      const oldSignature = computeFindingSignature({
        projectId: project.id,
        surface: oldCandidate.surface,
        symptomClass: oldCandidate.finalClass,
        evidenceShape: oldCandidate.evidenceShape,
      });
      const newSignature = computeFindingSignature({
        projectId: project.id,
        surface: newCandidate.surface,
        symptomClass: newCandidate.finalClass,
        evidenceShape: newCandidate.evidenceShape,
      });

      const edge = await service.recordAncestry({
        projectId: project.id,
        oldSignature,
        newSignature,
        reason: "surface_rename",
      });

      expect(edge.oldSignature).toBe(oldSignature);
      expect(edge.newSignature).toBe(newSignature);

      expect(await ledgerRepo.findBySignature(project.id, oldSignature)).toBeNull();
      expect(await ledgerRepo.findBySignature(project.id, newSignature)).toBeNull();
    });

    it("is idempotent on retry — the same edge recorded twice does not throw and does not double-carry times_seen", async () => {
      const org = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName("ancestry-retry"),
        userName: NAMES.userName("ancestry-retry-owner"),
        email: NAMES.email("ancestry-retry-owner"),
      });
      const project = await seedProject(db, {
        organizationId: org.organizationId,
        name: NAMES.projectName("ancestry-retry"),
      });
      const service = createSignatureLedgerService(db, org.ctx);
      const ledgerRepo = createFindingSignaturesRepo(db, org.ctx);

      const oldCandidate = buildCandidate(FIXTURE_NOW, { surface: "/retry-old" });
      const newCandidate = buildCandidate(FIXTURE_NOW, { surface: "/retry-new" });

      const oldRecorded = await service.recordSignature(project.id, oldCandidate);
      const newRecorded = await service.recordSignature(project.id, newCandidate);
      expect(oldRecorded.record.timesSeen).toBe(1);
      expect(newRecorded.record.timesSeen).toBe(1);

      const ancestryInput = {
        projectId: project.id,
        oldSignature: oldRecorded.signature,
        newSignature: newRecorded.signature,
        reason: "surface_rename" as const,
      };

      const firstEdge = await service.recordAncestry(ancestryInput);
      const afterFirst = await ledgerRepo.findBySignature(project.id, newRecorded.signature);

      expect(afterFirst?.timesSeen).toBe(2);

      const secondEdge = await service.recordAncestry(ancestryInput);
      expect(secondEdge.id).toBe(firstEdge.id);
      expect(secondEdge.newSignature).toBe(firstEdge.newSignature);

      const afterSecond = await ledgerRepo.findBySignature(project.id, newRecorded.signature);

      expect(afterSecond?.timesSeen).toBe(2);
    });
  });
});
