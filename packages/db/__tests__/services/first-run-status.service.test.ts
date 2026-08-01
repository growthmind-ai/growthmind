// AD-6 — the one read that assembles `StagePersistedFacts`. Wave 0d, task 0d.4.
// ADD §9, 8 rows.
//
// ###########################################################################
// # THIS FILE IS THE D11 PROOF, AND THE THING IT PROVES IS AN ABSENCE.
// #
// # D11's rule is that a value one surface COMPUTES and another surface
// # CONSUMES dies silently the moment the wire between them is severed: the
// # consumer reads an always-absent field, its "when present…" branch never
// # runs, and every null check downstream reads the permanent absence as the
// # legitimate no-signal case. Producer tests pass. Consumer tests pass. The
// # feature is inert.
// #
// # AD-6's answer is that THE CONSUMER DERIVES EVERY MILESTONE ITSELF, from
// # rows that already exist. There is no producer hand-passing `retrievedAt`
// # on a response field, no optional schema property, and therefore no wire to
// # sever. What this suite can assert is exactly that: each milestone appears
// # because the underlying ROW appears, and disappears because the row does.
// #
// # THE MILESTONE SOURCES (AD-6's own table), so nothing is re-derived here:
// #   retrievedAt -> session_source_poll_runs: min(finished_at), org+project
// #                  scoped, status='completed', events_persisted > 0,
// #                  finished_at >= armed_at
// #   readingAt   -> analysis_runs: min(started_at), org+project scoped,
// #                  started_at >= armed_at
// #   endedAt / runStatus / runOutcome -> that same analysis_runs row
// #   finding     -> findings.listForProject(projectId, { limit: 1 })
// #
// # AND WHY THE TWO LEGS CANNOT COLLAPSE INTO ONE LINE: they are written by
// # TWO DIFFERENT PROCESSES INTO TWO DIFFERENT TABLES AT TWO GENUINELY
// # DIFFERENT TIMES. `session-source-poll.ts` finishes a poll run when the
// # third party's read side finally surfaces the event; `analysis-tick.ts`
// # opens an analysis run when our own lane starts reading it. No single write
// # produces both, and no new column is required — `events_persisted` and a
// # `finished_at` distinct from `started_at` are already persisted.
// ###########################################################################
//
// THE RETURN TYPE IS IMPORTED FROM THE SHARED WAVE 0 MIRROR, not re-declared
// here. `StagePersistedFacts` is this service's OUTPUT and `reduceStage`'s
// INPUT; one declaration read from both ends is the type-level form of the
// same D11 argument.
//
// EVERY BEHAVIOURAL ROW IS RED TODAY:
// `packages/db/src/services/first-run-status.service.ts` is ADD Wave 2's, as
// are `first-run.repo.ts` and migration `0009_*`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  loadUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { createAnalysisRunsRepo } from "../../src/repositories/analysis-runs.repo";
import { createPollRunsRepo } from "../../src/repositories/poll-runs.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import { seedConnection, seedOrgWithOwner, seedProject } from "../helpers/fixtures";
import {
  type CreateFirstRunRepo,
  type CreateFirstRunStatusService,
} from "../helpers/onboarding-contract";

const NAMES = laneNames("first-run-status");

const OWNER = "ADD Wave 2 (packages/db/src/services/first-run-status.service.ts, AD-6)";

const SERVICE_SOURCE_PATH = "packages/db/src/services/first-run-status.service.ts";

/** The founder presses the button. Every predicate below is measured from here. */
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

/**
 * ARMING GOES THROUGH `first-run.repo`, NOT A RAW INSERT.
 *
 * `db-lane-fixtures.ts`'s header says arrange steps may bypass the repositories
 * — and they may — but not here, for a concrete reason rather than a stylistic
 * one: AD-8 states `first_run_state`'s GRAIN and its two stamps and nothing
 * else, so a raw `insert into first_run_state (…)` would have to guess at a
 * primary-key column the ADD never mentions and at whether its default is a
 * database default or one of drizzle's `$defaultFn`s (which a raw statement
 * does not get). Going through the named method depends only on the contract
 * §5 actually states.
 *
 * Every row loads the STATUS SERVICE first, so a Wave 0 red names the file the
 * row is about rather than this fixture's dependency.
 */
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

