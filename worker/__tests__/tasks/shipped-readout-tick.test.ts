// The one tick with two passes (.ai/adds/o-053-report-shipped.md Decision 5), driven over a
// real database with the poster faked at the dispatch seam only — the tick posts nothing
// itself (Decision 1). RED in Wave 0: the task, the two tables, the two emitters and the copy
// are all absent, and each is loaded rather than statically imported so a missing export
// reddens its own test instead of taking the whole file down with it.
//
// Row surgery goes through raw SQL rather than drizzle operators because the worker workspace
// declares no drizzle-orm dependency, and every test opens its own PGlite instance.
import { readFileSync } from "node:fs";

import { afterAll, describe, expect, test } from "bun:test";

import { schema } from "@growthmind/db";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  seedConnection,
  seedEvents,
  seedOrgWithOwner,
  seedProject,
  seedSession,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type SeededProject,
  type TestDb,
  type TestDbHandle,
} from "@growthmind/db/testing";
import {
  URL_PATH_NORMALISATION_VERSION,
  type PostRequest,
  type TenantContext,
} from "@growthmind/shared";

import {
  connectSlackChannel,
  dispatchJobsOf,
  dispatchPayloadOf,
  loudPoster,
  refusingPoster,
  runAllDispatchJobs,
  slackConnectionRowFor,
  type MirrorTaskLogger,
} from "../../../packages/db/__tests__/helpers/o051-contracts";
import {
  assertUnderConstruction,
  loadUnderConstruction,
  loadValueUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../../packages/shared/__tests__/onboarding/module-under-construction";

const NAMES = laneNames("o053-readout-tick");

const TICK_OWNER = "O-053 wave 4 (worker/src/tasks/shipped-readout-tick.ts, ADD Decision 5c)";

const EMITTER_OWNER = "O-053 wave 2 (packages/db/src/notifications/change-*.ts, ADD Decision 1)";

const REPO_OWNER = "O-053 wave 2 (packages/db/src/repositories/shipped-changes.repo.ts, R6)";

const SCHEMA_OWNER = "O-053 wave 1 (packages/db/src/schema/shipped-*.ts, ADD Decision 3c)";

const COPY_OWNER = "O-053 wave 1 (packages/shared/src/findings/messages.ts, ADD Decision 6e)";

const TYPES_OWNER = "O-053 wave 1 (packages/shared/src/shipped/types.ts, R1)";

// 60s: a cold PGlite boot blows bun's 5s default; the same figure every DB-backed suite uses.
const COLD_BOOT_BUDGET_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1_000;

const PAGE = "/reports";

const CHANGE = "CSV export";

const CHANNEL = "C0READOUT01";

const FAULT_PAGE = "/o053-fault";

// The product's own window (FIX_RESULTS_WINDOW_DAYS), stated as instants so the fixtures can
// seed sessions inside it without recomputing a rule the product owns.
const REPORTED_AT = new Date("2026-08-09T09:00:00.000Z");
const READOUT_DUE_AT = new Date("2026-08-23T09:00:00.000Z");
const IN_WINDOW_AT = new Date("2026-08-12T10:00:00.000Z");
const BEFORE_DUE_AT = new Date("2026-08-22T09:00:00.000Z");

// Comfortably clear of the ratified spine floor of 30, and deliberately not sitting on it: the
// equality boundary belongs to packages/core/__tests__/shipped/floors.test.ts.
const ELIGIBLE_SESSIONS = 34;

const REPO_ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const SCAN_SKIPPED = [/(^|\/)node_modules\//, /(^|\/)\.next\//, /(^|\/)__tests__\//, /\.d\.ts$/];

function repoFiles(pattern: string): readonly string[] {
  const found: string[] = [];
  for (const entry of new Bun.Glob(pattern).scanSync({ cwd: REPO_ROOT })) {
    const file = entry.replaceAll("\\", "/");
    if (SCAN_SKIPPED.some((skipped) => skipped.test(file))) continue;
    found.push(file);
  }
  return found.toSorted();
}

function readRepoFile(file: string): string {
  return readFileSync(`${REPO_ROOT}/${file}`, "utf8");
}

const handles: TestDbHandle[] = [];

async function openDb(): Promise<TestDb> {
  const handle = await createTestDb();
  handles.push(handle);
  await stubGraphileAddJob(handle.db);
  return handle.db;
}

afterAll(async () => {
  await Promise.all(handles.map((handle) => handle.close()));
});

interface MirrorShippedReadoutDeps {
  readonly db: TestDb;
  readonly now: () => Date;
  readonly logger: MirrorTaskLogger;
}

type RunShippedReadoutTick = (deps: MirrorShippedReadoutDeps) => Promise<void>;

const loadReadoutTick = (): Promise<RunShippedReadoutTick> =>
  loadUnderConstruction<RunShippedReadoutTick>({
    modulePath: underConstructionSpecifier("worker/src/tasks/shipped-readout-tick"),
    exportName: "runShippedReadoutTick",
    ownedBy: TICK_OWNER,
  });

// R6's pinned contract, mirrored so a Wave 2 signature drift fails at the call rather than here.
interface MirrorReportShippedInput {
  readonly projectId: string;
  readonly page: string;
  readonly description: string;
  readonly reportedAt: Date;
  readonly readoutDueAt: Date;
  readonly control?: string;
}

type MirrorShippedChangesRepo = {
  reportShipped(input: MirrorReportShippedInput): Promise<{ readonly id: string }>;
};

type CreateShippedChangesRepo = (db: TestDb, ctx: TenantContext) => MirrorShippedChangesRepo;

const loadShippedChangesRepo = (): Promise<CreateShippedChangesRepo> =>
  loadUnderConstruction<CreateShippedChangesRepo>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/shipped-changes.repo"),
    exportName: "createShippedChangesRepo",
    ownedBy: REPO_OWNER,
  });

