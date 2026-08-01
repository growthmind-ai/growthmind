// Wave 0 (red), `model-lane-above-the-floor`, lane fixture prefix `db-al-`. Add
// docs/adds/model-lane-above-the-floor.md "DB, tenancy/analysis-lane.tenancy.test.ts"
// , /; prd and the row of "Edge Cases & Failure Modes".
//
// Why this file exists. adds the first analysis-side writes (`findings` and
// `analysis_runs`) and the writer is a Graphile Worker task that runs with no user.
// That is precisely "the path that steps outside the tenant context flow": there is no
// session, no request, and nothing upstream of the repository that a route guard could
// have narrowed. The org filter on every statement is therefore the entire tenant
// boundary for this lane, exactly as `tenancy/queries.test.ts` is for the bootstrap
// reads.
//
// The one test this file owns (DB3, name is contractual): "org A's analysis run can
// neither read org B's sessions nor write into
//  org B's findings or analysis runs"
// plus the structural guardrails that behaviour cannot make total: no bypass context is
// reachable from the lane, no method takes an organization id, and every query in the
// two new repositories names `ctx.organizationId` out loud.
//
// Non-vacuity discipline. Every negative assertion here is preceded by org b writing
// the same data through org b's own context. Without that, "the cross-org read returned
// nothing" is satisfied by a fixture that was never written at all. A green test
// proving nothing. The paired positive read, under B's own context, is what tells the
// two apart.
//
// Every instant is a fixture constant; nothing here reads a clock.
//
// Red state, expected: `../../src/repositories/findings.repo`,
// `../../src/repositories/analysis-runs.repo` and their schema tables do not exist yet
// (Wave 2 lands them). Until then this file fails on the missing modules. That IS the
// Wave 0 success condition.
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
import { laneNames, seedEvent, seedSession } from "../helpers/db-lane-fixtures";
import { seedConnection, seedOrgWithOwner, seedProject } from "../helpers/fixtures";

// `al`, the analysis lane. No other suite in this package uses this token, so no org
// name, email, project name, session key or signature here can collide with the xt / dc
// / ev / pc / se / sym / claim / sys / sl lanes.
const NAMES = laneNames("al");

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DB_SRC = path.join(REPO_ROOT, "packages", "db", "src");

const TICK_AT = new Date("2026-08-01T09:00:00.000Z");
const WINDOW_START = new Date("2026-07-25T00:00:00.000Z");
const WINDOW_END = new Date("2026-08-01T00:00:00.000Z");

const SESSION_KEY_B = "ph:db-al-org-b-session";
const SOURCE_EVENT_ID_B = "db-al-org-b-event-0001";
const SIGNATURE_B = sha256Hex("db-al:org-b-candidate-0001");

/**
 * The `counts` fixture. Cast rather than declared: the persisted count row shape is
 * Wave 2's to define, and pinning a guess here would make this file (a tenancy suite)
 * the thing Wave 2 has to edit to land its own type. The counts are never the subject
 * of any assertion below; only which org the row lands in is.
 */
const FIXTURE_COUNTS = [
  {
    numerator: 3,
    denominator: 40,
    unit: "sessions",
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    basis: { totalInWindow: 40, kept: 40, setAside: [] },
  },
] as unknown as readonly MeasuredCountRow[];

/** A complete `PersistFindingInput` bar the two fields each test varies. */
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
    headline: "Fewer people finished checkout than started it.",
    context: ["3 of 40 sessions that reached checkout did not finish."],
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

/** One org, one project, one connection. Both orgs get the identical shape, so the only
 * variable across the legs below is which context issues the call. */
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

/** Strips comments, so prose promising `ctx.organizationId` can never satisfy a source
 * assertion about the code. Same helper shape as `repositories/cross-tenant.test.ts`. */
function stripSourceComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** How many times a pattern occurs in a source file. */
function countOf(code: string, pattern: RegExp): number {
  return (code.match(pattern) ?? []).length;
}