/**
 * A completed poll run — LEG ONE's only source. `eventsPersisted` is the
 * discriminator AD-6 turns on: a run that completed having persisted nothing is
 * a successful poll that found nothing, and telling a founder "your failed
 * request reached us" on the strength of it would be a claim we cannot support.
 */
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

/** How many of the two legs are present. The pair is the claim — a service
 *  that derived one leg from the other would report two where one was written. */
function milestoneCount(facts: { retrievedAt: Date | null; readingAt: Date | null }): number {
  return [facts.retrievedAt, facts.readingAt].filter((value) => value !== null).length;
}

/** LEG TWO's only source — `analysis_runs.started_at`, stamped from the
 *  caller's tick time (`analysis-runs.repo.ts`: `startedAt: input.tickAt`). */
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

  // --- row 1 ---------------------------------------------------------------
  test("retrievedAt is the first completed poll run that persisted events after arming", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();
    const scope = await seedScope(db, "retrieved");
    await createFirstRunRepo(db, scope.ctx).arm(scope.projectId, ARMED_AT);

    // A run that completed after arming AND PERSISTED NOTHING. It must not set
    // the milestone: the whole promise of the line it renders is "your failed
    // request reached us", and a poll that found nothing is evidence of the
    // opposite. `events_persisted` is already a non-null integer on this table
    // — the discrimination needs no new column.
    await completePollRun(db, scope, {
      startedAt: ARMED_AT,
      finishedAt: AFTER_ARMING,
      eventsPersisted: 0,
    });
    expect((await createService(db, scope.ctx).read(scope.projectId)).retrievedAt).toBeNull();

    // …and one that did persist events sets it, to ITS OWN finished_at.
    await completePollRun(db, scope, {
      startedAt: AFTER_ARMING,
      finishedAt: LATER,
      eventsPersisted: 3,
    });
    const facts = await createService(db, scope.ctx).read(scope.projectId);
    expect(facts.retrievedAt?.getTime()).toBe(LATER.getTime());
  });

  // --- row 2 ---------------------------------------------------------------
  test("a poll run that completed before arming does not set retrievedAt", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();
    const scope = await seedScope(db, "before-arming");
    await createFirstRunRepo(db, scope.ctx).arm(scope.projectId, ARMED_AT);

    // The connection has been polling on its own cadence since long before the
    // founder pressed anything (`next_poll_at` defaults to a 60-second loop).
    // Without the `>= armed_at` predicate the surface would announce "your
    // failed request reached us" on its FIRST PAINT, before the founder had
    // finished breaking anything — the single most damaging way this screen can
    // lie, because it is the claim the whole product is built to earn.
    await completePollRun(db, scope, {
      startedAt: BEFORE_ARMING,
      finishedAt: BEFORE_ARMING,
      eventsPersisted: 9,
    });

    expect((await createService(db, scope.ctx).read(scope.projectId)).retrievedAt).toBeNull();
  });

  // --- row 3 ---------------------------------------------------------------
  test("readingAt is the first analysis run started after arming", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();
    const scope = await seedScope(db, "reading");
    await createFirstRunRepo(db, scope.ctx).arm(scope.projectId, ARMED_AT);

    await openAnalysisRun(db, scope, AFTER_ARMING);

    const facts = await createService(db, scope.ctx).read(scope.projectId);
    expect(facts.readingAt?.getTime()).toBe(AFTER_ARMING.getTime());

    // The run is still open, so the terminal columns are facts-not-yet — null,
    // and null here means "has not finished", never "finished with nothing".
    expect(facts.endedAt).toBeNull();
    expect(facts.runStatus).toBe("running");
    expect(facts.runOutcome).toBeNull();
  });

  // --- row 4 ---------------------------------------------------------------
  test("the two legs come from two different tables and cannot collapse", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();

    // FIXTURE A — only the poll run exists.
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

    // FIXTURE B — only the analysis run exists.
    const analysisOnly = await seedScope(db, "leg-analysis-only");
    await createFirstRunRepo(db, analysisOnly.ctx).arm(analysisOnly.projectId, ARMED_AT);
    await openAnalysisRun(db, analysisOnly, AFTER_ARMING);

    const analysisFacts = await createService(db, analysisOnly.ctx).read(analysisOnly.projectId);
    expect(analysisFacts.readingAt?.getTime()).toBe(AFTER_ARMING.getTime());
    expect(analysisFacts.retrievedAt).toBeNull();

    // EXACTLY ONE MILESTONE EACH. A service that derived the second leg from
    // the first — "we started reading it" inferred from "it reached us" — would
    // render two lines from one write and would announce our own lane starting
    // before it had. Counted rather than asserted field-by-field so the claim
    // is about the pair, not about either field alone.
    expect(milestoneCount(pollFacts)).toBe(1);
    expect(milestoneCount(analysisFacts)).toBe(1);
  });

  // --- row 5 ---------------------------------------------------------------
  test("readingAt earlier than retrievedAt is returned as-is, not reordered", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();
    const scope = await seedScope(db, "out-of-order");
    await createFirstRunRepo(db, scope.ctx).arm(scope.projectId, ARMED_AT);

    // THE DESIGNED OUT-OF-ORDER CASE, not an accident. The hourly analysis cron
    // opens runs for reasons unrelated to the founder's trigger, so leg two can
    // genuinely land before leg one. The log renders whichever lines are
    // non-null, in stamp order.
    await openAnalysisRun(db, scope, AFTER_ARMING);
    await completePollRun(db, scope, {
      startedAt: AFTER_ARMING,
      finishedAt: LATER,
      eventsPersisted: 4,
    });

    const facts = await createService(db, scope.ctx).read(scope.projectId);

    // BOTH SURVIVE, AND NEITHER IS MOVED. The two failure modes this forbids
    // are (a) swapping them so the story reads in the expected order, and (b)
    // nulling `readingAt` because it "cannot" precede `retrievedAt` — which
    // would erase a milestone that genuinely happened.
    expect(facts.readingAt?.getTime()).toBe(AFTER_ARMING.getTime());
    expect(facts.retrievedAt?.getTime()).toBe(LATER.getTime());
    expect(facts.readingAt!.getTime()).toBeLessThan(facts.retrievedAt!.getTime());
  });

  // --- row 6 ---------------------------------------------------------------
  test("the service names organization_id on both sides of every join", () => {
    const source = readSourceUnderConstruction({
      repoRelativePath: SERVICE_SOURCE_PATH,
      ownedBy: OWNER,
    });

    // A HAND-WRITTEN AGGREGATION INHERITS NOTHING. `ScopedDb` is a raw driver
    // union — nothing injects an org filter on a service's behalf, and a join
    // that establishes tenancy on one side only is the D7 path that steps
    // outside the flow. `events-counter.service.ts:81-95` is the discipline
    // this copies: both sides of the join carry the predicate, out loud, and
    // the session table is not trusted to inherit it from the event side or
    // vice versa.
    expect(findUnscopedTableReads(source)).toEqual([]);
  });

  // --- row 7 ---------------------------------------------------------------
  test("another organization's rows never appear in the assembled facts", async () => {
    const createService = await loadCreateService();
    const createFirstRunRepo = await loadCreateFirstRunRepo();
    const orgA = await seedScope(db, "tenant-a");
    const orgB = await seedScope(db, "tenant-b");

    // Org B is busy: armed, polled, and being read. None of it is org A's.
    await createFirstRunRepo(db, orgB.ctx).arm(orgB.projectId, ARMED_AT);
    await completePollRun(db, orgB, {
      startedAt: ARMED_AT,
      finishedAt: AFTER_ARMING,
      eventsPersisted: 7,
    });
    await openAnalysisRun(db, orgB, AFTER_ARMING);

    // Org A armed and nothing has happened for them yet. If any of the three
    // tables were read without its own org predicate, org A would watch org B's
    // product being analysed and would be told it was their own.
    await createFirstRunRepo(db, orgA.ctx).arm(orgA.projectId, ARMED_AT);
    const own = await createService(db, orgA.ctx).read(orgA.projectId);
    expect(own.armedAt?.getTime()).toBe(ARMED_AT.getTime());
    expect(own.retrievedAt).toBeNull();
    expect(own.readingAt).toBeNull();
    expect(own.finding).toBeNull();

    // And the client-supplied project id is not a door either (D7): org A
    // naming org B's project must yield nothing, never org B's facts.
    const foreign = await createService(db, orgA.ctx).read(orgB.projectId);
    expect(foreign.armedAt).toBeNull();
    expect(foreign.retrievedAt).toBeNull();
    expect(foreign.readingAt).toBeNull();
  });

  // --- row 8 ---------------------------------------------------------------
  test("a project with no rows at all yields all-null facts, not a throw", async () => {
    const createService = await loadCreateService();
    const scope = await seedScope(db, "zero-rows");

    // EC-O5. Never armed, never polled, never analysed — the state a founder is
    // in for the whole of steps 1 to 4, which is most of the time they spend on
    // this surface. A `min()` over no rows is NULL and an aggregate DTO built
    // by calling a method on it throws a 500 on the one screen the product
    // exists for. All seven fields are enumerated rather than spot-checked,
    // because "not a throw" is only half the row.
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

// ===========================================================================
// THE SCANNER, AND ITS PLANTED-OFFENDER CONTROL.
//
// The control rows below are GREEN BY DESIGN and are NOT contract rows — the
// ADD's standing rule requires every scanner to ship one, because a scanner
// whose pattern silently matches nothing reports green forever and the
// invariant above becomes decoration. Row 6 is the contract row; these two
// prove row 6 can fail.
// ===========================================================================

/** Removes block and line comments so prose about `organizationId` cannot be
 *  mistaken for a predicate. Same approach as
 *  `__tests__/repositories/no-org-param.test.ts:59-61`. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * Every table read by a statement in `source` that is NOT narrowed by an
 * explicit `eq(<table>.organizationId, ctx.organizationId)` in that same
 * statement.
 *
 * Statement-scoped rather than file-scoped ON PURPOSE. A file-wide "does the
 * word `organizationId` appear?" check is the vacuous version: a service with
 * four statements, three of them scoped, passes it — and the fourth is the
 * leak. Splitting on `;` is crude and sufficient here: drizzle query chains
 * terminate in one, and a false split can only ever ADD offenders (a statement
 * cut in half loses its predicate), never hide one.
 *
 * `.from(X)` and every `…Join(Y, …)` are collected alike, which is what makes
 * this "both sides of every join" rather than "the driving table of every
 * query".
 */
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
      const scoped = new RegExp(
        String.raw`eq\(\s*${table}\.organizationId\s*,\s*ctx\.organizationId\s*\)`,
      );
      if (!scoped.test(statement)) {
        offenders.push(table);
      }
    }
  }

  return offenders;
}

