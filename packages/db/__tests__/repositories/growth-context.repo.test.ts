import { URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import { createGrowthContextRepo } from "../../src/repositories/growth-context.repo";
import { growthContext } from "../../src/schema/growth-context";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, seedOrgWithOwner, seedProject } from "../../src/testing";

const NAMES = laneNames("growth-context-repo");

const CONFIRMED = new Date("2026-08-01T10:00:00.000Z");

const CHECKOUT = {
  surface: "/checkout",
  role: "makes_money",
  basis: "stated_by_customer",
  confirmedAt: CONFIRMED,
  normalisationVersion: URL_PATH_NORMALISATION_VERSION,
} as const;

async function seedOrgAndProject(db: TestDb, label: string) {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });

  return { org, projectId: project.id };
}

describe("growth context repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("answers null for a project nothing has been said about", async () => {
    const { org, projectId } = await seedOrgAndProject(db, "absent");

    expect(await createGrowthContextRepo(db, org.ctx).findForProject(projectId)).toBeNull();
  });

  it("reads back what it saved", async () => {
    const { org, projectId } = await seedOrgAndProject(db, "roundtrip");
    const repo = createGrowthContextRepo(db, org.ctx);

    await repo.save({ projectId, surfaces: [CHECKOUT], confirmedChangeable: ["/legal/terms"] });

    const read = await repo.findForProject(projectId);

    expect(read?.bySurface.get("/checkout")?.role).toBe("makes_money");
    expect(read?.bySurface.get("/checkout")?.confirmedAt).toEqual(CONFIRMED);
    expect(read?.confirmedChangeable.has("/legal/terms")).toBe(true);
  });

  it("replaces the record on a second save rather than accumulating rows", async () => {
    const { org, projectId } = await seedOrgAndProject(db, "resave");
    const repo = createGrowthContextRepo(db, org.ctx);

    await repo.save({ projectId, surfaces: [CHECKOUT], confirmedChangeable: [] });
    await repo.save({
      projectId,
      surfaces: [{ ...CHECKOUT, role: "keeps_people" }],
      confirmedChangeable: [],
    });

    const rows = await db
      .select()
      .from(growthContext)
      .where(eq(growthContext.projectId, projectId));

    expect(rows).toHaveLength(1);
    expect((await repo.findForProject(projectId))?.bySurface.get("/checkout")?.role).toBe(
      "keeps_people",
    );
  });

  it("refuses to write against a project belonging to another organization", async () => {
    const mine = await seedOrgAndProject(db, "tenant-mine");
    const theirs = await seedOrgAndProject(db, "tenant-theirs");

    await expect(
      createGrowthContextRepo(db, mine.org.ctx).save({
        projectId: theirs.projectId,
        surfaces: [CHECKOUT],
        confirmedChangeable: [],
      }),
    ).rejects.toThrow(/not this organization's/);
  });

  it("does not read another organization's record for the same project id", async () => {
    const mine = await seedOrgAndProject(db, "read-mine");
    const theirs = await seedOrgAndProject(db, "read-theirs");

    await createGrowthContextRepo(db, theirs.org.ctx).save({
      projectId: theirs.projectId,
      surfaces: [CHECKOUT],
      confirmedChangeable: [],
    });

    expect(
      await createGrowthContextRepo(db, mine.org.ctx).findForProject(theirs.projectId),
    ).toBeNull();
  });

  it("refuses to save a record it could not read back", async () => {
    const { org, projectId } = await seedOrgAndProject(db, "write-validated");

    await expect(
      createGrowthContextRepo(db, org.ctx).save({
        projectId,
        surfaces: [{ ...CHECKOUT, surface: "checkout/" }],
        confirmedChangeable: [],
      }),
    ).rejects.toThrow();
  });

  it("answers absence, not a throw, for a stored row this build cannot read", async () => {
    // Prod holds every shape ever written. Absence is "weigh everything the same", which
    // is the ordering that shipped before any weighting existed — never a lost delivery.
    const { org, projectId } = await seedOrgAndProject(db, "unreadable");
    const repo = createGrowthContextRepo(db, org.ctx);

    await repo.save({ projectId, surfaces: [CHECKOUT], confirmedChangeable: [] });

    await db
      .update(growthContext)
      .set({ surfaces: [{ surface: "/checkout", role: "prints_money" }] })
      .where(eq(growthContext.projectId, projectId));

    expect(await repo.findForProject(projectId)).toBeNull();
  });

  it("returns only the projects it was asked about, keyed by project", async () => {
    const { org, projectId } = await seedOrgAndProject(db, "many");
    const second = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("many-second"),
    });
    const repo = createGrowthContextRepo(db, org.ctx);

    await repo.save({ projectId, surfaces: [CHECKOUT], confirmedChangeable: [] });

    const byProject = await repo.findForProjects([projectId, second.id]);

    expect(byProject.size).toBe(1);
    expect(byProject.get(projectId)?.bySurface.get("/checkout")?.role).toBe("makes_money");
    expect(byProject.get(second.id)).toBeUndefined();
  });

  it("reads nothing for an empty list without touching the database", async () => {
    const { org } = await seedOrgAndProject(db, "empty-list");

    expect((await createGrowthContextRepo(db, org.ctx).findForProjects([])).size).toBe(0);
  });
});

