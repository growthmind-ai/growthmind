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
