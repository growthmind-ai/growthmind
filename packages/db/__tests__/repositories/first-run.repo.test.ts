// AD-8 — `first_run_state` (org+project) and `first_run_dismissals` (org+user).
// Wave 0d, task 0d.3. ADD §9, 5 rows.
//
// ###########################################################################
// # TWO GRAINS, TWO TABLES. DO NOT COLLAPSE THEM.
// #
// #   `first_run_state`       — unique on (organization_id, project_id)
// #   `first_run_dismissals`  — unique on (organization_id, user_id)
// #
// # A SINGLE TABLE WITH A NULLABLE `user_id` DISCRIMINATOR IS THE D2
// # STAMP/FILTER ASYMMETRY THE TAXONOMY NAMES, and it is exactly the shape
// # that produced the "No sessions yet at project scope, 17 sessions at org
// # root" incident in this codebase: a read narrowed by a column the write
// # path leaves NULL matches zero rows, and zero rows reads as "nothing has
// # happened yet" rather than as an error. Applied here, that bug hides the
// # clock origin — a founder reloads mid-wait and the elapsed counter starts
// # again from zero, with nothing anywhere reporting a problem.
// #
// # The two grains are not a modelling preference. `armed_at` MUST be org-
// # grained (P-4 arriving mid-wait sees the same wait, from the same origin)
// # and dismissal MUST be user-grained (AD-17; per-org dismissal would let one
// # member lock every teammate out of the only surface that exists — the
// # property ESC-O2 rests on).
// ###########################################################################
//
// EVERY ROW IS RED TODAY: `packages/db/src/repositories/first-run.repo.ts`,
// both schema files and migration `0009_*` are ADD Wave 2's.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import {
  makeTenantContext,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUser,
} from "../helpers/fixtures";
import { readRawRows, type CreateFirstRunRepo } from "../helpers/onboarding-contract";

const NAMES = laneNames("first-run");

const OWNER = "ADD Wave 2 (packages/db/src/repositories/first-run.repo.ts, AD-8)";

const ARMED_AT = new Date("2026-08-01T10:00:00.000Z");
/** "Watch again", pressed four minutes later. Far enough apart that the
 *  assertion is about the write and never about clock resolution. */
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

