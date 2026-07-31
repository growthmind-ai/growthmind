// analysis_runs repository (O-011) — the persistence behind two clauses of the
// outcome's definition of done:
//
//   DB4 (FR-M19)  the persistence wire REFUSES a `summary_source` / `status` /
//                 `outcome` / `stop_reason` value the shared unions never
//                 declared. Type-level totality cannot catch a value forged at
//                 runtime past the types, so this is proven by REFUSAL — the
//                 write throws and the row is unchanged — never by writing a
//                 legal value and reading it back, which would assert nothing.
//
//   AD-4          the atomic cap claim. `claimModelCall` is ONE conditional
//                 insert with NO prior read (D6): the count subquery decides
//                 the cap and the unique index on
//                 `(organization_id, project_id, signature)` decides the
//                 retry, in a single statement. The claim is keyed on the
//                 FINDING'S IDENTITY (ADD v2 AD-20), so the ceiling counts
//                 distinct problems over the project's lifetime rather than
//                 distinct attempts within one tick. Its three answers —
//                 `{claimed:true}`, `cap_exhausted`, `already_claimed` — must
//                 never collapse into each other: a retry that read as
//                 `cap_exhausted` would make an ordinary Graphile Worker replay
//                 look like an over-spend, and a spent cap that read as
//                 `already_claimed` would let the lane believe a prior run had
//                 already written a finding that does not exist.
//
//   AD-23         the SECOND ceiling in that same statement. The per-project
//                 cap bounds nothing in aggregate — nothing limits how many
//                 projects an organisation creates — so the claim carries an
//                 organisation-wide count subquery as a second `AND` conjunct.
//                 Two properties are proven below and neither is visible from
//                 the per-project cases: a project still holding budget is
//                 refused once its ORGANISATION runs out, and one
//                 organisation's claims never consume another's, because that
//                 hand-written aggregation names `ctx.organizationId` itself
//                 rather than inheriting tenancy from the statement around it.
//
// Real SQL against the real generated migrations via `createTestDb()`'s PGlite
// instance, matching `deliveries.repo.test.ts`. That is the point for both
// blocks: an enum refusal is a CHECK/enum column and a cap claim is a unique
// index plus a subquery, and no fake can prove either.
//
// WAVE 0: `src/repositories/analysis-runs.repo.ts`, `src/repositories/findings.repo.ts`
// and their schema files do not exist yet. This file is expected to FAIL on the
// missing modules — that failure is the contract being stated before the code.
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
import {
  createFindingsRepo,
  type PersistFindingInput,
} from "../../src/repositories/findings.repo";
import { analysisModelCalls } from "../../src/schema/analysis-model-calls";
import { analysisRuns } from "../../src/schema/analysis-runs";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner, seedProject } from "../helpers/fixtures";

const TICK_AT = new Date("2026-07-31T09:00:00.000Z");
const FINISHED_AT = new Date("2026-07-31T09:04:00.000Z");
const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

/** Distinct signatures, in the shape the column really holds — 64 lowercase
 * hex characters. Deliberately NOT `computeFindingSignature`: this suite proves
 * what the CLAIM STATEMENT does with the value, and re-deriving a real identity
 * here would couple a concurrency test to a tuple serialisation it is not
 * about. What matters to every assertion below is only that A, B and C are
 * three distinct values and that the same constant used twice is the same
 * candidate twice. */
const SIGNATURE_DB4 = sha256Hex("analysis-runs.repo.test:db4");
const SIGNATURE_A = sha256Hex("analysis-runs.repo.test:candidate-a");
const SIGNATURE_B = sha256Hex("analysis-runs.repo.test:candidate-b");
const SIGNATURE_C = sha256Hex("analysis-runs.repo.test:candidate-c");

/** A distinct signature per label, in the same 64-hex shape as the four
 * constants above. The AD-23 cases below need more distinct candidates than a
 * fixed list can name, and all any of them requires is that two labels never
 * collide. */
function claimSignature(label: string): string {
  return sha256Hex(`analysis-runs.repo.test:${label}`);
}

