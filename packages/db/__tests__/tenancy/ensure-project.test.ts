// AD-7 / FR-O1 — `ensureProject`. Wave 0d, task 0d.1. ADD §9, 5 rows.
//
// THIS IS THE NEVER-CUT ROW. Nothing in this codebase mints a `projects` row
// today — `seedProject` in `__tests__/helpers/fixtures.ts` is a TEST fixture,
// and `projects.repo.ts` reads. Every other step of the first-run surface needs
// a `projectId` before it can do anything at all, so a founder who signs up
// currently reaches a surface that cannot address any of their own data. This
// function is what closes that, and if it is wrong nothing above it works.
//
// ###########################################################################
// # WHAT "SETTLED BY A CONSTRAINT, NOT A PRIOR READ" ACTUALLY REQUIRES
// #
// # EC-O6 and AC-O32 use that phrase, and the ADD's correction C-B found that
// # `projects` had NO constraint to settle it with — only a non-unique btree
// # index on `organization_id`. AD-7's answer is a NULLABLE
// # `provisioning_key` under `projects_provisioning_key_uidx`, and NOT
// # `UNIQUE (organization_id)`: the latter would be a permanent product
// # commitment that an organization may hold exactly one project, made
// # silently, inside an onboarding sprint. OQ-O4 stays open (ESC-O5), and the
// # rows below are written so that answering it later does not invalidate any
// # of them.
// #
// # THE ROW THAT IS EASY TO FAKE. "Two concurrent calls settle on one project"
// # passes for a RACY READ-THEN-INSERT too, on a single-connection driver,
// # because the row count comes out the same. So row 3 below does not assert a
// # row count as its proof. It asserts (a) that the loser's own path went
// # through the unique-violation catch, and (b) that the index exists and
// # refuses a duplicate key BY NAME. A read-then-insert can produce neither.
// ###########################################################################
//
// EVERY ROW IS RED TODAY, and for one reason: `packages/db/src/tenancy/
// ensure-project.ts` does not exist on this tree (ADD Wave 2 writes it,
// alongside the `provisioning_key` column and migration `0009_*`). The loader
// turns that into a NAMED diagnostic rather than a TS2307 that would take the
// whole typecheck gate down — see `module-under-construction.ts`.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { sql } from "drizzle-orm";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import { seedOrgWithOwner, seedProject } from "../helpers/fixtures";
import {
  captureRejection,
  provisioningKeyFor,
  readPgFailure,
  readRawRows,
  readRawScalar,
  type EnsureProject,
} from "../helpers/onboarding-contract";

const NAMES = laneNames("ensure-project");

const OWNER = "ADD Wave 2 (packages/db/src/tenancy/ensure-project.ts, AD-7)";

/** ADD Wave 2 creates this. Until then every row below is red on an ABSENT
 *  BEHAVIOUR, named as such. */
const loadEnsureProject = (): Promise<EnsureProject> =>
  loadUnderConstruction<EnsureProject>({
    modulePath: underConstructionSpecifier("packages/db/src/tenancy/ensure-project"),
    exportName: "ensureProject",
    ownedBy: OWNER,
  });

/**
 * The `provisioning_key` column read through RAW SQL, because Wave 2 adds the
 * column to `schema/projects.ts` and `db.select()` therefore cannot name it on
 * this tree. See `onboarding-contract.ts`'s `RawExecutor` header.
 */
async function readProvisioningKey(db: TestDb, projectId: string): Promise<unknown> {
  return readRawScalar(db, sql`select provisioning_key from projects where id = ${projectId}`);
}

async function listProjectIds(db: TestDb, organizationId: string): Promise<string[]> {
  const rows = await readRawRows(
    db,
    sql`select id from projects where organization_id = ${organizationId} order by id`,
  );
  return rows.map((row) => String(row.id));
}

