import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../../src/testing";
import {
  makeTenantContext,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUser,
} from "../../src/testing";
import { readRawRows, type CreateFirstRunRepo } from "../helpers/onboarding-contract";

const NAMES = laneNames("first-run");

const OWNER = "ADD Wave 2 (packages/db/src/repositories/first-run.repo.ts, AD-8)";

const ARMED_AT = new Date("2026-08-01T10:00:00.000Z");

const RE_ARMED_AT = new Date("2026-08-01T10:04:00.000Z");
const SKIPPED_AT = new Date("2026-08-01T10:01:00.000Z");
const DISMISSED_AT = new Date("2026-08-01T10:02:00.000Z");

const loadCreateRepo = (): Promise<CreateFirstRunRepo> =>
  loadUnderConstruction<CreateFirstRunRepo>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/first-run.repo"),
    exportName: "createFirstRunRepo",
    ownedBy: OWNER,
  });

interface Scope {
  organizationId: string;
  projectId: string;
  owner: ReturnType<typeof makeTenantContext>;
  ownerUserId: string;
  teammate: ReturnType<typeof makeTenantContext>;
  teammateUserId: string;
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
  const mate = await seedUser(db, {
    name: NAMES.userName(`${label}-mate`),
    email: NAMES.email(`${label}-mate`),
  });
  await seedMember(db, {
    organizationId: org.organizationId,
    userId: mate.id,
    role: "member",
  });

  return {
    organizationId: org.organizationId,
    projectId: project.id,
    owner: org.ctx,
    ownerUserId: org.userId,
    teammateUserId: mate.id,
    teammate: makeTenantContext({
      userId: mate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    }),
  };
}

describe("first_run_state / first_run_dismissals — the clock origin and the per-user dismissal", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("arming persists armedAt once and re-arming replaces it", async () => {
    const createFirstRunRepo = await loadCreateRepo();
    const scope = await seedScope(db, "arm");
    const repo = createFirstRunRepo(db, scope.owner);

    expect(await repo.readState(scope.projectId)).toBeNull();

    await repo.arm(scope.projectId, ARMED_AT);
    expect((await repo.readState(scope.projectId))?.armedAt?.getTime()).toBe(ARMED_AT.getTime());

    await repo.arm(scope.projectId, RE_ARMED_AT);
    expect((await repo.readState(scope.projectId))?.armedAt?.getTime()).toBe(RE_ARMED_AT.getTime());

    const rows = await readRawRows(
      db,
      sql`select armed_at from first_run_state
          where organization_id = ${scope.organizationId} and project_id = ${scope.projectId}`,
    );
    expect(rows).toHaveLength(1);
  });

  test("armedAt is visible to every member of the org", async () => {
    const createFirstRunRepo = await loadCreateRepo();
    const scope = await seedScope(db, "org-grain");

    await createFirstRunRepo(db, scope.owner).arm(scope.projectId, ARMED_AT);

    const asTeammate = await createFirstRunRepo(db, scope.teammate).readState(scope.projectId);
    expect(asTeammate?.armedAt?.getTime()).toBe(ARMED_AT.getTime());
  });

  test("dismissal is per user — one member dismissing leaves another undismissed", async () => {
    const createFirstRunRepo = await loadCreateRepo();
    const scope = await seedScope(db, "dismissal");
    const asOwner = createFirstRunRepo(db, scope.owner);
    const asTeammate = createFirstRunRepo(db, scope.teammate);

    await asOwner.dismiss(scope.ownerUserId, DISMISSED_AT);

    expect(await asOwner.isDismissed(scope.ownerUserId)).toBe(true);

    expect(await asOwner.isDismissed(scope.teammateUserId)).toBe(false);
    expect(await asTeammate.isDismissed(scope.teammateUserId)).toBe(false);
  });

  test("skipping slack persists a fact distinct from the absence of a connection", async () => {
    const createFirstRunRepo = await loadCreateRepo();
    const scope = await seedScope(db, "skip");
    const repo = createFirstRunRepo(db, scope.owner);

    const state = await repo.skipSlack(scope.projectId, SKIPPED_AT);

    expect(state.slackSkippedAt?.getTime()).toBe(SKIPPED_AT.getTime());
    expect((await repo.readState(scope.projectId))?.slackSkippedAt?.getTime()).toBe(
      SKIPPED_AT.getTime(),
    );

    const connections = await readRawRows(
      db,
      sql`select id from slack_connections where organization_id = ${scope.organizationId}`,
    );
    expect(connections).toHaveLength(0);

    const keys = Object.keys(state);
    expect(keys.filter((key) => /connect/i.test(key))).toEqual([]);

    expect(state.armedAt).toBeNull();
  });

  test("another organization's first-run state is never returned", async () => {
    const createFirstRunRepo = await loadCreateRepo();
    const orgA = await seedScope(db, "tenant-a");
    const orgB = await seedScope(db, "tenant-b");

    await createFirstRunRepo(db, orgA.owner).arm(orgA.projectId, ARMED_AT);
    await createFirstRunRepo(db, orgA.owner).dismiss(orgA.ownerUserId, DISMISSED_AT);

    const fromB = createFirstRunRepo(db, orgB.owner);
    expect(await fromB.readState(orgA.projectId)).toBeNull();

    expect(await fromB.isDismissed(orgA.ownerUserId)).toBe(false);

    expect(
      (await createFirstRunRepo(db, orgA.teammate).readState(orgA.projectId))?.armedAt?.getTime(),
    ).toBe(ARMED_AT.getTime());
  });
});
