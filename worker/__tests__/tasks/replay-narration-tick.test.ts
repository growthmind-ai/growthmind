import { describe, expect, test } from "bun:test";

import type { ReplaySource } from "@growthmind/adapters";
import { NARRATION_MAX_ACTIONS, buildTranscript, compactTranscript } from "@growthmind/core";
import type { ReplayRowSummary } from "@growthmind/core";
import type {
  PersistRecordingSummaryInput,
  RecordingMetaStamp,
  RecordingSummariesRepo,
  RecordingSummaryRecord,
  RefreshFailedPullInput,
  SessionRecord,
  SessionsRepo,
} from "@growthmind/db";
import type {
  ReplayEventsResult,
  ReplayListResult,
  ReplayRecordingSummary,
  RrwebEvent,
  SummaryRenderResult,
  TenantContext,
} from "@growthmind/shared";

import { runReplayNarrationTick } from "../../src/tasks/replay-narration-tick";
import type { ReplayLane, ReplayNarrationDeps } from "../../src/tasks/replay-narration-tick";

const MODEL_ID = "narration-model-under-test";

const LANE: ReplayLane = {
  organizationId: "org-1",
  organizationName: "Acme",
  projectId: "project-1",
};

const CTX = { organizationId: "org-1", actorId: "system" } as unknown as TenantContext;

function recording(
  id: string,
  startedAt = "2026-08-05T09:00:00.000Z",
  meta: Record<string, unknown> = {},
): ReplayRecordingSummary {
  return {
    recordingId: id,
    startedAt: new Date(startedAt),
    lastActivityAt: new Date(startedAt),
    meta,
  };
}

// The four values the listing carries for the ratified columns (decision 0020, amended
// 2026-08-07). `recording_duration` is seconds and the column is seconds: pass-through.
const LISTED_META = {
  recording_duration: 42,
  active_seconds: 30,
  click_count: 7,
  keypress_count: 3,
  mouse_activity_count: 11,
  console_error_count: 2,
  start_url: "https://example.com/pricing",
};

const STAMPED_META: RecordingMetaStamp = {
  durationSeconds: 42,
  activeSeconds: 30,
  clickCount: 7,
  keypressCount: 3,
  consoleErrorCount: 2,
};

// A x1000 on either seconds field would store 42000 for a measured 42 — three digits of
// precision the source never had, which is the amendment's whole argument. Both columns
// take the source value unchanged, so a conversion fails by name rather than by rounding.
const converted = (seconds: number): readonly number[] => [seconds * 1000, seconds / 1000];

interface Stamp {
  readonly projectId: string;
  readonly sessionKey: string;
  readonly meta: RecordingMetaStamp;
}

// One home for the fake's identity scope, so the write and the read cannot drift apart and
// turn a missed stamp into a missed lookup.
const stampKey = (projectId: string, sessionKey: string): string =>
  `${projectId}::${sessionKey}`;

const unused =
  (name: string) =>
  (): never => {
    throw new Error(`fakeSessions: the narration tick must not call ${name}`);
  };

// The repository returns the row it updated, and null when the key matched none. A fake that
// always returned null would hide the tick's report of exactly that.
const MATCHED_ROW = { id: "session-row" } as SessionRecord;

// Loud on every method the tick has no business calling: a silent stub here would let the
// stamp land through a path D-13 never described.
function fakeSessions(onStamp?: () => SessionRecord | null) {
  const stamps: Stamp[] = [];
  const rows = new Map<string, RecordingMetaStamp>();

  const repo: SessionsRepo = {
    upsertMany: unused("upsertMany"),
    listForProject: unused("listForProject"),
    findByKey: unused("findByKey"),
    listSessions: unused("listSessions"),
    stampRecordingMeta: (projectId, sessionKey, meta) => {
      const stamped = onStamp === undefined ? MATCHED_ROW : onStamp();
      stamps.push({ projectId, sessionKey, meta });
      rows.set(stampKey(projectId, sessionKey), meta);
      return Promise.resolve(stamped);
    },
  };

  return { repo, stamps, rows };
}

// A meta snapshot then a click: enough for the transcript to have something to say.
function eventsFor(): readonly RrwebEvent[] {
  return [
    { type: 4, timestamp: 1_000, data: { href: "/pricing", width: 800, height: 600 } },
    { type: 3, timestamp: 2_000, data: { source: 2, type: 2, id: 5, x: 10, y: 10 } },
  ];
}

function listOk(recordings: readonly ReplayRecordingSummary[]): ReplayListResult {
  return {
    ok: true,
    recordings: [...recordings],
    stop: "exhausted",
    resumeCursor: null,
    pagesFetched: 1,
    droppedMalformed: 0,
    eventsReceived: 0,
  };
}

function eventsOk(events: readonly RrwebEvent[]): ReplayEventsResult {
  return {
    ok: true,
    events: [...events],
    stop: "exhausted",
    resumeCursor: null,
    bytesReceived: 0,
    pagesFetched: 1,
    droppedMalformed: 0,
    eventsReceived: events.length,
  };
}

function fakeSource(overrides: Partial<ReplaySource> = {}): ReplaySource {
  return {
    kind: "posthog",
    validate: () => Promise.resolve({ ok: true, checkedAt: new Date() }),
    listRecordings: () => Promise.resolve(listOk([recording("rec-1")])),
    pullEvents: () => Promise.resolve(eventsOk(eventsFor())),
    ...overrides,
  };
}

