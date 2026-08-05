import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createRecordingSummariesRepo } from "../../src/repositories/recording-summaries.repo";
import type { PersistRecordingSummaryInput } from "../../src/repositories/recording-summaries.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, scannedTextFor, seedOrgWithOwner, seedProject } from "../../src/testing";

const NAMES = laneNames("recording-summaries");

const STARTED_AT = new Date("2026-08-05T09:00:00.000Z");

const CLEAN = scannedTextFor("Someone pressed the buy button and nothing happened", [
  "They opened pricing, pressed buy four times, and left.",
]);

function inputFor(projectId: string, recordingId: string): PersistRecordingSummaryInput {
  return {
    projectId,
    recordingId,
    summarySource: "model_rendered",
    headline: CLEAN.headline,
    context: CLEAN.context,
    transcript: "0:00  opened /pricing",
    pages: ["/pricing"],
    durationMs: 92_000,
    actionCount: 12,
    notableCount: 1,
    droppedEvents: 0,
    startedAt: STARTED_AT,
    resolvedModelId: "test-model",
    tokensIn: 40,
    tokensOut: 17,
  };
}

describe("recording summaries repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function seedOrg(label: string) {
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

  it("persists a summary and reads it back with its text and pages", async () => {
    const { org, project } = await seedOrg("persist");
    const repo = createRecordingSummariesRepo(db, org.ctx);

    await repo.persist(inputFor(project.id, "rec-1"));
    const found = await repo.findFor(project.id, "rec-1");

    expect(found).not.toBeNull();
    expect(found?.text.held).toBe(false);
    if (found?.text.held === false) {
      expect(found.text.headline).toBe(CLEAN.headline);
    }
    expect(found?.pages).toEqual(["/pricing"]);
    expect(found?.durationMs).toBe(92_000);
  });

  it("persisting the same recording twice yields one row, so a retry cannot double-write", async () => {
    const { org, project } = await seedOrg("idempotent");
    const repo = createRecordingSummariesRepo(db, org.ctx);

    const first = await repo.persist(inputFor(project.id, "rec-dup"));
    const second = await repo.persist({
      ...inputFor(project.id, "rec-dup"),
      transcript: "a different walk of the same recording",
    });

    expect(second.id).toBe(first.id);
    expect(second.transcript).toBe("0:00  opened /pricing");
  });

  it("summarisedIds reports only ids already held, so the poll skips them before the model", async () => {
    const { org, project } = await seedOrg("known");
    const repo = createRecordingSummariesRepo(db, org.ctx);

    await repo.persist(inputFor(project.id, "rec-known"));
    const known = await repo.summarisedIds(project.id, ["rec-known", "rec-new"]);

    expect(known.has("rec-known")).toBe(true);
    expect(known.has("rec-new")).toBe(false);
  });

  it("summarisedIds on an empty list asks the database nothing and returns empty", async () => {
    const { org, project } = await seedOrg("empty-ids");
    const repo = createRecordingSummariesRepo(db, org.ctx);

    expect((await repo.summarisedIds(project.id, [])).size).toBe(0);
  });

  it("latestStartedAt returns the newest watermark, and null before anything is held", async () => {
    const { org, project } = await seedOrg("watermark");
    const repo = createRecordingSummariesRepo(db, org.ctx);

    expect(await repo.latestStartedAt(project.id)).toBeNull();

    const later = new Date("2026-08-05T11:00:00.000Z");
    await repo.persist(inputFor(project.id, "rec-early"));
    await repo.persist({ ...inputFor(project.id, "rec-late"), startedAt: later });

    expect((await repo.latestStartedAt(project.id))?.toISOString()).toBe(later.toISOString());
  });

  it("a recording summarised in one org is invisible to another", async () => {
    const mine = await seedOrg("tenant-mine");
    const theirs = await seedOrg("tenant-theirs");

    await createRecordingSummariesRepo(db, mine.org.ctx).persist(
      inputFor(mine.project.id, "rec-shared-id"),
    );

    const otherRepo = createRecordingSummariesRepo(db, theirs.org.ctx);

    expect(await otherRepo.findFor(mine.project.id, "rec-shared-id")).toBeNull();
    expect((await otherRepo.summarisedIds(mine.project.id, ["rec-shared-id"])).size).toBe(0);
    expect(await otherRepo.latestStartedAt(mine.project.id)).toBeNull();
  });

  it("refuses to persist against a project another organization owns", async () => {
    const mine = await seedOrg("cross-write-mine");
    const theirs = await seedOrg("cross-write-theirs");

    const repo = createRecordingSummariesRepo(db, theirs.org.ctx);

    await expect(repo.persist(inputFor(mine.project.id, "rec-cross"))).rejects.toThrow(
      /not this organization's/,
    );
  });

  it("holds text that carries residual identifiers rather than rendering it", async () => {
    const { org, project } = await seedOrg("held-text");
    const repo = createRecordingSummariesRepo(db, org.ctx);

    await repo.persist({
      ...inputFor(project.id, "rec-pii"),
      headline: "Someone at ada@acme.com pressed buy" as PersistRecordingSummaryInput["headline"],
    });

    const found = await repo.findFor(project.id, "rec-pii");

    expect(found?.text.held).toBe(true);
  });
});
