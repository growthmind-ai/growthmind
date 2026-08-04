import {
  URL_PATH_NORMALISATION_VERSION,
  summarySourceSchema,
  type TenantContext,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { createDismissalsRepo } from "../../src/repositories/dismissals.repo";
import { createFindingPayloadsRepo } from "../../src/repositories/finding-payloads.repo";
import { createFindingsRepo, type MeasuredCountRow } from "../../src/repositories/findings.repo";
import { createGrowthContextRepo } from "../../src/repositories/growth-context.repo";
import type { ScopedDb } from "../../src/repositories/types";
import { createFixesService } from "../../src/services/fixes.service";
import { createGrowthContextService } from "../../src/services/growth-context.service";
import { sha256Hex, type SignatureHex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import {
  laneNames,
  seedAnalysisRun,
  seedOrgWithOwner,
  seedProject,
  type SeededOrgWithOwner,
} from "../../src/testing";
import { fixSpecPayload, findingCountRow } from "../helpers/fix-spec-payload";

const NAMES = laneNames("growth-context-service");

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const CONFIRMED = new Date("2026-08-01T10:00:00.000Z");

const OFFENDER = "jane.doe@acme.example";

const FIXTURES_OWNER = "ADD Wave 1.4 (packages/db/src/testing/fixtures.ts, seedUnscannedFinding)";

type SeedUnscannedFinding = (
  db: ScopedDb,
  params: {
    readonly ctx: TenantContext;
    readonly projectId: string;
    readonly runId: string;
    readonly headline: string;
    readonly context: readonly string[];
    readonly signature?: string;
    readonly surface?: string;
    readonly counts?: readonly MeasuredCountRow[];
    readonly createdAt?: Date;
  },
) => Promise<{ readonly id: string }>;

const loadSeedUnscannedFinding = (): Promise<SeedUnscannedFinding> =>
  loadUnderConstruction<SeedUnscannedFinding>({
    modulePath: underConstructionSpecifier("packages/db/src/testing/fixtures"),
    exportName: "seedUnscannedFinding",
    ownedBy: FIXTURES_OWNER,
  });

interface Seeded {
  readonly org: SeededOrgWithOwner;
  readonly projectId: string;
}

async function seedProjectFor(db: TestDb, label: string): Promise<Seeded> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });

  return { org, projectId: project.id };
}

async function seedFinding(
  db: TestDb,
  seeded: Seeded,
  input: { label: string; surface: string; headline: string; affected?: number },
): Promise<{ findingId: string; signature: SignatureHex }> {
  const run = await seedAnalysisRun(db, { ctx: seeded.org.ctx, projectId: seeded.projectId });
  const signature = sha256Hex(`growth-context.service.test:${input.label}`);

  const finding = await createFindingsRepo(db, seeded.org.ctx).persist({
    projectId: seeded.projectId,
    runId: run.id,
    signature,
    signatureVersion: 1,
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: input.headline,
    context: ["Something was measured here."],
    finalClass: "confusing",
    surface: input.surface,
    surfaceNormalisationVersion: 1,
    counts: [findingCountRow(28, 28), findingCountRow(input.affected ?? 19, 28)],
    confidenceBasis: "28 kept sessions in a seven-day window",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: `funnel_dropoff:surface=${input.surface}`,
    evidenceShapeVersion: 1,
    resolvedModelId: "claude-sonnet-5",
  });

  await createFindingPayloadsRepo(db, seeded.org.ctx).upsertFor({
    findingId: finding.id,
    payload: fixSpecPayload({ surface: input.surface, affected: input.affected }),
  });

  return { findingId: finding.id, signature };
}

// A payload is attached so the row carries an impact count: what leaves it out of the
// answer is the hold, not the missing count the row above it tests.
async function seedHeldFinding(
  db: TestDb,
  seed: SeedUnscannedFinding,
  seeded: Seeded,
  input: { readonly label: string; readonly surface: string },
): Promise<{ readonly findingId: string; readonly signature: SignatureHex }> {
  const run = await seedAnalysisRun(db, { ctx: seeded.org.ctx, projectId: seeded.projectId });
  const signature = sha256Hex(`growth-context.service.test:${input.label}`);

  const row = await seed(db, {
    ctx: seeded.org.ctx,
    projectId: seeded.projectId,
    runId: run.id,
    headline: `People stop at the second step, and one wrote in as ${OFFENDER}`,
    context: ["Something was measured here."],
    signature,
    surface: input.surface,
    counts: [findingCountRow(28, 28), findingCountRow(19, 28)],
  });

  await createFindingPayloadsRepo(db, seeded.org.ctx).upsertFor({
    findingId: row.id,
    payload: fixSpecPayload({ surface: input.surface }),
  });

  return { findingId: row.id, signature };
}