// The fake mirrors the two predicates the real repository enforces in SQL: a row is retryable
// only while its pull is "failed", and a refresh only lands while that is still true.
function fakeRepo() {
  const rows: PersistRecordingSummaryInput[] = [];
  const refreshed: RefreshFailedPullInput[] = [];

  const rowFor = (recordingId: string): PersistRecordingSummaryInput | undefined =>
    rows.find((row) => row.recordingId === recordingId);

  const repo: RecordingSummariesRepo = {
    persist: (input) => {
      rows.push(input);
      return Promise.resolve({ id: `row-${String(rows.length)}` } as RecordingSummaryRecord);
    },
    // Faithful, not stubbed to null: a stub here hid the retry path from ever combining a held
    // digest with a resumed pull, the same way a stubbed latestStartedAt hid B-053.
    findFor: (_projectId, recordingId) => {
      const row = rowFor(recordingId);
      if (row === undefined) return Promise.resolve(null);

      return Promise.resolve({
        actions: row.actions ?? null,
        actionsOmitted: row.actionsOmitted ?? null,
        pages: row.pages,
        durationMs: row.durationMs,
        droppedEvents: row.droppedEvents,
        pullResumeCursor: row.pullResumeCursor ?? null,
        pullOriginAt: row.pullOriginAt ?? null,
        pullStop: row.pullStop ?? null,
      } as RecordingSummaryRecord);
    },
    summarisedIds: (_projectId, ids) =>
      Promise.resolve(new Set(ids.filter((id) => rowFor(id) !== undefined))),
    retryablePullIds: (_projectId, ids) =>
      Promise.resolve(new Set(ids.filter((id) => rowFor(id)?.pullStop === "failed"))),
    refreshFailedPull: (input) => {
      const index = rows.findIndex((row) => row.recordingId === input.recordingId);
      const held = rows[index];

      if (held === undefined || held.pullStop !== "failed" || held.actionCount > input.actionCount) {
        return Promise.resolve(null);
      }

      refreshed.push(input);
      rows[index] = { ...held, ...input };

      return Promise.resolve({ id: `row-${String(index + 1)}` } as RecordingSummaryRecord);
    },
    // The real read: the newest start instant this project holds, ignoring rows with none.
    // Stubbing it to null hid B-053, because no fake could then advance a watermark.
    latestStartedAt: (projectId) => {
      let newest: Date | null = null;

      for (const row of rows) {
        const startedAt = row.startedAt;
        if (row.projectId !== projectId || startedAt === null) continue;
        if (newest === null || startedAt > newest) newest = startedAt;
      }

      return Promise.resolve(newest);
    },
    // Built from the rows this fake actually holds: the tick never reads it, and a stub that
    // returned an empty map would agree with a broken persist just as happily.
    storiesFor: (projectId, recordingIds) => {
      const stories = new Map<string, ReplayRowSummary>();

      for (const id of recordingIds) {
        const row = rowFor(id);
        if (row === undefined || row.projectId !== projectId) continue;
        stories.set(id, { headline: row.headline, held: false, pages: row.pages });
      }

      return Promise.resolve(stories);
    },
    citationsFor: () => Promise.resolve([]),
  };

  return { repo, rows, refreshed };
}

function okNarration(): SummaryRenderResult {
  return {
    ok: true,
    headline: "Someone looked at pricing and left",
    context: "They opened the pricing page, clicked once, and went no further.",
    resolvedModelId: MODEL_ID,
    usage: { inputTokens: 30, outputTokens: 12 },
  };
}

type Overrides = Partial<ReplayNarrationDeps> & { readonly narrate?: () => SummaryRenderResult };

function depsFor(rows: ReturnType<typeof fakeRepo>, overrides: Overrides = {}) {
  const logs: string[] = [];
  const narrate = overrides.narrate ?? okNarration;
  const sessions = fakeSessions();

  const deps: ReplayNarrationDeps = {
    lanes: { listDueLanes: () => Promise.resolve([LANE]) },
    sourceFor: () => Promise.resolve({ ok: true, source: fakeSource() }),
    summariesFor: () => rows.repo,
    sessionsFor: () => sessions.repo,
    contextFor: () => CTX,
    narrator: { port: { narrate: () => Promise.resolve(narrate()) }, resolvedModelId: MODEL_ID },
    perProjectCap: 10,
    perTickCap: 100,
    listPages: 1,
    logger: {
      info: (message: string) => logs.push(message),
      error: (message: string) => logs.push(message),
      warn: (message: string) => logs.push(message),
    } as unknown as ReplayNarrationDeps["logger"],
    ...overrides,
  };

  return { deps, logs, sessions };
}

describe("a recording always ends with a summary", () => {
  test("the model's words are persisted when the call succeeds", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store);

    const outcome = await runReplayNarrationTick(deps);

    expect(outcome.summarised).toBe(1);
    expect(store.rows[0]?.summarySource).toBe("model_rendered");
    expect(String(store.rows[0]?.headline)).toBe("Someone looked at pricing and left");
    expect(store.rows[0]?.resolvedModelId).toBe(MODEL_ID);
  });

  test("with no model configured the row is still written, from measured facts", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store, { narrator: null });

    await runReplayNarrationTick(deps);

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.summarySource).toBe("floor_no_key_configured");
    expect(store.rows[0]?.headline).toContain("spent");
    expect(store.rows[0]?.resolvedModelId).toBeNull();
  });

  test("a failed model call still writes a row, naming the failure as its provenance", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store, {
      narrate: () => ({
        ok: false,
        code: "call_failed",
        message: "no",
        resolvedModelId: MODEL_ID,
        usage: {},
      }),
    });

    await runReplayNarrationTick(deps);

    expect(store.rows[0]?.summarySource).toBe("floor_model_call_failed");
  });

  test("an unreadable model output is distinguished from a failed call", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store, {
      narrate: () => ({
        ok: false,
        code: "output_invalid",
        message: "no",
        resolvedModelId: MODEL_ID,
        usage: {},
      }),
    });

    await runReplayNarrationTick(deps);

    expect(store.rows[0]?.summarySource).toBe("floor_model_output_invalid");
  });

  test("model text carrying an identifier is rejected and the floor is written instead", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store, {
      narrate: () => ({
        ok: true,
        headline: "ada@acme.com pressed buy",
        context: "They tried twice.",
        resolvedModelId: MODEL_ID,
        usage: {},
      }),
    });

    await runReplayNarrationTick(deps);

    expect(store.rows[0]?.summarySource).toBe("floor_model_text_rejected");
    expect(store.rows[0]?.headline).not.toContain("ada@acme.com");
  });
});

