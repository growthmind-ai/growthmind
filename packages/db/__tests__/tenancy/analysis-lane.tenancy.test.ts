import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

import { createAnalysisRunsRepo } from "../../src/repositories/analysis-runs.repo";
import {
  createFindingsRepo,
  type MeasuredCountRow,
  type PersistFindingInput,
} from "../../src/repositories/findings.repo";
import { createEventsRepo } from "../../src/repositories/events.repo";
import { createSessionsRepo } from "../../src/repositories/sessions.repo";
import * as schema from "../../src/schema";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, seedEvent, seedSession } from "../../src/testing";
import { scannedTextFor, seedConnection, seedOrgWithOwner, seedProject } from "../../src/testing";

const NAMES = laneNames("al");

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DB_SRC = path.join(REPO_ROOT, "packages", "db", "src");

const TICK_AT = new Date("2026-08-01T09:00:00.000Z");
const WINDOW_START = new Date("2026-07-25T00:00:00.000Z");
const WINDOW_END = new Date("2026-08-01T00:00:00.000Z");

const SESSION_KEY_B = "ph:db-al-org-b-session";
const SOURCE_EVENT_ID_B = "db-al-org-b-event-0001";
const SIGNATURE_B = sha256Hex("db-al:org-b-candidate-0001");

const FIXTURE_COUNTS = [
  {
    numerator: 3,
    denominator: 40,
    unit: "sessions",
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    basis: { totalInWindow: 40, kept: 40, setAside: [] },
  },
] as unknown as readonly MeasuredCountRow[];

const CLEAN_TEXT = scannedTextFor("Fewer people finished checkout than started it.", [
  "3 of 40 sessions that reached checkout did not finish.",
]);

function findingInput(params: {
  projectId: string;
  signature: string;
  runId: string;
}): PersistFindingInput {
  return {
    projectId: params.projectId,
    signature: params.signature,
    signatureVersion: 1,
    runId: params.runId,
    summarySource: "floor_no_key_configured",
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
    finalClass: "drop_off",
    surface: "/checkout",
    surfaceNormalisationVersion: 2,
    counts: FIXTURE_COUNTS,
    confidenceBasis: "40 sessions in this window",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: "drop_off:v1",
    evidenceShapeVersion: 1,
    resolvedModelId: null,
    tokensIn: null,
    tokensOut: null,
  };
}

interface Org {
  ctx: TenantContext;
  organizationId: string;
  projectId: string;
  connectionId: string;
}

async function seedOrg(db: TestDb, label: string): Promise<Org> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(`${label}-owner`),
    email: NAMES.email(`${label}-owner`),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });
  const connection = await seedConnection(db, {
    organizationId: org.organizationId,
    projectId: project.id,
  });

  return {
    ctx: org.ctx,
    organizationId: org.organizationId,
    projectId: project.id,
    connectionId: connection.id,
  };
}

function stripSourceComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function countOf(code: string, pattern: RegExp): number {
  return (code.match(pattern) ?? []).length;
}

