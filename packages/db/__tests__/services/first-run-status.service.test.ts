import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  loadUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { createAnalysisRunsRepo } from "../../src/repositories/analysis-runs.repo";
import { createPollRunsRepo } from "../../src/repositories/poll-runs.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../../src/testing";
import { seedConnection, seedOrgWithOwner, seedProject } from "../../src/testing";
import {
  type CreateFirstRunRepo,
  type CreateFirstRunStatusService,
} from "../helpers/onboarding-contract";

const NAMES = laneNames("first-run-status");

const OWNER = "ADD Wave 2 (packages/db/src/services/first-run-status.service.ts, AD-6)";

const SERVICE_SOURCE_PATH = "packages/db/src/services/first-run-status.service.ts";

const ARMED_AT = new Date("2026-08-01T10:00:00.000Z");
const BEFORE_ARMING = new Date("2026-08-01T09:30:00.000Z");
const AFTER_ARMING = new Date("2026-08-01T10:00:30.000Z");
const LATER = new Date("2026-08-01T10:01:00.000Z");

const loadCreateService = (): Promise<CreateFirstRunStatusService> =>
  loadUnderConstruction<CreateFirstRunStatusService>({
    modulePath: underConstructionSpecifier("packages/db/src/services/first-run-status.service"),
    exportName: "createFirstRunStatusService",
    ownedBy: OWNER,
  });

const loadCreateFirstRunRepo = (): Promise<CreateFirstRunRepo> =>
  loadUnderConstruction<CreateFirstRunRepo>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/first-run.repo"),
    exportName: "createFirstRunRepo",
    ownedBy: "ADD Wave 2 (packages/db/src/repositories/first-run.repo.ts, AD-8)",
  });

interface Scope {
  organizationId: string;
  projectId: string;
  connectionId: string;
  ctx: Awaited<ReturnType<typeof seedOrgWithOwner>>["ctx"];
}

async function seedScope(db: TestDb, label: string): Promise<Scope> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
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
    organizationId: org.organizationId,
    projectId: project.id,
    connectionId: connection.id,
    ctx: org.ctx,
  };
}

async function completePollRun(
  db: TestDb,
  scope: Scope,
  input: { startedAt: Date; finishedAt: Date; eventsPersisted: number },
): Promise<void> {
  const runs = createPollRunsRepo(db, scope.ctx);
  const started = await runs.start({
    projectId: scope.projectId,
    connectionId: scope.connectionId,
    startedAt: input.startedAt,
  });
  await runs.finish(started.id, {
    status: "completed",
    finishedAt: input.finishedAt,
    outcome: input.eventsPersisted > 0 ? "with_events" : "no_new_events",
    watermarkAdvancedTo: input.eventsPersisted > 0 ? input.finishedAt : null,
    eventsReceived: input.eventsPersisted,
    eventsPersisted: input.eventsPersisted,
    eventsDroppedMalformed: 0,
    sessionsTouched: input.eventsPersisted > 0 ? 1 : 0,
    pagesFetched: 1,
    identityLookupsUsed: 0,
  });
}

function milestoneCount(facts: { retrievedAt: Date | null; readingAt: Date | null }): number {
  return [facts.retrievedAt, facts.readingAt].filter((value) => value !== null).length;
}

async function openAnalysisRun(db: TestDb, scope: Scope, tickAt: Date): Promise<string> {
  const { run } = await createAnalysisRunsRepo(db, scope.ctx).open({
    projectId: scope.projectId,
    tickAt,
  });
  return run.id;
}

