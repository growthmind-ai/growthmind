import type { AnalysisWindow } from "@growthmind/core";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createDetectorCorpusService } from "../../src/services/detector-corpus.service";
import { systemContextFor, SYSTEM_ACTOR } from "../../src/system";
import { createTestDb, type TestDb } from "../../src/testing";
import {
  laneNames,
  scannedTextFor,
  seedConnection,
  seedEvent,
  seedOrgWithOwner,
  seedProject,
  seedSession,
} from "../../src/testing";
import {
  SESSION_GROUPING_VERSION,
  recordingSessionKey,
  transcriptOf,
  transcriptRepo,
} from "../helpers/transcript-contract";

const NAMES = laneNames("corpus-citations");

const WINDOW: AnalysisWindow = {
  start: new Date("2026-07-29T00:00:00.000Z"),
  end: new Date("2026-08-05T00:00:00.000Z"),
};

const SESSION_STARTED_AT = new Date("2026-08-01T10:00:00.000Z");

const RAGE_CLICK_AT_MS = 64_000;

const RECORDING_IDS = [
  "0198c4f2-7a1b-7c3d-9e4f-000000000001",
  "0198c4f2-7a1b-7c3d-9e4f-000000000002",
] as const;

const SET_ASIDE_RECORDING_ID = "0198c4f2-7a1b-7c3d-9e4f-000000000003";

const CLEAN = scannedTextFor("Someone pressed buy four times and left", [
  "They opened pricing, pressed buy, and went no further.",
]);