describe("the model is never asked twice about one recording", () => {
  test("a recording already held is skipped before any model call", async () => {
    const store = fakeRepo();
    let calls = 0;

    const { deps } = depsFor(store, {
      narrator: {
        port: {
          narrate: () => {
            calls += 1;
            return Promise.resolve(okNarration());
          },
        },
        resolvedModelId: MODEL_ID,
      },
    });

    await runReplayNarrationTick(deps);
    const second = await runReplayNarrationTick(deps);

    expect(calls).toBe(1);
    expect(second.summarised).toBe(0);
    expect(second.skipped).toBe(1);
    expect(store.rows).toHaveLength(1);
  });

  test("the per-project cap bounds one tick, and the log names what it left", async () => {
    const store = fakeRepo();
    const many = [recording("a"), recording("b"), recording("c")];

    const { deps, logs } = depsFor(store, {
      perProjectCap: 2,
      sourceFor: () =>
        Promise.resolve({ ok: true, source: fakeSource({ listRecordings: () => Promise.resolve(listOk(many)) }) }),
    });

    const outcome = await runReplayNarrationTick(deps);

    expect(outcome.summarised).toBe(2);
    expect(logs.join(" ")).toContain("1 were left for a later tick");
  });
});

// Every other fake source here ignores sinceAt, so no test above can see a recording the
// watermark has excluded. These use a listing that honours it, against the faithful
// latestStartedAt in fakeRepo — the pair B-053 needed and the suite could not express.
describe("a backlog is drained, not stranded below the watermark", () => {
  function backlogSource(
    backlog: readonly ReplayRecordingSummary[],
    pulled: string[],
  ): ReplaySource {
    return fakeSource({
      listRecordings: (request) =>
        Promise.resolve(
          listOk(
            backlog.filter(
              (candidate) =>
                request.sinceAt === null ||
                candidate.startedAt === null ||
                candidate.startedAt.getTime() > request.sinceAt.getTime(),
            ),
          ),
        ),
      pullEvents: (recordingId: string) => {
        pulled.push(recordingId);
        return Promise.resolve(eventsOk(eventsFor()));
      },
    });
  }

  // Newest first, the order PostHog's recordings listing returns.
  const BACKLOG = [
    recording("rec-new-1", "2026-08-05T12:00:00.000Z"),
    recording("rec-new-2", "2026-08-05T11:00:00.000Z"),
    recording("rec-old-1", "2026-08-05T10:00:00.000Z"),
    recording("rec-old-2", "2026-08-05T09:00:00.000Z"),
  ];

  test("should transcript every recording of a backlog larger than the per-lane cap", async () => {
    const store = fakeRepo();
    const pulled: string[] = [];

    const { deps } = depsFor(store, {
      perProjectCap: 2,
      sourceFor: () => Promise.resolve({ ok: true, source: backlogSource(BACKLOG, pulled) }),
    });

    await runReplayNarrationTick(deps);
    await runReplayNarrationTick(deps);
    const third = await runReplayNarrationTick(deps);

    expect(new Set(store.rows.map((row) => row.recordingId))).toEqual(
      new Set(BACKLOG.map((candidate) => candidate.recordingId)),
    );
    expect(third.summarised).toBe(0);
  });

  test("should recover a recording that shares its started_at with the last one read", async () => {
    // The residual B-053 left open: oldest-first draining makes the watermark safe only when
    // the budget boundary falls between two DISTINCT instants. Two recordings sharing one
    // `started_at`, split by the budget, advanced the watermark onto the shared instant with
    // one still unread — and the adapter's `<=` filter then dropped it on every later tick.
    const TIED_AT = "2026-08-05T09:00:00.000Z";
    const tied = [
      recording("rec-tied-a", TIED_AT),
      recording("rec-tied-b", TIED_AT),
      recording("rec-later", "2026-08-05T10:00:00.000Z"),
    ];

    const store = fakeRepo();
    const pulled: string[] = [];

    // Strictly-before, matching the adapter after this fix. With `>=` here the second tick
    // lists nothing and the twin is stranded, which is the defect.
    const source = fakeSource({
      listRecordings: (request) =>
        Promise.resolve(
          listOk(
            tied.filter(
              (candidate) =>
                request.sinceAt === null ||
                candidate.startedAt === null ||
                candidate.startedAt.getTime() >= request.sinceAt.getTime(),
            ),
          ),
        ),
      pullEvents: (recordingId: string) => {
        pulled.push(recordingId);
        return Promise.resolve(eventsOk(eventsFor()));
      },
    });

    const { deps } = depsFor(store, {
      perProjectCap: 1,
      sourceFor: () => Promise.resolve({ ok: true, source }),
    });

    await runReplayNarrationTick(deps);
    expect(pulled).toHaveLength(1);

    const watermark = await store.repo.latestStartedAt(LANE.projectId);
    expect(watermark?.toISOString()).toBe(TIED_AT);

    await runReplayNarrationTick(deps);
    await runReplayNarrationTick(deps);

    expect(new Set(store.rows.map((row) => row.recordingId))).toEqual(
      new Set(tied.map((candidate) => candidate.recordingId)),
    );
  });

  test("should read the oldest recordings first, so the watermark never passes an unread one", async () => {
    const store = fakeRepo();
    const pulled: string[] = [];

    const { deps } = depsFor(store, {
      perProjectCap: 2,
      sourceFor: () => Promise.resolve({ ok: true, source: backlogSource(BACKLOG, pulled) }),
    });

    await runReplayNarrationTick(deps);

    expect(pulled).toEqual(["rec-old-2", "rec-old-1"]);

    const watermark = await store.repo.latestStartedAt(LANE.projectId);
    expect(watermark?.toISOString()).toBe("2026-08-05T10:00:00.000Z");
  });
});

