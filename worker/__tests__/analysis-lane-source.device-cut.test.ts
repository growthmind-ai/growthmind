import { randomUUID } from "node:crypto";

import { and, eq, schema } from "@growthmind/db";
import { createTestDb, seedEvents, seedSession, type TestDb } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  assertUnderConstruction,
  loadModuleUnderConstruction,
  underConstructionSpecifier,
} from "../../packages/shared/__tests__/onboarding/module-under-construction";
import { ANALYSIS_WINDOW_MS, createAnalysisLaneSource } from "../src/analysis-lane-source";
import type { AnalysisLane, AnalysisLogger } from "../src/analysis/types";
import { seedPollableWorkspace, type SeededWorkspace } from "./helpers/wire-fixtures";

const NOW = new Date("2026-07-08T00:00:00.000Z");
const IN_WINDOW_AT = new Date("2026-07-03T09:00:00.000Z");

const ORIGIN = "/pricing";
const DESTINATION = "/checkout";
const DETOUR = "/faq";
const NORMALISATION_VERSION = 1;

const SESSION_STRIDE_MS = 60_000;
const EVENT_STRIDE_MS = 1_000;

const CHROME_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

const SAFARI_ON_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Version/17.0 Mobile/15E148 Safari/604.1";

const UNREADABLE_USER_AGENT = " not-a-user-agent ";

const DETOUR_SESSIONS = 3;
const REACHED_ON_DESKTOP_SESSIONS = 8;
const REACHED_ON_MOBILE_SESSIONS = 7;
const DROPPED_ON_DESKTOP_SESSIONS = 5;
const DROPPED_ON_MOBILE_SESSIONS = 5;
const DROPPED_WITH_NO_READABLE_AGENT_SESSIONS = 2;

const SESSIONS_SEEDED =
  DETOUR_SESSIONS +
  REACHED_ON_DESKTOP_SESSIONS +
  REACHED_ON_MOBILE_SESSIONS +
  DROPPED_ON_DESKTOP_SESSIONS +
  DROPPED_ON_MOBILE_SESSIONS +
  DROPPED_WITH_NO_READABLE_AGENT_SESSIONS;

const SUCCEEDED_ON_DESKTOP = DETOUR_SESSIONS + REACHED_ON_DESKTOP_SESSIONS;
const SUCCEEDED_ON_MOBILE = REACHED_ON_MOBILE_SESSIONS;
const SUCCEEDED_WITH_NO_READABLE_AGENT = 0;

const CUT_TAXONOMY_OWNER =
  "backend-execution-agent, Wave 4 (packages/shared/src/cohort-cuts/cuts.ts, ADD Decision 1)";

const COHORT_CUT_COLUMN_OWNER =
  "backend-execution-agent, Wave 6 (packages/db/src/schema/divergence-points.ts + migration 0026)";

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

// The 11-member closed enum and its two producers are the single source of the labels this
// suite asserts on — hand-copying them here would let the worker and the taxonomy drift.
interface CohortCutTaxonomy {
  readonly surfaceCut: string;
  readonly allCuts: readonly string[];
  readonly browserCut: (family: string) => string;
  readonly deviceCut: (device: string) => string;
}

async function cohortCutTaxonomy(): Promise<CohortCutTaxonomy> {
  const namespace = await loadModuleUnderConstruction({
    modulePath: underConstructionSpecifier("packages/shared/src/cohort-cuts/cuts.ts"),
    ownedBy: CUT_TAXONOMY_OWNER,
  });

  const surfaceCut = namespace["SURFACE_COHORT_CUT"];
  const allCuts = namespace["COHORT_CUTS"];
  const browserCut = namespace["browserCut"];
  const deviceCut = namespace["deviceCut"];

  assertUnderConstruction(
    typeof surfaceCut === "string" &&
      Array.isArray(allCuts) &&
      typeof browserCut === "function" &&
      typeof deviceCut === "function",
    {
      contract:
        "packages/shared/src/cohort-cuts/cuts.ts exports SURFACE_COHORT_CUT, COHORT_CUTS, browserCut and deviceCut",
      ownedBy: CUT_TAXONOMY_OWNER,
    },
  );

  return {
    surfaceCut: surfaceCut as string,
    allCuts: allCuts as readonly string[],
    browserCut: browserCut as (family: string) => string,
    deviceCut: deviceCut as (device: string) => string,
  };
}