type EmitChangeReported = (
  db: TestDb,
  organizationId: string,
  input: { readonly changeId: string },
) => Promise<void>;

const loadEmitChangeReported = (): Promise<EmitChangeReported> =>
  loadUnderConstruction<EmitChangeReported>({
    modulePath: underConstructionSpecifier("packages/db/src/notifications/change-reported"),
    exportName: "emitChangeReported",
    ownedBy: EMITTER_OWNER,
  });

type AnyTable = Parameters<TestDb["insert"]>[0];

function shippedTable(name: string): AnyTable {
  const table = (schema as unknown as Record<string, unknown>)[name];

  assertUnderConstruction(table !== undefined, {
    contract: `the \`${name}\` table on the @growthmind/db schema barrel`,
    ownedBy: SCHEMA_OWNER,
  });

  return table as AnyTable;
}

interface ShippedCopy {
  readonly nobody: string;
  readonly pageReach: string;
  readonly promise: string;
  readonly reach: string;
  readonly spellingChanged: string;
  readonly spineCorpus: string;
  readonly unverified: string;
  readonly verdictQuestion: string;
}

let copyOnce: Promise<ShippedCopy> | null = null;

function shippedCopy(): Promise<ShippedCopy> {
  copyOnce ??= (async (): Promise<ShippedCopy> => {
    const one = (exportName: string): Promise<string> =>
      loadValueUnderConstruction<string>({
        modulePath: underConstructionSpecifier("packages/shared/src/findings/messages.ts"),
        exportName,
        ownedBy: COPY_OWNER,
      });

    return {
      nobody: await one("SHIPPED_NOBODY_TEMPLATE"),
      pageReach: await one("SHIPPED_PAGE_REACH_TEMPLATE"),
      promise: await one("SHIPPED_PROMISE_TEMPLATE"),
      reach: await one("SHIPPED_REACH_TEMPLATE"),
      spellingChanged: await one("SHIPPED_SPELLING_CHANGED_TEMPLATE"),
      spineCorpus: await one("SHIPPED_SPINE_CORPUS_LINE"),
      unverified: await one("SHIPPED_UNVERIFIED_LINE"),
      verdictQuestion: await one("SHIPPED_VERDICT_QUESTION"),
    };
  })();

  return copyOnce;
}

