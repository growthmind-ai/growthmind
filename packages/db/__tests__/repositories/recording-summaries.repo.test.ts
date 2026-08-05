import { DETECTOR_CORPUS_MAX_SESSIONS } from "@growthmind/core";
import type { TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createRecordingSummariesRepo } from "../../src/repositories/recording-summaries.repo";
import type { PersistRecordingSummaryInput } from "../../src/repositories/recording-summaries.repo";
import { recordingSummaries } from "../../src/schema/recording-summaries";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, scannedTextFor, seedOrgWithOwner, seedProject } from "../../src/testing";
import {
  makeTenantContext,
  seedConnection,
  seedMember,
  seedSession,
  seedUser,
  type SeededOrgWithOwner,
} from "../../src/testing";
import {
  SESSION_GROUPING_VERSION,
  citationsFor,
  recordingSessionKey,
  transcriptOf,
  transcriptRepo,
} from "../helpers/transcript-contract";
import type {
  PersistedSessionAction,
  TranscriptPersistInput,
} from "../helpers/transcript-contract";

const NAMES = laneNames("recording-summaries");

const STARTED_AT = new Date("2026-08-05T09:00:00.000Z");

const WATERMARK_AT = new Date("2026-08-05T08:30:00.000Z");

const RAGE_CLICK_AT_MS = 64_000;

const PERSISTED_ACTIONS: readonly PersistedSessionAction[] = [
  { kind: "page", atMs: 0 },
  {
    kind: "rage_click",
    atMs: RAGE_CLICK_AT_MS,
    element: { nodeId: 21, tag: "BUTTON", classes: ["gm-submit"] },
  },
];

const PAGE_CAP_REASON = "We read as much of this recording as one pass allows.";

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