describe("growth context repository — writing against a row that moved", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("writes when the row is exactly as it was read", async () => {
    const { org, projectId } = await seedOrgAndProject(db, "unchanged-writes");
    const repo = createGrowthContextRepo(db, org.ctx);

    await repo.save({ projectId, surfaces: [CHECKOUT], confirmedChangeable: [] });
    const snapshot = await repo.snapshotForProject(projectId);

    const written = await repo.saveIfUnchanged(
      { projectId, surfaces: [{ ...CHECKOUT, role: "keeps_people" }], confirmedChangeable: [] },
      snapshot?.updatedAt ?? null,
    );

    expect(written).toBe(true);
    expect((await repo.findForProject(projectId))?.bySurface.get("/checkout")?.role).toBe(
      "keeps_people",
    );
  });

  it("refuses to write over a confirmation that arrived after it read", async () => {
    // The whole point of the stamp: a nightly derivation must not discard what a person
    // said while it was working the answer out.
    const { org, projectId } = await seedOrgAndProject(db, "confirmation-wins");
    const repo = createGrowthContextRepo(db, org.ctx);

    await repo.save({ projectId, surfaces: [CHECKOUT], confirmedChangeable: [] });
    const snapshot = await repo.snapshotForProject(projectId);

    await repo.save({
      projectId,
      surfaces: [{ ...CHECKOUT, role: "first_value", basis: "stated_by_customer" }],
      confirmedChangeable: [],
    });

    const written = await repo.saveIfUnchanged(
      { projectId, surfaces: [{ ...CHECKOUT, role: "keeps_people" }], confirmedChangeable: [] },
      snapshot?.updatedAt ?? null,
    );

    expect(written).toBe(false);
    expect((await repo.findForProject(projectId))?.bySurface.get("/checkout")?.role).toBe(
      "first_value",
    );
  });

  it("refuses to write when it read no row and one has appeared since", async () => {
    const { org, projectId } = await seedOrgAndProject(db, "appeared-since");
    const repo = createGrowthContextRepo(db, org.ctx);

    await repo.save({
      projectId,
      surfaces: [{ ...CHECKOUT, role: "first_value" }],
      confirmedChangeable: [],
    });

    expect(
      await repo.saveIfUnchanged(
        { projectId, surfaces: [CHECKOUT], confirmedChangeable: [] },
        null,
      ),
    ).toBe(false);
    expect((await repo.findForProject(projectId))?.bySurface.get("/checkout")?.role).toBe(
      "first_value",
    );
  });

  it("inserts when it read no row and none has appeared", async () => {
    const { org, projectId } = await seedOrgAndProject(db, "first-write");
    const repo = createGrowthContextRepo(db, org.ctx);

    expect(
      await repo.saveIfUnchanged(
        { projectId, surfaces: [CHECKOUT], confirmedChangeable: [] },
        null,
      ),
    ).toBe(true);
    expect((await repo.findForProject(projectId))?.bySurface.get("/checkout")?.role).toBe(
      "makes_money",
    );
  });
});
