// D7 for the fix detail route, and the one distinction the route exists to keep: a fix
// another organization owns must answer exactly what an id that never existed answers, and
// a fix we hold and cannot word must NOT answer that — a Slack link to one of those would
// otherwise tell the founder it does not exist. It does; we are holding it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { FIX_SPEC_PAYLOAD_VERSION } from "@growthmind/core";
import {
  createFindingPayloadsRepo,
  createFindingsRepo,
  createFixesService,
  sha256Hex,
} from "@growthmind/db";
import {
  createTestDb,
  scannedTextFor,
  seedAnalysisRun,
  seedOrgWithOwner,
  seedProject,
  type SeededOrgWithOwner,
  type TestDb,
} from "@growthmind/db/testing";
import { summarySourceSchema } from "@growthmind/shared";

import {
  fixSpecPayload,
  findingCountRow,
  RENDERABLE_SURFACE,
} from "../../../../packages/db/__tests__/helpers/fix-spec-payload";
import { readFixDetail } from "../../lib/fixes/read";

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");

const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const NOW = new Date("2026-08-05T00:00:00.000Z");

const NO_SUCH_FIX = "3f2a1b40-0000-4000-8000-000000000000";

const TEXT = scannedTextFor("Two of every three people stop at the last step", [
  "Of 28 people who reached the last step, 19 did not finish.",
]);

async function seedOpenFix(
  db: TestDb,
  label: string,
): Promise<{
  readonly org: SeededOrgWithOwner;
  readonly fixId: string;
  readonly findingId: string;
}> {
  const org = await seedOrgWithOwner(db, {
    orgName: `web-fixes-${label}`,
    userName: `web-fixes-${label}`,
    email: `web-fixes-${label}@example.com`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `web-fixes-${label}`,
  });
  const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });

  const finding = await createFindingsRepo(db, org.ctx).persist({
    projectId: project.id,
    runId: run.id,
    signature: sha256Hex(`apps/web fixes detail:${label}`),
    signatureVersion: 1,
    detector: "funnel_dropoff",
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: TEXT.headline,
    context: TEXT.context,
    finalClass: "confusing",
    surface: RENDERABLE_SURFACE,
    surfaceNormalisationVersion: 1,
    counts: [findingCountRow(28, 28), findingCountRow(19, 28)],
    confidenceBasis: "28 kept sessions in a seven-day window",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: `funnel_dropoff:surface=${RENDERABLE_SURFACE}`,
    evidenceShapeVersion: 1,
    resolvedModelId: "claude-sonnet-5",
  });

  await createFindingPayloadsRepo(db, org.ctx).upsertFor({
    findingId: finding.id,
    payload: fixSpecPayload({ surface: RENDERABLE_SURFACE }),
  });

  const opened = await createFixesService(db, org.ctx).openFor(finding.id);
  if (opened.outcome !== "opened") {
    throw new Error(`seedOpenFix: expected a fix to open, got ${opened.outcome}`);
  }

  return { org, fixId: opened.fix.id, findingId: finding.id };
}

// A payload written under a version this build cannot read back: the production shape of
// "we hold this fix and cannot put it into words", reached without deleting anything.
async function makeUnreadable(db: TestDb, findingId: string): Promise<void> {
  await db.$client.query("update finding_payloads set payload_version = $1 where finding_id = $2", [
    FIX_SPEC_PAYLOAD_VERSION + 1,
    findingId,
  ]);
}

describe("the fix detail route", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("a fix another organization owns answers exactly what an id that never existed answers", async () => {
    const mine = await seedOpenFix(db, "cross-mine");
    const theirs = await seedOpenFix(db, "cross-theirs");

    const borrowed = await readFixDetail(db, mine.org.ctx, theirs.fixId, NOW);
    const invented = await readFixDetail(db, mine.org.ctx, NO_SUCH_FIX, NOW);

    expect(borrowed).toEqual({ kind: "missing" });
    expect(borrowed).toEqual(invented);
  });

  test("a fix we hold and cannot word is not a missing one, and keeps its finding to link to", async () => {
    const seeded = await seedOpenFix(db, "held-own");
    await makeUnreadable(db, seeded.findingId);

    expect(await readFixDetail(db, seeded.org.ctx, seeded.fixId, NOW)).toEqual({
      kind: "held",
      findingId: seeded.findingId,
    });
  });

  test("another organization's held fix stays missing, so the hold is never admitted across the boundary", async () => {
    const theirs = await seedOpenFix(db, "held-theirs");
    const mine = await seedOpenFix(db, "held-onlooker");
    await makeUnreadable(db, theirs.findingId);

    expect(await readFixDetail(db, mine.org.ctx, theirs.fixId, NOW)).toEqual({ kind: "missing" });
  });

  test("a readable fix renders the contract, its promised date and what left the denominator", async () => {
    const seeded = await seedOpenFix(db, "contract");

    const view = await readFixDetail(db, seeded.org.ctx, seeded.fixId, NOW);
    if (view.kind !== "contract") throw new Error(`expected a contract, got ${view.kind}`);

    expect(view.findingId).toBe(seeded.findingId);
    expect(view.spec.surface).toBe(RENDERABLE_SURFACE);
    expect(view.spec.symptom.length).toBeGreaterThan(0);
    expect(view.spec.boundary.length).toBeGreaterThan(0);
    expect(view.promise.lead).toContain("We said we would have an answer by");
    expect(view.setAside.some((sentence) => sentence.includes("set aside as"))).toBe(true);
  });
});
