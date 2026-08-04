import { URL_PATH_NORMALISATION_VERSION, type IcpBelief } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createGrowthContextRepo } from "../../src/repositories/growth-context.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, seedOrgWithOwner, seedProject } from "../../src/testing";

const NAMES = laneNames("icp-corrections");

const READ_AT = new Date("2026-08-04T21:00:00.000Z");
const STATED_AT = new Date("2026-08-05T09:00:00.000Z");

function readBelief(statement: string): IcpBelief {
  return {
    kind: "who_it_is_for",
    statement,
    provenance: { source: "site", at: READ_AT, citation: "https://example.com/" },
    correctedFrom: null,
  };
}

async function seedLane(db: TestDb, label: string) {
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

async function seedBeliefs(
  db: TestDb,
  lane: Awaited<ReturnType<typeof seedLane>>,
  beliefs: readonly IcpBelief[],
) {
  const repo = createGrowthContextRepo(db, lane.org.ctx);
  await repo.stateSiteDomain({ projectId: lane.projectId, siteDomain: "example.com" });
  await repo.recordResearch({
    projectId: lane.projectId,
    icp: { beliefs: [...beliefs] },
    researchedAt: READ_AT,
  });
  return repo;
}

describe("correcting what we read", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("keeps what it replaced, so a correction reads as one", async () => {
    // O-036: corrections are the highest-signal rows in the table. A correction that
    // overwrites its predecessor into silence is indistinguishable from a fresh read.
    const lane = await seedLane(db, "keeps-what-it-replaced");
    const repo = await seedBeliefs(db, lane, [readBelief("Marketing teams at large companies")]);

    expect(
      await repo.correctBelief({
        projectId: lane.projectId,
        kind: "who_it_is_for",
        was: "Marketing teams at large companies",
        statement: "Founders of small software agencies",
        statedAt: STATED_AT,
      }),
    ).toBe(true);

    const [belief] = (await repo.readSiteResearch(lane.projectId))?.icp.beliefs ?? [];

    expect(belief?.statement).toBe("Founders of small software agencies");
    expect(belief?.correctedFrom).toBe("Marketing teams at large companies");
    expect(belief?.provenance).toEqual({
      source: "stated_by_customer",
      at: STATED_AT,
      citation: null,
    });
  });

  it("keeps the original wording through a second correction", async () => {
    // What a person first disagreed with is the signal. Correcting twice must not lose it
    // behind the intermediate answer.
    const lane = await seedLane(db, "second-correction");
    const repo = await seedBeliefs(db, lane, [readBelief("Marketing teams")]);

    await repo.correctBelief({
      projectId: lane.projectId,
      kind: "who_it_is_for",
      was: "Marketing teams",
      statement: "Agencies",
      statedAt: STATED_AT,
    });
    await repo.correctBelief({
      projectId: lane.projectId,
      kind: "who_it_is_for",
      was: "Agencies",
      statement: "Small software agencies",
      statedAt: STATED_AT,
    });

    const [belief] = (await repo.readSiteResearch(lane.projectId))?.icp.beliefs ?? [];

    expect(belief?.statement).toBe("Small software agencies");
    expect(belief?.correctedFrom).toBe("Marketing teams");
  });

  it("removes a belief that is simply untrue", async () => {
    const lane = await seedLane(db, "removes");
    const repo = await seedBeliefs(db, lane, [
      readBelief("Enterprise buyers"),
      readBelief("Agencies"),
    ]);

    expect(
      await repo.correctBelief({
        projectId: lane.projectId,
        kind: "who_it_is_for",
        was: "Enterprise buyers",
        statement: null,
        statedAt: STATED_AT,
      }),
    ).toBe(true);

    const after = (await repo.readSiteResearch(lane.projectId))?.icp.beliefs ?? [];

    expect(after.map((row) => row.statement)).toEqual(["Agencies"]);
  });

  it("leaves every other belief untouched", async () => {
    const lane = await seedLane(db, "leaves-others");
    const repo = await seedBeliefs(db, lane, [readBelief("Agencies"), readBelief("Solo founders")]);

    await repo.correctBelief({
      projectId: lane.projectId,
      kind: "who_it_is_for",
      was: "Agencies",
      statement: "Small agencies",
      statedAt: STATED_AT,
    });

    const after = (await repo.readSiteResearch(lane.projectId))?.icp.beliefs ?? [];
    const untouched = after.find((row) => row.statement === "Solo founders");

    expect(untouched?.provenance.source).toBe("site");
    expect(untouched?.correctedFrom).toBeNull();
  });

  it("answers false when the belief has changed since the page loaded", async () => {
    const lane = await seedLane(db, "moved-under");
    const repo = await seedBeliefs(db, lane, [readBelief("Agencies")]);

    expect(
      await repo.correctBelief({
        projectId: lane.projectId,
        kind: "who_it_is_for",
        was: "Something nobody ever said",
        statement: "Anything",
        statedAt: STATED_AT,
      }),
    ).toBe(false);
  });

  it("answers false for a project with nothing read yet", async () => {
    const lane = await seedLane(db, "nothing-read");

    expect(
      await createGrowthContextRepo(db, lane.org.ctx).correctBelief({
        projectId: lane.projectId,
        kind: "who_it_is_for",
        was: "Agencies",
        statement: "Small agencies",
        statedAt: STATED_AT,
      }),
    ).toBe(false);
  });

  it("refuses to correct another organization's beliefs", async () => {
    const mine = await seedLane(db, "tenant-mine");
    const theirs = await seedLane(db, "tenant-theirs");
    await seedBeliefs(db, theirs, [readBelief("Agencies")]);

    await expect(
      createGrowthContextRepo(db, mine.org.ctx).correctBelief({
        projectId: theirs.projectId,
        kind: "who_it_is_for",
        was: "Agencies",
        statement: "Mine now",
        statedAt: STATED_AT,
      }),
    ).rejects.toThrow(/not this organization's/);
  });

  it("leaves the roled surfaces alone, which live on the same row", async () => {
    const lane = await seedLane(db, "surfaces-survive");
    const repo = createGrowthContextRepo(db, lane.org.ctx);

    await repo.save({
      projectId: lane.projectId,
      surfaces: [
        {
          surface: "/checkout",
          role: "makes_money",
          basis: "stated_by_customer",
          confirmedAt: STATED_AT,
          normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        },
      ],
      confirmedChangeable: [],
    });
    await repo.recordResearch({
      projectId: lane.projectId,
      icp: { beliefs: [readBelief("Agencies")] },
      researchedAt: READ_AT,
    });

    await repo.correctBelief({
      projectId: lane.projectId,
      kind: "who_it_is_for",
      was: "Agencies",
      statement: "Small agencies",
      statedAt: STATED_AT,
    });

    expect((await repo.findForProject(lane.projectId))?.bySurface.get("/checkout")?.role).toBe(
      "makes_money",
    );
  });
});