describe("failure isolation", () => {
  test("one recording that cannot be persisted does not stop the others", async () => {
    const store = fakeRepo();
    let attempts = 0;

    const failing: RecordingSummariesRepo = {
      ...store.repo,
      persist: (input) => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error("write failed"));
        return store.repo.persist(input);
      },
    };

    const { deps } = depsFor(store, {
      summariesFor: () => failing,
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            listRecordings: () => Promise.resolve(listOk([recording("a"), recording("b")])),
          }),
        }),
    });

    const outcome = await runReplayNarrationTick(deps);

    expect(outcome.failed).toBe(1);
    expect(outcome.summarised).toBe(1);
  });

  test("a project with no readable source is logged and the tick still completes", async () => {
    const store = fakeRepo();
    const { deps, logs } = depsFor(store, {
      sourceFor: () => Promise.resolve({ ok: false, code: "no_connection" }),
    });

    const outcome = await runReplayNarrationTick(deps);

    expect(outcome.summarised).toBe(0);
    expect(store.rows).toHaveLength(0);
    expect(logs.join(" ")).toContain("no readable recording source");
  });

  test("a partial event pull is narrated from what arrived rather than dropped", async () => {
    const store = fakeRepo();
    const { deps, logs } = depsFor(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            pullEvents: () =>
              Promise.resolve({
                ok: false,
                failure: { code: "rate_limited", message: "slow down" },
                partialEvents: [...eventsFor()],
                resumeCursor: null,
                bytesReceived: 0,
                pagesFetched: 1,
                droppedMalformed: 0,
                eventsReceived: 2,
              }),
          }),
        }),
    });

    await runReplayNarrationTick(deps);

    expect(store.rows).toHaveLength(1);
    expect(logs.join(" ")).toContain("read only in part");
  });

  test("a recording with no readable events still yields a row rather than nothing", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({ pullEvents: () => Promise.resolve(eventsOk([])) }),
        }),
    });

    await runReplayNarrationTick(deps);

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.actionCount).toBe(0);
  });

  test("no lanes is a quiet, complete tick", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store, { lanes: { listDueLanes: () => Promise.resolve([]) } });

    const outcome = await runReplayNarrationTick(deps);

    expect(outcome).toEqual({ lanesRead: 0, summarised: 0, retried: 0, skipped: 0, failed: 0 });
  });
});

describe("what is persisted alongside the words", () => {
  test("the deterministic transcript is stored, so the row is useful without the model", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store, { narrator: null });

    await runReplayNarrationTick(deps);

    expect(store.rows[0]?.transcript).toContain("opened /pricing");
  });

  test("token usage is recorded for a model-written row", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store);

    await runReplayNarrationTick(deps);

    expect(store.rows[0]?.tokensIn).toBe(30);
    expect(store.rows[0]?.tokensOut).toBe(12);
  });
});

type PersistedActionShape = { readonly kind: string; readonly atMs: number };

type PersistedTranscriptShape = {
  readonly v: number;
  readonly actions: readonly PersistedActionShape[];
};

type TranscriptRow = PersistRecordingSummaryInput & {
  readonly provider?: string;
  readonly sessionKey?: string | null;
  readonly actions?: PersistedTranscriptShape | null;
  readonly actionsVersion?: number | null;
  readonly actionsOmitted?: number | null;
  readonly pullStop?: string | null;
  readonly pullReason?: string | null;
  readonly pullWatermarkAt?: Date | null;
};

function transcriptRows(store: ReturnType<typeof fakeRepo>): readonly TranscriptRow[] {
  return store.rows as readonly TranscriptRow[];
}

function manyEvents(clicks: number): readonly RrwebEvent[] {
  const events: RrwebEvent[] = [
    { type: 4, timestamp: 1_000, data: { href: "/pricing", width: 800, height: 600 } },
  ];

  for (let index = 0; index < clicks; index += 1) {
    events.push({
      type: 3,
      timestamp: 2_000 + index * 1_000,
      data: { source: 2, type: 2, id: 5 + index, x: 10, y: 10 },
    });
  }

  return events;
}

function partialPull(events: readonly RrwebEvent[]): ReplayEventsResult {
  return {
    ok: false,
    failure: { code: "rate_limited", message: "Your recording source asked us to slow down." },
    partialEvents: [...events],
    resumeCursor: null,
    bytesReceived: 0,
    pagesFetched: 1,
    droppedMalformed: 0,
    eventsReceived: events.length,
  };
}

function byteCappedPull(events: readonly RrwebEvent[]): ReplayEventsResult {
  return {
    ...eventsOk(events),
    stop: "byte_cap",
    resumeCursor: "63",
  } as unknown as ReplayEventsResult;
}

function sourceReturning(result: ReplayEventsResult): ReplaySource {
  return fakeSource({ pullEvents: () => Promise.resolve(result) });
}

const SECOND_LANE: ReplayLane = {
  organizationId: "org-1",
  organizationName: "Acme",
  projectId: "project-2",
};

