// Wave 0b (RED) — lane L3, fixture seed prefix `db-`.
// ADD tasks/session-source-posthog-adapter/add.md §9 items 71–72.
//
// FR-6's idempotency key is `(project_id, source_event_id)`, enforced by a
// unique index and applied with `ON CONFLICT DO NOTHING` — never a
// check-then-insert. The overlap window (D-6e) deliberately re-requests events
// we already hold, so "a replay yields exactly one row per event" is the
// property that makes a retried poll safe, and it has to be proved against
// real SQL rather than against a fake that would simply do what it was told.
//
// `createEventsRepo` is a typed-stub throw today, so every test fails on
// "not implemented".
import { URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createEventsRepo, type EventInsertRow } from "../../src/repositories/events.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, seedSession } from "../helpers/db-lane-fixtures";
import { seedConnection, seedOrgWithOwner, seedProject } from "../helpers/fixtures";

const NAMES = laneNames("ev");

const OCCURRED_AT = new Date("2026-07-30T10:00:00.000Z");

function makeEventRow(
  params: { projectId: string; connectionId: string; sessionId: string; sourceEventId: string },
  overrides: Partial<EventInsertRow> = {},
): EventInsertRow {
  return {
    projectId: params.projectId,
    connectionId: params.connectionId,
    sessionId: params.sessionId,
    sourceEventId: params.sourceEventId,
    name: "$pageview",
    occurredAt: OCCURRED_AT,
    urlPath: "/pricing",
    urlPathNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
    ...overrides,
  };
}