const verdictWindowDaysDefault = (): Promise<number> =>
  loadValueUnderConstruction<number>({
    modulePath: underConstructionSpecifier("packages/shared/src/shipped/types.ts"),
    exportName: "VERDICT_WINDOW_DAYS_DEFAULT",
    ownedBy: TYPES_OWNER,
  });

interface RecordingLogger extends MirrorTaskLogger {
  readonly infos: string[];
  readonly warns: string[];
  readonly errors: string[];
}

function recordingLogger(): RecordingLogger {
  const infos: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];

  return {
    infos,
    warns,
    errors,
    info: (message: string) => infos.push(message),
    warn: (message: string) => warns.push(message),
    error: (message: string) => errors.push(message),
  };
}

async function runTick(db: TestDb, at: Date, logger: MirrorTaskLogger): Promise<void> {
  const tick = await loadReadoutTick();
  await tick({ db, now: () => new Date(at.getTime()), logger });
}

let seedCount = 0;

interface Fixture {
  readonly org: SeededOrgWithOwner;
  readonly project: SeededProject;
  readonly connectionId: string;
}

async function seedOrgAndProject(db: TestDb, label: string): Promise<Fixture> {
  seedCount += 1;
  const suffix = `${label}-${String(seedCount)}`;

  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(suffix),
    userName: NAMES.userName(suffix),
    email: NAMES.email(suffix),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(suffix),
  });
  const connection = await seedConnection(db, {
    organizationId: org.organizationId,
    projectId: project.id,
  });

  return { org, project, connectionId: connection.id };
}

async function reportChange(
  db: TestDb,
  fixture: Fixture,
  overrides: { readonly page?: string; readonly description?: string } = {},
): Promise<{ readonly id: string }> {
  const createRepo = await loadShippedChangesRepo();

  return createRepo(db, fixture.org.ctx).reportShipped({
    projectId: fixture.project.id,
    page: overrides.page ?? PAGE,
    description: overrides.description ?? CHANGE,
    reportedAt: REPORTED_AT,
    readoutDueAt: READOUT_DUE_AT,
  });
}

// One session per person, each with a pageview at the change's page inside the window, so the
// at-page denominator is the whole cohort and the claim clears the spine floor.
async function seedAtPageCohort(db: TestDb, fixture: Fixture, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const token = `${fixture.project.id.slice(0, 8)}-${String(index)}`;

    const session = await seedSession(db, {
      organizationId: fixture.org.organizationId,
      projectId: fixture.project.id,
      connectionId: fixture.connectionId,
      sessionKey: `o053-session-${token}`,
      identityKey: `o053-identity-${token}`,
      identityResolution: "resolved",
      entryUrlPath: PAGE,
      startedAt: IN_WINDOW_AT,
    });

    await seedEvents(db, [
      {
        organizationId: fixture.org.organizationId,
        projectId: fixture.project.id,
        connectionId: fixture.connectionId,
        sessionId: session.id,
        sourceEventId: `o053-event-${token}`,
        occurredAt: IN_WINDOW_AT,
        urlPath: PAGE,
      },
    ]);
  }
}

interface ChangeRow {
  readonly id: string;
  readonly state: string;
  readonly abandonedReason: string | null;
  readonly readOutAt: Date | null;
  readonly closedAt: Date | null;
}

async function allChangeRows(db: TestDb): Promise<readonly ChangeRow[]> {
  const rows = await db.select().from(shippedTable("shippedChanges"));
  return rows as unknown as readonly ChangeRow[];
}

// The full change-key scope, never a limit-1 helper: a "most recent" lookup reports success on
// a duplicated row, which is exactly what AC-G11 exists to catch (.ai/patterns.md #1).
async function changeRowsFor(db: TestDb, changeId: string): Promise<readonly ChangeRow[]> {
  return (await allChangeRows(db)).filter((row) => row.id === changeId);
}

async function changeRowsInState(db: TestDb, state: string): Promise<readonly ChangeRow[]> {
  return (await allChangeRows(db)).filter((row) => row.state === state);
}

