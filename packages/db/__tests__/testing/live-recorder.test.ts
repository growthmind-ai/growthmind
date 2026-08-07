import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { publishLive } from "../../src/live/publish";
import * as schema from "../../src/schema";
import { createTestDb, laneNames, recordPublishedTopics, type TestDb } from "../../src/testing";

const names = laneNames("live-recorder");

describe("recordPublishedTopics", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("records a payload published directly through it", async () => {
    const recorder = recordPublishedTopics(db);

    await publishLive(recorder.db, { organizationId: "org-a", topic: "recordings" });

    expect(recorder.published).toEqual([{ organizationId: "org-a", topic: "recordings" }]);
  });

  test("records two publishes as two entries", async () => {
    const recorder = recordPublishedTopics(db);

    await publishLive(recorder.db, { organizationId: "org-a", topic: "recordings" });
    await publishLive(recorder.db, { organizationId: "org-b", topic: "findings" });

    expect(recorder.published).toEqual([
      { organizationId: "org-a", topic: "recordings" },
      { organizationId: "org-b", topic: "findings" },
    ]);
  });

  test("records nothing for an ordinary select", async () => {
    const recorder = recordPublishedTopics(db);

    await recorder.db.select().from(schema.organization);

    expect(recorder.published).toEqual([]);
  });

  // The O-051 emit seams publish through the transaction executor the caller hands them,
  // never through the outer handle — a recorder that only wrapped the handle would report
  // every one of those publishes as a correct zero.
  test("records a payload published inside a transaction the wrapped handle opened", async () => {
    const recorder = recordPublishedTopics(db);

    const answer = await recorder.db.transaction(async (tx) => {
      await publishLive(tx, { organizationId: "org-tx", topic: "notifications" });
      return "committed";
    });

    expect(answer).toBe("committed");
    expect(recorder.published).toEqual([{ organizationId: "org-tx", topic: "notifications" }]);
  });

  test("a transaction that rolls back still ran its statements through the recorder", async () => {
    const recorder = recordPublishedTopics(db);

    await expect(
      recorder.db.transaction(async (tx) => {
        await publishLive(tx, { organizationId: "org-rollback", topic: "notifications" });
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow("deliberate rollback");

    // The recorder sees statements, not commits: asserting "published after the tx
    // resolved" is the caller's job, which is why wire tests assert only after awaiting
    // the repository call.
    expect(recorder.published).toEqual([{ organizationId: "org-rollback", topic: "notifications" }]);
  });

  // A trap that returns a member unbound from its target leaves drizzle reading its own
  // internal state off the proxy and observing nothing, so this is where `.bind(target)` fails.
  test("passes ordinary statements through unchanged", async () => {
    const recorder = recordPublishedTopics(db);
    const slug = names.orgName("passthrough");

    await recorder.db.insert(schema.organization).values({
      id: slug,
      name: slug,
      slug,
      createdAt: new Date("2026-08-06T10:00:00.000Z"),
    });

    const throughProxy = await recorder.db.select().from(schema.organization);
    const throughRaw = await db.select().from(schema.organization);

    expect(throughProxy).toHaveLength(1);
    expect(throughProxy).toEqual(throughRaw);
  });
});
