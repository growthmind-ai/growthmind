import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  DELIVERY_LANE_DECISION_MESSAGES,
  NOTHING_TODAY_REASON_MESSAGES,
} from "@growthmind/shared";

import {
  createDeliveryDecisionsRepo,
  extendOrOpenRun,
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
    reasonCode: reason === BUDGET ? "quiet_budget_spent" : "quiet_no_findings_ready",
    reason,
    findingId: null,
    channelId: CHANNEL,
    decidedAt,
  };
}

function posted(
  projectId: string,
  decidedAt: Date,
  findingId: string,
): RecordDeliveryDecisionInput {
  return {
    projectId,
    decision: "posted",
    reasonCode: "lane_posted",
    reason: DELIVERY_LANE_DECISION_MESSAGES.posted,
    findingId,
    channelId: CHANNEL,
    decidedAt,
  };
}

describe("delivery decisions repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  async function lane(name: string) {
    const org = await seedOrgWithOwner(db, {
      orgName: `acme-${name}`,
      userName: `Owner ${name}`,
      email: `owner-${name}@acme.example`,
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: `checkout-${name}`,
    });

    return { org, project, repo: createDeliveryDecisionsRepo(db, org.ctx) };
  }

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("keeps the day a run began when later ticks reach the same answer", async () => {
    const { project, repo } = await lane("quiet-run");

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
    const { project, repo } = await lane("retried-tick");

    await repo.record(quiet(project.id, DAY_ONE));
    await repo.record(quiet(project.id, DAY_ONE));
    await repo.record(quiet(project.id, DAY_ONE));

    expect(await repo.listRecentForProject(project.id, 10)).toHaveLength(1);
  });

  // The real Graphile retry, which the same-instant case above does not cover: `tickAt` is
  // `deps.now()` per invocation, so the replay of a failed tick carries a later instant.
  it("adds no row when a retried tick carries a later instant than the one it replays", async () => {
    const { project, repo } = await lane("retried-later");

    const later = new Date(DAY_ONE.getTime() + 47_000);

    await repo.record(quiet(project.id, DAY_ONE));
    await repo.record(quiet(project.id, later));

    const runs = await repo.listRecentForProject(project.id, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.firstDecidedAt.getTime()).toBe(DAY_ONE.getTime());
    expect(runs[0]?.lastDecidedAt.getTime()).toBe(later.getTime());
    expect(runs[0]?.endedAt).toBeNull();
  });

  it("starts a new run when the answer changes, and closes the one it replaced", async () => {
    const { project, repo } = await lane("changed-answer");

    await repo.record(quiet(project.id, DAY_ONE));
    await repo.record(posted(project.id, DAY_TWO, "finding-1"));

    const runs = await repo.listRecentForProject(project.id, 10);
    expect(runs.map((row) => row.decision)).toEqual(["posted", "nothing_today"]);
    expect(runs[1]?.endedAt?.getTime()).toBe(DAY_TWO.getTime());
    expect(await repo.currentForProject(project.id)).toMatchObject({ decision: "posted" });
  });

  it("does not merge two quiet spells that were quiet for different reasons", async () => {
    const { project, repo } = await lane("two-quiets");

    await repo.record(quiet(project.id, DAY_ONE, QUIET));
    await repo.record(quiet(project.id, DAY_TWO, BUDGET));

    const runs = await repo.listRecentForProject(project.id, 10);
    expect(runs.map((row) => row.reason)).toEqual([BUDGET, QUIET]);
  });

  // D12. The sentence is display copy in `@growthmind/shared` — a copy pass reaches it with
  // no migration, no schema change and no failing test. If it decided run identity, every
  // open run in the fleet would close on the next tick and every lane's "quiet since" would
  // read today. So: reword the value actually passed in, and assert nothing moved.
  it("continues one run when the sentence is reworded and the reason code is not", async () => {
    const { project, repo } = await lane("reworded-copy");

    await repo.record(quiet(project.id, DAY_ONE));

    const REWORDED = "We had nothing solid enough to send you, so we stayed quiet.";
    expect(REWORDED).not.toBe(QUIET);

    await repo.record({ ...quiet(project.id, DAY_TWO), reason: REWORDED });

    const runs = await repo.listRecentForProject(project.id, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.firstDecidedAt.getTime()).toBe(DAY_ONE.getTime());
    expect(runs[0]?.lastDecidedAt.getTime()).toBe(DAY_TWO.getTime());
    expect(runs[0]?.endedAt).toBeNull();

    // The sentence the run opened with, kept as the record of what was said at the time.
    expect(runs[0]?.reason).toBe(QUIET);
  });

  // D6. Staged rather than raced, because the interleave is exactly "the close-update ran
  // before the winner committed, so it closed nothing" — what is left of the losing tick is
  // its insert, arriving alone against a row it did not label.
  it("cannot write one tick's finding onto another tick's answer", async () => {
    const { org, project, repo } = await lane("racing-ticks");

    await repo.record(posted(project.id, DAY_ONE, "finding-winner"));

    const loser = await extendOrOpenRun(db, org.ctx, {
      ...quiet(project.id, DAY_ONE),
      findingId: "finding-loser",
      channelId: "C0LOSER",
    });

    expect(loser.claimed).toBe(false);

    const runs = await repo.listRecentForProject(project.id, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      decision: "posted",
      reasonCode: "lane_posted",
      reason: DELIVERY_LANE_DECISION_MESSAGES.posted,
      findingId: "finding-winner",
      channelId: CHANNEL,
    });
  });

  it("tells the caller its decision lost the race rather than reporting it as written", async () => {
    const { org, project, repo } = await lane("racing-report");

    await repo.record(posted(project.id, DAY_ONE, "finding-winner"));

    const loser = await extendOrOpenRun(db, org.ctx, {
      ...quiet(project.id, DAY_ONE),
      findingId: "finding-loser",
    });

    expect(loser.claimed).toBe(false);
    expect(loser.row).toMatchObject({ decision: "posted", findingId: "finding-winner" });
  });

  // /channel reads `last_decided_at` as the lane's heartbeat and raises a staleness alarm off
  // it, so a slow tick committing after a faster later one must not rewind it.
  it("never rewinds the heartbeat when a slow tick lands after a later one", async () => {
    const { project, repo } = await lane("slow-tick");

    await repo.record(posted(project.id, DAY_TWO, "finding-late"));
    await repo.record(posted(project.id, DAY_ONE, "finding-early"));

    const runs = await repo.listRecentForProject(project.id, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.lastDecidedAt.getTime()).toBe(DAY_TWO.getTime());
    expect(runs[0]?.findingId).toBe("finding-late");
  });

  it("shows one organization nothing of another organization's decisions", async () => {
    const mine = await seedOrgWithOwner(db, {
      orgName: "acme-scoped-mine",
      userName: "Owner Scoped Mine",
      email: "owner-scoped-mine@acme.example",
    });
    const theirs = await lane("scoped-theirs");

    await theirs.repo.record(quiet(theirs.project.id, DAY_ONE));

    // Their project id is a value we hold; the filter has to be the thing that refuses it.
    const asMine = createDeliveryDecisionsRepo(db, mine.ctx);
    expect(await asMine.listRecentForProject(theirs.project.id, 10)).toEqual([]);
    expect(await asMine.currentForProject(theirs.project.id)).toBeNull();
  });

  it("keeps one organization's run open while another organization opens its own", async () => {
    const first = await lane("parallel-first");
    const second = await lane("parallel-second");

    await first.repo.record(quiet(first.project.id, DAY_ONE));
    await second.repo.record(quiet(second.project.id, DAY_TWO));

    // The open-run index is keyed on the organization as well as the project, so one lane
    // going quiet can never close a different tenant's run.
    expect(await first.repo.currentForProject(first.project.id)).not.toBeNull();
  });
});