/**
 * Every claim row in the ledger, unfiltered by organization. Deliberately not a scoped
 * read.
 *
 * A row that landed under the wrong organization is invisible to a query that filters
 * by the organization it should have landed under, so the assertion that catches a
 * dropped org predicate must not itself use one. The caller filters the returned rows
 * in memory, by org and by project, so both halves of a mis-stamped row are visible.
 */
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

  // -- DB3, the headline, all three legs in one test
  it("org A's analysis run can neither read org B's sessions nor write into org B's findings or analysis runs", async () => {
    const orgA = await seedOrg(db, "db3-a");
    const orgB = await seedOrg(db, "db3-b");

    // Arrange, org B's data, written through org b's own path. Every negative assertion
    // below is meaningless without this: it is what distinguishes "correctly filtered"
    // from "the fixture was never written".
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

    // The arrange really landed: org B can see its own finding through its own scoped
    // read. Without this line every "null" below could be a no-op write.
    expect(
      await createFindingsRepo(db, orgB.ctx).findBySignature(orgB.projectId, SIGNATURE_B),
    ).not.toBeNull();
    expect(findingB.organizationId).toBe(orgB.organizationId);

    // -- leg 1, org A's lane context reads none of org B's corpus This is the read the
    // analysis lane makes to build its candidates. A session or event of org B's
    // reaching org A's run is evidence from another company's product inside org A's
    // finding.
    const sessionsA = createSessionsRepo(db, orgA.ctx);
    expect(await sessionsA.listForProject(orgB.projectId, { limit: 50 })).toEqual([]);
    expect(await sessionsA.findByKey(orgB.projectId, SESSION_KEY_B)).toBeNull();

    const eventsA = createEventsRepo(db, orgA.ctx);
    expect(await eventsA.listForProject(orgB.projectId, { limit: 50 })).toEqual([]);
    expect(await eventsA.listForSession(sessionB.id, { limit: 50 })).toEqual([]);

    // -- leg 2, org A cannot write a finding into org B A rejection or a row that lands
    // under org A are both acceptable. A silent success under org B is not, and only
    // the read-back can tell the difference, so the read-back is what decides this leg.
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
      // If it did not refuse, it stamped org a, never the project's owner.
      expect(persisted?.organizationId).toBe(orgA.organizationId);
      expect(persisted?.organizationId).not.toBe(orgB.organizationId);
    }

    // Org B's own row is untouched: still exactly one, still B's, still the headline B
    // wrote.
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

    // And nothing of org A's is reachable from org B's project through B's own scoped
    // read either. The boundary is not one-sided.
    expect(
      await createFindingsRepo(db, orgA.ctx).findBySignature(orgB.projectId, SIGNATURE_B),
    ).toBeNull();
    expect(
      await createFindingsRepo(db, orgA.ctx).listForProject(orgB.projectId, { limit: 50 }),
    ).toEqual([]);

    // -- leg 3, org A cannot write an analysis run into org B
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
    // Still exactly org B's own run. If org A's open had landed here it would also have
    // silently consumed org B's single-open-run slot. A cross-tenant write and a denial
    // of service in one statement.
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

    // The cap claim is the third write this lane makes, and it is the one statement
    // with count subqueries. The likeliest place for a dropped org predicate to hide,
    // because a widened count is invisible in its return value. Org A claiming against
    // org B's project must never consume, or collide with, org B's budget under either
    // ceiling: both are passed wide here, so if a row lands it is a tenancy fault and
    // never a budget refusal.
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

    // Read the ledger from both sides, and keyed on the project. Asking only "did a row
    // land under org B's organization_id?" cannot fail on the defect this leg names.
    // Delete the claim's `exists (select 1 from projects p … p.organization_id = …)`
    // conjunct and the forged row lands under org a's organization_id while naming org
    // b's project: org B's count is still zero and that assertion still passes.
    //
    // Such a row is not harmless. `analysis_model_calls.project_id` is `ON DELETE
    // cascade`, so org B deleting its own project would silently delete org A's claim
    // rows and refund budget org A had already spent. Exactly the silent refund
    // `../../src/schema/analysis-model-calls.ts`'s lifetime window header says must
    // never happen. So the row named by the project is what decides this leg, and org
    // A's own side is read too.
    const afterCrossOrgClaim = await allClaimRows(db);
    expect(afterCrossOrgClaim.filter((row) => row.projectId === orgB.projectId)).toHaveLength(0);
    expect(
      afterCrossOrgClaim.filter((row) => row.organizationId === orgA.organizationId),
    ).toHaveLength(0);
    expect(
      afterCrossOrgClaim.filter((row) => row.organizationId === orgB.organizationId),
    ).toHaveLength(0);

    // The positive control, the same call, differing only in whose project it names.
    // Without it the three zeroes above are satisfied by a claim that never lands for
    // anybody, which is a green test proving nothing (the non-vacuity discipline this
    // file's header states).
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
    // And the org-B side is still untouched, one org's legitimate claim never appears
    // against the other's project.
    expect(afterOwnClaim.filter((row) => row.projectId === orgB.projectId)).toHaveLength(0);
    expect(afterOwnClaim.filter((row) => row.organizationId === orgB.organizationId)).toHaveLength(
      0,
    );
  });

  // --, a client-supplied id never widens scope
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

    // Non-vacuity: org A's own scoped read finds it under org A's own project.
    expect(
      await createFindingsRepo(db, orgA.ctx).findBySignature(orgA.projectId, signature),
    ).not.toBeNull();

    // The failure this guards is not only a cross-org read. It is a project predicate
    // that gets dropped, which would hand org A its own finding back under someone
    // else's project id, and let a lane attribute a finding to a product it did not
    // come from.
    expect(
      await createFindingsRepo(db, orgA.ctx).findBySignature(orgB.projectId, signature),
    ).toBeNull();
    expect(
      await createFindingsRepo(db, orgA.ctx).listForProject(orgB.projectId, { limit: 50 }),
    ).toEqual([]);

    // The mirror direction.
    expect(
      await createFindingsRepo(db, orgB.ctx).findBySignature(orgA.projectId, signature),
    ).toBeNull();
    expect(
      await createFindingsRepo(db, orgB.ctx).listForProject(orgA.projectId, { limit: 50 }),
    ).toEqual([]);
  });

  // -- the same signature in two orgs is two findings
  it("scopes the finding signature per organization, so two orgs' identical signatures never collide", async () => {
    const orgA = await seedOrg(db, "key-a");
    const orgB = await seedOrg(db, "key-b");
    // The walker derives this signature from the candidate's own content, and the tuple
    // it hashes carries no organization, so two customers with the same problem on the
    // same page path will produce the same string. If the unique index is not
    // `(organization_id, project_id, signature)`, whichever org runs second silently
    // gets the other's finding back from the on conflict read.
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

    // Each org reads back its own row under the shared signature.
    expect(
      (await createFindingsRepo(db, orgA.ctx).findBySignature(orgA.projectId, sharedSignature))?.id,
    ).toBe(findingA.id);
    expect(
      (await createFindingsRepo(db, orgB.ctx).findBySignature(orgB.projectId, sharedSignature))?.id,
    ).toBe(findingB.id);
  });
});