/** Both sides of the join carry the predicate — the shape
 *  `events-counter.service.ts` already ships. */
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

/** THE PLANTED OFFENDER: tenancy established by joining, on one side only.
 *  It compiles, it returns plausible rows, and it is a cross-tenant read. */
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

describe("planted-offender control — proving row 6 bites", () => {
  test("the scanner passes a statement that names organization_id on both sides", () => {
    expect(findUnscopedTableReads(CLEAN_FIXTURE)).toEqual([]);
  });

  test("the scanner flags the joined table that carries no organization predicate", () => {
    expect(findUnscopedTableReads(OFFENDER_FIXTURE)).toEqual(["firstRunState"]);
  });

  test("the scanner finds the tables it claims to check in the shipped precedent", () => {
    // ANTI-VACUITY against the real thing, not only against a fixture:
    // `events-counter.service.ts` is the file AD-6's row cites as the
    // discipline to copy, and it is correct today. If the collector silently
    // matched no tables at all, both fixtures above could still pass by
    // accident — this row cannot.
    const precedent = readSourceUnderConstruction({
      repoRelativePath: "packages/db/src/services/events-counter.service.ts",
      ownedBy: "already shipped (O-003)",
    });
    expect(stripComments(precedent)).toContain(".innerJoin(");
    expect(findUnscopedTableReads(precedent)).toEqual([]);
  });
});
