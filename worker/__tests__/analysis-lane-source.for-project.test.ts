// O-008 Wave 3a — `AnalysisLaneSource.laneForProject` and the system read under
// it (AD-10, D7).
//
// ###########################################################################
// # WHY THIS FILE EXISTS AT ALL.
// #
// # Wave 2 shipped `findAnalysableProject` (packages/db/src/system/
// # analysable-projects.ts) with ONE DELIBERATE DIVERGENCE from its sibling
// # `listAnalysableProjects`: IT CARRIES NO ACTIVE-CONNECTION PREDICATE. That
// # divergence is the whole reason the onboarding trigger degrades correctly —
// # a connection revoked in the seconds between a poll and the trigger it fired
// # must not silently drop the founder's ONE analysis — and it arrived with NO
// # Wave 0 row. A deliberate divergence nothing asserts is a divergence the
// # next refactor deletes as an oversight, at which point the drop becomes
// # silent again and no test goes red.
// #
// # So the rows below pin the divergence AS A DECISION, in both directions:
// # what the widened population buys (row 1), and where the boundary still is
// # (row 2, row 3).
// ###########################################################################
//
// KNOWN CONFLICT, RECORDED HERE RATHER THAN RESOLVED SILENTLY.
// `onboarding-analysis-trigger.test.ts`'s row 3 ("laneForProject returns null
// for a project that is not analysable") asserts the OPPOSITE of row 1 below:
// it seeds a project whose only connection is inactive and expects `null`. Its
// stated reasoning — "a project whose only connection is inactive is outside
// `listAnalysableProjects`'s population" — describes the sibling read, not the
// one AD-10 names. The two cannot both hold. This file implements Wave 2's
// shipped contract; that row is reported as a finding rather than accommodated,
// and Wave 0 tests are not edited to agree with an implementation.
//
// FIXTURE SEED PREFIX: `o008p-`.
import { schema } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import { findAnalysableProject, listAnalysableProjects } from "@growthmind/db/system";
import { afterEach, beforeEach, expect, test } from "bun:test";

import { createAnalysisLaneSource } from "../src/analysis-lane-source";
import type { AnalysisLogger } from "../src/tasks/analysis-tick";
import { seedPollableWorkspace } from "./helpers/wire-fixtures";

const PREFIX = "o008p-";

/** The suite's ONLY instant. */
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

// ###########################################################################
// Row 1 — THE DIVERGENCE, AS A DECISION. A revocation between the poll and the
// trigger must not swallow the founder's one analysis.
// ###########################################################################
test("a project whose connection was revoked after the poll still resolves a lane", async () => {
  const workspace = await seedPollableWorkspace(db, { prefix: PREFIX, now: AT });

  // The poll ran and persisted events while the connection was active. THEN the
  // connection was deactivated — the exact seconds-wide window AD-10 names, and
  // the reason `findAnalysableProject` does not re-ask the active-connection
  // question the caller already answered.
  await db.update(schema.projectConnections).set({ isActive: false });

  // THE SIBLING READ NOW EXCLUDES IT. This is the control: without it, row 1
  // would be green against a tree where nothing had been revoked at all, and
  // the divergence it claims to pin would be unexercised.
  expect(await listAnalysableProjects(db)).toEqual([]);

  // THE ONE-PROJECT READ STILL FINDS IT, with the organisation scope read off
  // the project's own row.
  const found = await findAnalysableProject(db, workspace.projectId);
  expect(found).toEqual({
    organizationId: workspace.organizationId,
    organizationName: workspace.organizationName,
    projectId: workspace.projectId,
  });

  // AND THE LANE IS BUILT. Not null — the lane reports its own outcome (here,
  // nothing to analyse yet), which is a fact a founder can be told. Answering
  // `null` would drop the analysis with no record that it was ever asked for,
  // and the hourly cron would not cover it either: the cron reads
  // `listAnalysableProjects`, which has just excluded this project.
  const source = createAnalysisLaneSource({ db, logger: recordingLogger() });
  const lane = await source.laneForProject(workspace.projectId, AT);

  expect(lane).not.toBeNull();
  expect(lane?.projectId).toBe(workspace.projectId);
  expect(lane?.organizationId).toBe(workspace.organizationId);

  // AND `listDueLanes` STILL AGREES WITH ITS OWN POPULATION — the two methods
  // share one assembly, not one work list.
  expect(await source.listDueLanes(AT)).toEqual([]);
});