describe("the structured transcript the tick persists", () => {
  test("should persist the session key derived from the source kind and recording id", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store);

    await runReplayNarrationTick(deps);

    expect(transcriptRows(store)[0]?.sessionKey).toBe("ph:rec-1");
    expect(transcriptRows(store)[0]?.provider).toBe("posthog");
  });

  test("should persist exactly the actions the narrator read", async () => {
    const store = fakeRepo();
    const events = manyEvents(200);
    const digest = compactTranscript(buildTranscript(events));

    expect(digest.actions.length + digest.omitted).toBeGreaterThan(NARRATION_MAX_ACTIONS);
    expect(digest.omitted).toBeGreaterThan(0);

    const { deps } = depsFor(store, {
      sourceFor: () => Promise.resolve({ ok: true, source: sourceReturning(eventsOk(events)) }),
    });

    await runReplayNarrationTick(deps);

    const row = transcriptRows(store)[0];
    expect(row?.actions?.actions).toHaveLength(digest.actions.length);
    expect(row?.actionsOmitted).toBe(digest.omitted);
    expect(row?.actionCount).toBe(digest.actions.length + digest.omitted);
  });

  test("should persist an integer atMs on every action", async () => {
    const store = fakeRepo();
    const { deps } = depsFor(store);

    await runReplayNarrationTick(deps);

    const actions = transcriptRows(store)[0]?.actions?.actions ?? [];
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(Number.isInteger(action.atMs)).toBe(true);
    }
  });

  test("should persist the watermark the listing ran with, and null on a full re-list", async () => {
    const watermark = new Date("2026-08-05T08:30:00.000Z");

    const withWatermark = fakeRepo();
    await runReplayNarrationTick(
      depsFor(withWatermark, {
        summariesFor: () => ({
          ...withWatermark.repo,
          latestStartedAt: () => Promise.resolve(watermark),
        }),
      }).deps,
    );

    const fullRelist = fakeRepo();
    await runReplayNarrationTick(depsFor(fullRelist).deps);

    expect(transcriptRows(withWatermark)[0]?.pullWatermarkAt?.toISOString()).toBe(
      watermark.toISOString(),
    );
    expect(transcriptRows(fullRelist)[0]?.pullWatermarkAt).toBeNull();
  });

  test("should ask the model once when the tick runs twice over one recording", async () => {
    const store = fakeRepo();
    let narrations = 0;

    const { deps } = depsFor(store, {
      narrator: {
        port: {
          narrate: () => {
            narrations += 1;
            return Promise.resolve(okNarration());
          },
        },
        resolvedModelId: MODEL_ID,
      },
    });

    await runReplayNarrationTick(deps);
    await runReplayNarrationTick(deps);

    expect(narrations).toBe(1);
    expect(store.rows).toHaveLength(1);
  });
});

