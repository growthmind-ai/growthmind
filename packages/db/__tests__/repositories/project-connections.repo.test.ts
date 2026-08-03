import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import {
  createProjectConnectionsRepo,
  toConnectionSummary,
  type InsertActiveConnectionInput,
} from "../../src/repositories/project-connections.repo";
import * as schema from "../../src/schema";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../../src/testing";
import { seedConnection, seedOrgWithOwner, seedProject } from "../../src/testing";

const NAMES = laneNames("pc");

const FAKE_ENVELOPE = "v1.00000000.FAKE-IV.FAKE-TAG.FAKE-CIPHERTEXT-NOT-A-SECRET";

function makeInsertInput(
  projectId: string,
  overrides: Partial<InsertActiveConnectionInput> = {},
): InsertActiveConnectionInput {
  return {
    projectId,
    sourceKind: "posthog",
    host: "https://eu.posthog.example.invalid",
    sourceProjectId: "10001",
    credentialCiphertext: FAKE_ENVELOPE,
    credentialKeyId: "00000000",
    health: "validating",
    connectedAt: new Date("2026-07-30T09:00:00.000Z"),
    nextPollAt: new Date("2026-07-30T09:01:00.000Z"),
    ...overrides,
  };
}

describe("project-connections repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("rejects a second ACTIVE connection on one project in the database, not by a prior read", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("second-source"),
      userName: NAMES.userName("second-source"),
      email: NAMES.email("second-source"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("second-source"),
    });
    const repo = createProjectConnectionsRepo(db, org.ctx);

    const first = await repo.insertActive(makeInsertInput(project.id));
    expect(first.isActive).toBe(true);
    expect(first.projectId).toBe(project.id);

    let caught: unknown;
    try {
      await repo.insertActive(makeInsertInput(project.id, { sourceProjectId: "20002" }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(
      /project_connections_active_project_uidx|duplicate key|unique constraint/i,
    );

    const active = await repo.getActiveForProject(project.id);
    expect(active?.id).toBe(first.id);
    expect(active?.sourceProjectId).toBe("10001");
  });

  it("yields exactly one active connection when two attach attempts race", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("race"),
      userName: NAMES.userName("race"),
      email: NAMES.email("race"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("race"),
    });
    const repo = createProjectConnectionsRepo(db, org.ctx);

    const settled = await Promise.allSettled([
      repo.insertActive(makeInsertInput(project.id, { sourceProjectId: "30003" })),
      repo.insertActive(makeInsertInput(project.id, { sourceProjectId: "40004" })),
    ]);

    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);

    const active = await repo.getActiveForProject(project.id);
    if (!active) {
      throw new Error("expected exactly one active connection to survive the race");
    }
    expect(["30003", "40004"]).toContain(active.sourceProjectId);
  });

  it("re-attaching the same source after a deactivate succeeds and keeps the old row", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("reattach"),
      userName: NAMES.userName("reattach"),
      email: NAMES.email("reattach"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("reattach"),
    });
    const repo = createProjectConnectionsRepo(db, org.ctx);

    const first = await repo.insertActive(makeInsertInput(project.id));

    const deactivated = await repo.deactivate(first.id);
    expect(deactivated?.isActive).toBe(false);
    expect(deactivated?.health).toBe("disconnected");
    expect(await repo.getActiveForProject(project.id)).toBeNull();

    const second = await repo.insertActive(makeInsertInput(project.id));
    expect(second.id).not.toBe(first.id);
    expect(second.isActive).toBe(true);

    const active = await repo.getActiveForProject(project.id);
    expect(active?.id).toBe(second.id);

    const rows = await db
      .select()
      .from(schema.projectConnections)
      .where(eq(schema.projectConnections.projectId, project.id));
    expect(rows).toHaveLength(2);
  });

  it("updateCredential re-keys the existing attachment in place rather than adding one", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("rekey"),
      userName: NAMES.userName("rekey"),
      email: NAMES.email("rekey"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("rekey"),
    });
    const repo = createProjectConnectionsRepo(db, org.ctx);

    const first = await repo.insertActive(makeInsertInput(project.id));

    const rekeyed = await repo.updateCredential(first.id, {
      credentialCiphertext: "v1.11111111.FAKE-IV.FAKE-TAG.FAKE-ROTATED-NOT-A-SECRET",
      credentialKeyId: "11111111",
    });

    expect(rekeyed?.id).toBe(first.id);

    const active = await repo.getActiveForProject(project.id);
    expect(active?.id).toBe(first.id);

    const rows = await db
      .select()
      .from(schema.projectConnections)
      .where(eq(schema.projectConnections.projectId, project.id));
    expect(rows).toHaveLength(1);
  });

  it("exposes no credential field on any returned connection", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("dto"),
      userName: NAMES.userName("dto"),
      email: NAMES.email("dto"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("dto"),
    });
    const repo = createProjectConnectionsRepo(db, org.ctx);

    const inserted = await repo.insertActive(makeInsertInput(project.id));
    const read = await repo.getActiveForProject(project.id);

    for (const summary of [inserted, read]) {
      expect(summary).not.toBeNull();
      expect(JSON.stringify(summary)).not.toContain(FAKE_ENVELOPE);
      expect(Object.keys(summary as object)).not.toContain("credentialCiphertext");
      expect(Object.keys(summary as object)).not.toContain("credentialKeyId");
    }
  });

  it("maps a raw row to a summary that drops the ciphertext, and leaks none of it into an error", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("leak"),
      userName: NAMES.userName("leak"),
      email: NAMES.email("leak"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("leak"),
    });
    await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });

    const [row] = await db
      .select()
      .from(schema.projectConnections)
      .where(eq(schema.projectConnections.projectId, project.id));
    if (!row) {
      throw new Error("expected the seeded connection row");
    }

    const summary = toConnectionSummary(row);
    expect(Object.keys(summary)).not.toContain("credentialCiphertext");
    expect(Object.keys(summary)).not.toContain("credentialKeyId");
    expect(JSON.stringify(summary)).not.toContain(row.credentialCiphertext);

    const repo = createProjectConnectionsRepo(db, org.ctx);
    let caught: unknown;
    try {
      await repo.insertActive(makeInsertInput(project.id, { credentialCiphertext: FAKE_ENVELOPE }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(String(caught)).not.toContain(FAKE_ENVELOPE);
  });

  it("advances the watermark monotonically — a stale value cannot move it backwards", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("watermark"),
      userName: NAMES.userName("watermark"),
      email: NAMES.email("watermark"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("watermark"),
    });
    const middle = new Date("2026-07-30T11:00:00.000Z");
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      watermarkAt: middle,
    });
    const repo = createProjectConnectionsRepo(db, org.ctx);

    const older = new Date("2026-07-30T10:00:00.000Z");
    const newer = new Date("2026-07-30T12:00:00.000Z");

    const afterStale = await repo.advanceWatermark(connection.id, {
      watermarkAt: older,
      backfillBefore: null,
    });
    expect(afterStale?.watermarkAt?.getTime()).toBe(middle.getTime());

    const afterForward = await repo.advanceWatermark(connection.id, {
      watermarkAt: newer,
      backfillBefore: null,
    });
    expect(afterForward?.watermarkAt?.getTime()).toBe(newer.getTime());

    const readBack = await repo.getActiveForProject(project.id);
    expect(readBack?.watermarkAt?.getTime()).toBe(newer.getTime());
  });

  it("keeps the furthest watermark when two runs advance it concurrently", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("watermark-race"),
      userName: NAMES.userName("watermark-race"),
      email: NAMES.email("watermark-race"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("watermark-race"),
    });
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      watermarkAt: new Date("2026-07-30T10:00:00.000Z"),
    });
    const repo = createProjectConnectionsRepo(db, org.ctx);

    const behind = new Date("2026-07-30T10:30:00.000Z");
    const ahead = new Date("2026-07-30T13:00:00.000Z");

    await Promise.all([
      repo.advanceWatermark(connection.id, { watermarkAt: ahead, backfillBefore: null }),
      repo.advanceWatermark(connection.id, { watermarkAt: behind, backfillBefore: null }),
    ]);

    const readBack = await repo.getActiveForProject(project.id);
    expect(readBack?.watermarkAt?.getTime()).toBe(ahead.getTime());
  });

  it("records a resume cursor without moving the watermark when a walk stopped on the page cap", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("backfill"),
      userName: NAMES.userName("backfill"),
      email: NAMES.email("backfill"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("backfill"),
    });
    const watermark = new Date("2026-07-30T11:00:00.000Z");
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      watermarkAt: watermark,
    });
    const repo = createProjectConnectionsRepo(db, org.ctx);

    const updated = await repo.advanceWatermark(connection.id, {
      watermarkAt: watermark,
      backfillBefore: "2026-07-30T10:15:00.123+00:00",
    });

    expect(updated?.watermarkAt?.getTime()).toBe(watermark.getTime());
    expect(updated?.backfillBefore).toBe("2026-07-30T10:15:00.123+00:00");

    const readBack = await repo.getActiveForProject(project.id);
    expect(readBack?.backfillBefore).toBe("2026-07-30T10:15:00.123+00:00");
  });

  it("setBackfillCursor persists a resume cursor on a NEVER-POLLED connection, leaving watermark_at NULL", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("cr1-never-polled"),
      userName: NAMES.userName("cr1-never-polled"),
      email: NAMES.email("cr1-never-polled"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("cr1-never-polled"),
    });

    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });
    const repo = createProjectConnectionsRepo(db, org.ctx);
    expect((await repo.getActiveForProject(project.id))?.watermarkAt).toBeNull();

    const held = await repo.setBackfillCursor(connection.id, "2026-07-30T10:15:00.123+00:00");

    expect(held?.watermarkAt).toBeNull();
    expect(held?.backfillBefore).toBe("2026-07-30T10:15:00.123+00:00");

    const readBack = await repo.getActiveForProject(project.id);
    expect(readBack?.watermarkAt).toBeNull();
    expect(readBack?.backfillBefore).toBe("2026-07-30T10:15:00.123+00:00");
  });

  it("setBackfillCursor never touches watermark_at on an already-polled connection", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("cr1-polled"),
      userName: NAMES.userName("cr1-polled"),
      email: NAMES.email("cr1-polled"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("cr1-polled"),
    });
    const watermark = new Date("2026-07-30T11:00:00.000Z");
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      watermarkAt: watermark,
    });
    const repo = createProjectConnectionsRepo(db, org.ctx);

    const held = await repo.setBackfillCursor(connection.id, "2026-07-30T09:00:00.000+00:00");

    expect(held?.watermarkAt?.getTime()).toBe(watermark.getTime());
    expect(held?.backfillBefore).toBe("2026-07-30T09:00:00.000+00:00");
  });

  it("setBackfillCursor returns null for a foreign org's connection and changes nothing", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("cr1-foreign-a"),
      userName: NAMES.userName("cr1-foreign-a"),
      email: NAMES.email("cr1-foreign-a"),
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("cr1-foreign-b"),
      userName: NAMES.userName("cr1-foreign-b"),
      email: NAMES.email("cr1-foreign-b"),
    });
    const project = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: NAMES.projectName("cr1-foreign"),
    });
    const connection = await seedConnection(db, {
      organizationId: orgA.organizationId,
      projectId: project.id,
    });

    const repoB = createProjectConnectionsRepo(db, orgB.ctx);
    expect(
      await repoB.setBackfillCursor(connection.id, "2026-07-30T09:00:00.000+00:00"),
    ).toBeNull();

    const repoA = createProjectConnectionsRepo(db, orgA.ctx);
    const after = await repoA.getActiveForProject(project.id);
    expect(after?.backfillBefore).toBeNull();
  });

  it("returns null from every mutation for a foreign org's connection and changes nothing", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("foreign-a"),
      userName: NAMES.userName("foreign-a"),
      email: NAMES.email("foreign-a"),
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("foreign-b"),
      userName: NAMES.userName("foreign-b"),
      email: NAMES.email("foreign-b"),
    });
    const project = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: NAMES.projectName("foreign"),
    });
    const connection = await seedConnection(db, {
      organizationId: orgA.organizationId,
      projectId: project.id,
      health: "healthy",
    });

    const repoB = createProjectConnectionsRepo(db, orgB.ctx);

    expect(
      await repoB.updateCredential(connection.id, {
        credentialCiphertext: "v1.22222222.FAKE-IV.FAKE-TAG.FAKE-FOREIGN-NOT-A-SECRET",
        credentialKeyId: "22222222",
      }),
    ).toBeNull();
    expect(await repoB.deactivate(connection.id)).toBeNull();
    expect(
      await repoB.recordHealth(connection.id, {
        health: "failing",
        reasonCode: "invalid_credentials",
        reasonMessage: "seeded by a foreign organization",
        checkedAt: new Date("2026-07-30T12:00:00.000Z"),
      }),
    ).toBeNull();
    expect(
      await repoB.advanceWatermark(connection.id, {
        watermarkAt: new Date("2026-07-30T12:00:00.000Z"),
        backfillBefore: null,
      }),
    ).toBeNull();
    expect(
      await repoB.setInferredInternalDomain(connection.id, {
        domain: "attacker.example",
        provenance: "org_creator_email",
      }),
    ).toBeNull();

    const repoA = createProjectConnectionsRepo(db, orgA.ctx);
    const after = await repoA.getActiveForProject(project.id);
    expect(after?.id).toBe(connection.id);
    expect(after?.isActive).toBe(true);
    expect(after?.health).toBe("healthy");
    expect(after?.watermarkAt).toBeNull();
    expect(after?.inferredInternalDomain).toBeNull();
    expect(after?.healthReasonCode).toBeNull();
  });

  it("returns null rather than data when a foreign org names another org's project", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("read-a"),
      userName: NAMES.userName("read-a"),
      email: NAMES.email("read-a"),
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("read-b"),
      userName: NAMES.userName("read-b"),
      email: NAMES.email("read-b"),
    });
    const project = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: NAMES.projectName("read"),
    });
    await seedConnection(db, {
      organizationId: orgA.organizationId,
      projectId: project.id,
    });

    const repoB = createProjectConnectionsRepo(db, orgB.ctx);
    expect(await repoB.getActiveForProject(project.id)).toBeNull();
  });
});
