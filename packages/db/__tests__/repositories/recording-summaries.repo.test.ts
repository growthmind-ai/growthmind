import { randomUUID } from "node:crypto";

import { DETECTOR_CORPUS_MAX_SESSIONS } from "@growthmind/core";
import { LIVE_CHANNEL } from "@growthmind/shared";
import type { LivePayload, LiveTopic, TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SQL, StringChunk, and, eq } from "drizzle-orm";

import { createRecordingSummariesRepo } from "../../src/repositories/recording-summaries.repo";
import type { PersistRecordingSummaryInput } from "../../src/repositories/recording-summaries.repo";
import { recordingSummaries } from "../../src/schema/recording-summaries";
import * as dbTesting from "../../src/testing";
import { createTestDb, driverQueryError, type TestDb } from "../../src/testing";
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
  TranscriptRefreshInput,
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

const BYTE_CAP_REASON = "This recording is larger than we read in one visit.";

const RATE_LIMIT_REASON = "Your recording source asked us to slow down, so we stopped early.";

const SEEDED_ACTION_COUNT = 12;

const REFRESHED_ACTION_COUNT = 24;

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
    actionCount: SEEDED_ACTION_COUNT,
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

function refreshInputFor(
  projectId: string,
  recordingId: string,
  overrides: Partial<TranscriptRefreshInput> = {},
): TranscriptRefreshInput {
  return {
    projectId,
    recordingId,
    transcript: "0:00  opened /pricing\n1:04  pressed buy four times",
    pages: ["/pricing", "/checkout"],
    durationMs: 124_000,
    actionCount: REFRESHED_ACTION_COUNT,
    notableCount: 2,
    droppedEvents: 0,
    actions: transcriptOf(PERSISTED_ACTIONS),
    actionsVersion: 1,
    actionsOmitted: 0,
    pullStop: "exhausted",
    pullReason: null,
    pullWatermarkAt: WATERMARK_AT,
    bytesReceived: 2_048,
    ...overrides,
  };
}

// The one place the topic string is written. `satisfies` is what turns a topic absent from
// LIVE_TOPICS into a compile error instead of a publish nothing is listening for (D9/D11).
const RECORDINGS_TOPIC = "recordings" satisfies LiveTopic;

type LiveRecorder = {
  readonly db: TestDb;
  readonly published: readonly LivePayload[];
  readonly malformed: readonly unknown[];
};

const RECORDER_CONTRACT =
  "packages/db/src/testing exports no recordPublishedTopics(db) returning " +
  "{ db, published: readonly LivePayload[], malformed: readonly unknown[] }. ADD AD-1 and the " +
  "STATE.md amendment require `malformed` to collect every statement on LIVE_CHANNEL whose " +
  "payload failed livePayloadSchema: publishLive swallows the parse throw, so without that " +
  "surface a recorder that never intercepts is indistinguishable from a correct zero-publish.";

function recordPublishedTopics(realDb: TestDb): LiveRecorder {
  const factory = (dbTesting as unknown as Record<string, unknown>).recordPublishedTopics;

  if (typeof factory !== "function") {
    throw new Error(RECORDER_CONTRACT);
  }

  const recorder = (factory as (executor: TestDb) => LiveRecorder)(realDb);

  if (!Array.isArray(recorder.published) || !Array.isArray(recorder.malformed)) {
    throw new Error(RECORDER_CONTRACT);
  }

  return recorder;
}

function namesPgNotify(statement: unknown): boolean {
  return (
    statement instanceof SQL &&
    statement.queryChunks.some(
      (chunk) => chunk instanceof StringChunk && chunk.value.join("").includes("pg_notify"),
    )
  );
}

type BlindPublisher = {
  readonly db: TestDb;
  readonly attempts: () => number;
};

// Counting the attempt is the whole test: a repository that never publishes at all survives a
// failing publish exactly as well as one that publishes and swallows, so `attempts` is what
// separates D8 from a vacuous pass.
function failLivePublishes(realDb: TestDb, thrown: Error): BlindPublisher {
  let attempts = 0;

  const proxied = new Proxy(realDb, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop !== "execute") {
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      }

      return (...args: unknown[]) => {
        if (namesPgNotify(args[0])) {
          attempts += 1;
          throw thrown;
        }

        return (value as (...args: unknown[]) => unknown).apply(target, args);
      };
    },
  });

  return { db: proxied, attempts: () => attempts };
}

