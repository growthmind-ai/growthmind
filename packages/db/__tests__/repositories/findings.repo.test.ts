import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { summarySourceSchema, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";

import {
  assertUnderConstruction,
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import {
  createFindingsRepo,
  type FindingRecord,
  type FindingsRepo,
  type MeasuredCountRow,
  type PersistFindingInput,
} from "../../src/repositories/findings.repo";
import type { ScopedDb } from "../../src/repositories/types";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import { scannedTextFor, seedAnalysisRun, seedOrgWithOwner, seedProject } from "../../src/testing";
import { findingCountRow } from "../helpers/fix-spec-payload";

const FINDINGS_REPO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "repositories",
  "findings.repo.ts",
);

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const OFFENDER = "jane.doe@acme.example";

const HELD_SURFACE = "app/onboarding/connect/page.tsx";

const HELD_CREATED_AT = new Date("2026-07-31T09:15:00.000Z");

const FIXTURES_OWNER = "ADD Wave 1.4 (packages/db/src/testing/fixtures.ts, seedUnscannedFinding)";

// ADD Decision 2's `FindingText`, narrowed to what this row reads.
type Verdict =
  | { readonly held: false; readonly headline: string; readonly context: readonly string[] }
  | { readonly held: true; readonly why: string; readonly kind?: string };

// Writes a row the persist gate would refuse, which is every pre-sprint row.
type SeedUnscannedFinding = (
  db: ScopedDb,
  params: {
    readonly ctx: TenantContext;
    readonly projectId: string;
    readonly runId: string;
    readonly headline: string;
    readonly context: readonly string[];
    readonly signature?: string;
    readonly surface?: string;
    readonly counts?: readonly MeasuredCountRow[];
    readonly createdAt?: Date;
  },
) => Promise<{ readonly id: string }>;

const loadSeedUnscannedFinding = (): Promise<SeedUnscannedFinding> =>
  loadUnderConstruction<SeedUnscannedFinding>({
    modulePath: underConstructionSpecifier("packages/db/src/testing/fixtures"),
    exportName: "seedUnscannedFinding",
    ownedBy: FIXTURES_OWNER,
  });

function signatureFor(label: string): string {
  return sha256Hex(`findings.repo.test:${label}`);
}

const CLEAN_TEXT = scannedTextFor("Two of every three people stop at the payment step", [
  "Of 28 people who reached the payment step, 19 did not finish.",
  "This covers the seven days ending 31 July.",
]);

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
    detector: "funnel_dropoff",
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
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

// TODO(ADD o-019-dismissal-wired Decision 2 part A): findById is a new method on
// FindingsRepo, implemented via orgCrud's existing c.maybe(eq(findings.id, id)) — the same
// org-scoping every other method on this repo already gets for free from orgCrud's
// s.owned() filter (packages/db/src/repositories/findings.repo.ts).
interface FindingsRepoWithFindById extends FindingsRepo {
  findById(id: string): Promise<FindingRecord | null>;
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

    expect(written.organizationId).toBe(orgA.organizationId);
    expect(written.projectId).toBe(project.id);

    const bySignature = await repo.findBySignature(project.id, input.signature);
    expect(bySignature?.id).toBe(written.id);

    const byId = await repo.findById(project.id, written.id);
    expect(byId?.id).toBe(written.id);

    const listed = await repo.listForProject(project.id, { limit: 10 });
    expect(listed.map((row) => row.id)).toContain(written.id);

    const wrongProject = await repo.findBySignature(siblingProject.id, input.signature);
    expect(wrongProject).toBeNull();
    expect(await repo.findById(siblingProject.id, written.id)).toBeNull();
    expect(await repo.listForProject(siblingProject.id, { limit: 10 })).toEqual([]);

    const foreignRepo = createFindingsRepo(db, orgB.ctx);
    expect(await foreignRepo.findBySignature(project.id, input.signature)).toBeNull();
    expect(await foreignRepo.findById(project.id, written.id)).toBeNull();
    expect(await foreignRepo.listForProject(project.id, { limit: 10 })).toEqual([]);
  });

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

    const usage: { inputTokens?: number; outputTokens?: number } = {};
    const unmetered = makePersistInput(project.id, run.id, {
      signature: signatureFor("unmetered"),
      tokensIn: usage.inputTokens ?? null,
      tokensOut: usage.outputTokens ?? null,
    });

    const written = await repo.persist(unmetered);

    expect(written.tokensIn).toBeNull();
    expect(written.tokensOut).toBeNull();

    expect(written.tokensIn).not.toBe(0);
    expect(written.tokensOut).not.toBe(0);

    const readBack = await repo.findBySignature(project.id, unmetered.signature);
    expect(readBack?.tokensIn).toBeNull();
    expect(readBack?.tokensOut).toBeNull();
    expect(readBack?.tokensOut).not.toBe(0);

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

    const unrecorded = await repo.persist(
      makePersistInput(project.id, run.id, {
        signature: signatureFor("normversion-unrecorded"),
        surfaceNormalisationVersion: null,
      }),
    );

    expect(unrecorded.surfaceNormalisationVersion).toBeNull();

    expect(unrecorded.surfaceNormalisationVersion).not.toBe(0);

    const readBack = await repo.findBySignature(project.id, unrecorded.signature);
    expect(readBack?.surfaceNormalisationVersion).toBeNull();
    expect(readBack?.surfaceNormalisationVersion).not.toBe(0);

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

    expect(zeroReadBack?.surfaceNormalisationVersion).not.toBe(
      readBack?.surfaceNormalisationVersion,
    );
  });

  it("findById returns a finding scoped to the caller's organization, and null for another org's id", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "acme-findbyid-a",
      userName: "Owner FindById A",
      email: "owner-findbyid-a@acme.example",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "acme-findbyid-b",
      userName: "Owner FindById B",
      email: "owner-findbyid-b@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "checkout-findbyid",
    });
    const run = await seedAnalysisRun(db, { ctx: orgA.ctx, projectId: project.id });

    const repoA = createFindingsRepo(db, orgA.ctx) as FindingsRepoWithFindById;
    const repoB = createFindingsRepo(db, orgB.ctx) as FindingsRepoWithFindById;

    const written = await repoA.persist(
      makePersistInput(project.id, run.id, { signature: signatureFor("findbyid") }),
    );

    const found = await repoA.findById(written.id);
    expect(found?.id).toBe(written.id);

    const crossOrg = await repoB.findById(written.id);
    expect(crossOrg).toBeNull();
  });

  // R-1 lets a fix reference its finding instead of copying it, and that is only safe while
  // a persisted finding cannot change under the reference.
  it("declares no method that updates a persisted finding", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-findings-immutable",
      userName: "Owner Findings Immutable",
      email: "owner-findings-immutable@acme.example",
    });

    const methods = Object.keys(createFindingsRepo(db, org.ctx)).toSorted();
    expect(methods).toEqual(["findById", "findBySignature", "listForProject", "persist"]);

    const source = readFileSync(FINDINGS_REPO_PATH, "utf8");
    const declared = /export interface FindingsRepo\s*\{([\s\S]*?)\n\}/.exec(source);
    expect(declared).not.toBeNull();

    const body = declared?.[1] ?? "";
    expect(body).toMatch(/\bpersist\s*\(/);
    expect(body).not.toMatch(/\b(?:update|patch|edit|mutate|rewrite|set)\w*\s*\(/i);
  });

  test("every FindingRecord this repository mints carries its text as a verdict, and a held row still carries its counts and surface", async () => {
    const seedUnscannedFinding = await loadSeedUnscannedFinding();

    const org = await seedOrgWithOwner(db, {
      orgName: "acme-findings-held",
      userName: "Owner Findings Held",
      email: "owner-findings-held@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "onboarding-findings-held",
    });
    const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });

    const seeded = await seedUnscannedFinding(db, {
      ctx: org.ctx,
      projectId: project.id,
      runId: run.id,
      headline: `Two of every three people stop here, and one wrote in as ${OFFENDER}`,
      context: ["Of 28 people who reached the last step, 19 did not finish."],
      signature: signatureFor("held-row"),
      surface: HELD_SURFACE,
      counts: [findingCountRow(28, 28), findingCountRow(19, 28)],
      createdAt: HELD_CREATED_AT,
    });

    const [record] = await createFindingsRepo(db, org.ctx).listForProject(project.id, { limit: 1 });
    if (record === undefined) throw new Error("the seeded finding could not be read back");
    expect(record.id).toBe(seeded.id);

    assertUnderConstruction("text" in record, {
      contract:
        "FindingRecord carries `text: FindingText` — the repository mints every row's text through the residual-PII gate",
      ownedBy: "ADD Wave 1.3 (packages/db/src/repositories/findings.repo.ts, Decision 1)",
    });

    const { text } = record as unknown as { readonly text: Verdict };
    expect(text.held).toBe(true);

    // Gated, not dropped: the evidence the row carries is untouched by the hold.
    expect(record.counts).toHaveLength(2);
    expect(record.counts.map((count) => `${count.numerator}/${count.denominator}`)).toEqual([
      "28/28",
      "19/28",
    ]);
    expect(record.surface).toBe(HELD_SURFACE);
    expect(record.createdAt.getTime()).toBe(HELD_CREATED_AT.getTime());
  });
});
