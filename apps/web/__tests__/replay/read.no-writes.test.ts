import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestDb, type TestDb } from "@growthmind/db/testing";

import { readReplayScreen } from "../../lib/replay/read";
import {
  filtersOf,
  noWriteDb,
  replayDeps,
  screenOf,
  seedReplayWorkspace,
  seedSessions,
} from "./helpers/screen";

describe("readReplayScreen — the read path writes nothing", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // D6 is not applicable to this surface because it adds no write path — asserted rather
  // than assumed. `ensureProject` on the not-connected branch is the write this catches.
  test("should complete against a database proxy that throws on insert, update and delete", async () => {
    const workspace = await seedReplayWorkspace(db, "no-writes");

    await seedSessions(db, workspace, [
      { key: "ph:no-writes-1", company: "acme.example", entry: "/pricing" },
      { key: "ph:no-writes-2", company: "acme.example", entry: "/docs" },
    ]);

    const { deps } = replayDeps(noWriteDb(db), workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(deps, workspace.ctx, filtersOf({ company: "acme.example" })),
    );

    expect(screen.rows).toHaveLength(2);
  });
});
