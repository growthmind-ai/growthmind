import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { NOTHING_TODAY_REASON_MESSAGES } from "@growthmind/shared";

import {
  createDeliveryDecisionsRepo,
  type RecordDeliveryDecisionInput,
} from "../../src/repositories/delivery-decisions.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedOrgWithOwner, seedProject } from "../../src/testing";

const CHANNEL = "C0FINDINGS";
const DAY_ONE = new Date("2026-08-02T09:00:00.000Z");
const DAY_TWO = new Date("2026-08-03T09:00:00.000Z");
const DAY_THREE = new Date("2026-08-04T09:00:00.000Z");

const QUIET = NOTHING_TODAY_REASON_MESSAGES.no_findings_ready;
const BUDGET = NOTHING_TODAY_REASON_MESSAGES.budget_spent;

function quiet(projectId: string, decidedAt: Date, reason = QUIET): RecordDeliveryDecisionInput {
  return {
    projectId,
    decision: "nothing_today",
    reason,
    findingId: null,
    channelId: CHANNEL,
    decidedAt,
  };
}

describe("delivery decisions repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("keeps the day a run began when later ticks reach the same answer", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-quiet-run",
      userName: "Owner Quiet Run",
      email: "owner-quiet-run@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-quiet-run",
    });
    const repo = createDeliveryDecisionsRepo(db, org.ctx);

    await repo.record(quiet(project.id, DAY_ONE));
    await repo.record(quiet(project.id, DAY_TWO));
    await repo.record(quiet(project.id, DAY_THREE));

    // "Quiet since 2 August" is the sentence a founder wants, and it only exists if the run's
    // start survives every tick that agreed with it.
    const runs = await repo.listRecentForProject(project.id, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.firstDecidedAt.getTime()).toBe(DAY_ONE.getTime());
    expect(runs[0]?.lastDecidedAt.getTime()).toBe(DAY_THREE.getTime());
    expect(runs[0]?.endedAt).toBeNull();
  });

  it("adds no row when the same tick is retried", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-retried-tick",
      userName: "Owner Retried Tick",
      email: "owner-retried-tick@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-retried-tick",
    });
    const repo = createDeliveryDecisionsRepo(db, org.ctx);

    await repo.record(quiet(project.id, DAY_ONE));
    await repo.record(quiet(project.id, DAY_ONE));
    await repo.record(quiet(project.id, DAY_ONE));

    expect(await repo.listRecentForProject(project.id, 10)).toHaveLength(1);
  });

  it("starts a new run when the answer changes, and closes the one it replaced", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-changed-answer",
      userName: "Owner Changed Answer",
      email: "owner-changed-answer@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-changed-answer",
    });
    const repo = createDeliveryDecisionsRepo(db, org.ctx);

    await repo.record(quiet(project.id, DAY_ONE));
    await repo.record({
      projectId: project.id,
      decision: "posted",
      reason: "We sent this one to your channel.",
      findingId: "finding-1",
      channelId: CHANNEL,
      decidedAt: DAY_TWO,
    });

    const runs = await repo.listRecentForProject(project.id, 10);
    expect(runs.map((row) => row.decision)).toEqual(["posted", "nothing_today"]);
    expect(runs[1]?.endedAt?.getTime()).toBe(DAY_TWO.getTime());
    expect(await repo.currentForProject(project.id)).toMatchObject({ decision: "posted" });
  });

  it("does not merge two quiet spells that were quiet for different reasons", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-two-quiets",
      userName: "Owner Two Quiets",
      email: "owner-two-quiets@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-two-quiets",
    });
    const repo = createDeliveryDecisionsRepo(db, org.ctx);

    await repo.record(quiet(project.id, DAY_ONE, QUIET));
    await repo.record(quiet(project.id, DAY_TWO, BUDGET));

    const runs = await repo.listRecentForProject(project.id, 10);
    expect(runs.map((row) => row.reason)).toEqual([BUDGET, QUIET]);
  });

  it("shows one organization nothing of another organization's decisions", async () => {
    const mine = await seedOrgWithOwner(db, {
      orgName: "acme-scoped-mine",
      userName: "Owner Scoped Mine",
      email: "owner-scoped-mine@acme.example",
    });
    const theirs = await seedOrgWithOwner(db, {
      orgName: "acme-scoped-theirs",
      userName: "Owner Scoped Theirs",
      email: "owner-scoped-theirs@acme.example",
    });

    const theirProject = await seedProject(db, {
      organizationId: theirs.organizationId,
      name: "checkout-scoped-theirs",
    });

    await createDeliveryDecisionsRepo(db, theirs.ctx).record(quiet(theirProject.id, DAY_ONE));

    // Their project id is a value we hold; the filter has to be the thing that refuses it.
    const asMine = createDeliveryDecisionsRepo(db, mine.ctx);
    expect(await asMine.listRecentForProject(theirProject.id, 10)).toEqual([]);
    expect(await asMine.currentForProject(theirProject.id)).toBeNull();
  });

  it("keeps one organization's run open while another organization opens its own", async () => {
    const first = await seedOrgWithOwner(db, {
      orgName: "acme-parallel-first",
      userName: "Owner Parallel First",
      email: "owner-parallel-first@acme.example",
    });
    const second = await seedOrgWithOwner(db, {
      orgName: "acme-parallel-second",
      userName: "Owner Parallel Second",
      email: "owner-parallel-second@acme.example",
    });

    const firstProject = await seedProject(db, {
      organizationId: first.organizationId,
      name: "checkout-parallel-first",
    });
    const secondProject = await seedProject(db, {
      organizationId: second.organizationId,
      name: "checkout-parallel-second",
    });

    await createDeliveryDecisionsRepo(db, first.ctx).record(quiet(firstProject.id, DAY_ONE));
    await createDeliveryDecisionsRepo(db, second.ctx).record(quiet(secondProject.id, DAY_TWO));

    // The open-run index is keyed on the organization as well as the project, so one lane
    // going quiet can never close a different tenant's run.
    expect(
      await createDeliveryDecisionsRepo(db, first.ctx).currentForProject(firstProject.id),
    ).not.toBeNull();
  });
});
