// Two empties, not one. "You have no fixes" and "we cannot see anything at all" have
// different next actions, and merging them sends a brand-new org looking for a Slack
// button that will never appear.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createTestDb,
  seedConnection,
  seedOrgWithOwner,
  seedProject,
  type SeededOrgWithOwner,
  type TestDb,
} from "@growthmind/db/testing";

import { readOpenFixes } from "../../lib/fixes/read";
import {
  NOTHING_MEASURED_ACTION,
  NOTHING_MEASURED_BODY,
  NOTHING_OPENED_ACTION,
  NOTHING_OPENED_BODY,
} from "../../lib/fixes/view";

const NOW = new Date("2026-08-05T00:00:00.000Z");

async function seedOrgAndProject(
  db: TestDb,
  label: string,
): Promise<{ readonly org: SeededOrgWithOwner; readonly projectId: string }> {
  const org = await seedOrgWithOwner(db, {
    orgName: `web-fixes-empty-${label}`,
    userName: `web-fixes-empty-${label}`,
    email: `web-fixes-empty-${label}@example.com`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `web-fixes-empty-${label}`,
  });

  return { org, projectId: project.id };
}

describe("an empty open-fixes list", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("an org with nothing connected is told what to connect, not to wait for a Slack button", async () => {
    const { org, projectId } = await seedOrgAndProject(db, "no-source");

    expect(await readOpenFixes(db, org.ctx, projectId, NOW)).toEqual({ kind: "nothing_measured" });
  });

  test("an org that is measuring is told where the first fix comes from", async () => {
    const { org, projectId } = await seedOrgAndProject(db, "source");
    await seedConnection(db, { organizationId: org.organizationId, projectId });

    expect(await readOpenFixes(db, org.ctx, projectId, NOW)).toEqual({ kind: "nothing_opened" });
  });

  test("neither empty dead-ends: each names what produces the first fix and offers one action", () => {
    expect(NOTHING_OPENED_BODY).toContain("Slack");
    expect(NOTHING_OPENED_BODY).toContain("get it fixed");
    expect(NOTHING_OPENED_ACTION.length).toBeGreaterThan(0);

    expect(NOTHING_MEASURED_BODY).toContain("analytics is connected");
    expect(NOTHING_MEASURED_ACTION.length).toBeGreaterThan(0);
  });
});
