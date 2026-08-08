import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestDb, type TestDb } from "@growthmind/db/testing";

import { readReplayScreen } from "../../lib/replay/read";
import {
  filtersOf,
  replayDeps,
  screenOf,
  seedReplayWorkspace,
  seedSessions,
  seedSummaries,
  seedTeammate,
} from "./helpers/screen";

describe("readReplayScreen — the narration each row carries", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("should carry the headline and the pages for a narrated recording", async () => {
    const workspace = await seedReplayWorkspace(db, "story-happy");

    await seedSessions(db, workspace, [{ key: "ph:story-1", entry: "/pricing" }]);
    await seedSummaries(db, workspace, [
      {
        recordingId: "story-1",
        headline: "They stalled on the plan picker",
        pages: ["/pricing", "/signup"],
      },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);
    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(screen.stories.get("story-1")).toEqual({
      headline: "They stalled on the plan picker",
      held: false,
      pages: ["/pricing", "/signup"],
    });
  });

  // The list joins on the recording id, not the session key. 26 of the 64 summaries in production
  // predate 0021 and hold no session key; a session-key join makes every one of them invisible.
  test("should find a narration written before the session key existed", async () => {
    const workspace = await seedReplayWorkspace(db, "story-keyless");

    await seedSessions(db, workspace, [{ key: "ph:story-keyless-1", entry: "/docs" }]);
    await seedSummaries(db, workspace, [
      {
        recordingId: "story-keyless-1",
        headline: "They read the docs",
        pages: [],
        sessionKey: null,
      },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);
    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(screen.stories.get("story-keyless-1")?.headline).toBe("They read the docs");
  });

  test("should leave an un-narrated row out of the map rather than inventing a blank one", async () => {
    const workspace = await seedReplayWorkspace(db, "story-missing");

    await seedSessions(db, workspace, [{ key: "ph:story-missing-1", entry: "/pricing" }]);

    const { deps } = replayDeps(db, workspace.ctx);
    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(screen.rows).toHaveLength(1);
    expect(screen.stories.has("story-missing-1")).toBe(false);
  });

  // D1: the narration is the organization's, not the person who happened to open the page first.
  test("should carry the same narration for a teammate reading the same list", async () => {
    const workspace = await seedReplayWorkspace(db, "story-teammate");

    await seedSessions(db, workspace, [{ key: "ph:story-mate-1", entry: "/pricing" }]);
    await seedSummaries(db, workspace, [
      { recordingId: "story-mate-1", headline: "They stalled", pages: ["/pricing"] },
    ]);

    const mate = await seedTeammate(db, workspace);
    const { deps } = replayDeps(db, mate);
    const screen = screenOf(await readReplayScreen(deps, mate, filtersOf()));

    expect(screen.stories.get("story-mate-1")?.headline).toBe("They stalled");
  });

  // D7: the recording ids come off this org's own rows, so another org's summary can never be
  // asked for — but the read carries its own org predicate, and this is what proves it.
  test("should not carry another organization's narration for the same recording id", async () => {
    const ours = await seedReplayWorkspace(db, "story-ours");
    const theirs = await seedReplayWorkspace(db, "story-theirs");

    await seedSessions(db, ours, [{ key: "ph:shared-id", entry: "/pricing" }]);
    await seedSummaries(db, theirs, [
      { recordingId: "shared-id", headline: "Another org's session", pages: ["/secret"] },
    ]);

    const { deps } = replayDeps(db, ours.ctx);
    const screen = screenOf(await readReplayScreen(deps, ours.ctx, filtersOf()));

    expect(screen.rows).toHaveLength(1);
    expect(screen.stories.has("shared-id")).toBe(false);
  });
});