describe("a corpus session set resolves to recordings and per-action offsets (D11)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function seedProjectWithRecordings(label: string) {
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

    const narrationCtx = systemContextFor(SYSTEM_ACTOR.REPLAY_NARRATION_TICK, {
      organizationId: org.organizationId,
      organizationName: org.organizationName,
    });
    const summaries = transcriptRepo(db, narrationCtx);

    const seededByRecording = new Map<string, string>();

    for (const recordingId of [...RECORDING_IDS, SET_ASIDE_RECORDING_ID]) {
      const sessionKey = recordingSessionKey("posthog", recordingId);
      if (sessionKey === null) {
        throw new Error(`recordingSessionKey returned no key for ${recordingId}`);
      }

      const session = await seedSession(db, {
        organizationId: org.organizationId,
        projectId: project.id,
        connectionId: connection.id,
        sessionKey,
        startedAt: SESSION_STARTED_AT,
        entryUrlPath: "/pricing",
        exclusionReason: recordingId === SET_ASIDE_RECORDING_ID ? "automation_headless" : "none",
      });
      await seedEvent(db, {
        organizationId: org.organizationId,
        projectId: project.id,
        connectionId: connection.id,
        sessionId: session.id,
        sourceEventId: `${recordingId}-pageview`,
        occurredAt: SESSION_STARTED_AT,
        urlPath: "/pricing",
      });

      await summaries.persist({
        projectId: project.id,
        recordingId,
        summarySource: "model_rendered",
        headline: CLEAN.headline,
        context: CLEAN.context,
        transcript: "0:00  opened /pricing",
        pages: ["/pricing"],
        durationMs: 92_000,
        actionCount: 2,
        notableCount: 1,
        droppedEvents: 0,
        startedAt: SESSION_STARTED_AT,
        resolvedModelId: "test-model",
        provider: "posthog",
        sessionKey,
        sessionGroupingVersion: SESSION_GROUPING_VERSION,
        actions: transcriptOf([
          { kind: "page", atMs: 0, href: "/pricing" },
          {
            kind: "rage_click",
            atMs: RAGE_CLICK_AT_MS,
            element: { nodeId: 21, tag: "BUTTON", classes: ["gm-buy"] },
            clicks: 4,
            spanMs: 900,
          },
        ]),
        actionsVersion: 1,
        actionsOmitted: 0,
        pullStop: "exhausted",
        pullReason: null,
        pullWatermarkAt: null,
      });

      seededByRecording.set(session.id, recordingId);
    }

    const analysisCtx = systemContextFor(SYSTEM_ACTOR.ANALYSIS_TICK, {
      organizationId: org.organizationId,
      organizationName: org.organizationName,
    });

    return { projectId: project.id, analysisCtx, seededByRecording };
  }

  it("should return a corpus already carrying its sessions' recordings and per-action offsets", async () => {
    const { projectId, analysisCtx, seededByRecording } = await seedProjectWithRecordings("chain");

    // The call worker/src/analysis-lane-source.ts makes on every analysis tick. Nothing below
    // constructs an id: the citations arrive on the corpus the read produced.
    const corpus = await createDetectorCorpusService(db, analysisCtx).read(projectId, WINDOW);

    const keptSessionIds = corpus.sessions
      .filter((session) => session.exclusionReason === "none")
      .map((session) => session.sessionId);

    expect(keptSessionIds).toHaveLength(RECORDING_IDS.length);
    expect(corpus.basis.kept).toBe(RECORDING_IDS.length);

    expect(new Set(corpus.citations.map((citation) => citation.sessionId))).toEqual(
      new Set(keptSessionIds),
    );

    for (const citation of corpus.citations) {
      expect(citation.recordingId).toBe(seededByRecording.get(citation.sessionId) ?? "unseeded");
      expect(citation.provider).toBe("posthog");
      expect(citation.transcriptVersion).toBe(1);
      expect(citation.actions).not.toBeNull();
      expect(citation.actions?.map((action) => action.atMs)).toEqual([0, RAGE_CLICK_AT_MS]);
    }
  });

  it("should also carry replays derived from the same citations' actions (D11)", async () => {
    const { projectId, analysisCtx, seededByRecording } = await seedProjectWithRecordings("replay");

    const corpus = await createDetectorCorpusService(db, analysisCtx).read(projectId, WINDOW);

    const keptSessionIds = corpus.sessions
      .filter((session) => session.exclusionReason === "none")
      .map((session) => session.sessionId);

    expect(new Set(corpus.replays?.map((replay) => replay.sessionId))).toEqual(
      new Set(keptSessionIds),
    );

    for (const replay of corpus.replays ?? []) {
      expect(seededByRecording.has(replay.sessionId)).toBe(true);
      expect(replay.transcript.actions.map((action) => action.atMs)).toEqual([0, RAGE_CLICK_AT_MS]);
      expect(replay.transcript.actions.map((action) => action.kind)).toEqual([
        "page",
        "rage_click",
      ]);
    }
  });

  it("should carry a replay with an empty transcript for a recording pulled with zero actions, not drop it", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("empty-actions"),
      userName: NAMES.userName("empty-actions"),
      email: NAMES.email("empty-actions"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("empty-actions"),
    });
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });

    const recordingId = "0198c4f2-7a1b-7c3d-9e4f-0000000000ea";
    const sessionKey = recordingSessionKey("posthog", recordingId);
    if (sessionKey === null)
      throw new Error(`recordingSessionKey returned no key for ${recordingId}`);

    const session = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey,
      startedAt: SESSION_STARTED_AT,
      entryUrlPath: "/pricing",
      exclusionReason: "none",
    });

    const narrationCtx = systemContextFor(SYSTEM_ACTOR.REPLAY_NARRATION_TICK, {
      organizationId: org.organizationId,
      organizationName: org.organizationName,
    });

    await transcriptRepo(db, narrationCtx).persist({
      projectId: project.id,
      recordingId,
      summarySource: "model_rendered",
      headline: CLEAN.headline,
      context: CLEAN.context,
      transcript: "0:00  nothing happened",
      pages: [],
      durationMs: 0,
      actionCount: 0,
      notableCount: 0,
      droppedEvents: 0,
      startedAt: SESSION_STARTED_AT,
      resolvedModelId: "test-model",
      provider: "posthog",
      sessionKey,
      sessionGroupingVersion: SESSION_GROUPING_VERSION,
      actions: transcriptOf([]),
      actionsVersion: 1,
      actionsOmitted: 0,
      pullStop: "exhausted",
      pullReason: null,
      pullWatermarkAt: null,
    });

    const analysisCtx = systemContextFor(SYSTEM_ACTOR.ANALYSIS_TICK, {
      organizationId: org.organizationId,
      organizationName: org.organizationName,
    });

    const corpus = await createDetectorCorpusService(db, analysisCtx).read(project.id, WINDOW);

    const replay = corpus.replays?.find((entry) => entry.sessionId === session.id);
    expect(replay).toBeDefined();
    expect(replay?.transcript.actions).toEqual([]);
  });

  it("should carry no replay for a session the corpus set aside", async () => {
    const { projectId, analysisCtx, seededByRecording } =
      await seedProjectWithRecordings("replay-set-aside");

    const corpus = await createDetectorCorpusService(db, analysisCtx).read(projectId, WINDOW);

    const setAsideSessionIds = corpus.sessions
      .filter((session) => session.exclusionReason !== "none")
      .map((session) => session.sessionId);

    expect(setAsideSessionIds).toHaveLength(1);
    expect(seededByRecording.get(setAsideSessionIds[0] ?? "")).toBe(SET_ASIDE_RECORDING_ID);

    expect(
      (corpus.replays ?? []).filter((replay) => setAsideSessionIds.includes(replay.sessionId)),
    ).toEqual([]);
  });

  it("should carry no citation for a session the corpus set aside", async () => {
    const { projectId, analysisCtx, seededByRecording } =
      await seedProjectWithRecordings("set-aside");

    const corpus = await createDetectorCorpusService(db, analysisCtx).read(projectId, WINDOW);

    const setAsideSessionIds = corpus.sessions
      .filter((session) => session.exclusionReason !== "none")
      .map((session) => session.sessionId);

    expect(setAsideSessionIds).toHaveLength(1);
    expect(seededByRecording.get(setAsideSessionIds[0] ?? "")).toBe(SET_ASIDE_RECORDING_ID);

    expect(
      corpus.citations.filter((citation) => setAsideSessionIds.includes(citation.sessionId)),
    ).toEqual([]);
  });
});
