// RED in Wave 0 against repositories Wave 2 writes. D7 / AC-G5: the only source of org identity
// is the tenant context, and a caller-supplied project id is resolved through the ownership guard
// before any insert.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { createShippedChangesRepo } from "../../src/repositories/shipped-changes.repo";
import { createShippedChangeVerdictsRepo } from "../../src/repositories/shipped-change-verdicts.repo";
import * as schema from "../../src/schema";
import {
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  seedProject,
  type SeededOrgWithOwner,
  type SeededProject,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("shipped-tenancy");

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SHIPPED_REPO_SOURCES = [
  path.join(REPO_ROOT, "packages", "db", "src", "repositories", "shipped-changes.repo.ts"),
  path.join(REPO_ROOT, "packages", "db", "src", "repositories", "shipped-change-verdicts.repo.ts"),
];

const REPORTED_AT = new Date("2026-08-09T09:00:00.000Z");
const READOUT_DUE_AT = new Date("2026-08-23T09:00:00.000Z");

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function stripSourceComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

async function seedTenant(
  label: string,
): Promise<{ org: SeededOrgWithOwner; project: SeededProject }> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });

  return { org, project };
}

async function changeRowsForProject(projectId: string) {
  return db
    .select()
    .from(schema.shippedChanges)
    .where(eq(schema.shippedChanges.projectId, projectId));
}

describe("a report never crosses the tenant boundary", () => {
  test("org A reporting against org B's project id is refused and writes nothing", async () => {
    const a = await seedTenant("write-a");
    const b = await seedTenant("write-b");

    await expect(
      createShippedChangesRepo(db, a.org.ctx).reportShipped({
        projectId: b.project.id,
        page: "/reports",
        description: "CSV export",
        reportedAt: REPORTED_AT,
        readoutDueAt: READOUT_DUE_AT,
      }),
    ).rejects.toThrow(/organization/i);

    // Zero rows under EITHER org: a write that landed under the caller's own org would be a
    // silent success wearing a refusal's clothes.
    expect(await changeRowsForProject(b.project.id)).toHaveLength(0);
    expect(await changeRowsForProject(a.project.id)).toHaveLength(0);
  });

  test("org A cannot read org B's readout", async () => {
    const a = await seedTenant("read-a");
    const b = await seedTenant("read-b");

    const theirs = await createShippedChangesRepo(db, b.org.ctx).reportShipped({
      projectId: b.project.id,
      page: "/reports",
      control: "Export CSV",
      description: "CSV export",
      reportedAt: REPORTED_AT,
      readoutDueAt: READOUT_DUE_AT,
    });

    expect(await createShippedChangesRepo(db, a.org.ctx).findById(theirs.change.id)).toBeNull();
    expect(await createShippedChangesRepo(db, b.org.ctx).findById(theirs.change.id)).not.toBeNull();
  });

  test("org A cannot read the verdict recorded against org B's change", async () => {
    const a = await seedTenant("verdict-a");
    const b = await seedTenant("verdict-b");

    const theirs = await createShippedChangesRepo(db, b.org.ctx).reportShipped({
      projectId: b.project.id,
      page: "/reports",
      description: "CSV export",
      reportedAt: REPORTED_AT,
      readoutDueAt: READOUT_DUE_AT,
    });

    expect(
      await createShippedChangeVerdictsRepo(db, a.org.ctx).findForChange(theirs.change.id),
    ).toBeNull();
  });
});

describe("the ownership guard is present in the source rather than assumed", () => {
  test("every shipped repository asserts project ownership through the scope helper", () => {
    for (const file of SHIPPED_REPO_SOURCES) {
      const code = stripSourceComments(readFileSync(file, "utf8"));

      expect({ file: path.basename(file), guarded: /s\.assertProjectOwned\(/.test(code) }).toEqual({
        file: path.basename(file),
        guarded: true,
      });
    }
  });
});
