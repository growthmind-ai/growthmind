import {
  createFindingsRepo,
  type MeasuredCountRow,
  type PersistFindingInput,
  type ScopedDb,
} from "@growthmind/db";
import {
  createTestDb,
  scannedTextFor,
  seedAnalysisRun,
  seedOrgWithOwner,
  seedProject,
  seedUnscannedFinding,
  type TestDb,
} from "@growthmind/db/testing";
import { summarySourceSchema, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { readLiveFinding, readLiveOverview } from "../../lib/findings/read";

const WINDOW_START = new Date("2026-08-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-08-08T00:00:00.000Z");

const CLEAN_TEXT = scannedTextFor("The checkout step is losing sessions", [
  "Of 28 people who reached checkout, 19 did not finish.",
]);

const REACHED: MeasuredCountRow = {
  numerator: 28,
  denominator: 28,
  unit: "sessions",
  timeframe: { start: WINDOW_START, end: WINDOW_END },
  basis: {
    totalInWindow: 40,
    kept: 28,
    keptUnchecked: 0,
    setAside: [{ reason: "internal_team", count: 12, label: "your own team" }],
  },
};

const IMPACT: MeasuredCountRow = { ...REACHED, numerator: 19 };

function persistInput(
  projectId: string,
  runId: string,
  overrides: Partial<PersistFindingInput> = {},
): PersistFindingInput {
  return {
    projectId,
    runId,
    signature: overrides.signature ?? `sig-${Math.random().toString(36).slice(2)}`,
    signatureVersion: 1,
    detector: "funnel_dropoff",
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
    finalClass: "funnel_dropoff",
    surface: "/checkout",
    surfaceNormalisationVersion: 1,
    counts: [REACHED, IMPACT],
    confidenceBasis: "28 kept sessions in a seven-day window",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: "funnel_dropoff:step=checkout",
    evidenceShapeVersion: 1,
    resolvedModelId: "claude-sonnet-5",
    tokensIn: 900,
    tokensOut: 120,
    ...overrides,
  };
}

async function seedWorkspace(
  db: ScopedDb,
  label: string,
): Promise<{ ctx: TenantContext; projectId: string; runId: string }> {
  const org = await seedOrgWithOwner(db, {
    orgName: `acme-findings-read-${label}`,
    userName: `Owner ${label}`,
    email: `owner-findings-read-${label}@acme.example`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `project-findings-read-${label}`,
  });
  const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });

  return { ctx: org.ctx, projectId: project.id, runId: run.id };
}

describe("apps/web/lib/findings/read.ts", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("a project with no findings yields an empty, non-throwing overview", async () => {
    const { ctx, projectId } = await seedWorkspace(db, "empty");

    const overview = await readLiveOverview(db, ctx, projectId);

    expect(overview.rows).toEqual([]);
    expect(overview.coverage.found).toBe(0);
    expect(overview.calibration).toEqual({ right: 0, wrong: 0, pending: 0 });
  });

  test("a model-rendered finding reads as described, with its impact count and real headline", async () => {
    const { ctx, projectId, runId } = await seedWorkspace(db, "described");
    await createFindingsRepo(db, ctx).persist(persistInput(projectId, runId));

    const overview = await readLiveOverview(db, ctx, projectId);
    expect(overview.rows).toHaveLength(1);

    const [row] = overview.rows;
    expect(row?.group).toBe("described");
    expect(row?.headline).toBe(CLEAN_TEXT.headline);
    expect(row?.numerator).toBe(19);
    expect(row?.denominator).toBe(28);
  });

  test("a floor-rendered finding (no model call) reads as measurement, not described", async () => {
    const { ctx, projectId, runId } = await seedWorkspace(db, "measurement");
    await createFindingsRepo(db, ctx).persist(
      persistInput(projectId, runId, {
        summarySource: summarySourceSchema.enum.floor_no_key_configured,
      }),
    );

    const overview = await readLiveOverview(db, ctx, projectId);
    expect(overview.rows[0]?.group).toBe("measurement");
  });

  // The scanner's whole purpose is to keep flagged text off every surface it gates — the
  // list view must never carry it either, even as an aside.
  test("a held finding reads as withheld, and its real headline never reaches the row", async () => {
    const { ctx, projectId, runId } = await seedWorkspace(db, "withheld");
    const flagged = "Two people wrote in as jane.doe@acme.example about checkout";

    await seedUnscannedFinding(db, {
      ctx,
      projectId,
      runId,
      headline: flagged,
      context: ["Of 28 people who reached checkout, 19 did not finish."],
      counts: [REACHED, IMPACT],
    });

    const overview = await readLiveOverview(db, ctx, projectId);
    const [row] = overview.rows;

    expect(row?.group).toBe("withheld");
    expect(row?.headline).not.toContain("jane.doe@acme.example");
    expect(row?.context).toBe("");
  });

  test("readLiveFinding returns a detail view for a real id, and null for a wrong project or unknown id", async () => {
    const { ctx, projectId, runId } = await seedWorkspace(db, "detail");
    const written = await createFindingsRepo(db, ctx).persist(persistInput(projectId, runId));

    const found = await readLiveFinding(db, ctx, projectId, written.id);
    expect(found?.headline).toBe(CLEAN_TEXT.headline);
    expect(found?.withheld).toBe(false);
    expect(found?.countLine).toContain("19 of 28 sessions");

    const { projectId: siblingProjectId } = await seedWorkspace(db, "detail-sibling");
    expect(await readLiveFinding(db, ctx, siblingProjectId, written.id)).toBeNull();
    expect(await readLiveFinding(db, ctx, projectId, "not-a-real-id")).toBeNull();
  });

  // The real write path (worker/src/tasks/analysis-tick.ts) always sizes `counts` to its
  // detector's declared roles, never zero — this guards the reader in case that ever changes.
  test("a finding with no counts reads a null impact and a plain window line, never throws", async () => {
    const { ctx, projectId, runId } = await seedWorkspace(db, "no-counts");
    const written = await createFindingsRepo(db, ctx).persist(
      persistInput(projectId, runId, { counts: [] }),
    );

    const overview = await readLiveOverview(db, ctx, projectId);
    const [row] = overview.rows;
    expect(row?.numerator).toBeNull();
    expect(row?.denominator).toBeNull();

    const detail = await readLiveFinding(db, ctx, projectId, written.id);
    expect(detail?.countLine).not.toContain("of");
    expect(detail?.countLine).not.toContain("null");
  });

  test("readLiveFinding on a held finding withholds its detail too", async () => {
    const { ctx, projectId, runId } = await seedWorkspace(db, "detail-withheld");
    const flagged = "Contact jane.doe@acme.example if this keeps happening";

    const seeded = await seedUnscannedFinding(db, {
      ctx,
      projectId,
      runId,
      headline: flagged,
      context: ["Of 28 people who reached checkout, 19 did not finish."],
      counts: [REACHED, IMPACT],
    });

    const found = await readLiveFinding(db, ctx, projectId, seeded.id);
    expect(found?.withheld).toBe(true);
    expect(found?.headline).not.toContain("jane.doe@acme.example");
    expect(found?.context).toBe("");
  });
});
