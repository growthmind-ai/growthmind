import { schema } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import { findAnalysableProject, listAnalysableProjects } from "@growthmind/db/system";
import { afterEach, beforeEach, expect, test } from "bun:test";

import { createAnalysisLaneSource } from "../src/analysis-lane-source";
import type { AnalysisLogger } from "../src/tasks/analysis-tick";
import { seedPollableWorkspace } from "./helpers/wire-fixtures";

const PREFIX = "o008p-";

const AT = new Date("2026-08-01T09:00:00.000Z");

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

function recordingLogger(): AnalysisLogger & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message: string) => void lines.push(message),
    error: (message: string) => void lines.push(message),
  };
}

test("a project whose connection was revoked after the poll still resolves a lane", async () => {
  const workspace = await seedPollableWorkspace(db, { prefix: PREFIX, now: AT });

  await db.update(schema.projectConnections).set({ isActive: false });

  expect(await listAnalysableProjects(db)).toEqual([]);

  const found = await findAnalysableProject(db, workspace.projectId);
  expect(found).toEqual({
    organizationId: workspace.organizationId,
    organizationName: workspace.organizationName,
    projectId: workspace.projectId,
  });

  const source = createAnalysisLaneSource({ db, logger: recordingLogger() });
  const lane = await source.laneForProject(workspace.projectId, AT);

  expect(lane).not.toBeNull();
  expect(lane?.projectId).toBe(workspace.projectId);
  expect(lane?.organizationId).toBe(workspace.organizationId);

  expect(await source.listDueLanes(AT)).toEqual([]);
});

test("an unknown project id resolves no row and no lane", async () => {
  await seedPollableWorkspace(db, { prefix: PREFIX, now: AT });

  expect(await findAnalysableProject(db, `${PREFIX}no-such-project`)).toBeNull();

  const logger = recordingLogger();
  const source = createAnalysisLaneSource({ db, logger });

  expect(await source.laneForProject(`${PREFIX}no-such-project`, AT)).toBeNull();

  expect(logger.lines.some((line) => line.includes(`${PREFIX}no-such-project`))).toBe(true);
});

test("a project id resolves only its own organization, never the caller's", async () => {
  const orgA = await seedPollableWorkspace(db, { prefix: `${PREFIX}a-`, now: AT });
  const orgB = await seedPollableWorkspace(db, { prefix: `${PREFIX}b-`, now: AT });

  const source = createAnalysisLaneSource({ db, logger: recordingLogger() });

  const laneB = await source.laneForProject(orgB.projectId, AT);

  expect(laneB?.organizationId).toBe(orgB.organizationId);
  expect(laneB?.organizationId).not.toBe(orgA.organizationId);
  expect(laneB?.organizationName).toBe(orgB.organizationName);

  const laneA = await source.laneForProject(orgA.projectId, AT);
  expect(laneA?.organizationId).toBe(orgA.organizationId);
});

test("listDueLanes and laneForProject build the identical lane for one project", async () => {
  const workspace = await seedPollableWorkspace(db, { prefix: PREFIX, now: AT });

  const source = createAnalysisLaneSource({ db, logger: recordingLogger() });

  const [fromList] = await source.listDueLanes(AT);
  const fromProject = await source.laneForProject(workspace.projectId, AT);

  expect(fromList).toBeDefined();

  expect(fromProject).toEqual(fromList);
});
