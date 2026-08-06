import {
  FIX_RESULTS_RULE_VERSION,
  FIX_RESULTS_WINDOW_DAYS,
  summarySourceSchema,
  type TenantContext,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import { findingCountRow, RENDERABLE_SURFACE } from "../helpers/fix-spec-payload";
import { createFindingsRepo } from "../../src/repositories/findings.repo";
import { createFixesRepo, type ClaimFixInput } from "../../src/repositories/fixes.repo";
import type { ScopedExecutor } from "../../src/repositories/types";
import * as schema from "../../src/schema";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import {
  laneNames,
  scannedTextFor,
  seedAnalysisRun,
  seedOrgWithOwner,
  seedProject,
  type SeededOrgWithOwner,
} from "../../src/testing";

const CLEAN_TEXT = scannedTextFor("Two of every three people stop at the payment step", [
  "Of 28 people who reached the payment step, 19 did not finish.",
]);

const NAMES = laneNames("fixes-repo");

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const OPENED_AT = new Date("2026-08-03T09:00:00.000Z");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RESULTS_BY = new Date(OPENED_AT.getTime() + FIX_RESULTS_WINDOW_DAYS * MS_PER_DAY);

interface SeededFinding {
  readonly org: SeededOrgWithOwner;
  readonly projectId: string;
  readonly findingId: string;
}

async function seedFindingIn(
  db: TestDb,
  org: SeededOrgWithOwner,
  label: string,
): Promise<SeededFinding> {
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });
  const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });

  const finding = await createFindingsRepo(db, org.ctx).persist({
    projectId: project.id,
    runId: run.id,
    signature: sha256Hex(`fixes.repo.test:${label}`),
    signatureVersion: 1,
    detector: "funnel_dropoff",
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
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

  return { org, projectId: project.id, findingId: finding.id };
}

async function seedFinding(db: TestDb, label: string): Promise<SeededFinding> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });

  return seedFindingIn(db, org, label);
}

function claimInput(seeded: SeededFinding, ctx: TenantContext): ClaimFixInput {
  return {
    projectId: seeded.projectId,
    findingId: seeded.findingId,
    openedAt: OPENED_AT,
    openedBy: ctx.userId,
    resultsBy: RESULTS_BY,
    resultsByRuleVersion: FIX_RESULTS_RULE_VERSION,
  };
}

// A second handle on the same PGlite instance, logging every statement it emits, so the
// "org filter and id in the SAME query" claim is read off the SQL rather than inferred
// from a null.
function loggingExecutor(db: TestDb): { executor: ScopedExecutor; statements: string[] } {
  const statements: string[] = [];
  const executor = drizzle(db.$client, {
    schema,
    casing: "snake_case",
    logger: {
      logQuery(query: string): void {
        statements.push(query);
      },
    },
  });

  return { executor, statements };
}

describe("fixes repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("creates a fix row scoped to the minting organization", async () => {
    const seeded = await seedFinding(db, "scoped-mint");
    const input = claimInput(seeded, seeded.org.ctx);

    expect(Object.keys(input)).not.toContain("organizationId");
    expect(Object.keys(input)).not.toContain("orgId");

    const claimed = await createFixesRepo(db, seeded.org.ctx).claimFor(input);

    expect(claimed.claimed).toBe(true);
    expect(claimed.row?.organizationId).toBe(seeded.org.organizationId);
    expect(claimed.row?.projectId).toBe(seeded.projectId);
    expect(claimed.row?.findingId).toBe(seeded.findingId);
  });

  it("refuses a fix read for an organization that does not own it", async () => {
    const seeded = await seedFinding(db, "foreign-read");
    const other = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("foreign-read-b"),
      userName: NAMES.userName("foreign-read-b"),
      email: NAMES.email("foreign-read-b"),
    });

    const claimed = await createFixesRepo(db, seeded.org.ctx).claimFor(
      claimInput(seeded, seeded.org.ctx),
    );
    const fixId = claimed.row?.id;
    if (fixId === undefined) throw new Error("expected claimFor to return the minted row");

    expect(await createFixesRepo(db, other.ctx).findById(fixId)).toBeNull();
    expect((await createFixesRepo(db, seeded.org.ctx).findById(fixId))?.id).toBe(fixId);
  });

  it("returns null rather than another organization's fix row", async () => {
    const seeded = await seedFinding(db, "same-query");
    const other = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("same-query-b"),
      userName: NAMES.userName("same-query-b"),
      email: NAMES.email("same-query-b"),
    });

    await createFixesRepo(db, seeded.org.ctx).claimFor(claimInput(seeded, seeded.org.ctx));

    const { executor, statements } = loggingExecutor(db);
    const foreign = await createFixesRepo(executor, other.ctx).findForFinding(seeded.findingId);

    expect(foreign).toBeNull();

    const reads = statements.filter((statement) => /\bfrom\s+"?fixes"?/i.test(statement));
    expect(reads.length).toBeGreaterThan(0);
    for (const statement of reads) {
      expect(statement).toContain("organization_id");
      expect(statement).toContain("finding_id");
    }
  });

  it("counts only this organization's open fixes", async () => {
    const mine = await seedFinding(db, "count-mine");
    const sibling = await seedFindingIn(db, mine.org, "count-sibling");
    const theirs = await seedFinding(db, "count-theirs");

    await createFixesRepo(db, mine.org.ctx).claimFor(claimInput(mine, mine.org.ctx));
    await createFixesRepo(db, theirs.org.ctx).claimFor(claimInput(theirs, theirs.org.ctx));

    const mineRepo = createFixesRepo(db, mine.org.ctx);
    expect(await mineRepo.countOpen({ projectId: null })).toBe(1);
    expect(await mineRepo.countOpen({ projectId: mine.projectId })).toBe(1);
    expect(await mineRepo.countOpen({ projectId: sibling.projectId })).toBe(0);

    await db.execute(
      sql`update fixes set status = 'withdrawn' where organization_id = ${mine.org.organizationId}`,
    );

    expect(await mineRepo.countOpen({ projectId: null })).toBe(0);
    expect(await createFixesRepo(db, theirs.org.ctx).countOpen({ projectId: null })).toBe(1);
  });
});