// ###########################################################################
// Row 2 — WHERE THE BOUNDARY ACTUALLY IS. The widened population is "the
// project exists", and nothing wider.
// ###########################################################################
test("an unknown project id resolves no row and no lane", async () => {
  await seedPollableWorkspace(db, { prefix: PREFIX, now: AT });

  expect(await findAnalysableProject(db, `${PREFIX}no-such-project`)).toBeNull();

  const logger = recordingLogger();
  const source = createAnalysisLaneSource({ db, logger });

  // NULL, not a throw and not an empty lane. An empty lane would open a run and
  // close it — a different and false claim ("we looked") about a project that
  // does not exist.
  expect(await source.laneForProject(`${PREFIX}no-such-project`, AT)).toBeNull();

  // AND IT SAID SO. A drop that also vanished from the logs would be
  // undebuggable, which is the standing rule for every refusal in this lane.
  expect(logger.lines.some((line) => line.includes(`${PREFIX}no-such-project`))).toBe(true);
});

// ###########################################################################
// Row 3 — D7. THE ORG COMES OFF THE ROW, AND THERE IS NOWHERE ELSE IT COULD
// COME FROM.
// ###########################################################################
test("a project id resolves only its own organization, never the caller's", async () => {
  const orgA = await seedPollableWorkspace(db, { prefix: `${PREFIX}a-`, now: AT });
  const orgB = await seedPollableWorkspace(db, { prefix: `${PREFIX}b-`, now: AT });

  const source = createAnalysisLaneSource({ db, logger: recordingLogger() });

  const laneB = await source.laneForProject(orgB.projectId, AT);

  // The call carries a project id and NOTHING ELSE — there is no organisation
  // parameter on `laneForProject` and none on the queued payload that reaches
  // it, so a lane for org B's project cannot be built under org A's context by
  // any route. The id is resolved to a row, and the row carries its owner.
  expect(laneB?.organizationId).toBe(orgB.organizationId);
  expect(laneB?.organizationId).not.toBe(orgA.organizationId);
  expect(laneB?.organizationName).toBe(orgB.organizationName);

  const laneA = await source.laneForProject(orgA.projectId, AT);
  expect(laneA?.organizationId).toBe(orgA.organizationId);
});

// ###########################################################################
// Row 4 — AD-10's headline: ONE ASSEMBLY, TWO CALLERS.
//
// The deep-equality half is also asserted in the trigger suite; it is repeated
// here because THIS is the file that owns `laneForProject`'s behaviour, and a
// contract proven only in a sibling suite is a contract that survives that
// suite being rewritten.
// ###########################################################################
test("listDueLanes and laneForProject build the identical lane for one project", async () => {
  const workspace = await seedPollableWorkspace(db, { prefix: PREFIX, now: AT });

  const source = createAnalysisLaneSource({ db, logger: recordingLogger() });

  const [fromList] = await source.listDueLanes(AT);
  const fromProject = await source.laneForProject(workspace.projectId, AT);

  expect(fromList).toBeDefined();
  // DEEP EQUALITY, NOT SPOT-CHECKS. The corpus window, both T1 detectors and
  // `assembleCandidates` decide WHAT A FINDING EVEN IS; a second copy of that
  // assembly would drift within a sprint and would make the onboarding surface
  // show a different finding than Slack does.
  expect(fromProject).toEqual(fromList);
});
