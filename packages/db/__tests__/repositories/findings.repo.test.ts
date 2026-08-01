// findings repository, the first analysis-side persistence, and the two clauses of the
// outcome that only real SQL can prove.
//
// Every test below runs against the real generated migrations via `createTestDb`'s
// PGlite instance, the same harness `deliveries.repo.test.ts` uses. That is deliberate:
// both assertions here are about what the database holds, which columns a write stamps,
// and whether an unreported count lands as SQL `NULL` rather than as `0`. A fake
// repository would agree with itself and prove neither.
//
// Reading order, by the taxonomy dimension each block pins:
// stamp/filter symmetry, every column the read path filters by
//  (`organization_id`, `project_id`) is stamped by the write path. The
//  failure this names is the guaranteed-empty read: a filter keyed on a
//  column no write ever sets matches zero rows and reads as "no data",
//  never as an error.
// not-reported is not zero, `tokens_in`/`tokens_out` are nullable
//  because null means "the SDK reported no count" (
//  `shared/src/summary/types.ts:163-173`). A candidate the model touched
//  but did not meter must never look identical to one that cost nothing.
//  `surface_normalisation_version` is nullable for the same reason and is
//  tested in the same shape: the candidate contract makes `0` a version a
//  producer may legitimately emit, so it cannot double as the absence.
//
// NOTE: `findings.signature` IS the finding's identity, stored beside the ledger the
// way `deliveries.signature` and `dismissals.signature` already are. The repository
// accepts a signature and never mints one, `computeFindingSignature` remains the single
// producer, a layer up, so nothing here derives an identity, and the fixtures below are
// realistically-shaped values rather than a second derivation.
import { summarySourceSchema } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createFindingsRepo, type PersistFindingInput } from "../../src/repositories/findings.repo";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedAnalysisRun, seedOrgWithOwner, seedProject } from "../helpers/fixtures";

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

/** A distinct signature, in the shape the column really holds, 64 lowercase hex
 * characters. Deliberately not `computeFindingSignature`: this suite proves what the
 * database does with the value, and re-running the real producer here would couple a
 * storage test to a tuple serialisation it is not about. */
function signatureFor(label: string): string {
  return sha256Hex(`findings.repo.test:${label}`);
}

/**
 * A persistable finding. `counts` is empty on purpose: the composition of a measured
 * count is `packages/core`'s subject and is tested there. This suite is about which
 * columns the write stamps and how an absent token count lands, and a count row would
 * prove neither.
 */
function makePersistInput(
  projectId: string,
  runId: string,
  overrides: Partial<PersistFindingInput> = {},
): PersistFindingInput {
  return {
    projectId,
    runId,
    signature: signatureFor("checkout-step-2"),
    signatureVersion: 1,
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: "Two of every three people stop at the payment step",
    // One sentence per element, never a blob to be re-split later.
    context: [
      "Of 28 people who reached the payment step, 19 did not finish.",
      "This covers the seven days ending 31 July.",
    ],
    finalClass: "funnel_dropoff",
    surface: "app/checkout/payment/page.tsx",
    surfaceNormalisationVersion: 1,
    counts: [],
    confidenceBasis: "28 kept sessions in a seven-day window",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: "funnel_dropoff:step=payment",
    evidenceShapeVersion: 1,
    resolvedModelId: "claude-sonnet-5",
    tokensIn: 1_200,
    tokensOut: 180,
    ...overrides,
  };
}

