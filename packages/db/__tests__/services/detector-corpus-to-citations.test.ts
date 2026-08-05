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
  citationsFor,
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

  it("should resolve a finding's corpus session set to recordings and per-action offsets", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("chain"),
      userName: NAMES.userName("chain"),
      email: NAMES.email("chain"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("chain"),
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

    for (const recordingId of RECORDING_IDS) {
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
          { kind: "page", atMs: 0 },
          {
            kind: "rage_click",
            atMs: RAGE_CLICK_AT_MS,
            element: { nodeId: 21, tag: "BUTTON", classes: ["gm-buy"] },
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
    const corpus = await createDetectorCorpusService(db, analysisCtx).read(project.id, WINDOW);

    const keptSessionIds = corpus.sessions
      .filter((session) => session.exclusionReason === "none")
      .map((session) => session.sessionId);

    expect(keptSessionIds).toHaveLength(RECORDING_IDS.length);

    const citations = await citationsFor(
      transcriptRepo(db, analysisCtx),
      project.id,
      keptSessionIds,
    );

    expect(citations).toHaveLength(keptSessionIds.length);

    for (const citation of citations) {
      expect(citation.recordingId).toBe(seededByRecording.get(citation.sessionId) ?? "unseeded");
      expect(citation.provider).toBe("posthog");
      expect(citation.transcriptVersion).toBe(1);
      expect(citation.actions.map((action) => action.atMs)).toEqual([0, RAGE_CLICK_AT_MS]);
    }
  });
});