function transcriptInputFor(
  projectId: string,
  recordingId: string,
  overrides: Partial<TranscriptPersistInput> = {},
): TranscriptPersistInput {
  return {
    ...inputFor(projectId, recordingId),
    provider: "posthog",
    sessionKey: `ph:${recordingId}`,
    sessionGroupingVersion: SESSION_GROUPING_VERSION,
    actions: transcriptOf(PERSISTED_ACTIONS),
    actionsVersion: 1,
    actionsOmitted: 0,
    pullStop: "exhausted",
    pullReason: null,
    pullWatermarkAt: WATERMARK_AT,
    ...overrides,
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

  async function seedOrgProjectConnection(label: string) {
    const { org, project } = await seedOrg(label);
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });
    return { org, project, connection };
  }

  async function seedTeammate(org: SeededOrgWithOwner, label: string): Promise<TenantContext> {
    const user = await seedUser(db, {
      name: NAMES.userName(`${label}-mate`),
      email: NAMES.email(`${label}-mate`),
    });
    await seedMember(db, {
      organizationId: org.organizationId,
      userId: user.id,
      role: "member",
    });

    return makeTenantContext({
      userId: user.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    });
  }

  async function rowCountFor(projectId: string, recordingId: string): Promise<number> {
    const rows = await db
      .select({ id: recordingSummaries.id })
      .from(recordingSummaries)
      .where(
        and(
          eq(recordingSummaries.projectId, projectId),
          eq(recordingSummaries.recordingId, recordingId),
        ),
      );

    return rows.length;
  }

  it("should ignore rows with a null started_at when reading the watermark", async () => {
    const { org, project } = await seedOrg("watermark-nulls-first");
    const repo = createRecordingSummariesRepo(db, org.ctx);
    const known = new Date("2026-08-01T00:00:00.000Z");

    await repo.persist({ ...inputFor(project.id, "rec-dated"), startedAt: known });
    await repo.persist({ ...inputFor(project.id, "rec-undated"), startedAt: null });

    expect((await repo.latestStartedAt(project.id))?.toISOString()).toBe(known.toISOString());
  });

  it("should return null when every row has a null started_at", async () => {
    const { org, project } = await seedOrg("watermark-all-null");
    const repo = createRecordingSummariesRepo(db, org.ctx);

    await repo.persist({ ...inputFor(project.id, "rec-undated-a"), startedAt: null });
    await repo.persist({ ...inputFor(project.id, "rec-undated-b"), startedAt: null });

    expect(await repo.latestStartedAt(project.id)).toBeNull();
  });

  it("should stamp session_key, provider, actions, actions_version, actions_omitted, pull_stop and pull_watermark_at", async () => {
    const { org, project } = await seedOrg("stamps-transcript");
    const repo = transcriptRepo(db, org.ctx);

    await repo.persist(
      transcriptInputFor(project.id, "rec-stamped", {
        actionsOmitted: 7,
        pullStop: "page_cap",
        pullReason: PAGE_CAP_REASON,
      }),
    );

    const found = await repo.findFor(project.id, "rec-stamped");

    expect(found?.sessionKey).toBe("ph:rec-stamped");
    expect(found?.provider).toBe("posthog");
    expect(found?.sessionGroupingVersion).toBe(SESSION_GROUPING_VERSION);
    expect(found?.actions).toEqual(transcriptOf(PERSISTED_ACTIONS));
    expect(found?.actionsVersion).toBe(1);
    expect(found?.actionsOmitted).toBe(7);
    expect(found?.pullStop).toBe("page_cap");
    expect(found?.pullReason).toBe(PAGE_CAP_REASON);
    expect(found?.pullWatermarkAt?.toISOString()).toBe(WATERMARK_AT.toISOString());
  });

  it("should read a row written before 0021 without throwing", async () => {
    const { org, project } = await seedOrg("legacy-row");

    await db.insert(recordingSummaries).values({
      organizationId: org.organizationId,
      projectId: project.id,
      recordingId: "rec-pre-0021",
      summarySource: "model_rendered",
      headline: "Someone opened pricing and left",
      context: ["They read one page and went no further."],
      transcript: "0:00  opened /pricing",
      pages: ["/pricing"],
      durationMs: 4000,
      actionCount: 2,
      notableCount: 0,
      droppedEvents: 0,
      startedAt: STARTED_AT,
      resolvedModelId: null,
    });

    const repo = transcriptRepo(db, org.ctx);
    const found = await repo.findFor(project.id, "rec-pre-0021");

    expect(found).not.toBeNull();
    expect(found?.sessionKey).toBeNull();
    expect(found?.actions).toBeNull();
    expect(found?.actionsVersion).toBeNull();
    expect(found?.pullStop).toBeNull();
  });

  it("should write one row when the same recording is persisted twice", async () => {
    const { org, project } = await seedOrg("one-row-on-retry");
    const repo = transcriptRepo(db, org.ctx);

    const first = await repo.persist(transcriptInputFor(project.id, "rec-retried"));
    const second = await repo.persist(
      transcriptInputFor(project.id, "rec-retried", { actionsOmitted: 99 }),
    );

    expect(second.id).toBe(first.id);
    expect(second.actionsOmitted).toBe(0);
    expect(await rowCountFor(project.id, "rec-retried")).toBe(1);
  });

  it("should reject two rows sharing an organization, project and session key", async () => {
    const { org, project } = await seedOrg("session-key-injective");
    const repo = transcriptRepo(db, org.ctx);
    const shared = "ph:one-session-two-recordings";

    await repo.persist(transcriptInputFor(project.id, "rec-a", { sessionKey: shared }));

    await expect(
      repo.persist(transcriptInputFor(project.id, "rec-b", { sessionKey: shared })),
    ).rejects.toThrow();
  });

  it("should join a transcript to a session that landed after it", async () => {
    const { org, project, connection } = await seedOrgProjectConnection("recording-first");
    const repo = transcriptRepo(db, org.ctx);
    const recordingId = "0198c4f2-7a1b-7c3d-9e4f-recording-first";
    const sessionKey = recordingSessionKey("posthog", recordingId);

    await repo.persist(transcriptInputFor(project.id, recordingId, { sessionKey }));

    const session = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: sessionKey ?? "",
    });

    const citations = await citationsFor(repo, project.id, [session.id]);

    expect(citations).toHaveLength(1);
    expect(citations[0]?.recordingId).toBe(recordingId);
    expect(citations[0]?.sessionId).toBe(session.id);
  });

  it("should join a transcript to a session that landed before it", async () => {
    const { org, project, connection } = await seedOrgProjectConnection("session-first");
    const repo = transcriptRepo(db, org.ctx);
    const recordingId = "0198c4f2-7a1b-7c3d-9e4f-session-first";
    const sessionKey = recordingSessionKey("posthog", recordingId);

    const session = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: sessionKey ?? "",
    });

    await repo.persist(transcriptInputFor(project.id, recordingId, { sessionKey }));

    const citations = await citationsFor(repo, project.id, [session.id]);

    expect(citations).toHaveLength(1);
    expect(citations[0]?.recordingId).toBe(recordingId);
  });

  it("should never mint a second row in either arrival order", async () => {
    const { org, project, connection } = await seedOrgProjectConnection("no-second-row");
    const repo = transcriptRepo(db, org.ctx);

    const recordingFirst = "0198c4f2-7a1b-7c3d-9e4f-order-a";
    const sessionFirst = "0198c4f2-7a1b-7c3d-9e4f-order-b";

    await repo.persist(
      transcriptInputFor(project.id, recordingFirst, {
        sessionKey: recordingSessionKey("posthog", recordingFirst),
      }),
    );
    await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: recordingSessionKey("posthog", recordingFirst) ?? "",
    });

    await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: recordingSessionKey("posthog", sessionFirst) ?? "",
    });
    await repo.persist(
      transcriptInputFor(project.id, sessionFirst, {
        sessionKey: recordingSessionKey("posthog", sessionFirst),
      }),
    );

    expect(await rowCountFor(project.id, recordingFirst)).toBe(1);
    expect(await rowCountFor(project.id, sessionFirst)).toBe(1);
  });

  it("should return no citation for a transcript owned by another organization", async () => {
    const mine = await seedOrgProjectConnection("citation-mine");
    const theirs = await seedOrg("citation-theirs");
    const recordingId = "0198c4f2-7a1b-7c3d-9e4f-cross-tenant";
    const sessionKey = recordingSessionKey("posthog", recordingId);

    await transcriptRepo(db, mine.org.ctx).persist(
      transcriptInputFor(mine.project.id, recordingId, { sessionKey }),
    );
    const session = await seedSession(db, {
      organizationId: mine.org.organizationId,
      projectId: mine.project.id,
      connectionId: mine.connection.id,
      sessionKey: sessionKey ?? "",
    });

    const theirRepo = transcriptRepo(db, theirs.org.ctx);

    expect(await citationsFor(theirRepo, mine.project.id, [session.id])).toEqual([]);
  });

  it("should return the same citations for a teammate who connected nothing", async () => {
    const { org, project, connection } = await seedOrgProjectConnection("citation-teammate");
    const recordingId = "0198c4f2-7a1b-7c3d-9e4f-teammate";
    const sessionKey = recordingSessionKey("posthog", recordingId);

    await transcriptRepo(db, org.ctx).persist(
      transcriptInputFor(project.id, recordingId, { sessionKey }),
    );
    const session = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: sessionKey ?? "",
    });

    const connectorSaw = await citationsFor(transcriptRepo(db, org.ctx), project.id, [session.id]);
    const teammateCtx = await seedTeammate(org, "citation-teammate");
    const teammateSaw = await citationsFor(transcriptRepo(db, teammateCtx), project.id, [
      session.id,
    ]);

    expect(connectorSaw).toHaveLength(1);
    expect(teammateSaw).toEqual(connectorSaw);
  });

  it("should skip rows whose session key is null", async () => {
    const { org, project, connection } = await seedOrgProjectConnection("rrweb-no-key");
    const repo = transcriptRepo(db, org.ctx);
    const recordingId = "rrweb-recording-1";

    await repo.persist(
      transcriptInputFor(project.id, recordingId, {
        provider: "rrweb",
        sessionKey: recordingSessionKey("rrweb", recordingId),
        sessionGroupingVersion: null,
      }),
    );

    const session = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: `ph:${recordingId}`,
    });

    expect(await citationsFor(repo, project.id, [session.id])).toEqual([]);

    const found = await repo.findFor(project.id, recordingId);
    expect(found?.sessionKey).toBeNull();
    expect(found?.actions).toEqual(transcriptOf(PERSISTED_ACTIONS));
  });

  it("should throw rather than truncate when given more session ids than the corpus cap", async () => {
    const { org, project } = await seedOrg("citation-cap");
    const repo = transcriptRepo(db, org.ctx);

    const overCap = Array.from(
      { length: DETECTOR_CORPUS_MAX_SESSIONS + 1 },
      (_, index) => `session-${String(index)}`,
    );

    await expect(citationsFor(repo, project.id, overCap)).rejects.toThrow();
  });

  it("should return an empty list for an empty session id list without querying", async () => {
    const { org, project } = await seedOrg("citation-empty");

    expect(await citationsFor(transcriptRepo(db, org.ctx), project.id, [])).toEqual([]);
  });
});