function requireCohortCutColumn(): void {
  assertUnderConstruction("cohortCut" in schema.divergencePoints, {
    contract: "divergence_points carries a cohort_cut column that every write supplies",
    ownedBy: COHORT_CUT_COLUMN_OWNER,
  });
}

type CutRow = typeof schema.divergencePoints.$inferSelect & { readonly cohortCut: string };

function recordingLogger(): AnalysisLogger & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message: string) => void lines.push(message),
    warn: (message: string) => void lines.push(message),
    error: (message: string) => void lines.push(message),
  };
}

async function persistPathSession(
  workspace: SeededWorkspace,
  paths: readonly string[],
  startedAt: Date,
  userAgent: string | null,
): Promise<void> {
  const key = randomUUID();
  const session = await seedSession(db, {
    organizationId: workspace.organizationId,
    projectId: workspace.projectId,
    connectionId: workspace.connectionId,
    sessionKey: `ph:o045-${key}`,
    entryUrlPath: paths[0] ?? null,
    userAgent,
    startedAt,
    lastEventAt: new Date(startedAt.getTime() + (paths.length - 1) * EVENT_STRIDE_MS),
  });

  await seedEvents(
    db,
    paths.map((urlPath, index) => ({
      organizationId: workspace.organizationId,
      projectId: workspace.projectId,
      connectionId: workspace.connectionId,
      sessionId: session.id,
      sourceEventId: `o045-${key}-e${String(index).padStart(3, "0")}`,
      name: `step_${String(index)}`,
      occurredAt: new Date(startedAt.getTime() + index * EVENT_STRIDE_MS),
      urlPath,
      urlPathNormalisationVersion: NORMALISATION_VERSION,
    })),
  );
}

interface SeedAgents {
  readonly desktop: string | null;
  readonly mobile: string | null;
  readonly absent: string | null;
  readonly unreadable: string | null;
}

const AGENTS_PRESENT: SeedAgents = {
  desktop: CHROME_ON_WINDOWS,
  mobile: SAFARI_ON_IPHONE,
  absent: null,
  unreadable: UNREADABLE_USER_AGENT,
};

const AGENTS_ALL_NULL: SeedAgents = {
  desktop: null,
  mobile: null,
  absent: null,
  unreadable: null,
};

// The same 30 sessions and the same paths in both twins, so the only difference between a
// UA-carrying corpus and an all-null one is the column this sprint reads.
async function seedDeviceCutCorpus(workspace: SeededWorkspace, agents: SeedAgents): Promise<void> {
  let placed = 0;

  const nextStart = (): Date => {
    const startedAt = new Date(IN_WINDOW_AT.getTime() + placed * SESSION_STRIDE_MS);
    placed += 1;
    return startedAt;
  };

  const group = async (
    count: number,
    paths: readonly string[],
    userAgent: string | null,
  ): Promise<void> => {
    for (let index = 0; index < count; index += 1) {
      await persistPathSession(workspace, paths, nextStart(), userAgent);
    }
  };

  await group(DETOUR_SESSIONS, [ORIGIN, DETOUR, ORIGIN, DETOUR, ORIGIN], agents.desktop);
  await group(REACHED_ON_DESKTOP_SESSIONS, [ORIGIN, DESTINATION], agents.desktop);
  await group(REACHED_ON_MOBILE_SESSIONS, [ORIGIN, DESTINATION], agents.mobile);
  await group(DROPPED_ON_DESKTOP_SESSIONS, [ORIGIN], agents.desktop);
  await group(DROPPED_ON_MOBILE_SESSIONS, [ORIGIN], agents.mobile);
  await group(1, [ORIGIN], agents.absent);
  await group(1, [ORIGIN], agents.unreadable);
}