async function readoutRowsFor(db: TestDb, changeId: string) {
  const rows = await db.select().from(schema.notifications);
  return rows.filter(
    (row) =>
      String(row.type) === "change_readout" &&
      String(row.subjectKind) === "shipped_change" &&
      row.subjectId === changeId,
  );
}

interface VerdictRow {
  readonly changeId: string;
  readonly verdict: string;
}

async function verdictRowsFor(db: TestDb, changeId: string): Promise<readonly VerdictRow[]> {
  const rows = (await db
    .select()
    .from(shippedTable("shippedChangeVerdicts"))) as unknown as readonly VerdictRow[];
  return rows.filter((row) => row.changeId === changeId);
}

async function notificationRowsFor(db: TestDb, organizationId: string) {
  const rows = await db.select().from(schema.notifications);
  return rows.filter((row) => row.organizationId === organizationId);
}

async function sendRowsFor(db: TestDb, notificationId: string) {
  const rows = await db.select().from(schema.notificationSends);
  return rows.filter((row) => row.notificationId === notificationId);
}

// D12 has no writer inside the fixture's reach: the version is stamped from the current
// constant at insert, so the only way to age a row is to age the column.
async function agePageSpelling(db: TestDb, changeId: string): Promise<void> {
  await db.execute(
    `update shipped_changes set page_normalisation_version = ${String(
      URL_PATH_NORMALISATION_VERSION - 1,
    )} where id = '${changeId}'`,
  );
}

async function deleteProject(db: TestDb, projectId: string): Promise<void> {
  await db.execute(`delete from projects where id = '${projectId}'`);
}

// A per-row fault that fires only when the readout pass tries to claim this one row, so what
// this asserts is `isolated()`'s per-row boundary and not a whole-table outage.
async function plantReadoutFault(db: TestDb, page: string): Promise<void> {
  await db.execute(
    `alter table shipped_changes add constraint o053_readout_fault ` +
      `check (state <> 'read_out' or page <> '${page}')`,
  );
}

function bodyOf(request: PostRequest): string {
  return `${request.fallbackText}\n${JSON.stringify(request.blocks)}`;
}

// Asserted at the rendered value rather than at the template (../shared/standards.md): the
// placeholders are what carry the counts, so the literal segments around them are the claim.
function rendersTemplate(body: string, template: string): boolean {
  const segments = template
    .split(/\{[a-zA-Z]+\}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 3);

  return segments.length > 0 && segments.every((segment) => body.includes(segment));
}

async function postedFor(db: TestDb): Promise<readonly PostRequest[]> {
  const recorder = loudPoster();
  await runAllDispatchJobs(db, recorder.poster);
  return recorder.posted;
}

describe("the template matcher's own controls", () => {
  test("a rendered sentence matches its template and an empty body matches nothing", async () => {
    const copy = await shippedCopy();

    expect(rendersTemplate(copy.verdictQuestion, copy.verdictQuestion)).toBe(true);
    expect(rendersTemplate("", copy.verdictQuestion)).toBe(false);
    expect(
      rendersTemplate(
        "CSV export — 212 people reached /reports while I was watching.",
        copy.pageReach,
      ),
    ).toBe(true);
    expect(rendersTemplate("nothing was said about anyone", copy.pageReach)).toBe(false);
  });
});