describe("first-run status service — two legs, three tables, one read", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("retrievedAt is the first completed poll run that persisted events after arming", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();
    const scope = await seedScope(db, "retrieved");
    await createFirstRunRepo(db, scope.ctx).arm(scope.projectId, ARMED_AT);

    await completePollRun(db, scope, {
      startedAt: ARMED_AT,
      finishedAt: AFTER_ARMING,
      eventsPersisted: 0,
    });
    expect((await createService(db, scope.ctx).read(scope.projectId)).retrievedAt).toBeNull();

    await completePollRun(db, scope, {
      startedAt: AFTER_ARMING,
      finishedAt: LATER,
      eventsPersisted: 3,
    });
    const facts = await createService(db, scope.ctx).read(scope.projectId);
    expect(facts.retrievedAt?.getTime()).toBe(LATER.getTime());
  });

  test("a poll run that completed before arming does not set retrievedAt", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();
    const scope = await seedScope(db, "before-arming");
    await createFirstRunRepo(db, scope.ctx).arm(scope.projectId, ARMED_AT);

    await completePollRun(db, scope, {
      startedAt: BEFORE_ARMING,
      finishedAt: BEFORE_ARMING,
      eventsPersisted: 9,
    });

    expect((await createService(db, scope.ctx).read(scope.projectId)).retrievedAt).toBeNull();
  });

  test("readingAt is the first analysis run started after arming", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();
    const scope = await seedScope(db, "reading");
    await createFirstRunRepo(db, scope.ctx).arm(scope.projectId, ARMED_AT);

    await openAnalysisRun(db, scope, AFTER_ARMING);

    const facts = await createService(db, scope.ctx).read(scope.projectId);
    expect(facts.readingAt?.getTime()).toBe(AFTER_ARMING.getTime());

    expect(facts.endedAt).toBeNull();
    expect(facts.runStatus).toBe("running");
    expect(facts.runOutcome).toBeNull();
  });

  test("the two legs come from two different tables and cannot collapse", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();

    const pollOnly = await seedScope(db, "leg-poll-only");
    await createFirstRunRepo(db, pollOnly.ctx).arm(pollOnly.projectId, ARMED_AT);
    await completePollRun(db, pollOnly, {
      startedAt: ARMED_AT,
      finishedAt: AFTER_ARMING,
      eventsPersisted: 2,
    });

    const pollFacts = await createService(db, pollOnly.ctx).read(pollOnly.projectId);
    expect(pollFacts.retrievedAt?.getTime()).toBe(AFTER_ARMING.getTime());
    expect(pollFacts.readingAt).toBeNull();

    const analysisOnly = await seedScope(db, "leg-analysis-only");
    await createFirstRunRepo(db, analysisOnly.ctx).arm(analysisOnly.projectId, ARMED_AT);
    await openAnalysisRun(db, analysisOnly, AFTER_ARMING);

    const analysisFacts = await createService(db, analysisOnly.ctx).read(analysisOnly.projectId);
    expect(analysisFacts.readingAt?.getTime()).toBe(AFTER_ARMING.getTime());
    expect(analysisFacts.retrievedAt).toBeNull();

    expect(milestoneCount(pollFacts)).toBe(1);
    expect(milestoneCount(analysisFacts)).toBe(1);
  });

  test("readingAt earlier than retrievedAt is returned as-is, not reordered", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();
    const scope = await seedScope(db, "out-of-order");
    await createFirstRunRepo(db, scope.ctx).arm(scope.projectId, ARMED_AT);

    await openAnalysisRun(db, scope, AFTER_ARMING);
    await completePollRun(db, scope, {
      startedAt: AFTER_ARMING,
      finishedAt: LATER,
      eventsPersisted: 4,
    });

    const facts = await createService(db, scope.ctx).read(scope.projectId);

    expect(facts.readingAt?.getTime()).toBe(AFTER_ARMING.getTime());
    expect(facts.retrievedAt?.getTime()).toBe(LATER.getTime());
    expect(facts.readingAt!.getTime()).toBeLessThan(facts.retrievedAt!.getTime());
  });

  test("the service names organization_id on both sides of every join", () => {
    const source = readSourceUnderConstruction({
      repoRelativePath: SERVICE_SOURCE_PATH,
      ownedBy: OWNER,
    });

    expect(findUnscopedTableReads(source)).toEqual([]);
  });

  test("another organization's rows never appear in the assembled facts", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();
    const orgA = await seedScope(db, "tenant-a");
    const orgB = await seedScope(db, "tenant-b");

    await createFirstRunRepo(db, orgB.ctx).arm(orgB.projectId, ARMED_AT);
    await completePollRun(db, orgB, {
      startedAt: ARMED_AT,
      finishedAt: AFTER_ARMING,
      eventsPersisted: 7,
    });
    await openAnalysisRun(db, orgB, AFTER_ARMING);

    await createFirstRunRepo(db, orgA.ctx).arm(orgA.projectId, ARMED_AT);
    const own = await createService(db, orgA.ctx).read(orgA.projectId);
    expect(own.armedAt?.getTime()).toBe(ARMED_AT.getTime());
    expect(own.retrievedAt).toBeNull();
    expect(own.readingAt).toBeNull();
    expect(own.finding).toBeNull();

    const foreign = await createService(db, orgA.ctx).read(orgB.projectId);
    expect(foreign.armedAt).toBeNull();
    expect(foreign.retrievedAt).toBeNull();
    expect(foreign.readingAt).toBeNull();
  });

  test("a project with no rows at all yields all-null facts, not a throw", async () => {
    const createService = await loadCreateService();
    const scope = await seedScope(db, "zero-rows");

    const facts = await createService(db, scope.ctx).read(scope.projectId);
    expect(facts).toEqual({
      armedAt: null,
      retrievedAt: null,
      readingAt: null,
      endedAt: null,
      runStatus: null,
      runOutcome: null,
      finding: null,
    });
  });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function findUnscopedTableReads(source: string): string[] {
  const clean = stripComments(source);
  const offenders: string[] = [];

  for (const statement of clean.split(";")) {
    if (!statement.includes(".from(")) continue;

    const tables = new Set<string>();
    for (const match of statement.matchAll(/\.from\(\s*(\w+)/g)) {
      if (match[1]) tables.add(match[1]);
    }
    for (const match of statement.matchAll(/\.\w*[Jj]oin\(\s*(\w+)/g)) {
      if (match[1]) tables.add(match[1]);
    }

    for (const table of tables) {
      // A read is scoped when the statement hand-names the org predicate for the
      // table, or takes it from the scope helper (`s.org` / `s.owned`).
      const scoped = new RegExp(
        String.raw`eq\(\s*${table}\.organizationId\s*,\s*ctx\.organizationId\s*\)` +
          String.raw`|s\.(org|owned)\(\s*${table}\b`,
      );
      if (!scoped.test(statement)) {
        offenders.push(table);
      }
    }
  }

  return offenders;
}

const CLEAN_FIXTURE = `
  const rows = await db
    .select({ finishedAt: pollRuns.finishedAt })
    .from(pollRuns)
    .innerJoin(firstRunState, eq(pollRuns.projectId, firstRunState.projectId))
    .where(
      and(
        eq(pollRuns.organizationId, ctx.organizationId),
        eq(firstRunState.organizationId, ctx.organizationId),
        eq(pollRuns.projectId, projectId),
      ),
    );
`;

const OFFENDER_FIXTURE = `
  const rows = await db
    .select({ finishedAt: pollRuns.finishedAt })
    .from(pollRuns)
    .innerJoin(firstRunState, eq(pollRuns.projectId, firstRunState.projectId))
    .where(
      and(
        eq(pollRuns.organizationId, ctx.organizationId),
        eq(pollRuns.projectId, projectId),
      ),
    );
`;

const SCOPE_HELPER_FIXTURE = `
  const rows = await db
    .select({ finishedAt: pollRuns.finishedAt })
    .from(pollRuns)
    .innerJoin(firstRunState, eq(pollRuns.projectId, firstRunState.projectId))
    .where(
      and(
        s.owned(pollRuns, eq(pollRuns.projectId, projectId)),
        s.org(firstRunState),
      ),
    );
`;

describe("planted-offender control — proving row 6 bites", () => {
  test("the scanner passes a statement that names organization_id on both sides", () => {
    expect(findUnscopedTableReads(CLEAN_FIXTURE)).toEqual([]);
  });

  test("the scanner passes a statement scoped through the scope helper on both sides", () => {
    expect(findUnscopedTableReads(SCOPE_HELPER_FIXTURE)).toEqual([]);
  });

  test("the scanner flags the joined table that carries no organization predicate", () => {
    expect(findUnscopedTableReads(OFFENDER_FIXTURE)).toEqual(["firstRunState"]);
  });

  test("the scanner finds the tables it claims to check in the shipped precedent", () => {
    const precedent = readSourceUnderConstruction({
      repoRelativePath: "packages/db/src/services/events-counter.service.ts",
      ownedBy: "already shipped (O-003)",
    });
    expect(stripComments(precedent)).toContain(".innerJoin(");
    expect(findUnscopedTableReads(precedent)).toEqual([]);
  });
});
