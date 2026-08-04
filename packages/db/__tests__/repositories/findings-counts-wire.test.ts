import { mcpMeasuredCountSchema, summarySourceSchema } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { findingCountRow, RENDERABLE_SURFACE } from "../helpers/fix-spec-payload";
import { createFindingsRepo } from "../../src/repositories/findings.repo";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, seedAnalysisRun, seedOrgWithOwner, seedProject } from "../../src/testing";

const NAMES = laneNames("counts-wire");

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const SIGNATURE = sha256Hex("findings-counts-wire.test:first-count");

// A runtime specifier rather than a static import: `packages/db` must not take a build-time
// dependency on the web app, and the mapper under test has to be the shipped one, not a
// second copy written here.
const DTO_MODULE = "../../../../apps/web/lib/mcp/dto";

type WireMapper = (row: unknown) => unknown;

async function loadWireMapper(): Promise<WireMapper> {
  const specifier: string = DTO_MODULE;
  const loaded = (await import(specifier)) as { toMcpMeasuredCount?: unknown };

  if (typeof loaded.toMcpMeasuredCount !== "function") {
    throw new Error("apps/web/lib/mcp/dto.ts must export toMcpMeasuredCount");
  }

  return loaded.toMcpMeasuredCount as WireMapper;
}

describe("a persisted finding's counts reach the MCP wire", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("parses a real persisted finding's first count through the MCP measured-count schema", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("first-count"),
      userName: NAMES.userName("first-count"),
      email: NAMES.email("first-count"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("first-count"),
    });
    const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });
    const repo = createFindingsRepo(db, org.ctx);

    await repo.persist({
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
      counts: [findingCountRow(19, 28), findingCountRow(28, 28)],
      confidenceBasis: "28 kept sessions in a seven-day window",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      evidenceShape: `funnel_dropoff:surface=${RENDERABLE_SURFACE}`,
      evidenceShapeVersion: 1,
      resolvedModelId: "claude-sonnet-5",
    });

    const readBack = await repo.findBySignature(project.id, SIGNATURE);
    const persisted = readBack?.counts[0];
    if (persisted === undefined) {
      throw new Error("expected the persisted finding to carry at least one count");
    }
    expect(persisted.timeframe.start).toBeInstanceOf(Date);

    const toMcpMeasuredCount = await loadWireMapper();
    const wire = mcpMeasuredCountSchema.parse(toMcpMeasuredCount(persisted));

    const setAsideTotal = wire.basis.setAside.reduce((sum, row) => sum + row.count, 0);
    expect(wire.basis.kept + setAsideTotal).toBe(wire.basis.totalInWindow);
    expect(wire.denominator).toBe(wire.basis.kept);
    expect(wire.numerator).toBeLessThanOrEqual(wire.denominator);
    expect(Date.parse(wire.timeframe.end)).toBeGreaterThanOrEqual(Date.parse(wire.timeframe.start));

    expect(wire.timeframe.start).toBe(WINDOW_START.toISOString());
    expect(wire.timeframe.end).toBe(WINDOW_END.toISOString());
    expect(wire.numerator).toBe(19);
    expect(wire.denominator).toBe(28);
  });
});