describe("how a pull that stopped short reaches the row", () => {
  test("should record a failed pull on the row with a plain-English reason", async () => {
    const store = fakeRepo();
    const arrived = eventsFor();
    const digest = compactTranscript(buildTranscript(arrived));

    const { deps } = depsFor(store, {
      sourceFor: () =>
        Promise.resolve({ ok: true, source: sourceReturning(partialPull(arrived)) }),
    });

    await runReplayNarrationTick(deps);

    const row = transcriptRows(store)[0];
    expect(row?.pullStop).toBe("failed");
    expect(String(row?.pullReason).trim().length).toBeGreaterThan(20);
    expect(String(row?.pullReason).trim().endsWith(".")).toBe(true);
    expect(row?.actions?.actions).toHaveLength(digest.actions.length);
  });

  test("should record a byte-capped pull as a bounded partial, not a failure", async () => {
    const store = fakeRepo();
    const arrived = eventsFor();

    const { deps } = depsFor(store, {
      sourceFor: () =>
        Promise.resolve({ ok: true, source: sourceReturning(byteCappedPull(arrived)) }),
    });

    const outcome = await runReplayNarrationTick(deps);

    const row = transcriptRows(store)[0];
    expect(outcome.summarised).toBe(1);
    expect(outcome.failed).toBe(0);
    expect(row?.pullStop).toBe("byte_cap");
    expect(String(row?.pullReason).trim().endsWith(".")).toBe(true);
    expect((row?.actions?.actions ?? []).length).toBeGreaterThan(0);
  });

  test("should write no row and continue when the replay source rejects", async () => {
    const store = fakeRepo();

    const throwing = fakeSource({
      listRecordings: () => Promise.resolve(listOk([recording("rec-throws"), recording("rec-next")])),
      pullEvents: (recordingId: string) =>
        recordingId === "rec-throws"
          ? Promise.reject(new Error("the vendor closed the connection"))
          : Promise.resolve(eventsOk(eventsFor())),
    });

    const { deps, logs } = depsFor(store, {
      sourceFor: () => Promise.resolve({ ok: true, source: throwing }),
    });

    const outcome = await runReplayNarrationTick(deps);

    expect(store.rows.map((row) => row.recordingId)).toEqual(["rec-next"]);
    expect(outcome.failed).toBe(1);
    expect(outcome.summarised).toBe(1);
    expect(logs.join(" ")).toContain("rec-throws");
    expect(logs.join(" ")).toContain(LANE.projectId);
  });

  test("should not let one lane's failure stop another lane", async () => {
    const store = fakeRepo();

    const { deps } = depsFor(store, {
      lanes: { listDueLanes: () => Promise.resolve([LANE, SECOND_LANE]) },
      sourceFor: (_ctx, projectId) =>
        projectId === LANE.projectId
          ? Promise.reject(new Error("this lane's credential could not be read"))
          : Promise.resolve({ ok: true, source: fakeSource() }),
    });

    const outcome = await runReplayNarrationTick(deps);

    expect(outcome.summarised).toBe(1);
    expect(store.rows[0]?.projectId).toBe(SECOND_LANE.projectId);
  });

  test("should read a recording whose pull failed again on the next tick", async () => {
    const store = fakeRepo();
    let pulls = 0;
    let narrations = 0;

    const { deps } = depsFor(store, {
      narrator: {
        port: {
          narrate: () => {
            narrations += 1;
            return Promise.resolve(okNarration());
          },
        },
        resolvedModelId: MODEL_ID,
      },
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            pullEvents: () => {
              pulls += 1;
              return Promise.resolve(
                pulls === 1 ? partialPull(eventsFor()) : eventsOk(manyEvents(4)),
              );
            },
          }),
        }),
    });

    const first = await runReplayNarrationTick(deps);
    const second = await runReplayNarrationTick(deps);

    expect(first.summarised).toBe(1);
    expect(second.retried).toBe(1);
    expect(second.skipped).toBe(0);
    expect(pulls).toBe(2);
    expect(narrations).toBe(1);
    expect(store.rows).toHaveLength(1);
    expect(transcriptRows(store)[0]?.pullStop).toBe("exhausted");
    expect(String(transcriptRows(store)[0]?.headline)).toBe("Someone looked at pricing and left");
  });

  test("should never read a byte-capped recording again, because the bound is deliberate", async () => {
    const store = fakeRepo();
    let pulls = 0;

    const { deps } = depsFor(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            pullEvents: () => {
              pulls += 1;
              return Promise.resolve(byteCappedPull(eventsFor()));
            },
          }),
        }),
    });

    await runReplayNarrationTick(deps);
    const second = await runReplayNarrationTick(deps);

    expect(pulls).toBe(1);
    expect(second.retried).toBe(0);
    expect(second.skipped).toBe(1);
  });

  test("should keep offering a recording whose retry failed again, without narrating twice", async () => {
    const store = fakeRepo();
    let narrations = 0;

    const { deps } = depsFor(store, {
      narrator: {
        port: {
          narrate: () => {
            narrations += 1;
            return Promise.resolve(okNarration());
          },
        },
        resolvedModelId: MODEL_ID,
      },
      sourceFor: () =>
        Promise.resolve({ ok: true, source: sourceReturning(partialPull(eventsFor())) }),
    });

    await runReplayNarrationTick(deps);
    await runReplayNarrationTick(deps);
    const third = await runReplayNarrationTick(deps);

    expect(third.retried).toBe(1);
    expect(narrations).toBe(1);
    expect(store.rows).toHaveLength(1);
    expect(transcriptRows(store)[0]?.pullStop).toBe("failed");
  });

  test("should pass the row's stored resume cursor to the retried pull, not restart it", async () => {
    const store = fakeRepo();
    const seenResumeFrom: (string | null | undefined)[] = [];

    const { deps } = depsFor(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            pullEvents: (_recordingId, options) => {
              seenResumeFrom.push(options?.resumeFrom);
              return Promise.resolve({
                ...partialPull(eventsFor()),
                resumeCursor: seenResumeFrom.length === 1 ? "12" : null,
              });
            },
          }),
        }),
    });

    await runReplayNarrationTick(deps);
    await runReplayNarrationTick(deps);

    expect(seenResumeFrom).toEqual([undefined, "12"]);
  });

  test("should continue a held digest with the resumed pull's beats, not replace it", async () => {
    const store = fakeRepo();

    const { deps } = depsFor(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            pullEvents: () => Promise.resolve(partialPull(eventsFor())),
          }),
        }),
    });

    await runReplayNarrationTick(deps);

    const { deps: retryDeps } = depsFor(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            pullEvents: () => Promise.resolve(eventsOk(manyEvents(2))),
          }),
        }),
    });

    await runReplayNarrationTick(retryDeps);

    const kinds = transcriptRows(store)[0]?.actions?.actions.map((action) => action.kind);
    expect(kinds?.filter((kind) => kind === "page")).toHaveLength(2);
    expect(kinds?.filter((kind) => kind === "dead_click")).toHaveLength(3);
    expect(kinds?.at(0)).toBe("page");
    expect(kinds?.at(-1)).toBe("ended");
  });

  test("should keep a long recording's clock origin when a retry reads nothing at all", async () => {
    const store = fakeRepo();
    const rateLimitedEmpty: ReplayEventsResult = {
      ok: false,
      failure: { code: "rate_limited", message: "Your recording source asked us to slow down." },
      partialEvents: [],
      resumeCursor: null,
      bytesReceived: 0,
      pagesFetched: 0,
      droppedMalformed: 0,
      eventsReceived: 0,
    };
    const rateLimitedLong: ReplayEventsResult = {
      ok: false,
      failure: { code: "rate_limited", message: "Your recording source asked us to slow down." },
      partialEvents: [...manyEvents(150)],
      resumeCursor: "5",
      bytesReceived: 0,
      pagesFetched: 1,
      droppedMalformed: 0,
      eventsReceived: 150,
    };

    const { deps } = depsFor(store, {
      sourceFor: () =>
        Promise.resolve({ ok: true, source: sourceReturning(rateLimitedLong) }),
    });
    await runReplayNarrationTick(deps);

    const originalOrigin = transcriptRows(store)[0]?.pullOriginAt;
    expect(originalOrigin).not.toBeNull();
    // Over 120 actions is the point: compactTranscript keeps only 120, so the retry's
    // monotonic guard sees an equal action count and applies the update — the exact case
    // where the origin would otherwise be silently overwritten with null.
    expect(transcriptRows(store)[0]?.actions?.actions.length).toBe(120);

    const { deps: retryDeps } = depsFor(store, {
      sourceFor: () =>
        Promise.resolve({ ok: true, source: sourceReturning(rateLimitedEmpty) }),
    });
    await runReplayNarrationTick(retryDeps);

    expect(transcriptRows(store)[0]?.pullOriginAt).toEqual(originalOrigin);
  });

  test("should read a recording with no row at all before one waiting on a retry", async () => {
    const store = fakeRepo();
    const pulled: string[] = [];

    const listing = [recording("rec-stuck")];

    const { deps } = depsFor(store, {
      perProjectCap: 1,
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            listRecordings: () => Promise.resolve(listOk(listing)),
            pullEvents: (recordingId: string) => {
              pulled.push(recordingId);
              return Promise.resolve(
                recordingId === "rec-stuck"
                  ? partialPull(eventsFor())
                  : eventsOk(eventsFor()),
              );
            },
          }),
        }),
    });

    await runReplayNarrationTick(deps);
    listing.push(recording("rec-new"));
    const second = await runReplayNarrationTick(deps);

    expect(pulled).toEqual(["rec-stuck", "rec-new"]);
    expect(second.summarised).toBe(1);
    expect(second.retried).toBe(0);
  });

  test("should persist a transcript when the provider has no session-key mapping", async () => {
    const store = fakeRepo();

    const { deps } = depsFor(store, {
      sourceFor: () => Promise.resolve({ ok: true, source: fakeSource({ kind: "rrweb" }) }),
    });

    await runReplayNarrationTick(deps);

    const row = transcriptRows(store)[0];
    expect(row).toBeDefined();
    expect(row?.sessionKey).toBeNull();
    expect((row?.actions?.actions ?? []).length).toBeGreaterThan(0);
  });
});

