import { ANALYSIS_RUN_STATUS_MESSAGES, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";

import {
  ANALYSIS_RUN_LEASE_MS,
  createAnalysisRunsRepo,
  type AnalysisRunRecord,
  type AnalysisRunsRepo,
  type CloseRunInput,
} from "../../src/repositories/analysis-runs.repo";
import { createFindingsRepo, type PersistFindingInput } from "../../src/repositories/findings.repo";
import { analysisModelCalls } from "../../src/schema/analysis-model-calls";
import { analysisRuns } from "../../src/schema/analysis-runs";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { scannedTextFor, seedOrgWithOwner, seedProject } from "../../src/testing";

const TICK_AT = new Date("2026-07-31T09:00:00.000Z");
const FINISHED_AT = new Date("2026-07-31T09:04:00.000Z");
const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const SIGNATURE_DB4 = sha256Hex("analysis-runs.repo.test:db4");
const SIGNATURE_A = sha256Hex("analysis-runs.repo.test:candidate-a");
const SIGNATURE_B = sha256Hex("analysis-runs.repo.test:candidate-b");
const SIGNATURE_C = sha256Hex("analysis-runs.repo.test:candidate-c");

function claimSignature(label: string): string {
  return sha256Hex(`analysis-runs.repo.test:${label}`);
}

interface SeededLane {
  readonly projectId: string;
  readonly runId: string;
}

function laneAt(lanes: readonly SeededLane[], index: number): SeededLane {
  const lane = lanes[index];
  if (!lane) {
    throw new Error(`seedOrgWithProjects did not open a lane at index ${String(index)}`);
  }
  return lane;
}

const ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE = 10_000;

function forged<T>(illegal: string): T {
  return illegal as unknown as T;
}

function makeCloseInput(runId: string, projectId: string): CloseRunInput {
  return {
    runId,
    projectId,
    status: "completed",
    outcome: "no_candidates_passed_gate",
    stopReason: "ran_to_completion",
    finishedAt: FINISHED_AT,
    modelCallsAttempted: 0,

    candidatesUnrenderable: 0,
    candidatesRefused: 0,
    resolvedModelId: null,

    tokensIn: null,
    tokensOut: null,
    failureReason: null,
  };
}

const CLEAN_TEXT = scannedTextFor("Fewer people finished checkout than started it.", [
  "We looked at one week of activity.",
]);

function makeFindingInput(
  projectId: string,
  runId: string,
  overrides: Partial<PersistFindingInput> = {},
): PersistFindingInput {
  return {
    projectId,
    signature: SIGNATURE_DB4,
    signatureVersion: 1,
    runId,
    summarySource: "floor_no_key_configured",
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
    finalClass: "funnel_dropoff",
    surface: "checkout",
    surfaceNormalisationVersion: 1,
    counts: [],
    confidenceBasis: "measured",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: "funnel_dropoff_v1",
    evidenceShapeVersion: 1,
    resolvedModelId: null,
    tokensIn: null,
    tokensOut: null,
    ...overrides,
  };
}

describe("analysis runs repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function seedOpenRun(slug: string): Promise<{
    repo: AnalysisRunsRepo;
    ctx: TenantContext;
    projectId: string;
    runId: string;
  }> {
    const org = await seedOrgWithOwner(db, {
      orgName: `acme-${slug}`,
      userName: `Owner ${slug}`,
      email: `owner-${slug}@acme.example`,
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: `checkout-${slug}`,
    });
    const repo = createAnalysisRunsRepo(db, org.ctx);

    const opened = await repo.open({ projectId: project.id, tickAt: TICK_AT });

    if (!opened.run) {
      throw new Error(`open() did not return a run row for ${slug}`);
    }

    return {
      repo,
      ctx: org.ctx,
      projectId: project.id,
      runId: opened.run.id,
    };
  }

  it("the persistence wire refuses a summary source or run state the shared unions never declared", async () => {
    const { repo, ctx, projectId, runId } = await seedOpenRun("db4-refusal");

    const findings = createFindingsRepo(db, ctx);

    await expect(
      repo.close({
        ...makeCloseInput(runId, projectId),
        status: forged<CloseRunInput["status"]>("cancelled"),
      }),
    ).rejects.toThrow();

    await expect(
      repo.close({
        ...makeCloseInput(runId, projectId),
        outcome: forged<CloseRunInput["outcome"]>("nothing_found"),
      }),
    ).rejects.toThrow();

    await expect(
      repo.close({
        ...makeCloseInput(runId, projectId),
        stopReason: forged<CloseRunInput["stopReason"]>("stopped_early"),
      }),
    ).rejects.toThrow();

    await expect(
      findings.persist(
        makeFindingInput(projectId, runId, {
          summarySource: forged<PersistFindingInput["summarySource"]>("floor_unknown"),
        }),
      ),
    ).rejects.toThrow();

    const stillOpen = await repo.open({ projectId, tickAt: TICK_AT });
    expect(stillOpen.run?.id).toBe(runId);
    expect(stillOpen.run?.status).toBe("running");
    expect(stillOpen.run?.finishedAt).toBeNull();
    expect(stillOpen.run?.stopReason).toBeNull();
    expect(await findings.findBySignature(projectId, SIGNATURE_DB4)).toBeNull();

    const closed = await repo.close(makeCloseInput(runId, projectId));
    expect(closed.status).toBe("completed");
    expect(closed.stopReason).toBe("ran_to_completion");
  });

  it("a model call claim at the cap is refused as cap exhausted and a repeat claim is refused as already claimed", async () => {
    const { repo, projectId, runId } = await seedOpenRun("cap-claim");

    const cap = 1;

    const first = await repo.claimModelCall({
      projectId,
      runId,
      signature: SIGNATURE_A,
      signatureVersion: 1,
      projectCap: cap,
      organizationCap: ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE,
      at: TICK_AT,
    });
    expect(first).toEqual({ claimed: true });

    const repeat = await repo.claimModelCall({
      projectId,
      runId,
      signature: SIGNATURE_A,
      signatureVersion: 1,
      projectCap: cap,
      organizationCap: ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE,
      at: TICK_AT,
    });
    expect(repeat).toEqual({ claimed: false, reason: "already_claimed" });

    const past = await repo.claimModelCall({
      projectId,
      runId,
      signature: SIGNATURE_B,
      signatureVersion: 1,
      projectCap: cap,
      organizationCap: ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE,
      at: TICK_AT,
    });
    expect(past).toEqual({ claimed: false, reason: "cap_exhausted" });

    expect(repeat).not.toEqual(past);
    expect(first).not.toEqual(repeat);
    expect(first).not.toEqual(past);

    const repeatWhileSpent = await repo.claimModelCall({
      projectId,
      runId,
      signature: SIGNATURE_A,
      signatureVersion: 1,
      projectCap: cap,
      organizationCap: ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE,
      at: TICK_AT,
    });
    expect(repeatWhileSpent).toEqual({ claimed: false, reason: "already_claimed" });

    const zeroCap = await repo.claimModelCall({
      projectId,
      runId,
      signature: SIGNATURE_C,
      signatureVersion: 1,
      projectCap: 0,
      organizationCap: ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE,
      at: TICK_AT,
    });
    expect(zeroCap).toEqual({ claimed: false, reason: "cap_exhausted" });
  });

  async function seedOrgWithProjects(
    slug: string,
    projectCount: number,
  ): Promise<{
    repo: AnalysisRunsRepo;
    ctx: TenantContext;
    lanes: readonly SeededLane[];
  }> {
    const org = await seedOrgWithOwner(db, {
      orgName: `acme-${slug}`,
      userName: `Owner ${slug}`,
      email: `owner-${slug}@acme.example`,
    });
    const repo = createAnalysisRunsRepo(db, org.ctx);
    const lanes: SeededLane[] = [];

    for (let index = 0; index < projectCount; index += 1) {
      const project = await seedProject(db, {
        organizationId: org.organizationId,
        name: `checkout-${slug}-${String(index)}`,
      });
      const opened = await repo.open({ projectId: project.id, tickAt: TICK_AT });
      lanes.push({ projectId: project.id, runId: opened.run.id });
    }

    return { repo, ctx: org.ctx, lanes };
  }

  async function claimCountForOrg(ctx: TenantContext): Promise<number> {
    const rows = await db
      .select({ id: analysisModelCalls.id })
      .from(analysisModelCalls)
      .where(eq(analysisModelCalls.organizationId, ctx.organizationId));

    return rows.length;
  }

  it("a model call claim at the organization ceiling is refused even when the project still has budget", async () => {
    const { repo, ctx, lanes } = await seedOrgWithProjects("org-ceiling", 2);
    const first = laneAt(lanes, 0);
    const second = laneAt(lanes, 1);

    const PROJECT_CAP = 3;
    const ORGANIZATION_CAP = 4;

    for (const lane of [first, second]) {
      for (const suffix of ["a", "b"]) {
        const claim = await repo.claimModelCall({
          projectId: lane.projectId,
          runId: lane.runId,
          signature: claimSignature(`org-ceiling-${lane.projectId}-${suffix}`),
          signatureVersion: 1,
          projectCap: PROJECT_CAP,
          organizationCap: ORGANIZATION_CAP,
          at: TICK_AT,
        });
        expect(claim).toEqual({ claimed: true });
      }
    }

    expect(await claimCountForOrg(ctx)).toBe(4);

    const refused = await repo.claimModelCall({
      projectId: second.projectId,
      runId: second.runId,
      signature: claimSignature("org-ceiling-overflow"),
      signatureVersion: 1,
      projectCap: PROJECT_CAP,
      organizationCap: ORGANIZATION_CAP,
      at: TICK_AT,
    });

    expect(refused).toEqual({ claimed: false, reason: "cap_exhausted" });

    expect(await claimCountForOrg(ctx)).toBe(4);

    const allowed = await repo.claimModelCall({
      projectId: second.projectId,
      runId: second.runId,
      signature: claimSignature("org-ceiling-overflow"),
      signatureVersion: 1,
      projectCap: PROJECT_CAP,
      organizationCap: ORGANIZATION_CAP + 1,
      at: TICK_AT,
    });
    expect(allowed).toEqual({ claimed: true });
    expect(await claimCountForOrg(ctx)).toBe(5);
  });

  it("the organization ceiling counts only this organization's claims", async () => {
    const orgA = await seedOrgWithProjects("org-scope-a", 1);
    const orgB = await seedOrgWithProjects("org-scope-b", 1);
    const laneA = laneAt(orgA.lanes, 0);
    const laneB = laneAt(orgB.lanes, 0);

    const ORGANIZATION_CAP = 1;
    const PROJECT_CAP = 5;

    const spentByB = await orgB.repo.claimModelCall({
      projectId: laneB.projectId,
      runId: laneB.runId,
      signature: claimSignature("org-scope-b-first"),
      signatureVersion: 1,
      projectCap: PROJECT_CAP,
      organizationCap: ORGANIZATION_CAP,
      at: TICK_AT,
    });
    expect(spentByB).toEqual({ claimed: true });
    expect(await claimCountForOrg(orgB.ctx)).toBe(1);

    const allowedForA = await orgA.repo.claimModelCall({
      projectId: laneA.projectId,
      runId: laneA.runId,
      signature: claimSignature("org-scope-a-first"),
      signatureVersion: 1,
      projectCap: PROJECT_CAP,
      organizationCap: ORGANIZATION_CAP,
      at: TICK_AT,
    });
    expect(allowedForA).toEqual({ claimed: true });

    expect(await claimCountForOrg(orgA.ctx)).toBe(1);
    expect(await claimCountForOrg(orgB.ctx)).toBe(1);

    const beyondForA = await orgA.repo.claimModelCall({
      projectId: laneA.projectId,
      runId: laneA.runId,
      signature: claimSignature("org-scope-a-second"),
      signatureVersion: 1,
      projectCap: PROJECT_CAP,
      organizationCap: ORGANIZATION_CAP,
      at: TICK_AT,
    });
    expect(beyondForA).toEqual({ claimed: false, reason: "cap_exhausted" });
    expect(await claimCountForOrg(orgA.ctx)).toBe(1);
  });

  async function readRun(ctx: TenantContext, runId: string): Promise<AnalysisRunRecord> {
    const [row] = await db
      .select()
      .from(analysisRuns)
      .where(and(eq(analysisRuns.organizationId, ctx.organizationId), eq(analysisRuns.id, runId)))
      .limit(1);

    if (!row) {
      throw new Error(`no analysis run ${runId} for this organization`);
    }

    return row;
  }

  it("a running run older than the lease is closed as an abandoned run and the project's lane opens again", async () => {
    const { repo, ctx, projectId, runId } = await seedOpenRun("stale-lease");

    const laterTick = new Date(TICK_AT.getTime() + ANALYSIS_RUN_LEASE_MS + 1);
    const reopened = await repo.open({ projectId, tickAt: laterTick });

    expect(reopened.opened).toBe(true);
    expect(reopened.run.id).not.toBe(runId);
    expect(reopened.run.status).toBe("running");
    expect(reopened.run.startedAt).toEqual(laterTick);

    const abandoned = await readRun(ctx, runId);
    expect(abandoned.status).toBe("failed");
    expect(abandoned.stopReason).toBe("fatal_error");
    expect(abandoned.finishedAt).toEqual(laterTick);

    expect(abandoned.failureReason).toBe(ANALYSIS_RUN_STATUS_MESSAGES.failed);

    expect(abandoned.outcome).toBeNull();

    const open = await db
      .select({ id: analysisRuns.id })
      .from(analysisRuns)
      .where(
        and(
          eq(analysisRuns.organizationId, ctx.organizationId),
          eq(analysisRuns.projectId, projectId),
          eq(analysisRuns.status, "running"),
        ),
      );
    expect(open).toHaveLength(1);
    expect(open[0]?.id).toBe(reopened.run.id);
  });

  it("a running run still inside its lease is never stolen from itself", async () => {
    const { repo, ctx, projectId, runId } = await seedOpenRun("live-lease");

    const boundaryTick = new Date(TICK_AT.getTime() + ANALYSIS_RUN_LEASE_MS);
    const blocked = await repo.open({ projectId, tickAt: boundaryTick });

    expect(blocked.opened).toBe(false);
    expect(blocked.run.id).toBe(runId);
    expect(blocked.run.status).toBe("running");

    const untouched = await readRun(ctx, runId);
    expect(untouched.status).toBe("running");
    expect(untouched.finishedAt).toBeNull();
    expect(untouched.stopReason).toBeNull();
    expect(untouched.failureReason).toBeNull();
    expect(untouched.startedAt).toEqual(TICK_AT);
  });

  it("a run records the candidates it could not write up and the candidates it refused, apart from each other", async () => {
    const { repo, ctx, projectId, runId } = await seedOpenRun("no-finding-counts");

    const closed = await repo.close({
      ...makeCloseInput(runId, projectId),
      candidatesUnrenderable: 2,
      candidatesRefused: 5,
    });

    expect(closed.candidatesUnrenderable).toBe(2);
    expect(closed.candidatesRefused).toBe(5);

    const persisted = await readRun(ctx, runId);
    expect(persisted.candidatesUnrenderable).toBe(2);
    expect(persisted.candidatesRefused).toBe(5);

    expect(persisted.status).toBe("completed");
    expect(persisted.stopReason).toBe("ran_to_completion");
  });

  it("a terminal run is not rewritten by a second close", async () => {
    const { repo, ctx, projectId, runId } = await seedOpenRun("close-once");

    const closed = await repo.close(makeCloseInput(runId, projectId));
    expect(closed.status).toBe("completed");

    await expect(
      repo.close({
        ...makeCloseInput(runId, projectId),
        status: "failed",
        stopReason: "fatal_error",
        outcome: "no_sessions_to_analyse",
        finishedAt: new Date(FINISHED_AT.getTime() + 60_000),
        failureReason: ANALYSIS_RUN_STATUS_MESSAGES.failed,
      }),
    ).rejects.toThrow();

    const stillFirstVerdict = await readRun(ctx, runId);
    expect(stillFirstVerdict.status).toBe("completed");
    expect(stillFirstVerdict.outcome).toBe("no_candidates_passed_gate");
    expect(stillFirstVerdict.stopReason).toBe("ran_to_completion");
    expect(stillFirstVerdict.finishedAt).toEqual(FINISHED_AT);
    expect(stillFirstVerdict.failureReason).toBeNull();
  });
});
