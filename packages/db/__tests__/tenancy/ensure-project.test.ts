import { afterAll, beforeAll, describe, expect, test } from "bun:test";

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

import { setLogSink, type LogRecord } from "@growthmind/shared";
const NAMES = laneNames("ensure-project");

const OWNER = "ADD Wave 2 (packages/db/src/tenancy/ensure-project.ts, AD-7)";

const loadEnsureProject = (): Promise<EnsureProject> =>
  loadUnderConstruction<EnsureProject>({
    modulePath: underConstructionSpecifier("packages/db/src/tenancy/ensure-project"),
    exportName: "ensureProject",
    ownedBy: OWNER,
  });

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

    const stampedOrg = await readRawScalar(
      db,
      sql`select organization_id from projects where id = ${result.projectId}`,
    );
    expect(stampedOrg).toBe(org.organizationId);
  });

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

    expect(result.projectId).toBe(existing.id);
    expect(await listProjectIds(db, org.organizationId)).toEqual([existing.id]);
  });

  test("two concurrent calls for one org settle on one project via the constraint, not a prior read", async () => {
    const ensureProject = await loadEnsureProject();
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("race"),
      userName: NAMES.userName("race"),
      email: NAMES.email("race"),
    });

    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });
    let resultA: { projectId: string };
    let resultB: { projectId: string };

    try {
      [resultA, resultB] = await Promise.all([
        ensureProject(db, org.ctx),
        ensureProject(db, org.ctx),
      ]);
    } finally {
      restore();
    }

    expect(resultA.projectId).toBe(resultB.projectId);

    const conflictLogs = logged.filter(
      (record) =>
        /ensureProject/.test(record.message) &&
        /concurrent|conflict|duplicate|winner/i.test(record.message),
    );
    expect(conflictLogs).toHaveLength(1);

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

  test("a project created without a provisioning key does not block auto-provisioning", async () => {
    const ensureProject = await loadEnsureProject();

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

    expect(await readProvisioningKey(db, a.projectId)).toBe(
      provisioningKeyFor(orgA.organizationId),
    );
    expect(await readProvisioningKey(db, b.projectId)).toBe(
      provisioningKeyFor(orgB.organizationId),
    );

    const again = await ensureProject(db, orgA.ctx);
    expect(again.projectId).toBe(a.projectId);
    expect(await readProvisioningKey(db, again.projectId)).toBe(
      provisioningKeyFor(orgA.organizationId),
    );
  });
});

describe("anti-vacuity control — the red above is about ensure-project.ts, not about the loader", () => {
  test("the loader resolves a module that exists, from this file, through the same specifier helper", async () => {
    const ensureOrganization = await loadUnderConstruction<unknown>({
      modulePath: underConstructionSpecifier("packages/db/src/tenancy/ensure-organization"),
      exportName: "ensureOrganization",
      ownedBy: "already shipped (O-002)",
    });
    expect(typeof ensureOrganization).toBe("function");
  });
});