/** One seeded lane — a project of the organisation, and the run open on it. */
interface SeededLane {
  readonly projectId: string;
  readonly runId: string;
}

/** Narrows a seeded lane, so an assertion downstream is never made against
 * `undefined` — the vacuous pass an optional-chain would buy. */
function laneAt(lanes: readonly SeededLane[], index: number): SeededLane {
  const lane = lanes[index];
  if (!lane) {
    throw new Error(`seedOrgWithProjects did not open a lane at index ${String(index)}`);
  }
  return lane;
}

/**
 * An organisation-wide ceiling set so high that it cannot be the thing that
 * refuses (AD-23). Every AD-4 case in this file is about the PER-PROJECT
 * ceiling, and a second ceiling that could also fire would make each refusal
 * unattributable — green for a reason the test does not name. The two AD-23
 * cases set both ceilings explicitly instead.
 */
const ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE = 10_000;

/**
 * Forge a value the type system would have refused. Every DB4 case below goes
 * through here rather than through a bare `as` at the call site, so the point
 * is legible: the value is illegal, the compiler has been walked around
 * deliberately, and only the WIRE is left to catch it. That is precisely the
 * situation prod is in when a stale enqueued payload or a hand-run script
 * arrives carrying a member the unions never declared.
 */
function forged<T>(illegal: string): T {
  return illegal as unknown as T;
}

/**
 * A well-formed terminal write, so each DB4 case can override exactly ONE
 * field and the refusal is attributable to that field alone.
 */
function makeCloseInput(runId: string, projectId: string): CloseRunInput {
  return {
    runId,
    projectId,
    status: "completed",
    outcome: "no_candidates_passed_gate",
    stopReason: "ran_to_completion",
    finishedAt: FINISHED_AT,
    modelCallsAttempted: 0,
    // The candidates that produced no finding. Zero here is a FACT about this
    // fixture's run — nothing fell out of it — not a placeholder; the test
    // below varies both and reads them back.
    candidatesUnrenderable: 0,
    candidatesRefused: 0,
    resolvedModelId: null,
    // `null` means NOT REPORTED here, never `0` — a run the model touched but
    // did not meter must not read as a run that cost nothing (FR-M9).
    tokensIn: null,
    tokensOut: null,
    failureReason: null,
  };
}

