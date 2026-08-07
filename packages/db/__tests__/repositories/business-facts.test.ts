import {
  FACTS_PER_KIND_MAX,
  URL_PATH_NORMALISATION_VERSION,
  type BusinessFact,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createGrowthContextRepo } from "../../src/repositories/growth-context.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, seedOrgWithOwner, seedProject } from "../../src/testing";

const NAMES = laneNames("business-facts");

const READ_AT = new Date("2026-08-04T21:00:00.000Z");
const STATED_AT = new Date("2026-08-05T09:00:00.000Z");

function readFact(statement: string, kind: BusinessFact["kind"] = "regime"): BusinessFact {
  return {
    kind,
    statement,
    provenance: {
      source: "site",
      at: READ_AT,
      citation: "https://example.com/",
      seen: null,
      statedBy: null,
    },
    correctedFrom: null,
    audience: null,
    confirmation: null,
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

async function seedFacts(
  db: TestDb,
  lane: Awaited<ReturnType<typeof seedLane>>,
  facts: readonly BusinessFact[],
) {
  const repo = createGrowthContextRepo(db, lane.org.ctx);
  await repo.stateSiteDomain({ projectId: lane.projectId, siteDomain: "example.com" });
  await repo.recordResearch({ projectId: lane.projectId, facts, researchedAt: READ_AT });
  return repo;
}

async function factsOn(
  repo: ReturnType<typeof createGrowthContextRepo>,
  projectId: string,
): Promise<readonly BusinessFact[]> {
  return (await repo.readBusinessResearch(projectId))?.businessContext.facts ?? [];
}

describe("stating a business fact", () => {
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
    const repo = await seedFacts(db, lane, [readFact("Held to nothing in particular")]);

    expect(
      await repo.stateFact({
        projectId: lane.projectId,
        kind: "regime",
        was: "Held to nothing in particular",
        statement: "Licensed by the UK Gambling Commission",
        statedAt: STATED_AT,
        statedBy: null,
      }),
    ).toBe("stated");

    const [fact] = await factsOn(repo, lane.projectId);

    expect(fact?.statement).toBe("Licensed by the UK Gambling Commission");
    expect(fact?.correctedFrom).toBe("Held to nothing in particular");
    expect(fact?.provenance).toEqual({
      source: "stated_by_customer",
      at: STATED_AT,
      citation: null,
      seen: null,
      statedBy: null,
    });
  });

  it("keeps the original wording through a second correction", async () => {
    const lane = await seedLane(db, "second-correction");
    const repo = await seedFacts(db, lane, [readFact("Marketing teams", "who_counts")]);

    await repo.stateFact({
      projectId: lane.projectId,
      kind: "who_counts",
      was: "Marketing teams",
      statement: "Agencies",
      statedAt: STATED_AT,
      statedBy: null,
    });
    await repo.stateFact({
      projectId: lane.projectId,
      kind: "who_counts",
      was: "Agencies",
      statement: "Small software agencies",
      statedAt: STATED_AT,
      statedBy: null,
    });

    const [fact] = await factsOn(repo, lane.projectId);

    expect(fact?.statement).toBe("Small software agencies");
    expect(fact?.correctedFrom).toBe("Marketing teams");
  });

  // Five of the twelve kinds have no reader that could ever propose them, so adding is the
  // only way they are ever filled (D11).
  it("adds a fact nothing read, on a kind no crawl could ever propose", async () => {
    const lane = await seedLane(db, "adds");
    const repo = await seedFacts(db, lane, []);

    expect(
      await repo.stateFact({
        projectId: lane.projectId,
        kind: "conversion",
        was: null,
        statement: "An order that arrives without a substitution complaint",
        statedAt: STATED_AT,
        statedBy: null,
      }),
    ).toBe("stated");

    const [fact] = await factsOn(repo, lane.projectId);

    expect(fact?.kind).toBe("conversion");
    expect(fact?.correctedFrom).toBeNull();
    expect(fact?.provenance.source).toBe("stated_by_customer");
  });

  it("refuses an addition once that kind is full, rather than dropping one silently", async () => {
    const lane = await seedLane(db, "full");
    const repo = await seedFacts(
      db,
      lane,
      Array.from({ length: FACTS_PER_KIND_MAX }, (_, index) =>
        readFact(`Never do the ${String(index)} thing`, "forbidden_move"),
      ),
    );

    expect(
      await repo.stateFact({
        projectId: lane.projectId,
        kind: "forbidden_move",
        was: null,
        statement: "One more",
        statedAt: STATED_AT,
        statedBy: null,
      }),
    ).toBe("full");

    expect(await factsOn(repo, lane.projectId)).toHaveLength(FACTS_PER_KIND_MAX);
  });

  it("removes a fact that is simply untrue", async () => {
    const lane = await seedLane(db, "removes");
    const repo = await seedFacts(db, lane, [readFact("Enterprise buyers"), readFact("Agencies")]);

    expect(
      await repo.stateFact({
        projectId: lane.projectId,
        kind: "regime",
        was: "Enterprise buyers",
        statement: null,
        statedAt: STATED_AT,
        statedBy: null,
      }),
    ).toBe("stated");

    expect((await factsOn(repo, lane.projectId)).map((row) => row.statement)).toEqual(["Agencies"]);
  });

  it("leaves every other fact untouched", async () => {
    const lane = await seedLane(db, "leaves-others");
    const repo = await seedFacts(db, lane, [readFact("Agencies"), readFact("Solo founders")]);

    await repo.stateFact({
      projectId: lane.projectId,
      kind: "regime",
      was: "Agencies",
      statement: "Small agencies",
      statedAt: STATED_AT,
      statedBy: null,
    });

    const untouched = (await factsOn(repo, lane.projectId)).find(
      (row) => row.statement === "Solo founders",
    );

    expect(untouched?.provenance.source).toBe("site");
    expect(untouched?.correctedFrom).toBeNull();
  });

  it("answers not_found when the fact has changed since the page loaded", async () => {
    const lane = await seedLane(db, "moved-under");
    const repo = await seedFacts(db, lane, [readFact("Agencies")]);

    expect(
      await repo.stateFact({
        projectId: lane.projectId,
        kind: "regime",
        was: "Something nobody ever said",
        statement: "Anything",
        statedAt: STATED_AT,
        statedBy: null,
      }),
    ).toBe("not_found");
  });

  it("answers not_found for a project with nothing read yet", async () => {
    const lane = await seedLane(db, "nothing-read");

    expect(
      await createGrowthContextRepo(db, lane.org.ctx).stateFact({
        projectId: lane.projectId,
        kind: "regime",
        was: "Agencies",
        statement: "Small agencies",
        statedAt: STATED_AT,
        statedBy: null,
      }),
    ).toBe("not_found");
  });

  it("refuses to state a fact on another organization's business", async () => {
    const mine = await seedLane(db, "tenant-mine");
    const theirs = await seedLane(db, "tenant-theirs");
    await seedFacts(db, theirs, [readFact("Agencies")]);

    await expect(
      createGrowthContextRepo(db, mine.org.ctx).stateFact({
        projectId: theirs.projectId,
        kind: "regime",
        was: "Agencies",
        statement: "Mine now",
        statedAt: STATED_AT,
        statedBy: null,
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
      facts: [readFact("Agencies")],
      researchedAt: READ_AT,
    });

    await repo.stateFact({
      projectId: lane.projectId,
      kind: "regime",
      was: "Agencies",
      statement: "Small agencies",
      statedAt: STATED_AT,
      statedBy: null,
    });

    expect((await repo.findForProject(lane.projectId))?.bySurface.get("/checkout")?.role).toBe(
      "makes_money",
    );
  });
});

describe("reading the site again", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // A whole-column overwrite would erase every correction on every re-read, which is the one
  // row in this table that cost a person their time.
  it("keeps what a person stated and replaces only what the last read said", async () => {
    const lane = await seedLane(db, "keeps-corrections");
    const repo = await seedFacts(db, lane, [readFact("Held to nothing in particular")]);

    await repo.stateFact({
      projectId: lane.projectId,
      kind: "conversion",
      was: null,
      statement: "An order that arrives without a complaint",
      statedAt: STATED_AT,
      statedBy: null,
    });

    await repo.recordResearch({
      projectId: lane.projectId,
      facts: [readFact("Licensed by somebody")],
      researchedAt: READ_AT,
    });

    const after = await factsOn(repo, lane.projectId);

    expect(after.map((row) => row.statement).toSorted()).toEqual([
      "An order that arrives without a complaint",
      "Licensed by somebody",
    ]);
  });

  it("does not hand back a sentence a person has already corrected", async () => {
    const lane = await seedLane(db, "suppresses-corrected");
    const repo = await seedFacts(db, lane, [readFact("Marketing teams", "who_counts")]);

    await repo.stateFact({
      projectId: lane.projectId,
      kind: "who_counts",
      was: "Marketing teams",
      statement: "Small agencies",
      statedAt: STATED_AT,
      statedBy: null,
    });

    await repo.recordResearch({
      projectId: lane.projectId,
      facts: [readFact("Marketing teams", "who_counts")],
      researchedAt: READ_AT,
    });

    expect((await factsOn(repo, lane.projectId)).map((row) => row.statement)).toEqual([
      "Small agencies",
    ]);
  });

  // Two people answering different kinds at the same moment each wrote the other's stale
  // value back, and one answer vanished with nothing said (D6).
  it("does not lose a fact stated on one kind while another was being answered", async () => {
    const lane = await seedLane(db, "concurrent-writers");
    const repo = await seedFacts(db, lane, []);

    await Promise.all([
      repo.stateFact({
        projectId: lane.projectId,
        kind: "conversion",
        was: null,
        statement: "An order that arrives",
        statedAt: STATED_AT,
        statedBy: null,
      }),
      repo.stateFact({
        projectId: lane.projectId,
        kind: "invalidating_period",
        was: null,
        statement: "The fortnight before Christmas",
        statedAt: STATED_AT,
        statedBy: null,
      }),
    ]);

    expect((await factsOn(repo, lane.projectId)).map((row) => row.kind).toSorted()).toEqual([
      "conversion",
      "invalidating_period",
    ]);
  });

  it("settles the status even when the read is overtaken, so nothing sits on running", async () => {
    const lane = await seedLane(db, "contended-read");
    const repo = await seedFacts(db, lane, []);

    await repo.markResearchRunning(lane.projectId);

    await Promise.all([
      repo.recordResearch({
        projectId: lane.projectId,
        facts: [readFact("Read off the site")],
        researchedAt: READ_AT,
      }),
      repo.stateFact({
        projectId: lane.projectId,
        kind: "conversion",
        was: null,
        statement: "An order that arrives",
        statedAt: STATED_AT,
        statedBy: null,
      }),
    ]);

    const row = await repo.readBusinessResearch(lane.projectId);

    expect(row?.researchStatus).toBe("done");
    // Whatever a person typed survives either ordering; what the model found is one button
    // press from being re-derived.
    expect(row?.businessContext.facts.map((fact) => fact.kind)).toContain("conversion");
  });

  it("drops the old domain's pages but keeps what a person said when the site changes", async () => {
    const lane = await seedLane(db, "domain-change");
    const repo = await seedFacts(db, lane, [readFact("Read off the old site")]);

    await repo.stateFact({
      projectId: lane.projectId,
      kind: "invalidating_period",
      was: null,
      statement: "The fortnight before Christmas",
      statedAt: STATED_AT,
      statedBy: null,
    });

    await repo.stateSiteDomain({ projectId: lane.projectId, siteDomain: "elsewhere.example" });

    expect((await factsOn(repo, lane.projectId)).map((row) => row.statement)).toEqual([
      "The fortnight before Christmas",
    ]);
  });
});
