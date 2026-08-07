import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { findFirstProjectForOrg } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import { setLogSink, type LogRecord } from "@growthmind/shared";

import { readReplayScreen } from "../../lib/replay/read";
import {
  failingSessionRead,
  failingSummaryRead,
  filtersOf,
  replayDeps,
  screenOf,
  seedOrgWithoutProject,
  seedReplayWorkspace,
  seedSessions,
  seedSummaries,
} from "./helpers/screen";

describe("readReplayScreen — failure isolation", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // AC-17 / D8. R1 and R2 are two reads of `sessions` issued together, R1 first; failing the
  // second is failing the lane facet. A missing count is not a wrong count, but a blanked
  // list would be a wrong screen.
  test("should keep the list and the two list facets when the lane facet read fails", async () => {
    const workspace = await seedReplayWorkspace(db, "lane-read-fails");

    await seedSessions(db, workspace, [
      { key: "ph:degrade-1", company: "acme.example", entry: "/pricing" },
      { key: "ph:degrade-2", company: "orbitlabs.example", entry: "/docs" },
    ]);

    const probe = failingSessionRead(db, 2);
    const { deps } = replayDeps(probe.db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(probe.sessionReads()).toBe(2);
    expect(screen.rows).toHaveLength(2);
    expect(screen.facets.company.map((option) => option.sessionCount)).toEqual([1, 1]);
    expect(screen.facets.entry.map((option) => option.sessionCount)).toEqual([1, 1]);

    expect(screen.facets.whoCounts.map((option) => option.value)).toEqual([
      "real",
      "simulated",
      "excluded",
    ]);
    expect(screen.facets.whoCounts.map((option) => option.sessionCount)).toEqual([
      null,
      null,
      null,
    ]);
  });

  // E10's retry re-runs the current query. A retry that drops you back to unfiltered is a
  // second failure, so the filters come back on the failed value.
  test("should return the failed outcome when the primary read fails", async () => {
    const workspace = await seedReplayWorkspace(db, "primary-read-fails");

    await seedSessions(db, workspace, [
      { key: "ph:failed-1", company: "acme.example", entry: "/pricing" },
    ]);

    const filters = filtersOf({ company: "acme.example", entry: "/pricing" });
    const probe = failingSessionRead(db, 1);
    const { deps } = replayDeps(probe.db, workspace.ctx);

    const result = await readReplayScreen(deps, workspace.ctx, filters);

    expect(result.kind).toBe("failed");
    expect(result).toEqual({ kind: "failed", filters });
  });

  // A DrizzleQueryError's message is `Failed query: ${query}\nparams: ${params}`, and the logger
  // serialises an Error's message and stack — so the bound params of a failed read are the
  // customer's own domain and entry paths, one DB blip away from stdout.
  test("should log a failed read without the query's bound params", async () => {
    const workspace = await seedReplayWorkspace(db, "read-failure-log");

    await seedSessions(db, workspace, [
      { key: "ph:log-1", company: "acme.example", entry: "/pricing" },
    ]);

    const probe = failingSessionRead(db, 1, () => {
      const error = new Error(
        'Failed query: select ... from "sessions" where "identity_email_domain" = $1\n' +
          `params: ${workspace.ctx.organizationId},acme.example,/pricing`,
      );
      error.name = "DrizzleQueryError";
      return error;
    });

    const { deps } = replayDeps(probe.db, workspace.ctx);

    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });

    try {
      await readReplayScreen(
        deps,
        workspace.ctx,
        filtersOf({ company: "acme.example", entry: "/pricing" }),
      );
    } finally {
      restore();
    }

    const written = JSON.stringify(logged);

    expect(logged).toHaveLength(1);
    expect(written).not.toContain("acme.example");
    expect(written).not.toContain("/pricing");
    expect(written).not.toContain(workspace.ctx.organizationId);
    expect(written).not.toContain("params:");

    // Still enough to debug with: which of the two reads failed, and how it failed.
    expect(logged[0]?.fields).toEqual({ lane: "real", code: "DrizzleQueryError" });
  });

  // The narration is what a row says happened, and it is decoration on a list that renders
  // without it. Losing it must cost the headlines and nothing else (D8).
  test("should keep the list when the narration read fails", async () => {
    const workspace = await seedReplayWorkspace(db, "summary-read-fails");

    await seedSessions(db, workspace, [
      { key: "ph:story-degrade-1", company: "acme.example", entry: "/pricing" },
    ]);
    await seedSummaries(db, workspace, [
      { recordingId: "story-degrade-1", headline: "They stalled", pages: ["/pricing"] },
    ]);

    const { deps } = replayDeps(failingSummaryRead(db).db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(screen.rows).toHaveLength(1);
    expect(screen.stories.size).toBe(0);
    expect(screen.provenance).toEqual({ replays: 1, sessions: 1 });
  });

  // The bound params of this read are recording ids, and a DrizzleQueryError carries them in its
  // message and stack — the same hazard the session read was closed for.
  test("should log a failed narration read without the query's bound params", async () => {
    const workspace = await seedReplayWorkspace(db, "summary-failure-log");

    await seedSessions(db, workspace, [
      { key: "ph:story-log-1", company: "acme.example", entry: "/pricing" },
    ]);

    const { deps } = replayDeps(failingSummaryRead(db).db, workspace.ctx);

    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });

    try {
      await readReplayScreen(deps, workspace.ctx, filtersOf());
    } finally {
      restore();
    }

    expect(logged).toHaveLength(1);
    expect(logged[0]?.fields).toEqual({ code: "DrizzleQueryError" });
    expect(JSON.stringify(logged)).not.toContain("story-log-1");
  });

  test("should return the not-connected outcome without provisioning a project", async () => {
    const ctx = await seedOrgWithoutProject(db, "no-project");
    const { deps, sourceCalls } = replayDeps(db, ctx);

    const result = await readReplayScreen(deps, ctx, filtersOf());

    expect(result).toEqual({ kind: "not_connected" });
    // Reading must not provision: ensureProject must not appear on this path.
    expect(await findFirstProjectForOrg(db, ctx)).toBeUndefined();
    expect(sourceCalls()).toBe(0);
  });

  test("should return the not-connected outcome when the project has no active analytics connection", async () => {
    const workspace = await seedReplayWorkspace(db, "inactive-connection", {
      activeConnection: false,
    });

    await seedSessions(db, workspace, [
      { key: "ph:inactive-1", company: "acme.example", entry: "/pricing" },
    ]);

    const probe = failingSessionRead(db, 1);
    const { deps, sourceCalls } = replayDeps(probe.db, workspace.ctx);

    const result = await readReplayScreen(deps, workspace.ctx, filtersOf());

    expect(result).toEqual({ kind: "not_connected" });
    // The connection question is one query. No source object is built, and the answer is
    // reached before either session read — so the read that would have failed never ran.
    expect(sourceCalls()).toBe(0);
    expect(probe.sessionReads()).toBe(0);
  });
});