/** A well-formed finding, for the `summary_source` half of DB4. */
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
    headline: "Fewer people finished checkout than started it.",
    context: ["We looked at one week of activity."],
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

  /**
   * Seeds an org + project and opens a run, returning everything the two blocks
   * below need. The run id is read off `open`'s result rather than invented:
   * `close` and `claimModelCall` are keyed on a run this org actually owns, so
   * there is no id-only write path being exercised here.
   */
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
    // Narrowed rather than optional-chained: every assertion downstream is
    // about a REAL run row, and `?.` on a failed open would let them pass
    // vacuously against `undefined`.
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

  // --- DB4 (FR-M19): refusal at the wire ------------------------------------

  it("the persistence wire refuses a summary source or run state the shared unions never declared", async () => {
    const { repo, ctx, projectId, runId } = await seedOpenRun("db4-refusal");
    // The same org context the run was opened under — this test is about enum
    // refusal, not about scope, and a foreign context would refuse for the
    // wrong reason and prove nothing.
    const findings = createFindingsRepo(db, ctx);

    // Each of the four columns, one at a time. A forged member is REFUSED —
    // the promise rejects — and nothing lands. Were the wire to accept any of
    // them, a run would persist a state no message table has a sentence for,
    // and the customer would be shown a blank where a named state belongs.
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

    // The most load-bearing of the four: `cap_exhausted` and
    // `ran_to_completion` are the pair SAC-10 exists to keep apart, and an
    // unvalidated third value on this column is how that distinction rots.
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

    // REFUSED, not merely thrown-after-writing. The run is still open — no
    // partial terminal write landed — and no finding row exists under the
    // signature the refused write named.
    const stillOpen = await repo.open({ projectId, tickAt: TICK_AT });
    expect(stillOpen.run?.id).toBe(runId);
    expect(stillOpen.run?.status).toBe("running");
    expect(stillOpen.run?.finishedAt).toBeNull();
    expect(stillOpen.run?.stopReason).toBeNull();
    expect(await findings.findBySignature(projectId, SIGNATURE_DB4)).toBeNull();

    // The control: the SAME write, with every member drawn from the shared
    // unions, succeeds. Without this the four refusals above would also pass
    // against a wire that refuses everything.
    const closed = await repo.close(makeCloseInput(runId, projectId));
    expect(closed.status).toBe("completed");
    expect(closed.stopReason).toBe("ran_to_completion");
  });

  // --- AD-4: the atomic cap claim -------------------------------------------

  it("a model call claim at the cap is refused as cap exhausted and a repeat claim is refused as already claimed", async () => {
    const { repo, projectId, runId } = await seedOpenRun("cap-claim");
    // Deliberately tiny, and passed IN: the cap is worker policy
    // (`COLDSTART_MODEL_CALL_CAP`), never a constant this package knows.
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

    // A Graphile Worker replay of the job that already claimed candidate A.
    // The unique index — not a prior read — is what refuses it, and it must
    // say ALREADY CLAIMED: the lane's response is "a previous run already did
    // this work, reuse its finding and make no call". Reading `cap_exhausted`
    // here would degrade a healthy retry to the floor and report an over-spend
    // that never happened.
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

    // A NEW candidate once the cap is spent. Same `claimed: false`, different
    // cause, and the lane's response is different too: persist the finding
    // with `floor_cap_exhausted` and record `stop_reason = cap_exhausted` on
    // the run. Reading `already_claimed` here would send the lane looking for
    // a persisted finding that was never written.
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

    // The three answers are pairwise distinct — stated directly, because the
    // whole point of AD-4 is that they never collapse.
    expect(repeat).not.toEqual(past);
    expect(first).not.toEqual(repeat);
    expect(first).not.toEqual(past);

    // A repeat claim while the cap is ALSO spent still reads as the retry it
    // is. This is the case a check-then-write implementation gets wrong: the
    // count predicate fails first and the conflict is never reached.
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

    // The boundary the PRD names explicitly (D5): a cap of 0 means every
    // candidate takes the floor lane, and the refusal is still the NAMED
    // exhaustion — never silence, never a throw.
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

  // --- AD-23: the organisation-wide ceiling ---------------------------------
  //
  // The per-project cap is a ceiling of `projectCap × N` with no N. These two
  // tests are the N: the first proves the second conjunct fires while the
  // project itself still has budget, the second proves the conjunct is scoped,
  // and neither means anything without the other. A statement that refuses
  // everything passes the first; a statement with no organisation conjunct at
  // all passes the second.

  /**
   * ONE organisation with SEVERAL projects, each carrying its own open run —
   * the shape the organisation ceiling is about, and the one `seedOpenRun`
   * cannot express because it mints a fresh organisation per call. The partial
   * unique index on `analysis_runs` is per `(organization, project)`, so N runs
   * open at once across N projects is an ordinary state rather than a contrived
   * one.
   */
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

  /** How many claim rows this organisation holds, read directly. The repository
   * deliberately exposes no count, and what these assertions are about is
   * whether the conditional insert minted a row at all — which its return value
   * alone cannot prove. */
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

    // Two projects, two claims each. EACH PROJECT STAYS UNDER ITS OWN CEILING
    // (2 of 3) while the two together sit exactly ON the organisation's — the
    // shape a per-project cap alone cannot see, and the whole reason AD-23
    // exists.
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

    // The arrange really landed: four claim rows, so the organisation is at its
    // ceiling for a countable reason rather than an assumed one.
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

    // The project has budget left (2 < 3) and this candidate has never been
    // claimed, so the ONLY thing in the statement that can refuse it is the
    // organisation-wide conjunct. It answers `cap_exhausted` — the same answer
    // the per-project ceiling gives, deliberately: the lane renders one
    // sentence for both and this repository invents no second one.
    expect(refused).toEqual({ claimed: false, reason: "cap_exhausted" });

    // AND IT MINTED NOTHING. A refusal that still inserted a row would spend
    // budget while reporting there was none — invisible in the return value,
    // which is why the ledger is counted rather than inferred.
    expect(await claimCountForOrg(ctx)).toBe(4);

    // NON-VACUITY. The same candidate, the same project budget, the same run —
    // everything identical but a wider organisation ceiling — and it is
    // claimed. Without this, the refusal above is equally satisfied by a
    // statement that refuses every claim.
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

    // One unit of organisation budget each, and a per-project ceiling wide
    // enough that it can never be the refuser below — so every answer in this
    // test is attributable to the organisation conjunct alone.
    const ORGANIZATION_CAP = 1;
    const PROJECT_CAP = 5;

    // ARRANGE — ORG B SPENDS ITS WHOLE ORGANISATION BUDGET, through org B's own
    // context. Every assertion after this is meaningless without it: "org A was
    // allowed" is satisfied by a fixture nobody ever wrote.
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

    // Org B is now AT the very ceiling org A is being held to. A count subquery
    // that dropped its organization predicate would see B's row, conclude org A
    // is out of budget, and refuse — one customer's spending silently consuming
    // another's, with nothing in the return value to say so (D7).
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

    // Each ledger holds exactly its own claim — the row org A minted landed
    // under org A, not beside org B's.
    expect(await claimCountForOrg(orgA.ctx)).toBe(1);
    expect(await claimCountForOrg(orgB.ctx)).toBe(1);

    // NON-VACUITY, the other way round: the ceiling really does bite inside org
    // A once ORG A's own budget is gone. Without this, "org A was allowed"
    // would also pass against a statement carrying no organisation conjunct at
    // all. The project still holds four units, so nothing else can be refusing.
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

  // --- H-1: the lease on a `running` run ------------------------------------
  //
  // The partial unique index makes ONE `running` row block every future run for
  // its project, and nothing outside the repository closes an abandoned row:
  // there is no reaper in this codebase. A SIGKILL, an OOM kill, a container
  // restart or a deploy between `open` and `close` therefore used to buy a
  // PERMANENT, SILENT, per-project denial of analysis — every later tick taking
  // the `opened:false` arm forever, with an info log and no error anywhere.
  // Graphile Worker's job retry does not reach it, because the run row is not
  // the job.
  //
  // The two tests below are a pair and only mean something together: one proves
  // the lease releases a lane nobody is holding, the other proves it does not
  // steal a lane somebody still is.

  /** Reads a run row directly, because the repository deliberately exposes no
   * id-only read — the assertions here are about columns a reclaim writes, and
   * every one of them is fetched under the org that owns the run. */
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

    // One millisecond past the lease — the SMALLEST age that should reclaim, so
    // this passes for the stated reason rather than because the gap was made
    // implausibly large.
    const laterTick = new Date(TICK_AT.getTime() + ANALYSIS_RUN_LEASE_MS + 1);
    const reopened = await repo.open({ projectId, tickAt: laterTick });

    // THE LANE IS FREE AGAIN. This is the whole point: without the lease this
    // is `opened: false` at every future tick until a human notices.
    expect(reopened.opened).toBe(true);
    expect(reopened.run.id).not.toBe(runId);
    expect(reopened.run.status).toBe("running");
    expect(reopened.run.startedAt).toEqual(laterTick);

    // TERMINAL, NOT DELETED AND NOT RE-OPENED (D8). A reclaim is an exit path,
    // so the abandoned run records one — and it records the honest one: it
    // failed, it ended on an unexpected problem, and it says so in the plain
    // English a person reads.
    const abandoned = await readRun(ctx, runId);
    expect(abandoned.status).toBe("failed");
    expect(abandoned.stopReason).toBe("fatal_error");
    expect(abandoned.finishedAt).toEqual(laterTick);
    // The sentence comes from `@growthmind/shared`'s message table, never from
    // the repository — asserted against the table itself so a re-worded message
    // travels rather than forking a second copy into a data-access layer.
    expect(abandoned.failureReason).toBe(ANALYSIS_RUN_STATUS_MESSAGES.failed);
    // `outcome` stays NULL. All three members are claims about what a check
    // FOUND, and nobody observed this one's answer: `produced_findings` would
    // invent a finding, and either `no_*` member would report the shape of an
    // empty product for a run that simply died.
    expect(abandoned.outcome).toBeNull();

    // Exactly ONE run is open for the project afterwards — the reclaim did not
    // leave the old row `running` alongside the new one, which would be the
    // index violation this whole mechanism exists inside.
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

    // EXACTLY at the lease, the near-miss the boundary is chosen for. The
    // comparison is strict (`started_at < cutoff`), so a run of exactly this
    // age is still believed — the safe direction, because reclaiming a live run
    // puts two writers on one project's lane while the cap's count subquery
    // still assumes a single writer.
    const boundaryTick = new Date(TICK_AT.getTime() + ANALYSIS_RUN_LEASE_MS);
    const blocked = await repo.open({ projectId, tickAt: boundaryTick });

    expect(blocked.opened).toBe(false);
    expect(blocked.run.id).toBe(runId);
    expect(blocked.run.status).toBe("running");

    // NOTHING WAS WRITTEN. A reclaim that fired and then lost the insert race
    // would still have marked this row terminal, so the columns are checked
    // rather than inferred from `opened: false`.
    const untouched = await readRun(ctx, runId);
    expect(untouched.status).toBe("running");
    expect(untouched.finishedAt).toBeNull();
    expect(untouched.stopReason).toBeNull();
    expect(untouched.failureReason).toBeNull();
    expect(untouched.startedAt).toEqual(TICK_AT);
  });

  // --- CR-2: the candidates that produced no finding are DURABLE ------------

  it("a run records the candidates it could not write up and the candidates it refused, apart from each other", async () => {
    const { repo, ctx, projectId, runId } = await seedOpenRun("no-finding-counts");

    // A run whose whole list fell out: nothing was written, and the two causes
    // are different facts. Deliberately UNEQUAL, so a `close` that wrote one
    // column into both — or swapped them — cannot pass.
    const closed = await repo.close({
      ...makeCloseInput(runId, projectId),
      candidatesUnrenderable: 2,
      candidatesRefused: 5,
    });

    expect(closed.candidatesUnrenderable).toBe(2);
    expect(closed.candidatesRefused).toBe(5);

    // AND IT SURVIVED SQL, not just the `RETURNING` row. This is the whole
    // point of the columns: in memory these numbers die with the tick, and the
    // run then reads as one that produced findings and finished its list while
    // in truth it wrote nothing — "we lost some" decaying into "we checked
    // everything", SAC-10's shape one level down.
    const persisted = await readRun(ctx, runId);
    expect(persisted.candidatesUnrenderable).toBe(2);
    expect(persisted.candidatesRefused).toBe(5);
    // The run still reports the rest of its verdict truthfully alongside them —
    // these columns ADD a fact, they do not restate one.
    expect(persisted.status).toBe("completed");
    expect(persisted.stopReason).toBe("ran_to_completion");
  });

  // --- L-2: a run is finished ONCE ------------------------------------------

  it("a terminal run is not rewritten by a second close", async () => {
    const { repo, ctx, projectId, runId } = await seedOpenRun("close-once");

    const closed = await repo.close(makeCloseInput(runId, projectId));
    expect(closed.status).toBe("completed");

    // The late-returning original worker: a second close, carrying a DIFFERENT
    // and less-informed verdict. It is refused, loudly — `analysis-tick.ts`'s
    // `closeRun` catches and logs every fault from this method, so the refusal
    // costs one log line and never reaches a lane or a finding.
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

    // REFUSED, not merely thrown after writing. Every column still carries the
    // first verdict — the audit trail lying in this direction is the whole
    // reason for the predicate: a run that finished cleanly must never be
    // re-reported as one that broke.
    const stillFirstVerdict = await readRun(ctx, runId);
    expect(stillFirstVerdict.status).toBe("completed");
    expect(stillFirstVerdict.outcome).toBe("no_candidates_passed_gate");
    expect(stillFirstVerdict.stopReason).toBe("ran_to_completion");
    expect(stillFirstVerdict.finishedAt).toEqual(FINISHED_AT);
    expect(stillFirstVerdict.failureReason).toBeNull();
  });
});