describe("the tick carries a ceiling of its own, because the lane list carries none", () => {
  function twoLaneDeps(store: ReturnType<typeof fakeRepo>, perTickCap: number) {
    const pulled: string[] = [];

    const { deps, logs } = depsFor(store, {
      lanes: { listDueLanes: () => Promise.resolve([LANE, SECOND_LANE]) },
      perProjectCap: 3,
      perTickCap,
      sourceFor: (_ctx, projectId) =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            listRecordings: () =>
              Promise.resolve(
                listOk([
                  recording(`${projectId}-a`),
                  recording(`${projectId}-b`),
                  recording(`${projectId}-c`),
                ]),
              ),
            pullEvents: (recordingId: string) => {
              pulled.push(recordingId);
              return Promise.resolve(eventsOk(eventsFor()));
            },
          }),
        }),
    });

    return { deps, logs, pulled };
  }

  test("should bound the recordings a whole tick pulls, not only the ones one lane pulls", async () => {
    const store = fakeRepo();
    const { deps, pulled } = twoLaneDeps(store, 4);

    const outcome = await runReplayNarrationTick(deps);

    expect(pulled).toHaveLength(4);
    expect(outcome.summarised).toBe(4);
    expect(outcome.lanesRead).toBe(2);
  });

  test("should leave the lanes it could not reach for the next tick, and say so", async () => {
    const store = fakeRepo();
    const { deps, logs, pulled } = twoLaneDeps(store, 3);

    const outcome = await runReplayNarrationTick(deps);

    expect(pulled.every((recordingId) => recordingId.startsWith(LANE.projectId))).toBe(true);
    expect(outcome.lanesRead).toBe(1);
    expect(logs.join(" ")).toContain("reached its ceiling");
  });
});