const publishFailure = (): Error =>
  driverQueryError({
    sql: "select pg_notify($1, $2::text)",
    params: [LIVE_CHANNEL],
    driverMessage: "sorry, too many clients already",
  });

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

  // The detector corpus reads at most this many sessions and asks for citations across the
  // subset it kept, so the throw above sits one id beyond anything read() can produce.
  it("should query rather than throw at exactly the corpus cap", async () => {
    const { org, project } = await seedOrg("citation-cap-edge");
    const repo = transcriptRepo(db, org.ctx);

    const atCap = Array.from({ length: DETECTOR_CORPUS_MAX_SESSIONS }, () => randomUUID());

    expect(await citationsFor(repo, project.id, atCap)).toEqual([]);
  });

  it("should return an empty list for an empty session id list without querying", async () => {
    const { org, project } = await seedOrg("citation-empty");

    expect(await citationsFor(transcriptRepo(db, org.ctx), project.id, [])).toEqual([]);
  });

  async function seedCitable(
    label: string,
    recordingId: string,
    actions: unknown,
    version: number,
  ) {
    const { org, project, connection } = await seedOrgProjectConnection(label);
    const sessionKey = recordingSessionKey("posthog", recordingId);

    await transcriptRepo(db, org.ctx).persist(
      transcriptInputFor(project.id, recordingId, {
        sessionKey,
        actions: actions as TranscriptPersistInput["actions"],
        actionsVersion: version,
      }),
    );

    const session = await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: sessionKey ?? "",
    });

    return citationsFor(transcriptRepo(db, org.ctx), project.id, [session.id]);
  }

  it("should report no readable actions for a transcript written by a newer version", async () => {
    const citations = await seedCitable(
      "citation-newer-version",
      "0198c4f2-7a1b-7c3d-9e4f-newer-version",
      { v: 2, actions: [{ kind: "page", atMs: 0 }] },
      2,
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]?.transcriptVersion).toBe(2);
    expect(citations[0]?.actions).toBeNull();
  });

  it("should report no readable actions for a payload carrying a kind its version cannot read", async () => {
    const citations = await seedCitable(
      "citation-unknown-kind",
      "0198c4f2-7a1b-7c3d-9e4f-unknown-kind",
      { v: 1, actions: [{ kind: "teleported", atMs: 12 }] },
      1,
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]?.transcriptVersion).toBe(1);
    expect(citations[0]?.actions).toBeNull();
  });

  it("should report an empty action list for a recording that genuinely had no beats", async () => {
    const citations = await seedCitable(
      "citation-no-beats",
      "0198c4f2-7a1b-7c3d-9e4f-no-beats",
      transcriptOf([]),
      1,
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]?.transcriptVersion).toBe(1);
    expect(citations[0]?.actions).toEqual([]);
  });

  it("should report a failed pull as retryable and a capped or exhausted one as settled", async () => {
    const { org, project } = await seedOrg("retryable-ids");
    const repo = transcriptRepo(db, org.ctx);
    const ids = ["rec-throttled", "rec-byte-capped", "rec-read-whole"];

    await repo.persist(
      transcriptInputFor(project.id, "rec-throttled", {
        pullStop: "failed",
        pullReason: RATE_LIMIT_REASON,
      }),
    );
    await repo.persist(
      transcriptInputFor(project.id, "rec-byte-capped", {
        pullStop: "byte_cap",
        pullReason: BYTE_CAP_REASON,
      }),
    );
    await repo.persist(transcriptInputFor(project.id, "rec-read-whole"));

    expect(await repo.summarisedIds(project.id, ids)).toEqual(new Set(ids));
    expect(await repo.retryablePullIds(project.id, ids)).toEqual(new Set(["rec-throttled"]));
  });

  it("should treat a row written before 0021 as settled rather than retryable", async () => {
    const { org, project } = await seedOrg("retryable-legacy");

    await db.insert(recordingSummaries).values({
      organizationId: org.organizationId,
      projectId: project.id,
      recordingId: "rec-legacy-pull",
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

    expect((await repo.summarisedIds(project.id, ["rec-legacy-pull"])).size).toBe(1);
    expect((await repo.retryablePullIds(project.id, ["rec-legacy-pull"])).size).toBe(0);
  });

  it("should replace the evidence on a failed pull and leave the narration as written", async () => {
    const { org, project } = await seedOrg("refresh-failed");
    const repo = transcriptRepo(db, org.ctx);

    const first = await repo.persist(
      transcriptInputFor(project.id, "rec-retried-pull", {
        pullStop: "failed",
        pullReason: RATE_LIMIT_REASON,
        bytesReceived: 1_024,
      }),
    );

    const refreshed = await repo.refreshFailedPull(refreshInputFor(project.id, "rec-retried-pull"));

    expect(refreshed?.id).toBe(first.id);
    expect(refreshed?.pullStop).toBe("exhausted");
    expect(refreshed?.pullReason).toBeNull();
    expect(refreshed?.actionCount).toBe(REFRESHED_ACTION_COUNT);
    expect(refreshed?.bytesReceived).toBe(2_048);
    expect(refreshed?.pages).toEqual(["/pricing", "/checkout"]);
    expect(refreshed?.text.held).toBe(false);
    if (refreshed?.text.held === false) {
      expect(refreshed.text.headline).toBe(CLEAN.headline);
    }
    expect(refreshed?.summarySource).toBe("model_rendered");
    expect(refreshed?.resolvedModelId).toBe("test-model");
    expect(refreshed?.tokensIn).toBe(40);
    expect(refreshed?.startedAt?.toISOString()).toBe(STARTED_AT.toISOString());
    expect(await rowCountFor(project.id, "rec-retried-pull")).toBe(1);
    expect((await repo.retryablePullIds(project.id, ["rec-retried-pull"])).size).toBe(0);
  });

  it("should refuse to replace a row whose pull reached a bound", async () => {
    const { org, project } = await seedOrg("refresh-bounded");
    const repo = transcriptRepo(db, org.ctx);

    await repo.persist(
      transcriptInputFor(project.id, "rec-bounded", {
        pullStop: "byte_cap",
        pullReason: BYTE_CAP_REASON,
      }),
    );

    expect(await repo.refreshFailedPull(refreshInputFor(project.id, "rec-bounded"))).toBeNull();

    const found = await repo.findFor(project.id, "rec-bounded");
    expect(found?.pullStop).toBe("byte_cap");
    expect(found?.pullReason).toBe(BYTE_CAP_REASON);
  });

  it("should refuse a retry that read less than the row already holds", async () => {
    const { org, project } = await seedOrg("refresh-shorter");
    const repo = transcriptRepo(db, org.ctx);

    await repo.persist(
      transcriptInputFor(project.id, "rec-shorter-retry", {
        pullStop: "failed",
        pullReason: RATE_LIMIT_REASON,
      }),
    );

    const shorter = await repo.refreshFailedPull(
      refreshInputFor(project.id, "rec-shorter-retry", { actionCount: 3, notableCount: 0 }),
    );

    expect(shorter).toBeNull();

    const found = await repo.findFor(project.id, "rec-shorter-retry");
    expect(found?.actionCount).toBe(12);
    expect(found?.pullStop).toBe("failed");
  });

  it("should refuse to refresh or list a failed pull another organization owns", async () => {
    const mine = await seedOrg("refresh-tenant-mine");
    const theirs = await seedOrg("refresh-tenant-theirs");

    await transcriptRepo(db, mine.org.ctx).persist(
      transcriptInputFor(mine.project.id, "rec-not-theirs", {
        pullStop: "failed",
        pullReason: RATE_LIMIT_REASON,
      }),
    );

    const theirRepo = transcriptRepo(db, theirs.org.ctx);

    expect((await theirRepo.retryablePullIds(mine.project.id, ["rec-not-theirs"])).size).toBe(0);
    expect(
      await theirRepo.refreshFailedPull(refreshInputFor(mine.project.id, "rec-not-theirs")),
    ).toBeNull();

    const found = await transcriptRepo(db, mine.org.ctx).findFor(mine.project.id, "rec-not-theirs");
    expect(found?.pullStop).toBe("failed");
    expect(found?.actionCount).toBe(12);
  });

  describe("a recordings publish means a row changed", () => {
    it("should publish the recordings topic once when persist inserted a row", async () => {
      const { org, project } = await seedOrg("publish-on-insert");
      const recorder = recordPublishedTopics(db);

      await createRecordingSummariesRepo(recorder.db, org.ctx).persist(
        inputFor(project.id, "rec-published"),
      );

      expect(recorder.published).toEqual([
        { organizationId: org.organizationId, topic: RECORDINGS_TOPIC },
      ]);
    });

    it("should publish nothing when persist found the row already there", async () => {
      const { org, project } = await seedOrg("publish-on-fetch");
      await createRecordingSummariesRepo(db, org.ctx).persist(inputFor(project.id, "rec-again"));

      const recorder = recordPublishedTopics(db);
      const settled = await createRecordingSummariesRepo(recorder.db, org.ctx).persist(
        inputFor(project.id, "rec-again"),
      );

      expect(recorder.published).toEqual([]);
      expect(recorder.malformed).toEqual([]);
      expect(settled.recordingId).toBe("rec-again");
    });

    it("should return its record on both the insert and the fetch path", async () => {
      const { org, project } = await seedOrg("record-on-both-paths");
      const repo = createRecordingSummariesRepo(db, org.ctx);

      const inserted = await repo.persist(inputFor(project.id, "rec-both-paths"));
      const fetched = await repo.persist(inputFor(project.id, "rec-both-paths"));

      expect(inserted.recordingId).toBe("rec-both-paths");
      expect(fetched.recordingId).toBe("rec-both-paths");
      expect(fetched.id).toBe(inserted.id);
    });

    it("should publish once when refreshFailedPull updated a row", async () => {
      const { org, project } = await seedOrg("publish-on-refresh");
      await transcriptRepo(db, org.ctx).persist(
        transcriptInputFor(project.id, "rec-refresh-published", {
          pullStop: "failed",
          pullReason: RATE_LIMIT_REASON,
        }),
      );

      const recorder = recordPublishedTopics(db);
      const refreshed = await transcriptRepo(recorder.db, org.ctx).refreshFailedPull(
        refreshInputFor(project.id, "rec-refresh-published"),
      );

      expect(refreshed).not.toBeNull();
      expect(recorder.published).toEqual([
        { organizationId: org.organizationId, topic: RECORDINGS_TOPIC },
      ]);
    });

    it("should publish nothing when refreshFailedPull matched no row", async () => {
      const { org, project } = await seedOrg("publish-on-no-match");
      await transcriptRepo(db, org.ctx).persist(
        transcriptInputFor(project.id, "rec-settled-pull", {
          pullStop: "byte_cap",
          pullReason: BYTE_CAP_REASON,
        }),
      );

      const recorder = recordPublishedTopics(db);
      const refreshed = await transcriptRepo(recorder.db, org.ctx).refreshFailedPull(
        refreshInputFor(project.id, "rec-settled-pull"),
      );

      expect(refreshed).toBeNull();
      expect(recorder.published).toEqual([]);
      expect(recorder.malformed).toEqual([]);
    });

    async function seedFailedPull(label: string, recordingId: string) {
      const { org, project } = await seedOrg(label);
      await transcriptRepo(db, org.ctx).persist(
        transcriptInputFor(project.id, recordingId, {
          pullStop: "failed",
          pullReason: RATE_LIMIT_REASON,
        }),
      );

      return { org, project };
    }

    it("should publish nothing when a failing retry read nothing new", async () => {
      const { org, project } = await seedFailedPull("publish-on-stuck-retry", "rec-stuck-retry");

      const stuck: Partial<TranscriptRefreshInput> = {
        actionCount: SEEDED_ACTION_COUNT,
        notableCount: 1,
        pullStop: "failed",
        pullReason: RATE_LIMIT_REASON,
      };

      const recorder = recordPublishedTopics(db);
      const repo = transcriptRepo(recorder.db, org.ctx);

      const first = await repo.refreshFailedPull(
        refreshInputFor(project.id, "rec-stuck-retry", stuck),
      );
      const second = await repo.refreshFailedPull(
        refreshInputFor(project.id, "rec-stuck-retry", stuck),
      );

      expect(recorder.published).toEqual([]);
      expect(recorder.malformed).toEqual([]);

      // The cursor and watermark still move on a retry that read nothing new — only the publish
      // is withheld, so a resumable pull is not traded away for a quiet page.
      expect(first?.bytesReceived).toBe(2_048);
      expect(second?.pullWatermarkAt?.toISOString()).toBe(WATERMARK_AT.toISOString());
    });

    it("should publish when a failing retry read further", async () => {
      const { org, project } = await seedFailedPull("publish-on-longer-retry", "rec-longer-retry");

      const recorder = recordPublishedTopics(db);
      const refreshed = await transcriptRepo(recorder.db, org.ctx).refreshFailedPull(
        refreshInputFor(project.id, "rec-longer-retry", {
          pullStop: "failed",
          pullReason: RATE_LIMIT_REASON,
        }),
      );

      expect(refreshed?.actionCount).toBe(REFRESHED_ACTION_COUNT);
      expect(refreshed?.pullStop).toBe("failed");
      expect(recorder.published).toEqual([
        { organizationId: org.organizationId, topic: RECORDINGS_TOPIC },
      ]);
    });

    it("should publish when a retry settles a pull that read nothing further", async () => {
      const { org, project } = await seedFailedPull(
        "publish-on-settling-retry",
        "rec-settled-late",
      );

      const recorder = recordPublishedTopics(db);
      const refreshed = await transcriptRepo(recorder.db, org.ctx).refreshFailedPull(
        refreshInputFor(project.id, "rec-settled-late", {
          actionCount: SEEDED_ACTION_COUNT,
          notableCount: 1,
        }),
      );

      expect(refreshed?.actionCount).toBe(SEEDED_ACTION_COUNT);
      expect(refreshed?.pullStop).toBe("exhausted");
      expect(recorder.published).toEqual([
        { organizationId: org.organizationId, topic: RECORDINGS_TOPIC },
      ]);
    });

    it("should publish the repository's own tenant and refuse another organization's project", async () => {
      const mine = await seedOrg("publish-tenant-mine");
      const theirs = await seedOrg("publish-tenant-theirs");

      const recorder = recordPublishedTopics(db);
      const theirRepo = createRecordingSummariesRepo(recorder.db, theirs.org.ctx);

      await theirRepo.persist(inputFor(theirs.project.id, "rec-own-tenant"));

      await expect(
        theirRepo.persist(inputFor(mine.project.id, "rec-other-tenant")),
      ).rejects.toThrow(/not this organization's/);

      expect(recorder.published).toEqual([
        { organizationId: theirs.org.organizationId, topic: RECORDINGS_TOPIC },
      ]);
      expect(recorder.malformed).toEqual([]);
    });

    it("should return its record from persist when the publish itself throws", async () => {
      const { org, project } = await seedOrg("publish-throws-on-persist");
      const blind = failLivePublishes(db, publishFailure());

      const record = await createRecordingSummariesRepo(blind.db, org.ctx).persist(
        inputFor(project.id, "rec-publish-throws"),
      );

      expect(record.recordingId).toBe("rec-publish-throws");
      expect(blind.attempts()).toBe(1);
    });

    it("should return its record from refreshFailedPull when the publish itself throws", async () => {
      const { org, project } = await seedOrg("publish-throws-on-refresh");
      await transcriptRepo(db, org.ctx).persist(
        transcriptInputFor(project.id, "rec-refresh-publish-throws", {
          pullStop: "failed",
          pullReason: RATE_LIMIT_REASON,
        }),
      );

      const blind = failLivePublishes(db, publishFailure());
      const refreshed = await transcriptRepo(blind.db, org.ctx).refreshFailedPull(
        refreshInputFor(project.id, "rec-refresh-publish-throws"),
      );

      expect(refreshed?.recordingId).toBe("rec-refresh-publish-throws");
      expect(blind.attempts()).toBe(1);
    });

    it("should publish the topic the recording detail page mounts", async () => {
      const { org, project } = await seedOrg("publish-topic-constant");
      const recorder = recordPublishedTopics(db);

      await createRecordingSummariesRepo(recorder.db, org.ctx).persist(
        inputFor(project.id, "rec-topic-wire"),
      );

      expect(recorder.published[0]?.topic).toBe(RECORDINGS_TOPIC);
    });
  });
});