describe("the readout pass answers once per due row", () => {
  test(
    "three due rows produce three readouts, one each",
    async () => {
      const db = await openDb();
      const fixture = await seedOrgAndProject(db, "three-due");
      await seedAtPageCohort(db, fixture, ELIGIBLE_SESSIONS);

      const changes = [
        await reportChange(db, fixture, { page: "/reports", description: "CSV export" }),
        await reportChange(db, fixture, { page: "/settings", description: "Timezone picker" }),
        await reportChange(db, fixture, { page: "/findings", description: "Severity filter" }),
      ];

      await runTick(db, READOUT_DUE_AT, recordingLogger());

      for (const change of changes) {
        expect(await readoutRowsFor(db, change.id)).toHaveLength(1);
        expect((await changeRowsFor(db, change.id))[0]?.state).toBe("read_out");
      }

      expect(await notificationRowsFor(db, fixture.org.organizationId)).toHaveLength(
        changes.length,
      );
    },
    COLD_BOOT_BUDGET_MS,
  );

  test(
    "zero due rows logs a count and writes nothing",
    async () => {
      const db = await openDb();
      const fixture = await seedOrgAndProject(db, "none-due");
      const change = await reportChange(db, fixture);
      const logger = recordingLogger();

      await runTick(db, BEFORE_DUE_AT, logger);

      expect(await notificationRowsFor(db, fixture.org.organizationId)).toEqual([]);
      expect((await changeRowsFor(db, change.id))[0]?.state).toBe("reported");

      // A silent no-op and a scan that read nothing are indistinguishable without the count.
      expect(logger.infos.length).toBeGreaterThan(0);
      expect(logger.infos.some((message) => /\b0\b/.test(message))).toBe(true);
      expect(logger.errors).toEqual([]);
    },
    COLD_BOOT_BUDGET_MS,
  );

  test(
    "a readout re-run on a row already read out writes no second readout and no second verdict",
    async () => {
      const db = await openDb();
      const fixture = await seedOrgAndProject(db, "re-run");
      await connectSlackChannel(db, fixture.org, CHANNEL);
      await seedAtPageCohort(db, fixture, ELIGIBLE_SESSIONS);
      const change = await reportChange(db, fixture);

      await runTick(db, READOUT_DUE_AT, recordingLogger());
      const firstReadOutAt = (await changeRowsFor(db, change.id))[0]?.readOutAt;

      await runTick(db, new Date(READOUT_DUE_AT.getTime() + 60 * 60 * 1_000), recordingLogger());

      // Queried directly by change key over the whole table, so a duplicate row is visible.
      expect(await readoutRowsFor(db, change.id)).toHaveLength(1);
      expect(await verdictRowsFor(db, change.id)).toHaveLength(0);

      // The clock does not move either: a second run must not restamp the readout instant.
      expect((await changeRowsFor(db, change.id))[0]?.readOutAt?.toISOString()).toBe(
        firstReadOutAt?.toISOString(),
      );

      expect(await postedFor(db)).toHaveLength(1);
    },
    COLD_BOOT_BUDGET_MS,
  );

  test(
    "a poster that refuses leaves the readout state persisted and the row not orphaned",
    async () => {
      const db = await openDb();
      const fixture = await seedOrgAndProject(db, "poster-refuses");
      await connectSlackChannel(db, fixture.org, CHANNEL);
      await seedAtPageCohort(db, fixture, ELIGIBLE_SESSIONS);
      const change = await reportChange(db, fixture);

      await runTick(db, READOUT_DUE_AT, recordingLogger());

      // The retryable arm: the receipt commits and the task throws, which is the contract
      // rather than a fault of the drive.
      await runAllDispatchJobs(db, refusingPoster("call_failed").poster, { swallowThrows: true });

      // The fact survives its delivery (D8, FR-4.3).
      expect((await changeRowsFor(db, change.id))[0]?.state).toBe("read_out");
      expect(await changeRowsInState(db, "reported")).toEqual([]);

      const readouts = await readoutRowsFor(db, change.id);
      expect(readouts).toHaveLength(1);

      const readoutId = readouts[0]?.id ?? "";

      // The failure is recorded rather than swallowed, and the dispatch job — never the tick —
      // owns the retry.
      const receipts = await sendRowsFor(db, readoutId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.status).not.toBe("sent");

      const owned = dispatchJobsOf(await capturedJobs(db))
        .map(dispatchPayloadOf)
        .filter((payload) => payload.notificationId === readoutId);
      expect(owned).toHaveLength(1);
    },
    COLD_BOOT_BUDGET_MS,
  );

  test(
    "one org's fault does not starve the rest of the tick",
    async () => {
      const db = await openDb();

      const first = await seedOrgAndProject(db, "isolation-first");
      const faulty = await seedOrgAndProject(db, "isolation-faulty");
      const third = await seedOrgAndProject(db, "isolation-third");

      for (const fixture of [first, faulty, third]) {
        await seedAtPageCohort(db, fixture, ELIGIBLE_SESSIONS);
      }

      const healthyOne = await reportChange(db, first);
      const broken = await reportChange(db, faulty, { page: FAULT_PAGE });
      const healthyTwo = await reportChange(db, third);

      await plantReadoutFault(db, FAULT_PAGE);

      const logger = recordingLogger();
      await runTick(db, READOUT_DUE_AT, logger);

      expect(await readoutRowsFor(db, healthyOne.id)).toHaveLength(1);
      expect(await readoutRowsFor(db, healthyTwo.id)).toHaveLength(1);
      expect(await readoutRowsFor(db, broken.id)).toHaveLength(0);

      // The fault is loud: a swallowed one is how a whole org stops being answered in silence.
      expect(logger.errors.length).toBeGreaterThan(0);
    },
    COLD_BOOT_BUDGET_MS,
  );
});

