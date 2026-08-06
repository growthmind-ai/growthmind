import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { TenantContext } from "@growthmind/shared";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import {
  createTestDb,
  makeTenantContext,
  seedAnalysisRun,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUnscannedFinding,
  seedUser,
  type TestDb,
} from "../../src/testing";

// Wave 0 contract shapes (ADD tasks/o-044-cause-stage-citation-gate/add.md, Decision 3).
// Production types arrive with packages/db/src/repositories/cause-claims.repo.ts (Wave 1+).
const OWNER = "backend-execution-agent, Wave 1+ (packages/db/src/repositories/cause-claims.repo.ts, ADD Decision 3)";

interface CauseClaimStatement {
  readonly statement: string;
  readonly citesBeats: readonly number[];
}

interface PersistCauseClaimsInput {
  readonly projectId: string;
  readonly findingId: string;
  readonly anchorSessionId: string;
  readonly claims: readonly CauseClaimStatement[];
  readonly droppedClaims: number;
  readonly resolvedModelId: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

interface CauseClaimRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly findingId: string;
  readonly anchorSessionId: string;
  readonly claims: readonly CauseClaimStatement[];
  readonly droppedClaims: number;
  readonly resolvedModelId: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly createdAt: Date;
}

interface CauseClaimsRepo {
  persist(input: PersistCauseClaimsInput): Promise<CauseClaimRecord>;

  findForFinding(projectId: string, findingId: string): Promise<CauseClaimRecord | null>;
}

type CreateCauseClaimsRepo = (db: TestDb, ctx: TenantContext) => CauseClaimsRepo;

const loadCreateRepo = (): Promise<CreateCauseClaimsRepo> =>
  loadUnderConstruction<CreateCauseClaimsRepo>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/cause-claims.repo"),
    exportName: "createCauseClaimsRepo",
    ownedBy: OWNER,
  });

interface Scope {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly owner: TenantContext;
  readonly projectId: string;
  readonly findingId: string;
}

async function seedScope(db: TestDb, slug: string): Promise<Scope> {
  const org = await seedOrgWithOwner(db, {
    orgName: `acme-cause-claims-${slug}`,
    userName: `Owner Cause Claims ${slug}`,
    email: `owner-cause-claims-${slug}@acme.example`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `checkout-cause-claims-${slug}`,
  });
  const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });
  const finding = await seedUnscannedFinding(db, {
    ctx: org.ctx,
    projectId: project.id,
    runId: run.id,
    headline: "Fewer people finished checkout than started it.",
    context: ["We looked at one week of activity."],
  });

  return {
    organizationId: org.organizationId,
    organizationName: org.organizationName,
    owner: org.ctx,
    projectId: project.id,
    findingId: finding.id,
  };
}

function survivorsAndDropsInput(scope: Scope): PersistCauseClaimsInput {
  return {
    projectId: scope.projectId,
    findingId: scope.findingId,
    anchorSessionId: "session-anchor-survivors",
    claims: [
      {
        statement: "The request failed because the field was left empty.",
        citesBeats: [2],
      },
    ],
    droppedClaims: 1,
    resolvedModelId: "claude-sonnet-5",
    tokensIn: 500,
    tokensOut: 80,
  };
}

function dropsOnlyInput(scope: Scope): PersistCauseClaimsInput {
  return {
    projectId: scope.projectId,
    findingId: scope.findingId,
    anchorSessionId: "session-anchor-drops-only",
    claims: [],
    droppedClaims: 2,
    resolvedModelId: "claude-sonnet-5",
    tokensIn: 420,
    tokensOut: 0,
  };
}

describe("cause claims repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("persist writes a row for a survivors-and-drops fixture", async () => {
    const createCauseClaimsRepo = await loadCreateRepo();
    const scope = await seedScope(db, "survivors-and-drops");
    const repo = createCauseClaimsRepo(db, scope.owner);
    const input = survivorsAndDropsInput(scope);

    const record = await repo.persist(input);

    expect(record.organizationId).toBe(scope.organizationId);
    expect(record.projectId).toBe(scope.projectId);
    expect(record.findingId).toBe(scope.findingId);
    expect(record.anchorSessionId).toBe(input.anchorSessionId);
    expect(record.claims).toEqual(input.claims);
    expect(record.droppedClaims).toBe(1);

    const found = await repo.findForFinding(scope.projectId, scope.findingId);
    expect(found?.id).toBe(record.id);
    expect(found?.claims).toEqual(input.claims);
    expect(found?.droppedClaims).toBe(1);
  });

  it("persist writes a row for a drops-only fixture (claims: [], droppedClaims > 0)", async () => {
    const createCauseClaimsRepo = await loadCreateRepo();
    const scope = await seedScope(db, "drops-only");
    const repo = createCauseClaimsRepo(db, scope.owner);
    const input = dropsOnlyInput(scope);

    const record = await repo.persist(input);

    expect(record.claims).toEqual([]);
    expect(record.droppedClaims).toBe(2);

    const found = await repo.findForFinding(scope.projectId, scope.findingId);
    expect(found?.claims).toEqual([]);
    expect(found?.droppedClaims).toBe(2);
  });

  it("a teammate in the same org can read a cause_claims row created by a different actor", async () => {
    const createCauseClaimsRepo = await loadCreateRepo();
    const scope = await seedScope(db, "teammate-read");

    const teammate = await seedUser(db, {
      name: "Teammate Cause Claims",
      email: "teammate-cause-claims@acme.example",
    });
    await seedMember(db, {
      organizationId: scope.organizationId,
      userId: teammate.id,
      role: "member",
    });
    const teammateCtx: TenantContext = makeTenantContext({
      userId: teammate.id,
      organizationId: scope.organizationId,
      organizationName: scope.organizationName,
      role: "member",
    });

    const ownerRepo = createCauseClaimsRepo(db, scope.owner);
    const teammateRepo = createCauseClaimsRepo(db, teammateCtx);
    const input = survivorsAndDropsInput(scope);

    await ownerRepo.persist(input);

    const found = await teammateRepo.findForFinding(scope.projectId, scope.findingId);

    expect(found?.findingId).toBe(scope.findingId);
    expect(found?.claims).toEqual(input.claims);
  });

  it("an actor in a different organization cannot read another org's cause_claims row", async () => {
    const createCauseClaimsRepo = await loadCreateRepo();
    const scopeA = await seedScope(db, "org-a");
    const scopeB = await seedScope(db, "org-b");

    const repoA = createCauseClaimsRepo(db, scopeA.owner);
    const repoB = createCauseClaimsRepo(db, scopeB.owner);

    await repoA.persist(survivorsAndDropsInput(scopeA));

    const foundFromB = await repoB.findForFinding(scopeA.projectId, scopeA.findingId);

    expect(foundFromB).toBeNull();
  });
});