// The structural half. Behaviour cannot make these total: a repository that establishes
// tenancy by joining an already-scoped table passes every test above and is one
// refactor away from establishing none, and a bypass context imported into the lane
// leaves no behavioural trace at all until the day it leaks. Same discipline as
// `system/reachability.test.ts` (items 83–85) and the source assertion in
// `repositories/cross-tenant.test.ts`.
describe("no bypass context is reachable from the analysis lane", () => {
  const LANE_SOURCES = [
    path.join(DB_SRC, "repositories", "findings.repo.ts"),
    path.join(DB_SRC, "repositories", "analysis-runs.repo.ts"),
  ];

  it("names no system/bypass context in either analysis repository", () => {
    for (const file of LANE_SOURCES) {
      const source = readFileSync(file, "utf8");
      const code = stripSourceComments(source);

      // Not vacuous: the file was really read and really is the repository.
      expect(source.length).toBeGreaterThan(0);
      expect(code).toMatch(/export function create(Findings|AnalysisRuns)Repo/);

      // The worker legitimately runs with no user, which is exactly why the sentinel
      // must be minted once, in `src/system/`, from a claimed row, and never reached
      // for from inside a scoped repository.
      expect(code).not.toMatch(/\bSYSTEM_ACTOR\b/);
      expect(code).not.toMatch(/\bsystemContextFor\b/);
      expect(code).not.toMatch(/\bsystemTenantContextFor\b/);
      expect(code).not.toMatch(/from\s+["'](\.\.\/)+system/);
    }
  });

  it("takes an organization id as a parameter on no method of either analysis repository", () => {
    for (const file of LANE_SOURCES) {
      const code = stripSourceComments(readFileSync(file, "utf8"));

      // Org scope comes from the injected `TenantContext` at construction, and from
      // nowhere else. An `organizationId` parameter is an id-only path with extra
      // steps. The exact shape of the sibling cross-tenant incident.
      // `no-org-param.test.ts` enforces this package-wide; this is the same rule stated
      // where the analysis lane's own reviewer will see it.
      expect(code).toContain("ctx: TenantContext");
      expect(code).not.toMatch(/organizationId\s*[?]?\s*:\s*string/);
    }
  });

  it("names ctx.organizationId on every query in both analysis repositories", () => {
    // A count, not a match. `.from(findings)` appears on several reads, and a single
    // `toMatch` passes while one of them has had its org predicate dropped. The
    // expected count is derived from the source, so a query added in a later sprint
    // raises the bar automatically instead of arriving uncovered.
    //
    // Every statement, not every read. An earlier revision counted only the builder
    // reads and so covered neither the writes nor the raw-SQL claim, which is the
    // named standing hazard, because a widened count subquery is invisible in the
    // claim's return value. Reads, inserts, updates and both hand-written aggregations
    // are each counted below.
    const findingsCode = stripSourceComments(readFileSync(LANE_SOURCES[0] as string, "utf8"));
    const findingReads = countOf(findingsCode, /\.from\(\s*findings\s*\)/g);
    expect(findingReads).toBeGreaterThan(0);
    expect(
      countOf(findingsCode, /eq\(\s*findings\.organizationId\s*,\s*ctx\.organizationId\s*\)/g),
    ).toBe(findingReads);

    // The write. `findings` is stamped, not filtered, on the way in. An insert that
    // omits the column is the same tenancy hole one statement earlier.
    const findingWrites = countOf(findingsCode, /\.insert\(\s*findings\s*\)/g);
    expect(findingWrites).toBeGreaterThan(0);
    expect(countOf(findingsCode, /organizationId:\s*ctx\.organizationId/g)).toBe(findingWrites);

    const runsCode = stripSourceComments(readFileSync(LANE_SOURCES[1] as string, "utf8"));

    // The builder half, counted through the helper rather than the literal `eq`.
    // `analysis-runs.repo.ts` hoists its predicate into `ownedByCallerOrg`, so
    // counting the literal would compare one read against one definition and pass by
    // coincidence, and would then fail on correct code the moment a second, correctly
    // scoped statement was added.
    const runStatements =
      countOf(runsCode, /\.from\(\s*analysisRuns\s*\)/g) +
      countOf(runsCode, /\.update\(\s*analysisRuns\s*\)/g);
    expect(runStatements).toBeGreaterThan(0);
    expect(countOf(runsCode, /ownedByCallerOrg\(\)/g)).toBe(runStatements);

    const runWrites = countOf(runsCode, /\.insert\(\s*analysisRuns\s*\)/g);
    expect(runWrites).toBeGreaterThan(0);
    expect(countOf(runsCode, /organizationId:\s*ctx\.organizationId/g)).toBe(runWrites);

    // The disambiguating read on the claim ledger. A different table, and so a
    // predicate of its own that no helper covers.
    const claimReads = countOf(runsCode, /\.from\(\s*analysisModelCalls\s*\)/g);
    expect(claimReads).toBeGreaterThan(0);
    expect(
      countOf(
        runsCode,
        /eq\(\s*analysisModelCalls\.organizationId\s*,\s*ctx\.organizationId\s*\)/g,
      ),
    ).toBe(claimReads);

    // The ownership guard both repositories run against `projects` before a
    // client-supplied project id is trusted.
    for (const code of [findingsCode, runsCode]) {
      const projectReads = countOf(code, /\.from\(\s*projects\s*\)/g);
      expect(projectReads).toBeGreaterThan(0);
      expect(countOf(code, /eq\(\s*projects\.organizationId\s*,\s*ctx\.organizationId\s*\)/g)).toBe(
        projectReads,
      );
    }

    // The raw-sql half, the cap claim, which the builder counts above cannot see at
    // all. Its two count subqueries are hand-written aggregations, and nothing about
    // sitting inside a scoped repository's statement gives a subquery tenancy: each
    // must name the caller's organization itself, or the count silently spans every
    // customer's claims.
    const claimAggregations = countOf(runsCode, /from\s+analysis_model_calls\s+c\b/g);
    expect(claimAggregations).toBeGreaterThan(0);
    expect(countOf(runsCode, /c\.organization_id\s*=\s*\$\{ctx\.organizationId\}/g)).toBe(
      claimAggregations,
    );

    // And the claim's own project-ownership conjunct, which is what stops a row landing
    // under one org while naming another's project.
    const claimProjectGuards = countOf(runsCode, /from\s+projects\s+p\b/g);
    expect(claimProjectGuards).toBeGreaterThan(0);
    expect(countOf(runsCode, /p\.organization_id\s*=\s*\$\{ctx\.organizationId\}/g)).toBe(
      claimProjectGuards,
    );
  });
});
