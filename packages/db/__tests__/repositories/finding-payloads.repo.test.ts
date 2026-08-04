import { summarySourceSchema } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { fixSpecPayload, findingCountRow, RENDERABLE_SURFACE } from "../helpers/fix-spec-payload";
import { createFindingPayloadsRepo } from "../../src/repositories/finding-payloads.repo";
import { createFindingsRepo } from "../../src/repositories/findings.repo";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, seedAnalysisRun, seedOrgWithOwner, seedProject } from "../../src/testing";

const NAMES = laneNames("finding-payloads");

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const SIGNATURE = sha256Hex("finding-payloads.repo.test:payload-write-fails");

describe("finding payloads repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("persists the finding even when its payload row cannot be written", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("write-fails"),
      userName: NAMES.userName("write-fails"),
      email: NAMES.email("write-fails"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("write-fails"),
    });
    const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });
    const findings = createFindingsRepo(db, org.ctx);

    const written = await findings.persist({
      projectId: project.id,
      runId: run.id,
      signature: SIGNATURE,
      signatureVersion: 1,
      summarySource: summarySourceSchema.enum.model_rendered,
      headline: "Two of every three people stop at the payment step",
      context: ["Of 28 people who reached the payment step, 19 did not finish."],
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

    // Without this leg the forced failure below is indistinguishable from a payload write
    // that never works at all, and the whole assertion passes for the wrong reason.
    const liveRepo = createFindingPayloadsRepo(db, org.ctx);
    const stored = await liveRepo.upsertFor({
      findingId: written.id,
      payload: fixSpecPayload(),
    });
    expect(stored.findingId).toBe(written.id);
    expect((await liveRepo.findForFinding(written.id))?.id).toBe(stored.id);

    const dead = await createTestDb();
    await dead.close();

    let payloadWriteFailed = false;
    try {
      await createFindingPayloadsRepo(dead.db, org.ctx).upsertFor({
        findingId: written.id,
        payload: fixSpecPayload(),
      });
    } catch {
      payloadWriteFailed = true;
    }
    expect(payloadWriteFailed).toBe(true);

    expect((await findings.findBySignature(project.id, SIGNATURE))?.id).toBe(written.id);
  });
});