// A where clause is scoped when it comes from the scope helper, or from a local predicate this
// suite separately proves is built from it.
const SCOPE_DERIVED = /^(s\.(owned|org)\(|and\(\s*(s\.(owned|org)\(|bySignature\()|bySignature\()/;

function whereArguments(code: string): string[] {
  const clauses: string[] = [];
  const head = /\.where\(/g;

  let match: RegExpExecArray | null = head.exec(code);
  while (match !== null) {
    const openIndex = match.index + match[0].length - 1;
    let depth = 0;

    for (let i = openIndex; i < code.length; i += 1) {
      if (code[i] === "(") {
        depth += 1;
      } else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          clauses.push(code.slice(openIndex + 1, i));
          break;
        }
      }
    }

    match = head.exec(code);
  }

  return clauses;
}

async function allClaimRows(
  db: TestDb,
): Promise<(typeof schema.analysisModelCalls.$inferSelect)[]> {
  const rows = await db.select().from(schema.analysisModelCalls);
  return rows;
}

describe("the analysis lane's tenant boundary (DB3)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("org A's analysis run can neither read org B's sessions nor write into org B's findings or analysis runs", async () => {
    const orgA = await seedOrg(db, "db3-a");
    const orgB = await seedOrg(db, "db3-b");

    const sessionB = await seedSession(db, {
      organizationId: orgB.organizationId,
      projectId: orgB.projectId,
      connectionId: orgB.connectionId,
      sessionKey: SESSION_KEY_B,
      startedAt: new Date("2026-07-28T10:00:00.000Z"),
    });
    await seedEvent(db, {
      organizationId: orgB.organizationId,
      projectId: orgB.projectId,
      connectionId: orgB.connectionId,
      sessionId: sessionB.id,
      sourceEventId: SOURCE_EVENT_ID_B,
    });

    const runB = await createAnalysisRunsRepo(db, orgB.ctx).open({
      projectId: orgB.projectId,
      tickAt: TICK_AT,
    });
    const findingB = await createFindingsRepo(db, orgB.ctx).persist(
      findingInput({
        projectId: orgB.projectId,
        signature: SIGNATURE_B,
        runId: runB.run.id,
      }),
    );

    expect(
      await createFindingsRepo(db, orgB.ctx).findBySignature(orgB.projectId, SIGNATURE_B),
    ).not.toBeNull();
    expect(findingB.organizationId).toBe(orgB.organizationId);

    const sessionsA = createSessionsRepo(db, orgA.ctx);
    expect(await sessionsA.listForProject(orgB.projectId, { limit: 50 })).toEqual([]);
    expect(await sessionsA.findByKey(orgB.projectId, SESSION_KEY_B)).toBeNull();

    const eventsA = createEventsRepo(db, orgA.ctx);
    expect(await eventsA.listForProject(orgB.projectId, { limit: 50 })).toEqual([]);
    expect(await eventsA.listForSession(sessionB.id, { limit: 50 })).toEqual([]);

    let persistError: unknown;
    let persisted:
      Awaited<ReturnType<ReturnType<typeof createFindingsRepo>["persist"]>> | undefined;
    try {
      persisted = await createFindingsRepo(db, orgA.ctx).persist(
        findingInput({
          projectId: orgB.projectId,
          signature: SIGNATURE_B,
          runId: runB.run.id,
        }),
      );
    } catch (error) {
      persistError = error;
    }
    if (persistError === undefined) {
      expect(persisted?.organizationId).toBe(orgA.organizationId);
      expect(persisted?.organizationId).not.toBe(orgB.organizationId);
    }

    const bFindings = await db
      .select()
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.organizationId, orgB.organizationId),
          eq(schema.findings.projectId, orgB.projectId),
        ),
      );
    expect(bFindings).toHaveLength(1);
    expect(bFindings[0]?.id).toBe(findingB.id);

    expect(
      await createFindingsRepo(db, orgA.ctx).findBySignature(orgB.projectId, SIGNATURE_B),
    ).toBeNull();
    expect(
      await createFindingsRepo(db, orgA.ctx).listForProject(orgB.projectId, { limit: 50 }),
    ).toEqual([]);

    let openError: unknown;
    let openedByA:
      Awaited<ReturnType<ReturnType<typeof createAnalysisRunsRepo>["open"]>> | undefined;
    try {
      openedByA = await createAnalysisRunsRepo(db, orgA.ctx).open({
        projectId: orgB.projectId,
        tickAt: TICK_AT,
      });
    } catch (error) {
      openError = error;
    }

    const bRuns = await db
      .select()
      .from(schema.analysisRuns)
      .where(
        and(
          eq(schema.analysisRuns.organizationId, orgB.organizationId),
          eq(schema.analysisRuns.projectId, orgB.projectId),
        ),
      );

    expect(bRuns).toHaveLength(1);
    expect(bRuns[0]?.id).toBe(runB.run.id);

    if (openError === undefined) {
      expect(openedByA?.run.id).not.toBe(runB.run.id);
      const aRuns = await db
        .select()
        .from(schema.analysisRuns)
        .where(eq(schema.analysisRuns.organizationId, orgA.organizationId));
      expect(aRuns.every((row) => row.organizationId === orgA.organizationId)).toBe(true);
    }

    try {
      await createAnalysisRunsRepo(db, orgA.ctx).claimModelCall({
        projectId: orgB.projectId,
        runId: runB.run.id,
        signature: SIGNATURE_B,
        signatureVersion: 1,
        projectCap: 5,
        organizationCap: 5,
        at: TICK_AT,
      });
    } catch {
      // A refusal is acceptable; the read-back below is what decides.
    }

    const afterCrossOrgClaim = await allClaimRows(db);
    expect(afterCrossOrgClaim.filter((row) => row.projectId === orgB.projectId)).toHaveLength(0);
    expect(
      afterCrossOrgClaim.filter((row) => row.organizationId === orgA.organizationId),
    ).toHaveLength(0);
    expect(
      afterCrossOrgClaim.filter((row) => row.organizationId === orgB.organizationId),
    ).toHaveLength(0);

    const runA = await createAnalysisRunsRepo(db, orgA.ctx).open({
      projectId: orgA.projectId,
      tickAt: TICK_AT,
    });
    expect(
      await createAnalysisRunsRepo(db, orgA.ctx).claimModelCall({
        projectId: orgA.projectId,
        runId: runA.run.id,
        signature: SIGNATURE_B,
        signatureVersion: 1,
        projectCap: 5,
        organizationCap: 5,
        at: TICK_AT,
      }),
    ).toEqual({ claimed: true });

    const afterOwnClaim = await allClaimRows(db);
    const aClaims = afterOwnClaim.filter((row) => row.organizationId === orgA.organizationId);
    expect(aClaims).toHaveLength(1);
    expect(aClaims[0]?.projectId).toBe(orgA.projectId);

    expect(afterOwnClaim.filter((row) => row.projectId === orgB.projectId)).toHaveLength(0);
    expect(afterOwnClaim.filter((row) => row.organizationId === orgB.organizationId)).toHaveLength(
      0,
    );
  });

  it("a foreign project id supplied to the analysis repositories widens nothing in either direction", async () => {
    const orgA = await seedOrg(db, "foreign-a");
    const orgB = await seedOrg(db, "foreign-b");

    const runA = await createAnalysisRunsRepo(db, orgA.ctx).open({
      projectId: orgA.projectId,
      tickAt: TICK_AT,
    });
    const signature = sha256Hex("db-al:foreign-candidate-0001");
    await createFindingsRepo(db, orgA.ctx).persist(
      findingInput({ projectId: orgA.projectId, signature, runId: runA.run.id }),
    );

    expect(
      await createFindingsRepo(db, orgA.ctx).findBySignature(orgA.projectId, signature),
    ).not.toBeNull();

    expect(
      await createFindingsRepo(db, orgA.ctx).findBySignature(orgB.projectId, signature),
    ).toBeNull();
    expect(
      await createFindingsRepo(db, orgA.ctx).listForProject(orgB.projectId, { limit: 50 }),
    ).toEqual([]);

    expect(
      await createFindingsRepo(db, orgB.ctx).findBySignature(orgA.projectId, signature),
    ).toBeNull();
    expect(
      await createFindingsRepo(db, orgB.ctx).listForProject(orgA.projectId, { limit: 50 }),
    ).toEqual([]);
  });

  it("scopes the finding signature per organization, so two orgs' identical signatures never collide", async () => {
    const orgA = await seedOrg(db, "key-a");
    const orgB = await seedOrg(db, "key-b");

    const sharedSignature = sha256Hex("db-al:shared-candidate-0001");

    const runA = await createAnalysisRunsRepo(db, orgA.ctx).open({
      projectId: orgA.projectId,
      tickAt: TICK_AT,
    });
    const runB = await createAnalysisRunsRepo(db, orgB.ctx).open({
      projectId: orgB.projectId,
      tickAt: TICK_AT,
    });

    const findingA = await createFindingsRepo(db, orgA.ctx).persist(
      findingInput({ projectId: orgA.projectId, signature: sharedSignature, runId: runA.run.id }),
    );
    const findingB = await createFindingsRepo(db, orgB.ctx).persist(
      findingInput({ projectId: orgB.projectId, signature: sharedSignature, runId: runB.run.id }),
    );

    expect(findingA.id).not.toBe(findingB.id);
    expect(findingA.organizationId).toBe(orgA.organizationId);
    expect(findingB.organizationId).toBe(orgB.organizationId);

    expect(
      (await createFindingsRepo(db, orgA.ctx).findBySignature(orgA.projectId, sharedSignature))?.id,
    ).toBe(findingA.id);
    expect(
      (await createFindingsRepo(db, orgB.ctx).findBySignature(orgB.projectId, sharedSignature))?.id,
    ).toBe(findingB.id);
  });
});