// The stamp is a side effect on a running task (ADD D-13): D4 says it must survive a replay
// and a missing session row, D8 says its failure must not cost a narration.
describe("the session row is stamped with the recording's meta", () => {
  const METERED = recording("rec-1", "2026-08-05T09:00:00.000Z", LISTED_META);

  function meteredDeps(store: ReturnType<typeof fakeRepo>, overrides: Overrides = {}) {
    return depsFor(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({ listRecordings: () => Promise.resolve(listOk([METERED])) }),
        }),
      ...overrides,
    });
  }

  test("should stamp the session row and persist the recording summary in one pass", async () => {
    const store = fakeRepo();
    const { deps, sessions } = meteredDeps(store);

    const outcome = await runReplayNarrationTick(deps);

    expect(outcome.summarised).toBe(1);
    expect(store.rows).toHaveLength(1);
    expect(sessions.stamps).toEqual([
      { projectId: LANE.projectId, sessionKey: "ph:rec-1", meta: STAMPED_META },
    ]);
  });

  test("should carry the listed duration through as seconds, converting nothing", async () => {
    const store = fakeRepo();
    const { deps, sessions } = meteredDeps(store);

    await runReplayNarrationTick(deps);

    const stamped = sessions.stamps[0]?.meta.durationSeconds;
    expect(stamped).toBe(LISTED_META.recording_duration);
    expect(converted(LISTED_META.recording_duration)).not.toContain(stamped);
  });

  test("should carry the listed active seconds through as seconds, converting nothing", async () => {
    const store = fakeRepo();
    const { deps, sessions } = meteredDeps(store);

    await runReplayNarrationTick(deps);

    const stamped = sessions.stamps[0]?.meta.activeSeconds;
    expect(stamped).toBe(LISTED_META.active_seconds);
    expect(converted(LISTED_META.active_seconds)).not.toContain(stamped);
  });

  test("should stamp on a retry attempt as well as a first attempt", async () => {
    const store = fakeRepo();
    let pulls = 0;

    const { deps, sessions } = meteredDeps(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            listRecordings: () => Promise.resolve(listOk([METERED])),
            pullEvents: () => {
              pulls += 1;
              return Promise.resolve(
                pulls === 1 ? partialPull(eventsFor()) : eventsOk(manyEvents(4)),
              );
            },
          }),
        }),
    });

    const first = await runReplayNarrationTick(deps);
    const second = await runReplayNarrationTick(deps);

    expect(first.summarised).toBe(1);
    expect(second.retried).toBe(1);
    expect(sessions.stamps.map((stamp) => stamp.sessionKey)).toEqual(["ph:rec-1", "ph:rec-1"]);
    expect(sessions.stamps[1]?.meta).toEqual(STAMPED_META);
  });

  // The stamp is hoisted out of the narration path, so it survives a narration that never
  // reaches a persisted row — the recordings whose meta is most worth having.
  test("should stamp the session row for a recording whose narration throws", async () => {
    const store = fakeRepo();
    const { deps, sessions } = meteredDeps(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            listRecordings: () => Promise.resolve(listOk([METERED])),
            pullEvents: () => Promise.reject(new Error("the source hung up")),
          }),
        }),
    });

    const outcome = await runReplayNarrationTick(deps);

    expect(outcome.failed).toBe(1);
    expect(outcome.summarised).toBe(0);
    expect(store.rows).toHaveLength(0);
    expect(sessions.stamps).toEqual([
      { projectId: LANE.projectId, sessionKey: "ph:rec-1", meta: STAMPED_META },
    ]);
  });

  // The allowlist is per key: an omitted key is unmeasured on that column alone, and a zero
  // there would report a session nobody measured as one where nothing happened.
  test("should stamp active seconds as null when the listing omits it", async () => {
    const store = fakeRepo();
    const withoutActiveSeconds = Object.fromEntries(
      Object.entries(LISTED_META).filter(([key]) => key !== "active_seconds"),
    );

    const { deps, sessions } = meteredDeps(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            listRecordings: () =>
              Promise.resolve(listOk([recording("rec-1", undefined, withoutActiveSeconds)])),
          }),
        }),
    });

    await runReplayNarrationTick(deps);

    const stamped = sessions.stamps[0]?.meta;
    expect(stamped?.activeSeconds).toBeNull();
    expect(stamped?.durationSeconds).toBe(LISTED_META.recording_duration);
    expect(stamped?.clickCount).toBe(LISTED_META.click_count);
  });

  test("should stamp a fractional count as null, because the column is an integer", async () => {
    const store = fakeRepo();
    const fractional = { ...LISTED_META, active_seconds: 22.5, click_count: 7.5 };

    const { deps, sessions } = meteredDeps(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            listRecordings: () =>
              Promise.resolve(listOk([recording("rec-1", undefined, fractional)])),
          }),
        }),
    });

    await runReplayNarrationTick(deps);

    const stamped = sessions.stamps[0]?.meta;
    expect(stamped?.activeSeconds).toBeNull();
    expect(stamped?.clickCount).toBeNull();
    expect(stamped?.durationSeconds).toBe(LISTED_META.recording_duration);
  });

  test("should stamp a negative count as null, because no session had fewer than none", async () => {
    const store = fakeRepo();
    const negative = { ...LISTED_META, active_seconds: -1, console_error_count: -3 };

    const { deps, sessions } = meteredDeps(store, {
      sourceFor: () =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            listRecordings: () => Promise.resolve(listOk([recording("rec-1", undefined, negative)])),
          }),
        }),
    });

    await runReplayNarrationTick(deps);

    const stamped = sessions.stamps[0]?.meta;
    expect(stamped?.activeSeconds).toBeNull();
    expect(stamped?.consoleErrorCount).toBeNull();
    expect(stamped?.keypressCount).toBe(LISTED_META.keypress_count);
  });

  test("should say so when the stamp matched no session row", async () => {
    const store = fakeRepo();
    const unmatched = fakeSessions(() => null);

    const { deps, logs } = meteredDeps(store, { sessionsFor: () => unmatched.repo });

    const outcome = await runReplayNarrationTick(deps);

    expect(outcome.summarised).toBe(1);
    expect(unmatched.stamps).toHaveLength(1);
    expect(logs.join(" ")).toContain("no session row under ph:rec-1");
    expect(logs.join(" ")).toContain("rec-1");
  });

  test("should persist the recording summary and complete the lane when the meta stamp throws", async () => {
    const store = fakeRepo();
    let attempts = 0;
    const failing = fakeSessions(() => {
      attempts += 1;
      throw new Error("session row locked");
    });

    const { deps, logs } = meteredDeps(store, { sessionsFor: () => failing.repo });

    const outcome = await runReplayNarrationTick(deps);

    expect(attempts).toBe(1);
    expect(outcome.summarised).toBe(1);
    expect(outcome.failed).toBe(0);
    expect(store.rows).toHaveLength(1);
    expect(await store.repo.latestStartedAt(LANE.projectId)).toEqual(
      new Date("2026-08-05T09:00:00.000Z"),
    );
    expect(logs.join(" ")).toContain("rec-1");
    expect(logs.join(" ")).toContain(LANE.projectId);
  });

  test("should produce the same session row when the tick is replayed over the same recording", async () => {
    const store = fakeRepo();
    const { deps, sessions } = meteredDeps(store);

    await runReplayNarrationTick(deps);
    await runReplayNarrationTick(deps);

    expect([...sessions.rows.keys()]).toHaveLength(1);
    expect(sessions.rows.get(stampKey(LANE.projectId, "ph:rec-1"))).toEqual(STAMPED_META);
  });

  // Two lanes, two providers, one tick: a bare "nothing was stamped" would pass against a
  // tick that stamps nothing at all, so the mapped provider is the control.
  test("should never write meta for a recording whose provider yields no session key", async () => {
    const store = fakeRepo();
    const { deps, sessions } = depsFor(store, {
      lanes: { listDueLanes: () => Promise.resolve([LANE, SECOND_LANE]) },
      sourceFor: (_ctx, projectId) =>
        Promise.resolve({
          ok: true,
          source: fakeSource({
            kind: projectId === LANE.projectId ? "posthog" : "rrweb",
            listRecordings: () =>
              Promise.resolve(listOk([recording(`rec-${projectId}`, undefined, LISTED_META)])),
          }),
        }),
    });

    await runReplayNarrationTick(deps);

    expect(store.rows).toHaveLength(2);
    expect(sessions.stamps).toEqual([
      {
        projectId: LANE.projectId,
        sessionKey: `ph:rec-${LANE.projectId}`,
        meta: STAMPED_META,
      },
    ]);
  });
});