describe("the lapse pass closes what the founder never answered", () => {
  test(
    "a row read out eight days ago closes with no verdict given and one read out six days ago stays open",
    async () => {
      const db = await openDb();

      const lapsing = await seedOrgAndProject(db, "lapse-eight");
      const open = await seedOrgAndProject(db, "lapse-six");
      await seedAtPageCohort(db, lapsing, ELIGIBLE_SESSIONS);
      await seedAtPageCohort(db, open, ELIGIBLE_SESSIONS);

      const lapsed = await reportChange(db, lapsing);
      const inside = await reportChange(db, open);

      await runTick(db, READOUT_DUE_AT, recordingLogger());
      expect((await changeRowsFor(db, lapsed.id))[0]?.state).toBe("read_out");

      // Six days after the readout: inside the ratified seven-day default (HC-4).
      await runTick(db, new Date(READOUT_DUE_AT.getTime() + 6 * DAY_MS), recordingLogger());
      expect((await changeRowsFor(db, inside.id))[0]?.state).toBe("read_out");
      expect(await verdictRowsFor(db, inside.id)).toHaveLength(0);

      await runTick(db, new Date(READOUT_DUE_AT.getTime() + 8 * DAY_MS), recordingLogger());

      const closed = (await changeRowsFor(db, lapsed.id))[0];
      expect(closed?.state).toBe("closed");
      expect(closed?.closedAt).not.toBeNull();

      const verdicts = await verdictRowsFor(db, lapsed.id);
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0]?.verdict).toBe("no_verdict_given");

      // Six inside and eight outside only bracket the window if the default really is seven.
      expect(await verdictWindowDaysDefault()).toBe(7);
    },
    COLD_BOOT_BUDGET_MS,
  );

  test(
    "an org that set a three-day window closes at day four while an org with no settings row does not",
    async () => {
      const db = await openDb();

      const impatient = await seedOrgAndProject(db, "window-three");
      const defaulted = await seedOrgAndProject(db, "window-default");
      await seedAtPageCohort(db, impatient, ELIGIBLE_SESSIONS);
      await seedAtPageCohort(db, defaulted, ELIGIBLE_SESSIONS);

      await db.insert(schema.notificationSettings).values({
        organizationId: impatient.org.organizationId,
        verdictWindowDays: 3,
      });

      // No settings row at all for the other org — absence is the default, which only a LEFT
      // JOIN can see. Seeding a row set to seven would pass against an INNER JOIN too.
      const settingsRows = (await db.select().from(schema.notificationSettings)).filter(
        (row) => row.organizationId === defaulted.org.organizationId,
      );
      expect(settingsRows).toEqual([]);

      const early = await reportChange(db, impatient);
      const later = await reportChange(db, defaulted);

      await runTick(db, READOUT_DUE_AT, recordingLogger());
      await runTick(db, new Date(READOUT_DUE_AT.getTime() + 4 * DAY_MS), recordingLogger());

      expect((await changeRowsFor(db, early.id))[0]?.state).toBe("closed");
      expect((await verdictRowsFor(db, early.id))[0]?.verdict).toBe("no_verdict_given");

      expect((await changeRowsFor(db, later.id))[0]?.state).toBe("read_out");
      expect(await verdictRowsFor(db, later.id)).toHaveLength(0);
    },
    COLD_BOOT_BUDGET_MS,
  );
});