async function cutRowsFor(workspace: SeededWorkspace): Promise<readonly CutRow[]> {
  const rows = await db
    .select()
    .from(schema.divergencePoints)
    .where(
      and(
        eq(schema.divergencePoints.organizationId, workspace.organizationId),
        eq(schema.divergencePoints.projectId, workspace.projectId),
      ),
    );

  return rows.map((row) => row as CutRow);
}

interface LaneRun {
  readonly workspace: SeededWorkspace;
  readonly lane: AnalysisLane;
  readonly rows: readonly CutRow[];
}

async function runLane(prefix: string, agents: SeedAgents): Promise<LaneRun> {
  const workspace = await seedPollableWorkspace(db, { prefix, now: NOW });
  await seedDeviceCutCorpus(workspace, agents);

  const source = createAnalysisLaneSource({ db, logger: recordingLogger() });
  const lane = await source.laneForProject(workspace.projectId, NOW);
  if (lane === null) {
    throw new Error(`expected a lane for the seeded project ${workspace.projectId}`);
  }

  return { workspace, lane, rows: await cutRowsFor(workspace) };
}

interface Twins {
  readonly withAgents: LaneRun;
  readonly withoutAgents: LaneRun;
}

let twinRuns: Promise<Twins> | null = null;

function twins(): Promise<Twins> {
  twinRuns ??= (async (): Promise<Twins> => ({
    withAgents: await runLane("o045a-", AGENTS_PRESENT),
    withoutAgents: await runLane("o045b-", AGENTS_ALL_NULL),
  }))();

  return twinRuns;
}

function cutOf(rows: readonly CutRow[], cut: string): CutRow {
  const found = rows.find((row) => row.cohortCut === cut);
  if (found === undefined) {
    throw new Error(
      `expected a divergence row for cut ${cut}; got [${rows.map((row) => row.cohortCut).join(", ")}]`,
    );
  }
  return found;
}