describe("findings repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // --: stamp/filter symmetry

  it("every column the findings read path filters by is stamped by the write path", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "acme-findings-stamp",
      userName: "Owner Findings Stamp",
      email: "owner-findings-stamp@acme.example",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "other-findings-stamp",
      userName: "Owner Other Stamp",
      email: "owner-other-stamp@other.example",
    });
    const project = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "checkout-findings-stamp",
    });
    const siblingProject = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "onboarding-findings-stamp",
    });

    const repo = createFindingsRepo(db, orgA.ctx);
    const run = await seedAnalysisRun(db, { ctx: orgA.ctx, projectId: project.id });
    const input = makePersistInput(project.id, run.id);

    const written = await repo.persist(input);

    // The write stamps both scoping columns. If either were left unstamped, every
    // scoped read below would match zero rows and the lane would look empty rather than
    // broken.
    expect(written.organizationId).toBe(orgA.organizationId);
    expect(written.projectId).toBe(project.id);

    // …and the repository's own org+project-scoped reads find what it wrote.
    const bySignature = await repo.findBySignature(project.id, input.signature);
    expect(bySignature?.id).toBe(written.id);

    const listed = await repo.listForProject(project.id, { limit: 10 });
    expect(listed.map((row) => row.id)).toContain(written.id);

    // Both filters genuinely narrow, without these two, the assertions above would also
    // pass against a read that ignores its filters entirely.
    const wrongProject = await repo.findBySignature(siblingProject.id, input.signature);
    expect(wrongProject).toBeNull();
    expect(await repo.listForProject(siblingProject.id, { limit: 10 })).toEqual([]);

    const foreignRepo = createFindingsRepo(db, orgB.ctx);
    expect(await foreignRepo.findBySignature(project.id, input.signature)).toBeNull();
    expect(await foreignRepo.listForProject(project.id, { limit: 10 })).toEqual([]);
  });

  // --: not reported is not zero

  it("unreported token counts persist as not reported and are never written as zero", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-findings-usage",
      userName: "Owner Findings Usage",
      email: "owner-findings-usage@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-findings-usage",
    });
    const repo = createFindingsRepo(db, org.ctx);
    const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });

    // Exactly how the port hands usage over when the SDK reported nothing:
    // `summaryUsageSchema`'s fields are `.optional`, so an unmetered call arrives as
    // `undefined`, never pre-coerced to a number by the caller.
    const usage: { inputTokens?: number; outputTokens?: number } = {};
    const unmetered = makePersistInput(project.id, run.id, {
      signature: signatureFor("unmetered"),
      tokensIn: usage.inputTokens ?? null,
      tokensOut: usage.outputTokens ?? null,
    });

    const written = await repo.persist(unmetered);

    expect(written.tokensIn).toBeNull();
    expect(written.tokensOut).toBeNull();
    // Named explicitly, because this is the failure being prevented: a candidate the
    // model touched but did not meter must not be indistinguishable from one that cost
    // nothing.
    expect(written.tokensIn).not.toBe(0);
    expect(written.tokensOut).not.toBe(0);

    // The same fact survives the round-trip through SQL, not just the `RETURNING` row.
    const readBack = await repo.findBySignature(project.id, unmetered.signature);
    expect(readBack?.tokensIn).toBeNull();
    expect(readBack?.tokensOut).toBeNull();
    expect(readBack?.tokensOut).not.toBe(0);

    // The contrast that gives "never zero" its meaning: a genuinely reported zero is a
    // different, storable fact. The column is not simply refusing zeroes.
    const meteredZero = await repo.persist(
      makePersistInput(project.id, run.id, {
        signature: signatureFor("metered-zero"),
        tokensIn: 0,
        tokensOut: 0,
      }),
    );
    expect(meteredZero.tokensIn).toBe(0);
    expect(meteredZero.tokensOut).toBe(0);
  });

  it("an unrecorded surface normalisation version persists as not recorded and a genuine zero remains a distinct storable version", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-findings-normversion",
      userName: "Owner Findings Norm Version",
      email: "owner-findings-normversion@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-findings-normversion",
    });
    const repo = createFindingsRepo(db, org.ctx);
    const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });

    // Exactly how a candidate hands this over when no normaliser version was recorded:
    // `CandidateFinding.surfaceNormalisationVersion` is `z.number.int.nullable`
    // (`core/src/findings/candidate.ts:93`), so the absence arrives as `null`, never
    // pre-coerced to a number by the lane.
    const unrecorded = await repo.persist(
      makePersistInput(project.id, run.id, {
        signature: signatureFor("normversion-unrecorded"),
        surfaceNormalisationVersion: null,
      }),
    );

    expect(unrecorded.surfaceNormalisationVersion).toBeNull();
    // Named explicitly, because this is the failure being prevented: the column used to
    // be not NULL and the lane wrote `0` to mean "none recorded".
    expect(unrecorded.surfaceNormalisationVersion).not.toBe(0);

    // The same fact survives the round-trip through SQL, not just `RETURNING`.
    const readBack = await repo.findBySignature(project.id, unrecorded.signature);
    expect(readBack?.surfaceNormalisationVersion).toBeNull();
    expect(readBack?.surfaceNormalisationVersion).not.toBe(0);

    // The contrast that gives "never zero" its meaning, and the reason this is not
    // pedantry: the candidate contract is `.nullable` and not `.positive`, so `0`
    // is a version a normaliser may legitimately report. It is a different, storable
    // fact, and on a column that feeds identity comparisons, "normaliser v0" and "we do
    // not know" must never be the same stored value.
    const versionZero = await repo.persist(
      makePersistInput(project.id, run.id, {
        signature: signatureFor("normversion-zero"),
        surfaceNormalisationVersion: 0,
      }),
    );
    expect(versionZero.surfaceNormalisationVersion).toBe(0);
    expect(versionZero.surfaceNormalisationVersion).not.toBeNull();

    const zeroReadBack = await repo.findBySignature(project.id, versionZero.signature);
    expect(zeroReadBack?.surfaceNormalisationVersion).toBe(0);
    // The pair, stated directly: the two rows are distinguishable in the database,
    // which is the entire property.
    expect(zeroReadBack?.surfaceNormalisationVersion).not.toBe(
      readBack?.surfaceNormalisationVersion,
    );
  });
});
