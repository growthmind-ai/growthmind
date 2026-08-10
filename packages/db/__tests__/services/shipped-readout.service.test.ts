// F-F2: the branch was computed twice, from two corpus reads at two moments, so a session
// ingested between the transition and the dispatch could move the founder's message off the
// branch the row stores — the column the verdict is recorded against and the one a re-report
// reads to decide whether the change may be watched again.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { fill } from "@growthmind/core";
import {
  SHIPPED_PAGE_REACH_TEMPLATE,
  SHIPPED_SPELLING_CHANGED_TEMPLATE,
  SHIPPED_TOO_FEW_TEMPLATE,
  type ShippedReadoutOutcome,
} from "@growthmind/shared";

import { createShippedChangesRepo } from "../../src/repositories/shipped-changes.repo";
import { shippedChanges } from "../../src/schema/shipped-changes";
import { renderChangeReadout } from "../../src/services/shipped-readout.service";
import {
  createTestDb,
  laneNames,
  seedConnection,
  seedEvents,
  seedOrgWithOwner,
  seedProject,
  seedSession,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("shipped-readout-branch");

const PAGE = "/reports";

const CHANGE = "CSV export";

const REPORTED_AT = new Date("2026-08-09T09:00:00.000Z");
const IN_WINDOW_AT = new Date("2026-08-14T12:00:00.000Z");
const READOUT_DUE_AT = new Date("2026-08-23T09:00:00.000Z");

// Far below the page floor of 30, so a fresh classification of this corpus can only say
// "too few" — which is what makes the `measured` row below a real disagreement rather than a
// coincidence the two paths happen to share.
const SESSIONS_AT_PAGE = 3;

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

interface Fixture {
  readonly org: SeededOrgWithOwner;
  readonly changeId: string;
}

async function seedChangeAtPage(label: string): Promise<Fixture> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });
  const connection = await seedConnection(db, {
    organizationId: org.organizationId,
    projectId: project.id,
  });

  for (let index = 0; index < SESSIONS_AT_PAGE; index += 1) {
    const token = `${label}-${String(index)}`;

    const session = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: `shipped-readout-${token}`,
      entryUrlPath: PAGE,
      startedAt: IN_WINDOW_AT,
    });

    await seedEvents(db, [
      {
        organizationId: org.organizationId,
        projectId: project.id,
        connectionId: connection.id,
        sessionId: session.id,
        sourceEventId: `shipped-readout-event-${token}`,
        occurredAt: IN_WINDOW_AT,
        urlPath: PAGE,
      },
    ]);
  }

  const { change } = await createShippedChangesRepo(db, org.ctx).reportShipped({
    projectId: project.id,
    page: PAGE,
    description: CHANGE,
    reportedAt: REPORTED_AT,
    readoutDueAt: READOUT_DUE_AT,
  });

  return { org, changeId: change.id };
}

async function storeBranch(changeId: string, outcome: ShippedReadoutOutcome | null): Promise<void> {
  await db
    .update(shippedChanges)
    .set({ state: "read_out", readOutAt: READOUT_DUE_AT, readoutOutcome: outcome })
    .where(eq(shippedChanges.id, changeId));
}

const tooFewSentence = fill(SHIPPED_TOO_FEW_TEMPLATE, {
  change: CHANGE,
  page: PAGE,
  denominator: String(SESSIONS_AT_PAGE),
});

const reachSentence = fill(SHIPPED_PAGE_REACH_TEMPLATE, {
  change: CHANGE,
  page: PAGE,
  denominator: String(SESSIONS_AT_PAGE),
});

const spellingSentence = fill(SHIPPED_SPELLING_CHANGED_TEMPLATE, { change: CHANGE, page: PAGE });

describe("the readout speaks the branch the row stores, never a second opinion of the corpus", () => {
  test("a row stored as measured states its counts, even where a fresh reading would refuse", async () => {
    const fixture = await seedChangeAtPage("stored-measured");
    await storeBranch(fixture.changeId, "measured");

    const rendered = await renderChangeReadout(db, fixture.org.ctx, fixture.changeId);

    expect(rendered?.body).toContain(reachSentence);
    expect(rendered?.body).not.toContain(tooFewSentence);
  });

  test("a row stored as too few refuses to claim, on the very same corpus", async () => {
    // The pair is the whole test: one corpus, two stored branches, two different messages. If
    // the dispatch classified for itself, both rows would speak the same sentence.
    const fixture = await seedChangeAtPage("stored-too-few");
    await storeBranch(fixture.changeId, "too_few");

    const rendered = await renderChangeReadout(db, fixture.org.ctx, fixture.changeId);

    expect(rendered?.body).toContain(tooFewSentence);
    expect(rendered?.body).not.toContain(reachSentence);
  });

  test("a row stored as a changed spelling says so, even where the page reads perfectly well", async () => {
    const fixture = await seedChangeAtPage("stored-spelling");
    await storeBranch(fixture.changeId, "stale_page_spelling");

    const rendered = await renderChangeReadout(db, fixture.org.ctx, fixture.changeId);

    expect(rendered?.body).toContain(spellingSentence);
    expect(rendered?.body).not.toContain(tooFewSentence);
  });

  test("a row with no branch stored has nothing to say, rather than one worked out here", async () => {
    const fixture = await seedChangeAtPage("stored-nothing");
    await storeBranch(fixture.changeId, null);

    expect(await renderChangeReadout(db, fixture.org.ctx, fixture.changeId)).toBeNull();
  });
});