describe("four states, zero orphans", () => {
  test(
    "a change whose project is gone reaches abandoned with a reason",
    async () => {
      const db = await openDb();
      const fixture = await seedOrgAndProject(db, "project-gone");
      const change = await reportChange(db, fixture);

      await deleteProject(db, fixture.project.id);

      // The change has to outlive its project or the terminal state has nowhere to be written:
      // a cascade from projects deletes the very row this state exists to record.
      expect(await changeRowsFor(db, change.id)).toHaveLength(1);

      await runTick(db, READOUT_DUE_AT, recordingLogger());

      const row = (await changeRowsFor(db, change.id))[0];
      expect(row?.state).toBe("abandoned");
      expect(row?.abandonedReason).toBe("project_gone");
      expect(await changeRowsInState(db, "reported")).toEqual([]);
    },
    COLD_BOOT_BUDGET_MS,
  );

  test(
    "a stale page spelling reaches read out with the cannot-tell branch, not abandoned",
    async () => {
      const db = await openDb();
      const copy = await shippedCopy();
      const fixture = await seedOrgAndProject(db, "stale-spelling");
      await connectSlackChannel(db, fixture.org, CHANNEL);
      await seedAtPageCohort(db, fixture, ELIGIBLE_SESSIONS);
      const change = await reportChange(db, fixture);

      await agePageSpelling(db, change.id);

      await runTick(db, READOUT_DUE_AT, recordingLogger());

      // Going silent on a promised date is worse than saying we cannot put an honest number on
      // it, so this reaches read_out and closes like any other readout (Decision 5a).
      const row = (await changeRowsFor(db, change.id))[0];
      expect(row?.state).toBe("read_out");
      expect(row?.abandonedReason).toBeNull();

      const posted = await postedFor(db);
      expect(posted).toHaveLength(1);
      const body = bodyOf(posted[0] as PostRequest);

      expect(rendersTemplate(body, copy.spellingChanged)).toBe(true);
      expect(rendersTemplate(body, copy.verdictQuestion)).toBe(true);

      // No used / not-used claim of any kind rides out on a spelling we could not join.
      expect(rendersTemplate(body, copy.pageReach)).toBe(false);
      expect(rendersTemplate(body, copy.reach)).toBe(false);
      expect(rendersTemplate(body, copy.nobody)).toBe(false);
    },
    COLD_BOOT_BUDGET_MS,
  );
});