describe("createAnalysisLaneSource — the device cut reaches divergence through the real entry point (O-045, D11)", () => {
  test("laneForProject persists a surface row plus browser rows plus device rows on one window", async () => {
    const taxonomy = await cohortCutTaxonomy();
    requireCohortCutColumn();

    const { withAgents } = await twins();

    expect(withAgents.lane.sessionsConsidered).toBe(SESSIONS_SEEDED);

    const surfaceRows = withAgents.rows.filter((row) => row.cohortCut === taxonomy.surfaceCut);
    expect(surfaceRows).toHaveLength(1);

    const browserCuts = new Set(
      ["chrome", "safari", "unknown"].map((family) => taxonomy.browserCut(family)),
    );
    const deviceCuts = new Set(
      ["desktop", "mobile", "unknown"].map((device) => taxonomy.deviceCut(device)),
    );

    const written = withAgents.rows.map((row) => row.cohortCut);
    expect(written.filter((cut) => browserCuts.has(cut)).length).toBeGreaterThanOrEqual(2);
    expect(written.filter((cut) => deviceCuts.has(cut)).length).toBeGreaterThanOrEqual(2);

    const identities = new Set(
      withAgents.rows.map(
        (row) => `${row.surface}|${row.windowStart.toISOString()}|${row.windowEnd.toISOString()}`,
      ),
    );
    const windowStart = new Date(NOW.getTime() - ANALYSIS_WINDOW_MS);
    expect([...identities]).toEqual([
      `${ORIGIN}|${windowStart.toISOString()}|${NOW.toISOString()}`,
    ]);
  });

  test("laneForProject writes exactly one row per present cut and never a cut outside the enum", async () => {
    const taxonomy = await cohortCutTaxonomy();
    requireCohortCutColumn();

    const { withAgents } = await twins();

    const expected = [
      taxonomy.surfaceCut,
      taxonomy.browserCut("chrome"),
      taxonomy.browserCut("safari"),
      taxonomy.browserCut("unknown"),
      taxonomy.deviceCut("desktop"),
      taxonomy.deviceCut("mobile"),
      taxonomy.deviceCut("unknown"),
    ];

    expect<readonly string[]>(withAgents.rows.map((row) => row.cohortCut).toSorted()).toEqual(
      expected.toSorted(),
    );
    expect(withAgents.rows.length).toBeLessThanOrEqual(taxonomy.allCuts.length);

    for (const row of withAgents.rows) {
      expect(taxonomy.allCuts).toContain(row.cohortCut);
    }
  });

  test("an absent and an unreadable user agent land in the browser:unknown row and in no other browser row", async () => {
    const taxonomy = await cohortCutTaxonomy();
    requireCohortCutColumn();

    const { withAgents } = await twins();

    const unknown = cutOf(withAgents.rows, taxonomy.browserCut("unknown"));
    expect(unknown.failedCohortSize).toBe(DROPPED_WITH_NO_READABLE_AGENT_SESSIONS);
    expect(unknown.succeededCohortSize).toBe(SUCCEEDED_WITH_NO_READABLE_AGENT);

    const chrome = cutOf(withAgents.rows, taxonomy.browserCut("chrome"));
    const safari = cutOf(withAgents.rows, taxonomy.browserCut("safari"));
    expect([chrome.failedCohortSize, chrome.succeededCohortSize]).toEqual([
      DROPPED_ON_DESKTOP_SESSIONS,
      SUCCEEDED_ON_DESKTOP,
    ]);
    expect([safari.failedCohortSize, safari.succeededCohortSize]).toEqual([
      DROPPED_ON_MOBILE_SESSIONS,
      SUCCEEDED_ON_MOBILE,
    ]);

    const surface = cutOf(withAgents.rows, taxonomy.surfaceCut);
    const browserRows = [chrome, safari, unknown];
    expect(browserRows.reduce((total, row) => total + row.failedCohortSize, 0)).toBe(
      surface.failedCohortSize,
    );
    expect(browserRows.reduce((total, row) => total + row.succeededCohortSize, 0)).toBe(
      surface.succeededCohortSize,
    );
  });

  test("the surface-level row is unchanged by the presence of device cuts", async () => {
    const taxonomy = await cohortCutTaxonomy();
    requireCohortCutColumn();

    const { withAgents, withoutAgents } = await twins();

    const carried = cutOf(withAgents.rows, taxonomy.surfaceCut);
    const bare = cutOf(withoutAgents.rows, taxonomy.surfaceCut);

    expect([carried.kind, carried.divergedAtRank, carried.reason]).toEqual([
      bare.kind,
      bare.divergedAtRank,
      bare.reason,
    ]);
    expect([carried.succeededCohortSize, carried.failedCohortSize]).toEqual([
      bare.succeededCohortSize,
      bare.failedCohortSize,
    ]);
  });

  test("no new finding appears when the corpus carries user agents", async () => {
    const taxonomy = await cohortCutTaxonomy();
    requireCohortCutColumn();

    const { withAgents, withoutAgents } = await twins();

    // Without this the deep-equality below would also hold for two empty lanes, which is
    // the one shape that would make the invariant vacuous.
    expect(withAgents.rows.length).toBeGreaterThan(withoutAgents.rows.length);
    expect(withAgents.lane.candidates).toHaveLength(1);
    expect(withAgents.lane.candidates[0]?.surface).toBe(ORIGIN);
    expect(withAgents.rows.some((row) => row.cohortCut !== taxonomy.surfaceCut)).toBe(true);

    expect(withAgents.lane.candidates).toEqual(withoutAgents.lane.candidates);
  });

  test("a second lane run over the same pinned instant leaves the per-cut row count identical", async () => {
    requireCohortCutColumn();

    const { withAgents } = await twins();

    const before = await cutRowsFor(withAgents.workspace);

    const source = createAnalysisLaneSource({ db, logger: recordingLogger() });
    await source.laneForProject(withAgents.workspace.projectId, NOW);

    const after = await cutRowsFor(withAgents.workspace);

    expect(after).toHaveLength(before.length);
    expect(after.map((row) => row.cohortCut).toSorted()).toEqual(
      before.map((row) => row.cohortCut).toSorted(),
    );
  });
});