describe("no bypass context is reachable from the analysis lane", () => {
  const LANE_SOURCES = [
    path.join(DB_SRC, "repositories", "findings.repo.ts"),
    path.join(DB_SRC, "repositories", "analysis-runs.repo.ts"),
  ];

  it("names no system/bypass context in either analysis repository", () => {
    for (const file of LANE_SOURCES) {
      const source = readFileSync(file, "utf8");
      const code = stripSourceComments(source);

      expect(source.length).toBeGreaterThan(0);
      expect(code).toMatch(/export function create(Findings|AnalysisRuns)Repo/);

      expect(code).not.toMatch(/\bSYSTEM_ACTOR\b/);
      expect(code).not.toMatch(/\bsystemContextFor\b/);
      expect(code).not.toMatch(/\bsystemTenantContextFor\b/);
      expect(code).not.toMatch(/from\s+["'](\.\.\/)+system/);
    }
  });

  it("takes an organization id as a parameter on no method of either analysis repository", () => {
    for (const file of LANE_SOURCES) {
      const code = stripSourceComments(readFileSync(file, "utf8"));

      expect(code).toContain("ctx: TenantContext");
      expect(code).not.toMatch(/organizationId\s*[?]?\s*:\s*string/);
    }
  });

  it("routes every query in both analysis repositories through the crud or scope helpers", () => {
    for (const file of LANE_SOURCES) {
      const code = stripSourceComments(readFileSync(file, "utf8"));

      expect(code).toMatch(/const c = orgCrud\(db, ctx, (findings|analysisRuns)\)/);

      // Any query still built beside the crud helper must take its filter from the scope
      // helper — nothing may reconstruct the org predicate by hand.
      for (const clause of whereArguments(code)) {
        expect({ file: path.basename(file), clause: clause.trim() }).toMatchObject({
          clause: expect.stringMatching(SCOPE_DERIVED),
        });
      }
      expect(code).not.toMatch(/eq\(\s*\w+\.organizationId\s*,\s*ctx\.organizationId\s*\)/);
    }
  });

  it("stamps the organization on every insert that bypasses the crud helper", () => {
    // Findings writes all go through the crud helper, which stamps; a direct insert
    // appearing here would be a write path outside the stamp.
    const findingsCode = stripSourceComments(readFileSync(LANE_SOURCES[0] as string, "utf8"));
    expect(countOf(findingsCode, /db\s*\.insert\(/g)).toBe(0);

    const runsCode = stripSourceComments(readFileSync(LANE_SOURCES[1] as string, "utf8"));
    const runWrites = countOf(runsCode, /\.insert\(\s*analysisRuns\s*\)/g);
    expect(runWrites).toBeGreaterThan(0);
    expect(countOf(runsCode, /\.\.\.s\.stamp\b/g)).toBe(runWrites);
  });

  it("proves the project-ownership guard both lanes rely on is itself org-scoped", () => {
    for (const file of LANE_SOURCES) {
      const code = stripSourceComments(readFileSync(file, "utf8"));
      expect(code).toMatch(/s\.assertProjectOwned\(/);
    }

    const scopeCode = stripSourceComments(
      readFileSync(path.join(DB_SRC, "repositories", "scope.ts"), "utf8"),
    );

    const projectReads = countOf(scopeCode, /\.from\(\s*projects\s*\)/g);
    expect(projectReads).toBeGreaterThan(0);
    expect(countOf(scopeCode, /and\(\s*org\(projects\)/g)).toBe(projectReads);
  });

  it("names ctx.organizationId in the hand-written claim aggregation, which no helper covers", () => {
    const runsCode = stripSourceComments(readFileSync(LANE_SOURCES[1] as string, "utf8"));

    const claimAggregations = countOf(runsCode, /from\s+analysis_model_calls\s+c\b/g);
    expect(claimAggregations).toBeGreaterThan(0);
    expect(countOf(runsCode, /c\.organization_id\s*=\s*\$\{ctx\.organizationId\}/g)).toBe(
      claimAggregations,
    );

    const claimProjectGuards = countOf(runsCode, /from\s+projects\s+p\b/g);
    expect(claimProjectGuards).toBeGreaterThan(0);
    expect(countOf(runsCode, /p\.organization_id\s*=\s*\$\{ctx\.organizationId\}/g)).toBe(
      claimProjectGuards,
    );
  });
});