describe("growth context service", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("answers an empty picture for a project nothing is known about", async () => {
    const seeded = await seedProjectFor(db, "empty");

    const read = await createGrowthContextService(db, seeded.org.ctx).read({
      projectId: seeded.projectId,
      surface: null,
    });

    expect(read.whatMatters).toEqual([]);
    expect(read.knownProblems).toEqual([]);
    expect(read.declined).toEqual([]);
    expect(read.changeable).toBeNull();
  });

  it("answers whether a named page may be worked on, with no growth context at all", async () => {
    // The deny list decides alone until a customer has confirmed anything.
    const seeded = await seedProjectFor(db, "verdict-only");
    const service = createGrowthContextService(db, seeded.org.ctx);

    expect(
      (await service.read({ projectId: seeded.projectId, surface: "/checkout" })).changeable,
    ).toEqual({ allowed: false, reason: "pricing_or_billing" });

    expect(
      (await service.read({ projectId: seeded.projectId, surface: "/onboarding" })).changeable,
    ).toEqual({ allowed: true, reason: null });
  });

  it("narrows every part of the answer to the page it was asked about", async () => {
    const seeded = await seedProjectFor(db, "narrowed");

    await seedFinding(db, seeded, {
      label: "narrowed-here",
      surface: "/onboarding",
      headline: "People stop at the second step",
    });
    await seedFinding(db, seeded, {
      label: "narrowed-elsewhere",
      surface: "/reports",
      headline: "Nobody opens the report",
    });

    await createGrowthContextRepo(db, seeded.org.ctx).save({
      projectId: seeded.projectId,
      surfaces: [
        {
          surface: "/onboarding",
          role: "first_value",
          basis: "stated_by_customer",
          confirmedAt: CONFIRMED,
          normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        },
        {
          surface: "/reports",
          role: "keeps_people",
          basis: "derived_from_product",
          confirmedAt: null,
          normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        },
      ],
      confirmedChangeable: [],
    });

    const read = await createGrowthContextService(db, seeded.org.ctx).read({
      projectId: seeded.projectId,
      surface: "/onboarding",
    });

    expect(read.whatMatters.map((note) => note.surface)).toEqual(["/onboarding"]);
    expect(read.whatMatters[0]?.role).toBe("first_value");
    expect(read.whatMatters[0]?.confirmedByAPerson).toBe(true);
    expect(read.knownProblems.map((problem) => problem.headline)).toEqual([
      "People stop at the second step",
    ]);
  });

  it("reports a proposal-free surface as unconfirmed rather than confirmed", async () => {
    const seeded = await seedProjectFor(db, "unconfirmed");

    await createGrowthContextRepo(db, seeded.org.ctx).save({
      projectId: seeded.projectId,
      surfaces: [
        {
          surface: "/reports",
          role: "keeps_people",
          basis: "derived_from_product",
          confirmedAt: null,
          normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        },
      ],
      confirmedChangeable: [],
    });

    const read = await createGrowthContextService(db, seeded.org.ctx).read({
      projectId: seeded.projectId,
      surface: null,
    });

    expect(read.whatMatters[0]?.confirmedByAPerson).toBe(false);
  });

  it("honours the customer's confirmation that a money page is theirs to work on", async () => {
    const seeded = await seedProjectFor(db, "confirmed-changeable");

    await createGrowthContextRepo(db, seeded.org.ctx).save({
      projectId: seeded.projectId,
      surfaces: [],
      confirmedChangeable: ["/checkout"],
    });

    const read = await createGrowthContextService(db, seeded.org.ctx).read({
      projectId: seeded.projectId,
      surface: "/checkout",
    });

    expect(read.changeable).toEqual({ allowed: true, reason: null });
  });

  it("carries the fix id for a problem that already has one", async () => {
    const seeded = await seedProjectFor(db, "with-fix");
    const finding = await seedFinding(db, seeded, {
      label: "with-fix",
      surface: "/onboarding",
      headline: "People stop at the second step",
    });

    await createFixesService(db, seeded.org.ctx).openFor(finding.findingId);

    const read = await createGrowthContextService(db, seeded.org.ctx).read({
      projectId: seeded.projectId,
      surface: "/onboarding",
    });

    expect(read.knownProblems[0]?.fixId).not.toBeNull();
  });

  it("reports the ideas a person turned down, so they are not raised again", async () => {
    // §8: never re-propose a dead idea.
    const seeded = await seedProjectFor(db, "declined");
    const finding = await seedFinding(db, seeded, {
      label: "declined",
      surface: "/onboarding",
      headline: "Ask for a company name on the first screen",
    });

    await createDismissalsRepo(db, seeded.org.ctx).record({
      projectId: seeded.projectId,
      findingId: finding.findingId,
      signature: finding.signature,
      action: "not_useful",
      dismissedByUserId: seeded.org.ctx.userId,
      dismissedAt: WINDOW_END,
    });

    const read = await createGrowthContextService(db, seeded.org.ctx).read({
      projectId: seeded.projectId,
      surface: "/onboarding",
    });

    expect(read.declined).toHaveLength(1);
    expect(read.declined[0]?.headline).toBe("Ask for a company name on the first screen");
  });

  it("does not read another organization's pages, problems or refusals", async () => {
    const mine = await seedProjectFor(db, "tenant-mine");
    const theirs = await seedProjectFor(db, "tenant-theirs");

    await seedFinding(db, theirs, {
      label: "tenant-theirs",
      surface: "/onboarding",
      headline: "Their problem, not mine",
    });
    await createGrowthContextRepo(db, theirs.org.ctx).save({
      projectId: theirs.projectId,
      surfaces: [
        {
          surface: "/onboarding",
          role: "first_value",
          basis: "stated_by_customer",
          confirmedAt: CONFIRMED,
          normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        },
      ],
      confirmedChangeable: [],
    });

    const read = await createGrowthContextService(db, mine.org.ctx).read({
      projectId: theirs.projectId,
      surface: "/onboarding",
    });

    expect(read.whatMatters).toEqual([]);
    expect(read.knownProblems).toEqual([]);
    expect(read.declined).toEqual([]);
  });

  it("leaves out a problem whose stored detail this build cannot read", async () => {
    // The count comes from the stored payload, so a finding written before it existed
    // contributes no count and is left out rather than reported with a guessed one.
    const seeded = await seedProjectFor(db, "no-payload");
    const run = await seedAnalysisRun(db, { ctx: seeded.org.ctx, projectId: seeded.projectId });

    await createFindingsRepo(db, seeded.org.ctx).persist({
      projectId: seeded.projectId,
      runId: run.id,
      signature: sha256Hex("growth-context.service.test:no-payload"),
      signatureVersion: 1,
      summarySource: summarySourceSchema.enum.model_rendered,
      headline: "Older than the detail we keep",
      context: ["Something was measured here."],
      finalClass: "confusing",
      surface: "/onboarding",
      surfaceNormalisationVersion: 1,
      counts: [findingCountRow(28, 28), findingCountRow(19, 28)],
      confidenceBasis: "28 kept sessions in a seven-day window",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      evidenceShape: "funnel_dropoff:surface=/onboarding",
      evidenceShapeVersion: 1,
      resolvedModelId: "claude-sonnet-5",
    });

    const read = await createGrowthContextService(db, seeded.org.ctx).read({
      projectId: seeded.projectId,
      surface: "/onboarding",
    });

    expect(read.knownProblems).toEqual([]);
  });

  test("a held finding is omitted from knownProblems and a held dismissal is omitted from declined", async () => {
    const seedUnscannedFinding = await loadSeedUnscannedFinding();
    const seeded = await seedProjectFor(db, "pii-held");
    const surface = "/onboarding";

    const cleanProblem = await seedFinding(db, seeded, {
      label: "pii-clean-problem",
      surface,
      headline: "People stop at the second step",
    });
    const cleanDeclined = await seedFinding(db, seeded, {
      label: "pii-clean-declined",
      surface,
      headline: "Ask for a company name on the first screen",
    });
    const heldProblem = await seedHeldFinding(db, seedUnscannedFinding, seeded, {
      label: "pii-held-problem",
      surface,
    });
    const heldDeclined = await seedHeldFinding(db, seedUnscannedFinding, seeded, {
      label: "pii-held-declined",
      surface,
    });

    const dismissals = createDismissalsRepo(db, seeded.org.ctx);
    for (const dismissed of [cleanDeclined, heldDeclined]) {
      await dismissals.record({
        projectId: seeded.projectId,
        findingId: dismissed.findingId,
        signature: dismissed.signature,
        action: "not_useful",
        dismissedByUserId: seeded.org.ctx.userId,
        dismissedAt: WINDOW_END,
      });
    }

    const read = await createGrowthContextService(db, seeded.org.ctx).read({
      projectId: seeded.projectId,
      surface,
    });

    const problems = read.knownProblems.map((problem) => problem.findingId);
    expect(problems).toContain(cleanProblem.findingId);
    expect(problems).not.toContain(heldProblem.findingId);
    expect(problems).not.toContain(heldDeclined.findingId);

    expect(read.declined.map((row) => row.headline)).toEqual([
      "Ask for a company name on the first screen",
    ]);

    expect(JSON.stringify(read)).not.toContain(OFFENDER);
  });
});