describe("ensureProject — FR-O1, the row nothing else works without", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // --- row 1 ---------------------------------------------------------------
  test("a signed-in org with no project gets exactly one", async () => {
    const ensureProject = await loadEnsureProject();
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("cold"),
      userName: NAMES.userName("cold"),
      email: NAMES.email("cold"),
    });

    const result = await ensureProject(db, org.ctx);

    const ids = await listProjectIds(db, org.organizationId);
    expect(ids).toEqual([result.projectId]);

    // The org stamp is what every later scoped read filters on (D2). A project
    // provisioned without it is a row no repository in this package can find.
    const stampedOrg = await readRawScalar(
      db,
      sql`select organization_id from projects where id = ${result.projectId}`,
    );
    expect(stampedOrg).toBe(org.organizationId);
  });

  // --- row 2 ---------------------------------------------------------------
  test("an org that already has a project gets that project, never a second", async () => {
    const ensureProject = await loadEnsureProject();
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("existing"),
      userName: NAMES.userName("existing"),
      email: NAMES.email("existing"),
    });
    const existing = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("existing"),
    });

    const result = await ensureProject(db, org.ctx);

    // The read-first fast path (`ensure-organization.ts:47-50`'s shape). An org
    // that already holds a project must not acquire a second one merely by
    // landing on `/first-run` — OQ-O4 is open, and silently minting projects
    // per visit would answer it by accident.
    expect(result.projectId).toBe(existing.id);
    expect(await listProjectIds(db, org.organizationId)).toEqual([existing.id]);
  });

  // --- row 3 ---------------------------------------------------------------
  test("two concurrent calls for one org settle on one project via the constraint, not a prior read", async () => {
    const ensureProject = await loadEnsureProject();
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("race"),
      userName: NAMES.userName("race"),
      email: NAMES.email("race"),
    });

    const errors = spyOn(console, "error");
    let resultA: { projectId: string };
    let resultB: { projectId: string };
    try {
      // `Promise.all`, not sequential awaits — both calls issue their read-first
      // SELECT before either INSERT lands, which is what puts the loser on the
      // conflict path. This is the exact shape `apps/web/__tests__/tenancy/
      // signup-org.test.ts` uses to race `ensureOrganization`, and it is
      // deterministic on PGlite's single connection for that reason.
      [resultA, resultB] = await Promise.all([
        ensureProject(db, org.ctx),
        ensureProject(db, org.ctx),
      ]);
    } finally {
      errors.mockRestore();
    }

    expect(resultA.projectId).toBe(resultB.projectId);

    // LEG 1 — THE LOSER WENT THROUGH THE UNIQUE-VIOLATION CATCH.
    //
    // This, and not the row count, is what distinguishes a constraint-settled
    // provision from a racy read-then-insert. `ensureOrganization` announces
    // exactly this path (`ensure-organization.ts:92-95`) and it must: D8
    // forbids a silent recovery, because an operator who cannot see the race
    // cannot see it becoming frequent. The pattern is deliberately loose about
    // wording — the contract is that the conflict path SAYS SO, not that it
    // says any particular sentence.
    const conflictLogs = errors.mock.calls.filter(([first]) => {
      const line = String(first);
      return /ensureProject/.test(line) && /concurrent|conflict|duplicate|winner/i.test(line);
    });
    expect(conflictLogs).toHaveLength(1);

    // LEG 2 — AND THE CONSTRAINT ITSELF EXISTS AND BITES, BY NAME.
    //
    // A second row bearing the same deterministic key is un-insertable. If this
    // write succeeds, "settled by a constraint" was a description of intent
    // rather than of the schema, and leg 1's log line would be decoration.
    const duplicate = await captureRejection(() =>
      readRawRows(
        db,
        sql`insert into projects (id, organization_id, name, provisioning_key)
            values (${`${org.organizationId}-duplicate`}, ${org.organizationId},
                    ${NAMES.projectName("race-duplicate")},
                    ${provisioningKeyFor(org.organizationId)})`,
      ),
    );
    const failure = readPgFailure(duplicate);
    expect(failure.code).toBe("23505");
    expect(`${failure.constraint ?? ""} ${failure.message}`).toContain(
      "projects_provisioning_key_uidx",
    );

    expect(await listProjectIds(db, org.organizationId)).toEqual([resultA.projectId]);
  });

  // --- row 4 ---------------------------------------------------------------
  test("a project created without a provisioning key does not block auto-provisioning", async () => {
    const ensureProject = await loadEnsureProject();

    // Two projects created by SOME OTHER PATH — `seedProject` writes no
    // provisioning key, exactly as a future "create a second project" flow
    // would not. Postgres permits unlimited NULLs in a unique index, so these
    // two coexist; if AD-7 had chosen `UNIQUE (organization_id)` instead, the
    // second of these would already be un-insertable and OQ-O4 would have been
    // answered by a schema line nobody read.
    const other = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("nulls"),
      userName: NAMES.userName("nulls"),
      email: NAMES.email("nulls"),
    });
    const first = await seedProject(db, {
      organizationId: other.organizationId,
      name: NAMES.projectName("nulls-a"),
    });
    const second = await seedProject(db, {
      organizationId: other.organizationId,
      name: NAMES.projectName("nulls-b"),
    });
    expect(await readProvisioningKey(db, first.id)).toBeNull();
    expect(await readProvisioningKey(db, second.id)).toBeNull();

    // …and auto-provisioning for a DIFFERENT org still works. The NULL rows
    // consumed no slot in the index.
    const fresh = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("nulls-fresh"),
      userName: NAMES.userName("nulls-fresh"),
      email: NAMES.email("nulls-fresh"),
    });
    const provisioned = await ensureProject(db, fresh.ctx);
    expect(await readProvisioningKey(db, provisioned.projectId)).toBe(
      provisioningKeyFor(fresh.organizationId),
    );
  });

  // --- row 5 ---------------------------------------------------------------
  test("the provisioning key is derived from the organization id and nothing else", async () => {
    const ensureProject = await loadEnsureProject();
    const orgA = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("key-a"),
      userName: NAMES.userName("key-a"),
      email: NAMES.email("key-a"),
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("key-b"),
      userName: NAMES.userName("key-b"),
      email: NAMES.email("key-b"),
    });

    const a = await ensureProject(db, orgA.ctx);
    const b = await ensureProject(db, orgB.ctx);

    // THE LITERAL, from AD-7's own comment block. No uuid, no timestamp, no
    // user id, no project name — a key carrying any of those would fork on the
    // next call and the constraint would settle nothing (D12: a deterministic
    // id is exactly as stable as its least stable input; `organization.id` is a
    // primary key and never churns).
    expect(await readProvisioningKey(db, a.projectId)).toBe(
      provisioningKeyFor(orgA.organizationId),
    );
    expect(await readProvisioningKey(db, b.projectId)).toBe(
      provisioningKeyFor(orgB.organizationId),
    );

    // Determinism, observed rather than assumed: a second call for org A
    // resolves to the same project under the same key.
    const again = await ensureProject(db, orgA.ctx);
    expect(again.projectId).toBe(a.projectId);
    expect(await readProvisioningKey(db, again.projectId)).toBe(
      provisioningKeyFor(orgA.organizationId),
    );
  });
});

