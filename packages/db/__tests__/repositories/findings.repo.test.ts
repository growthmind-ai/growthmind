import { summarySourceSchema } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createFindingsRepo, type PersistFindingInput } from "../../src/repositories/findings.repo";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedAnalysisRun, seedOrgWithOwner, seedProject } from "../helpers/fixtures";

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

function signatureFor(label: string): string {
  return sha256Hex(`findings.repo.test:${label}`);
}

function makePersistInput(
  projectId: string,
  runId: string,
  overrides: Partial<PersistFindingInput> = {},
): PersistFindingInput {
  return {
    projectId,
    runId,
    signature: signatureFor("checkout-step-2"),
    signatureVersion: 1,
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: "Two of every three people stop at the payment step",

    context: [
      "Of 28 people who reached the payment step, 19 did not finish.",
      "This covers the seven days ending 31 July.",
    ],
    finalClass: "funnel_dropoff",
    surface: "app/checkout/payment/page.tsx",
    surfaceNormalisationVersion: 1,
    counts: [],
    confidenceBasis: "28 kept sessions in a seven-day window",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: "funnel_dropoff:step=payment",
    evidenceShapeVersion: 1,
    resolvedModelId: "claude-sonnet-5",
    tokensIn: 1_200,
    tokensOut: 180,
    ...overrides,
  };
}

describe("findings repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("every column the findings read path filters by is stamped by the write path", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "acme-findings-stamp",
      userName: "Owner Findings Stamp",
      email: "owner-findings-stamp@acme.example",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "other-findings-stamp",
      userName: "Owner Other Stamp",
      email: "owner-other-stamp@other.example",
    });
    const project = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "checkout-findings-stamp",
    });
    const siblingProject = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "onboarding-findings-stamp",
    });

    const repo = createFindingsRepo(db, orgA.ctx);
    const run = await seedAnalysisRun(db, { ctx: orgA.ctx, projectId: project.id });
    const input = makePersistInput(project.id, run.id);

    const written = await repo.persist(input);

    expect(written.organizationId).toBe(orgA.organizationId);
    expect(written.projectId).toBe(project.id);

    const bySignature = await repo.findBySignature(project.id, input.signature);
    expect(bySignature?.id).toBe(written.id);

    const listed = await repo.listForProject(project.id, { limit: 10 });
    expect(listed.map((row) => row.id)).toContain(written.id);

    const wrongProject = await repo.findBySignature(siblingProject.id, input.signature);
    expect(wrongProject).toBeNull();
    expect(await repo.listForProject(siblingProject.id, { limit: 10 })).toEqual([]);

    const foreignRepo = createFindingsRepo(db, orgB.ctx);
    expect(await foreignRepo.findBySignature(project.id, input.signature)).toBeNull();
    expect(await foreignRepo.listForProject(project.id, { limit: 10 })).toEqual([]);
  });

  it("unreported token counts persist as not reported and are never written as zero", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-findings-usage",
      userName: "Owner Findings Usage",
      email: "owner-findings-usage@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-findings-usage",
    });
    const repo = createFindingsRepo(db, org.ctx);
    const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });

    const usage: { inputTokens?: number; outputTokens?: number } = {};
    const unmetered = makePersistInput(project.id, run.id, {
      signature: signatureFor("unmetered"),
      tokensIn: usage.inputTokens ?? null,
      tokensOut: usage.outputTokens ?? null,
    });

    const written = await repo.persist(unmetered);

    expect(written.tokensIn).toBeNull();
    expect(written.tokensOut).toBeNull();

    expect(written.tokensIn).not.toBe(0);
    expect(written.tokensOut).not.toBe(0);

    const readBack = await repo.findBySignature(project.id, unmetered.signature);
    expect(readBack?.tokensIn).toBeNull();
    expect(readBack?.tokensOut).toBeNull();
    expect(readBack?.tokensOut).not.toBe(0);

    const meteredZero = await repo.persist(
      makePersistInput(project.id, run.id, {
        signature: signatureFor("metered-zero"),
        tokensIn: 0,
        tokensOut: 0,
      }),
    );
    expect(meteredZero.tokensIn).toBe(0);
    expect(meteredZero.tokensOut).toBe(0);
  });

  it("an unrecorded surface normalisation version persists as not recorded and a genuine zero remains a distinct storable version", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-findings-normversion",
      userName: "Owner Findings Norm Version",
      email: "owner-findings-normversion@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-findings-normversion",
    });
    const repo = createFindingsRepo(db, org.ctx);
    const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });

    const unrecorded = await repo.persist(
      makePersistInput(project.id, run.id, {
        signature: signatureFor("normversion-unrecorded"),
        surfaceNormalisationVersion: null,
      }),
    );

    expect(unrecorded.surfaceNormalisationVersion).toBeNull();

    expect(unrecorded.surfaceNormalisationVersion).not.toBe(0);

    const readBack = await repo.findBySignature(project.id, unrecorded.signature);
    expect(readBack?.surfaceNormalisationVersion).toBeNull();
    expect(readBack?.surfaceNormalisationVersion).not.toBe(0);

    const versionZero = await repo.persist(
      makePersistInput(project.id, run.id, {
        signature: signatureFor("normversion-zero"),
        surfaceNormalisationVersion: 0,
      }),
    );
    expect(versionZero.surfaceNormalisationVersion).toBe(0);
    expect(versionZero.surfaceNormalisationVersion).not.toBeNull();

    const zeroReadBack = await repo.findBySignature(project.id, versionZero.signature);
    expect(zeroReadBack?.surfaceNormalisationVersion).toBe(0);

    expect(zeroReadBack?.surfaceNormalisationVersion).not.toBe(
      readBack?.surfaceNormalisationVersion,
    );
  });
});