describe("the readout reaches the org's channel through the real dispatch path (D11)", () => {
  test(
    "the readout tick and the dispatch task together put one readout in the org channel",
    async () => {
      const db = await openDb();
      const copy = await shippedCopy();
      const fixture = await seedOrgAndProject(db, "wire-readout");
      await connectSlackChannel(db, fixture.org, CHANNEL);
      await seedAtPageCohort(db, fixture, ELIGIBLE_SESSIONS);
      await reportChange(db, fixture);

      await runTick(db, READOUT_DUE_AT, recordingLogger());

      // The tick emits and the dispatch task posts: a producer test beside a consumer test
      // would prove nothing about the hop between them.
      expect(dispatchJobsOf(await capturedJobs(db))).toHaveLength(1);

      const posted = await postedFor(db);
      expect(posted).toHaveLength(1);

      const body = bodyOf(posted[0] as PostRequest);
      expect(rendersTemplate(body, copy.pageReach)).toBe(true);
      expect(body.includes(copy.spineCorpus)).toBe(true);
      expect(rendersTemplate(body, copy.verdictQuestion)).toBe(true);
      expect(body.includes(String(ELIGIBLE_SESSIONS))).toBe(true);
    },
    COLD_BOOT_BUDGET_MS,
  );

  test(
    "a teammate who set nothing up receives both messages in the same org channel",
    async () => {
      const db = await openDb();
      const fixture = await seedOrgAndProject(db, "teammate");
      await connectSlackChannel(db, fixture.org, CHANNEL);
      await seedAtPageCohort(db, fixture, ELIGIBLE_SESSIONS);

      // Actor A holds the API key and reports; teammate B configured nothing and holds no key.
      const teammate = await seedOrgWithOwner(db, {
        orgName: NAMES.orgName("teammate-b"),
        userName: NAMES.userName("teammate-b"),
        email: NAMES.email("teammate-b"),
      });
      expect(teammate.userId).not.toBe(fixture.org.userId);

      const change = await reportChange(db, fixture);
      const emitChangeReported = await loadEmitChangeReported();
      await emitChangeReported(db, fixture.org.organizationId, { changeId: change.id });
      await runTick(db, READOUT_DUE_AT, recordingLogger());

      const posted = await postedFor(db);
      expect(posted).toHaveLength(2);

      const connection = await slackConnectionRowFor(db, fixture.org.organizationId);
      const orgChannel = connection.channelId ?? "";
      expect(orgChannel).toBe(CHANNEL);
      for (const request of posted) {
        expect(request.channelId).toBe(orgChannel);
      }

      // Both rows say org, which is what the teammate's copy of the message rests on.
      const rows = await notificationRowsFor(db, fixture.org.organizationId);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.audience).toBe("org");
      }
    },
    COLD_BOOT_BUDGET_MS,
  );

  test("no code path on the readout journey narrows delivery to a person or their key", () => {
    const narrowing =
      /audience:\s*["'](?:user|owner)["']|postEphemeral|users\.conversations|im\.open|response_url/;

    const journey = [
      "worker/src/tasks/shipped-readout-tick.ts",
      "packages/db/src/notifications/change-reported.ts",
      "packages/db/src/notifications/change-readout.ts",
    ];

    for (const file of journey) {
      const source = readSourceUnderConstruction({
        repoRelativePath: file,
        ownedBy: file.startsWith("worker/") ? TICK_OWNER : EMITTER_OWNER,
      });

      expect(`${file}: ${String(source.length > 0)}`).toBe(`${file}: true`);
      expect(`${file}: ${String(narrowing.test(source))}`).toBe(`${file}: false`);
    }

    // The matcher is not a pattern that could never fire.
    expect(narrowing.test('  audience: "owner",')).toBe(true);
    expect(narrowing.test('  audience: "org",')).toBe(false);
  });

  test(
    "the acknowledgement names both counts, the date, and that we are taking their word for it",
    async () => {
      const db = await openDb();
      const copy = await shippedCopy();
      const fixture = await seedOrgAndProject(db, "acknowledgement");
      await connectSlackChannel(db, fixture.org, CHANNEL);

      const change = await reportChange(db, fixture);
      const emitChangeReported = await loadEmitChangeReported();
      await emitChangeReported(db, fixture.org.organizationId, { changeId: change.id });

      const posted = await postedFor(db);
      expect(posted).toHaveLength(1);
      const body = bodyOf(posted[0] as PostRequest);

      // Both counts are named by the promise itself, before the window runs (FR-5.1).
      expect(rendersTemplate(body, copy.promise)).toBe(true);
      expect(body.includes(String(READOUT_DUE_AT.getUTCDate()))).toBe(true);
      expect(
        body.includes(READOUT_DUE_AT.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })),
      ).toBe(true);

      // Nothing here trusts the change is live, and the absence of that check is stated out
      // loud rather than papered over (FR-1.5).
      expect(body.includes(copy.unverified)).toBe(true);
    },
    COLD_BOOT_BUDGET_MS,
  );
});

describe("the readout's system actor belongs to the worker alone (D7)", () => {
  test("SYSTEM_ACTOR.SHIPPED_READOUT appears in no apps/web source file", () => {
    const NEEDLE = "SHIPPED_READOUT";

    const webFiles = repoFiles("apps/web/**/*.{ts,tsx}");
    expect(webFiles.length).toBeGreaterThan(20);

    const offenders = webFiles.filter((file) => readRepoFile(file).includes(NEEDLE));
    expect(offenders).toEqual([]);

    // Non-vacuous only if the actor exists somewhere: the worker owns it and nothing else may.
    const owners = repoFiles("worker/src/**/*.ts").filter((file) =>
      readRepoFile(file).includes(NEEDLE),
    );
    expect(owners.length).toBeGreaterThan(0);
  });
});