// ===========================================================================
// ANTI-VACUITY CONTROL — GREEN BY DESIGN, AND NOT A CONTRACT ROW.
//
// All five rows above fail on the SAME first line (`loadEnsureProject`). That
// is correct for Wave 0, and it is also the shape in which a suite can quietly
// stop describing anything: if the LOADER were broken — a bad specifier, a
// resolution mode this package does not support — every row would still be red
// and nobody would learn that the contract had never been expressed at all.
//
// So this row resolves a module that DOES exist, through the same call, from
// this same file. It is written to stay true forever rather than to assert the
// absence of `ensure-project.ts`: an assertion that the module is missing would
// go red the day Wave 2 lands, on a file Wave 2 does not own, which is a trap
// rather than a control.
// ===========================================================================

describe("anti-vacuity control — the red above is about ensure-project.ts, not about the loader", () => {
  test("the loader resolves a module that exists, from this file, through the same specifier helper", async () => {
    // AD-7: `ensure-project.ts` "copies `ensureOrganization`'s shape line for
    // line". If the specifier helper works for the model, a failure for the
    // copy is a statement about the copy.
    const ensureOrganization = await loadUnderConstruction<unknown>({
      modulePath: underConstructionSpecifier("packages/db/src/tenancy/ensure-organization"),
      exportName: "ensureOrganization",
      ownedBy: "already shipped (O-002)",
    });
    expect(typeof ensureOrganization).toBe("function");
  });
});
