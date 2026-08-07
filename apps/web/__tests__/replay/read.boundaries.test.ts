import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestDb, type TestDb } from "@growthmind/db/testing";

import { REPLAY_SCREEN_READ_CAP, readReplayScreen } from "../../lib/replay/read";
import {
  filtersOf,
  outcomeName,
  replayDeps,
  screenOf,
  seedReplayWorkspace,
  seedSessionCohort,
  seedSessions,
} from "./helpers/screen";

describe("readReplayScreen — boundaries and terminal states", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("should put a session with a null entry_url_path in no entry bucket and create no null option", async () => {
    const workspace = await seedReplayWorkspace(db, "null-entry");

    await seedSessions(db, workspace, [
      { key: "ph:null-entry-1", company: "acme.example", entry: null },
      { key: "ph:null-entry-2", company: "acme.example", entry: "/pricing" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(screen.facets.entry).toEqual([{ value: "/pricing", sessionCount: 1, replayCount: 1 }]);
    expect(screen.rows).toHaveLength(2);
  });

  test("should keep a session with a null identity_email_domain in the list while giving it no company", async () => {
    const workspace = await seedReplayWorkspace(db, "null-company");

    await seedSessions(db, workspace, [
      { key: "ph:null-company-1", company: null, entry: "/pricing" },
      { key: "ph:null-company-2", company: "acme.example", entry: "/pricing" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(screen.facets.company).toEqual([
      { value: "acme.example", sessionCount: 1, replayCount: 1 },
    ]);
    expect(screen.rows).toHaveLength(2);
    expect(
      screen.rows.find((row) => row.sessionKey === "ph:null-company-1")?.companyDomain,
    ).toBeNull();
  });

  test("should return the no-replays-yet outcome for an org with zero sessions", async () => {
    const workspace = await seedReplayWorkspace(db, "e1-empty");
    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(outcomeName(screen.outcome)).toBe("no_replays_yet");
    expect(screen.provenance).toEqual({ replays: 0, sessions: 0 });
  });

  // FR-19 is per-descriptor (State 14 / E11): one work domain is not a choice, but the entry
  // paths still are, and suppressing the whole bar would remove a filter that works.
  test("should render no company pill and still render the entry pill for an org with exactly one work domain", async () => {
    const workspace = await seedReplayWorkspace(db, "one-domain");

    await seedSessions(db, workspace, [
      { key: "ph:one-domain-1", company: "acme.example", entry: "/pricing" },
      { key: "ph:one-domain-2", company: "acme.example", entry: "/docs" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(screen.facets.company).toHaveLength(1);
    expect(screen.facets.entry).toHaveLength(2);
  });

  // E7's sentence reads "We have seen <M> sessions from <company>" — the number has to come
  // back with the outcome, or the copy has nothing to say.
  test("should state the session count it does have when a company has sessions and zero replays", async () => {
    const workspace = await seedReplayWorkspace(db, "e7-no-replays");

    await seedSessions(db, workspace, [
      { key: "gm:e7-1", company: "acme.example", entry: "/pricing" },
      { key: "gm:e7-2", company: "acme.example", entry: "/pricing" },
      { key: "gm:e7-3", company: "acme.example", entry: "/docs" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(deps, workspace.ctx, filtersOf({ company: "acme.example" })),
    );

    expect(outcomeName(screen.outcome)).toBe("zero_replays_for_selection");
    expect(screen.provenance).toEqual({ replays: 0, sessions: 3 });
  });

  // E6 is a fact, not a wait. The defect this catches is the simulated lane rendering E1,
  // whose copy says "yet" and invites the founder to come back to a zero that never moves.
  test("should return the permanent-zero outcome for the simulated lane", async () => {
    const workspace = await seedReplayWorkspace(db, "e6-simulated");

    await seedSessions(db, workspace, [
      { key: "sim:e6-1", company: "acme.example", entry: "/pricing", origin: "synthetic" },
      { key: "sim:e6-2", company: "acme.example", entry: "/pricing", origin: "synthetic" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(deps, workspace.ctx, filtersOf({ lane: "simulated" })),
    );

    expect(outcomeName(screen.outcome)).toBe("simulated_permanent_zero");
    expect(outcomeName(screen.outcome)).not.toBe("no_replays_yet");
    expect(screen.provenance).toEqual({ replays: 0, sessions: 2 });
  });

  // P-2's trust surface: "nothing was left out" is a statement about the exclusion rules, and
  // rendering E1 here would say instead that we have no data at all.
  test("should return the nothing-was-left-out outcome for an empty excluded lane", async () => {
    const workspace = await seedReplayWorkspace(db, "e9-excluded");

    await seedSessions(db, workspace, [
      { key: "ph:e9-real-1", company: "acme.example", entry: "/pricing" },
      { key: "ph:e9-real-2", company: "acme.example", entry: "/docs" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(deps, workspace.ctx, filtersOf({ lane: "excluded" })),
    );

    expect(outcomeName(screen.outcome)).toBe("nothing_left_out");
    expect(outcomeName(screen.outcome)).not.toBe("no_replays_yet");
  });

  test("should return the value-matches-nothing outcome for a company value no session carries", async () => {
    const workspace = await seedReplayWorkspace(db, "e5-unknown-value");

    await seedSessions(db, workspace, [
      { key: "ph:e5-1", company: "acme.example", entry: "/pricing" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(deps, workspace.ctx, filtersOf({ company: "not-a-customer.example" })),
    );

    expect(outcomeName(screen.outcome)).toBe("value_matches_nothing");
    expect(screen.rows).toHaveLength(0);
    // R-5: the value is not invented into the option list to make the pill renderable — the
    // pill renders from the URL, and the facet stays a statement about the data.
    expect(screen.facets.company.map((option) => option.value)).toEqual(["acme.example"]);
  });

  test("should report truncated from a single bounded read so the truncation notice can render", async () => {
    const workspace = await seedReplayWorkspace(db, "e12-truncated");

    await seedSessionCohort(db, workspace, REPLAY_SCREEN_READ_CAP + 1, (index) => ({
      key: `ph:e12-${String(index)}`,
      company: "acme.example",
      entry: "/pricing",
    }));

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(screen.truncated).toBe(true);
    expect(screen.rows).toHaveLength(REPLAY_SCREEN_READ_CAP);
  });

  // The null half of HC-1's first constraint. Kept apart from the row below on purpose: one
  // parameterised case over both would prove neither.
  test("should carry an unstamped session's meta through as null, never as zero", async () => {
    const workspace = await seedReplayWorkspace(db, "meta-null");

    await seedSessions(db, workspace, [
      { key: "ph:meta-null-1", company: "acme.example", entry: "/pricing" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));
    const [row] = screen.rows;

    expect(row?.durationSeconds).toBeNull();
    expect(row?.activeSeconds).toBeNull();
    expect(row?.clickCount).toBeNull();
    expect(row?.keypressCount).toBeNull();
    expect(row?.consoleErrorCount).toBeNull();
  });

  // The zero half. A measured zero is a signal — a replay nobody clicked in — and coalescing
  // it to null would say we never looked.
  test("should carry a measured zero through as zero", async () => {
    const workspace = await seedReplayWorkspace(db, "meta-zero");

    await seedSessions(db, workspace, [
      {
        key: "ph:meta-zero-1",
        company: "acme.example",
        entry: "/pricing",
        meta: {
          durationSeconds: 42,
          activeSeconds: 0,
          clickCount: 0,
          keypressCount: 3,
          consoleErrorCount: 0,
        },
      },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));
    const [row] = screen.rows;

    expect(row?.clickCount).toBe(0);
    expect(row?.consoleErrorCount).toBe(0);
    expect(row?.activeSeconds).toBe(0);
    expect(row?.durationSeconds).toBe(42);
    expect(row?.keypressCount).toBe(3);
  });
});