describe("events repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // --- item 71 -------------------------------------------------------------
  it("inserts one row per event when the same source event id is applied twice", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("replay"),
      userName: NAMES.userName("replay"),
      email: NAMES.email("replay"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("replay"),
    });
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });
    const session = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: "ph:db-ev-replay",
    });

    const repo = createEventsRepo(db, org.ctx);
    const rows = [
      makeEventRow({
        projectId: project.id,
        connectionId: connection.id,
        sessionId: session.id,
        sourceEventId: "db-ev-replay-0001",
      }),
    ];

    expect(await repo.insertManyIgnoringDuplicates(rows)).toBe(1);
    // The replay a 15-minute overlap window makes routine. Not an error, and
    // not a second row.
    expect(await repo.insertManyIgnoringDuplicates(rows)).toBe(0);

    const listed = await repo.listForProject(project.id, { limit: 50 });
    expect(listed.filter((event) => event.sourceEventId === "db-ev-replay-0001")).toHaveLength(1);
  });

  // --- item 71 (duplicate within one batch) --------------------------------
  it("inserts one row when a single batch carries the same source event id twice", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("batch-dupe"),
      userName: NAMES.userName("batch-dupe"),
      email: NAMES.email("batch-dupe"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("batch-dupe"),
    });
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });
    const session = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: "ph:db-ev-batch-dupe",
    });

    const repo = createEventsRepo(db, org.ctx);
    const base = {
      projectId: project.id,
      connectionId: connection.id,
      sessionId: session.id,
      sourceEventId: "db-ev-batch-0001",
    };

    const inserted = await repo.insertManyIgnoringDuplicates([
      makeEventRow(base),
      makeEventRow(base, { name: "$autocapture" }),
      makeEventRow({ ...base, sourceEventId: "db-ev-batch-0002" }),
    ]);

    expect(inserted).toBe(2);

    const listed = await repo.listForProject(project.id, { limit: 50 });
    expect(listed).toHaveLength(2);
  });

  // --- item 72 -------------------------------------------------------------
  it("keeps the dedup key project-scoped — the same source event id in two projects is two rows", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("two-projects"),
      userName: NAMES.userName("two-projects"),
      email: NAMES.email("two-projects"),
    });
    const projectOne = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("two-projects-one"),
    });
    const projectTwo = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("two-projects-two"),
    });
    const connectionOne = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: projectOne.id,
    });
    const connectionTwo = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: projectTwo.id,
    });
    const sessionOne = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: projectOne.id,
      connectionId: connectionOne.id,
      sessionKey: "ph:db-ev-shared-one",
    });
    const sessionTwo = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: projectTwo.id,
      connectionId: connectionTwo.id,
      sessionKey: "ph:db-ev-shared-two",
    });

    const repo = createEventsRepo(db, org.ctx);
    const sharedSourceEventId = "db-ev-shared-0001";

    const inserted = await repo.insertManyIgnoringDuplicates([
      makeEventRow({
        projectId: projectOne.id,
        connectionId: connectionOne.id,
        sessionId: sessionOne.id,
        sourceEventId: sharedSourceEventId,
      }),
      makeEventRow({
        projectId: projectTwo.id,
        connectionId: connectionTwo.id,
        sessionId: sessionTwo.id,
        sourceEventId: sharedSourceEventId,
      }),
    ]);

    expect(inserted).toBe(2);

    const listedOne = await repo.listForProject(projectOne.id, { limit: 50 });
    const listedTwo = await repo.listForProject(projectTwo.id, { limit: 50 });
    expect(listedOne.map((event) => event.sourceEventId)).toEqual([sharedSourceEventId]);
    expect(listedTwo.map((event) => event.sourceEventId)).toEqual([sharedSourceEventId]);
  });

  // --- item 72 (session-scoped read) --------------------------------------
  it("lists a session's events without crossing into another session in the same project", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("per-session"),
      userName: NAMES.userName("per-session"),
      email: NAMES.email("per-session"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("per-session"),
    });
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });
    const sessionOne = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: "ph:db-ev-per-session-one",
    });
    const sessionTwo = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: "ph:db-ev-per-session-two",
    });

    const repo = createEventsRepo(db, org.ctx);
    await repo.insertManyIgnoringDuplicates([
      makeEventRow({
        projectId: project.id,
        connectionId: connection.id,
        sessionId: sessionOne.id,
        sourceEventId: "db-ev-per-session-0001",
      }),
      makeEventRow({
        projectId: project.id,
        connectionId: connection.id,
        sessionId: sessionTwo.id,
        sourceEventId: "db-ev-per-session-0002",
      }),
    ]);

    const forSessionOne = await repo.listForSession(sessionOne.id, { limit: 50 });
    expect(forSessionOne.map((event) => event.sourceEventId)).toEqual(["db-ev-per-session-0001"]);
  });

  // --- ES-14 / ADD §D-15 ---------------------------------------------------
  // `url_path_normalisation_version` is nullable AND NEVER COERCED. `null`
  // carries a specific claim — "written before versions were recorded, so the
  // redaction status of this row's `url_path` is unknown" — which is not the
  // same claim as version `0`. A `.default(0)` on the column, a `?? 0` in the
  // repository's insert value map, or a `?? 0` on the read would each silently
  // assert a version we never wrote, and would erase the only signal a §5
  // remediation migration has: `WHERE url_path_normalisation_version IS NULL`.
  //
  // The stamped sibling in the same batch is the control. Without it, a read
  // path that returned `null` for EVERY row would pass the null half of this
  // test while proving nothing.
  it("reads back a null normalisation version as null, never coerced to a version", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("norm-version"),
      userName: NAMES.userName("norm-version"),
      email: NAMES.email("norm-version"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("norm-version"),
    });
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });
    const session = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: "ph:db-ev-norm-version",
    });

    const repo = createEventsRepo(db, org.ctx);
    const base = {
      projectId: project.id,
      connectionId: connection.id,
      sessionId: session.id,
      sourceEventId: "db-ev-norm-version-legacy",
    };

    expect(
      await repo.insertManyIgnoringDuplicates([
        makeEventRow(base, { urlPathNormalisationVersion: null }),
        makeEventRow({ ...base, sourceEventId: "db-ev-norm-version-stamped" }),
      ]),
    ).toBe(2);

    const listed = await repo.listForSession(session.id, { limit: 50 });
    const legacy = listed.find((event) => event.sourceEventId === "db-ev-norm-version-legacy");
    const stamped = listed.find((event) => event.sourceEventId === "db-ev-norm-version-stamped");

    expect(legacy?.urlPathNormalisationVersion).toBeNull();
    expect(stamped?.urlPathNormalisationVersion).toBe(URL_PATH_NORMALISATION_VERSION);
  });
});