/** An org with a project, an owner, and a teammate who set nothing up (P-4).
 *  Three of the five rows below are statements about the teammate. */
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

  // --- row 1 ---------------------------------------------------------------
  test("arming persists armedAt once and re-arming replaces it", async () => {
    const createFirstRunRepo = await loadCreateRepo();
    const scope = await seedScope(db, "arm");
    const repo = createFirstRunRepo(db, scope.owner);

    // No row before arming, and `null` rather than a zeroed state object —
    // "never armed" and "armed at the epoch" are different facts, and the
    // reducer's `unarmed` branch turns on exactly this (AD-5, branch 2).
    expect(await repo.readState(scope.projectId)).toBeNull();

    await repo.arm(scope.projectId, ARMED_AT);
    expect((await repo.readState(scope.projectId))?.armedAt?.getTime()).toBe(ARMED_AT.getTime());

    // "Watch again" RESETS the clock origin (UX flow F). The elapsed counter
    // counts up from a persisted origin, so a second arming that APPENDED
    // instead of replacing would leave the surface counting from the first
    // trigger — a founder pressing the button again would watch a number that
    // is already minutes old.
    await repo.arm(scope.projectId, RE_ARMED_AT);
    expect((await repo.readState(scope.projectId))?.armedAt?.getTime()).toBe(RE_ARMED_AT.getTime());

    // ONE ROW PER (organization_id, project_id), enforced by the unique index
    // rather than by whichever write happened to run last. Two rows would make
    // "the" clock origin a question of ordering.
    const rows = await readRawRows(
      db,
      sql`select armed_at from first_run_state
          where organization_id = ${scope.organizationId} and project_id = ${scope.projectId}`,
    );
    expect(rows).toHaveLength(1);
  });

  // --- row 2 ---------------------------------------------------------------
  test("armedAt is visible to every member of the org", async () => {
    const createFirstRunRepo = await loadCreateRepo();
    const scope = await seedScope(db, "org-grain");

    await createFirstRunRepo(db, scope.owner).arm(scope.projectId, ARMED_AT);

    // THE ORG GRAIN, and the whole reason this is not a session flag. P-4 opens
    // the link the founder sent them thirty seconds into the wait: they must
    // see the SAME wait, counting from the SAME origin, not an unarmed surface
    // inviting them to trigger it again. A row keyed on the acting user's id
    // would give them the second thing, silently.
    const asTeammate = await createFirstRunRepo(db, scope.teammate).readState(scope.projectId);
    expect(asTeammate?.armedAt?.getTime()).toBe(ARMED_AT.getTime());
  });

  // --- row 3 ---------------------------------------------------------------
  test("dismissal is per user — one member dismissing leaves another undismissed", async () => {
    const createFirstRunRepo = await loadCreateRepo();
    const scope = await seedScope(db, "dismissal");
    const asOwner = createFirstRunRepo(db, scope.owner);
    const asTeammate = createFirstRunRepo(db, scope.teammate);

    await asOwner.dismiss(scope.ownerUserId, DISMISSED_AT);

    expect(await asOwner.isDismissed(scope.ownerUserId)).toBe(true);

    // AD-17, AND THE PROPERTY ESC-O2 RESTS ON. `/first-run` is the only surface
    // this product has; a per-org dismissal would mean the first member to
    // press "Hide this" removes the entire product from every teammate's
    // account, with no way back that the UI offers. Asked from the teammate's
    // OWN context as well as about their user id, because a repository that
    // reads `ctx.userId` and ignores the parameter passes the first check and
    // fails the second.
    expect(await asOwner.isDismissed(scope.teammateUserId)).toBe(false);
    expect(await asTeammate.isDismissed(scope.teammateUserId)).toBe(false);
  });

  // --- row 4 ---------------------------------------------------------------
  test("skipping slack persists a fact distinct from the absence of a connection", async () => {
    const createFirstRunRepo = await loadCreateRepo();
    const scope = await seedScope(db, "skip");
    const repo = createFirstRunRepo(db, scope.owner);

    const state = await repo.skipSlack(scope.projectId, SKIPPED_AT);

    // MECHANISM ONE — the STEP STATE. `skipped` has to be distinguishable from
    // `pending`, or step 3 renders as unfinished work forever for someone who
    // deliberately walked past it (AD-19's `StepState` carries both members).
    expect(state.slackSkippedAt?.getTime()).toBe(SKIPPED_AT.getTime());
    expect((await repo.readState(scope.projectId))?.slackSkippedAt?.getTime()).toBe(
      SKIPPED_AT.getTime(),
    );

    // MECHANISM TWO — the DEGRADED NOTICE, which this flag does NOT drive. It
    // is derived from the absence of an ACTIVE CONNECTION, which is what makes
    // it survive a reload by construction (FR-O14). The two are independent
    // here and must stay so: skipping wrote a state row while the connections
    // table stayed empty.
    const connections = await readRawRows(
      db,
      sql`select id from slack_connections where organization_id = ${scope.organizationId}`,
    );
    expect(connections).toHaveLength(0);

    // AND THE STATE CARRIES NO CONNECTION FIELD. A `slackConnected` boolean
    // cached onto this row would be the D11 hand-passed wire the split exists
    // to avoid — computed by one path, read by another, and stale the moment
    // the connection is revoked by anybody else.
    const keys = Object.keys(state);
    expect(keys.filter((key) => /connect/i.test(key))).toEqual([]);

    // Skipping is not arming. A write that touched both columns would start the
    // clock for a founder who only pressed "Skip for now".
    expect(state.armedAt).toBeNull();
  });

  // --- row 5 ---------------------------------------------------------------
  test("another organization's first-run state is never returned", async () => {
    const createFirstRunRepo = await loadCreateRepo();
    const orgA = await seedScope(db, "tenant-a");
    const orgB = await seedScope(db, "tenant-b");

    await createFirstRunRepo(db, orgA.owner).arm(orgA.projectId, ARMED_AT);
    await createFirstRunRepo(db, orgA.owner).dismiss(orgA.ownerUserId, DISMISSED_AT);

    // D7: a client-supplied project id belonging to another organization must
    // resolve to `null`, never to that org's clock. `first_run_state` is keyed
    // on (organization_id, project_id), so a read that filtered on project id
    // ALONE would compile, pass every single-tenant test, and hand org B org
    // A's wait.
    const fromB = createFirstRunRepo(db, orgB.owner);
    expect(await fromB.readState(orgA.projectId)).toBeNull();

    // The dismissals table has the same hazard one grain over: a user id is
    // just as client-supplied as a project id.
    expect(await fromB.isDismissed(orgA.ownerUserId)).toBe(false);

    // And org A is undisturbed — a D7 test that only asserts the leak is
    // absent can pass against a repository that returns nothing to anybody.
    expect(
      (await createFirstRunRepo(db, orgA.teammate).readState(orgA.projectId))?.armedAt?.getTime(),
    ).toBe(ARMED_AT.getTime());
  });
});
