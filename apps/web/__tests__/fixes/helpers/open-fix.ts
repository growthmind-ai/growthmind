import {
  createFindingPayloadsRepo,
  createFindingsRepo,
  createFixesService,
  sha256Hex,
} from "@growthmind/db";
import {
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
} from "../../../../../packages/db/__tests__/helpers/fix-spec-payload";

export const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");

export const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const TEXT = scannedTextFor("Two of every three people stop at the last step", [
  "Of 28 people who reached the last step, 19 did not finish.",
]);

export interface SeededOpenFix {
  readonly org: SeededOrgWithOwner;
  readonly projectId: string;
  readonly fixId: string;
  readonly findingId: string;
}

export interface SeededFixOrg {
  readonly org: SeededOrgWithOwner;
  readonly projectId: string;
}

export async function seedFixOrg(db: TestDb, label: string): Promise<SeededFixOrg> {
  const org = await seedOrgWithOwner(db, {
    orgName: `web-fixes-${label}`,
    userName: `web-fixes-${label}`,
    email: `web-fixes-${label}@example.com`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `web-fixes-${label}`,
  });

  return { org, projectId: project.id };
}

/** One open fix, with the finding and payload behind it, in an org of its own. */
export async function seedOpenFix(db: TestDb, label: string): Promise<SeededOpenFix> {
  const seeded = await seedFixOrg(db, label);

  return { ...seeded, ...(await openFixIn(db, seeded, label)) };
}

/** A second, third… open fix inside an org already seeded, for a list with more than one row. */
export async function openFixIn(
  db: TestDb,
  seeded: SeededFixOrg,
  label: string,
): Promise<{ readonly fixId: string; readonly findingId: string }> {
  const { org, projectId } = seeded;
  const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId });

  const finding = await createFindingsRepo(db, org.ctx).persist({
    projectId,
    runId: run.id,
    signature: sha256Hex(`apps/web fixes:${label}`),
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

  return { fixId: opened.fix.id, findingId: finding.id };
}
