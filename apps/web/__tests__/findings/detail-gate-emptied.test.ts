// UX First-Run Checklist rows 4-5 (.ai/ux/cause-stage-citation-gate.md §4) AND the consumer half
// of the D11 shared-fixture end-to-end pair — the producer half is
// worker/__tests__/analysis/cause.test.ts's "two ticks over the same seeded finding + divergence
// row produce exactly one cause_claims row" test. Both halves are driven from the SAME
// org/project/finding/session ids (CAUSE_STAGE_D11_FIXTURE, @growthmind/db/testing) so this is
// provably one fixture proving one wire, not a producer test and a consumer test that never
// touch each other (D11, ADD Decision 7/8).
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { schema, type ScopedDb } from "@growthmind/db";
import {
  CAUSE_STAGE_D11_FIXTURE,
  createTestDb,
  makeTenantContext,
  scannedTextFor,
  seedAnalysisRun,
  type TestDb,
} from "@growthmind/db/testing";
import { EVIDENCE_CLAIM_DROPPED, summarySourceSchema, type TenantContext } from "@growthmind/shared";

import { AnnotatedTranscript } from "../../components/findings/AnnotatedTranscript";
import { readMarkup } from "../first-run/helpers/rendered-markup";
import {
  jargonFoundIn,
  loadCreateCauseClaimsRepo,
  readFindingDetailPageSource,
  readLiveFindingWave0,
} from "./helpers/wave0-types";

const SHARED_D11_FIXTURE = CAUSE_STAGE_D11_FIXTURE;

// The finding, org and project this fixture needs don't exist through any seeder that accepts a
// caller-chosen id (seedOrgWithOwner/seedProject/createFindingsRepo.persist all mint their own
// random ids) — a direct insert against the real schema is the only way to reproduce the exact
// ids the worker-side producer test also uses.
async function seedSharedD11Fixture(db: ScopedDb): Promise<TenantContext> {
  await db.insert(schema.organization).values({
    id: SHARED_D11_FIXTURE.organizationId,
    name: SHARED_D11_FIXTURE.organizationName,
    slug: `org-${SHARED_D11_FIXTURE.organizationId}`,
    createdAt: new Date(),
  });

  await db.insert(schema.projects).values({
    id: SHARED_D11_FIXTURE.projectId,
    organizationId: SHARED_D11_FIXTURE.organizationId,
    name: "project-shared-d11",
  });

  const ctx = makeTenantContext({
    userId: "o44-shared-user",
    organizationId: SHARED_D11_FIXTURE.organizationId,
    organizationName: SHARED_D11_FIXTURE.organizationName,
  });

  const run = await seedAnalysisRun(db, { ctx, projectId: SHARED_D11_FIXTURE.projectId });
  const text = scannedTextFor("The checkout step is losing sessions", [
    "Of 28 people who reached checkout, 19 did not finish.",
  ]);

  await db.insert(schema.findings).values({
    id: SHARED_D11_FIXTURE.findingId,
    organizationId: SHARED_D11_FIXTURE.organizationId,
    projectId: SHARED_D11_FIXTURE.projectId,
    runId: run.id,
    signature: "sig-shared-d11",
    signatureVersion: 1,
    detector: "funnel_dropoff",
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: text.headline,
    context: text.context,
    finalClass: "funnel_dropoff",
    surface: SHARED_D11_FIXTURE.surface,
    surfaceNormalisationVersion: 1,
    counts: [],
    confidenceBasis: "28 kept sessions in a seven-day window",
    windowStart: SHARED_D11_FIXTURE.windowStart,
    windowEnd: SHARED_D11_FIXTURE.windowEnd,
    evidenceShape: "funnel_dropoff:step=checkout",
    evidenceShapeVersion: 1,
    resolvedModelId: "claude-sonnet-5",
    createdAt: new Date(),
  });

  return ctx;
}

describe("UX rows 4-5 — the citation gate emptied every claim (D11 consumer half)", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let sharedCtx: TenantContext;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    sharedCtx = await seedSharedD11Fixture(db);
  });

  afterAll(async () => {
    await close();
  });

  // The producer half's own "wholly-uncited" fixture: one claim proposed, zero survive. Called
  // from each test individually (not a shared beforeAll) so that once the repo exists, a
  // partial implementation still shows each row's assertion failing or passing on its own line
  // rather than one throw collapsing all three. The ADD (Decision 3) and ownership comment on
  // this repo both call for `persist` to be an insertOrFetch (mirroring
  // divergence-points.repo.ts) so a repeat call for the same finding is a no-op — today's
  // packages/db/src/repositories/cause-claims.repo.ts does a plain insert instead, which throws
  // a unique-constraint violation on the second call. That is a real backend defect (it also
  // means a retried Graphile Worker tick would crash rather than no-op, which is exactly what
  // 0.7's "two ticks" dedup test is supposed to guard, but that test runs against a fake
  // in-memory repo and never exercises this path) — out of this frontend wave's write scope
  // (packages/db/src/repositories/**). The guard below keeps this test file provably red-only
  // for the reasons stated in its own header rather than for this unrelated repo bug.
  let seeded = false;

  async function seedGateEmptiedClaims(): Promise<void> {
    if (seeded) return;
    seeded = true;

    const createCauseClaimsRepo = await loadCreateCauseClaimsRepo();
    await createCauseClaimsRepo(db, sharedCtx).persist({
      projectId: SHARED_D11_FIXTURE.projectId,
      findingId: SHARED_D11_FIXTURE.findingId,
      anchorSessionId: SHARED_D11_FIXTURE.anchorSessionId,
      claims: [],
      droppedClaims: 1,
      resolvedModelId: "claude-sonnet-5",
      tokensIn: 300,
      tokensOut: 60,
    });
  }

  test("readLiveFinding on the shared seeded finding returns evidence.droppedClaims === 1, never upgraded to explained", async () => {
    await seedGateEmptiedClaims();

    const finding = await readLiveFindingWave0(
      db,
      sharedCtx,
      SHARED_D11_FIXTURE.projectId,
      SHARED_D11_FIXTURE.findingId,
    );

    expect(finding?.evidence).not.toBeNull();
    expect(finding?.evidence?.droppedClaims).toBe(1);
    expect(finding?.evidence?.claims).toEqual([]);
    expect(finding?.grade).toBe("described");
  });

  test("the finding detail page threads droppedClaims into the render for the described-but-attempted arm", () => {
    const source = readFindingDetailPageSource();

    expect(source).toMatch(/AnnotatedTranscript/);
    expect(source).toMatch(/droppedClaims/);
  });

  test("a P-2 reader sees the plain-English dropped-claims line, with none of the forbidden internal terms, anywhere in view", async () => {
    await seedGateEmptiedClaims();

    const finding = await readLiveFindingWave0(
      db,
      sharedCtx,
      SHARED_D11_FIXTURE.projectId,
      SHARED_D11_FIXTURE.findingId,
    );

    const html = renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(AnnotatedTranscript, {
          beats: finding?.evidence?.beats ?? [],
          claims: finding?.evidence?.claims ?? [],
          droppedClaims: finding?.evidence?.droppedClaims ?? 0,
        }),
      ),
    );
    const visible = readMarkup(html).text;

    // Never a fabricated citation: zero surviving claims means zero anchors, no matter what.
    expect(html).not.toMatch(/<a\b/);
    expect(visible).toContain(EVIDENCE_CLAIM_DROPPED);
    expect(jargonFoundIn(visible)).toEqual([]);
  });
});
