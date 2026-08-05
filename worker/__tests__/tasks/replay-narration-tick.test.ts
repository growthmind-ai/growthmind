import { describe, expect, test } from "bun:test";

import type { ReplaySource } from "@growthmind/adapters";
import type {
  PersistRecordingSummaryInput,
  RecordingSummariesRepo,
  RecordingSummaryRecord,
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

function recording(id: string, startedAt = "2026-08-05T09:00:00.000Z"): ReplayRecordingSummary {
  return {
    recordingId: id,
    startedAt: new Date(startedAt),
    lastActivityAt: new Date(startedAt),
    meta: {},
  };
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

function fakeRepo() {
  const rows: PersistRecordingSummaryInput[] = [];

  const repo: RecordingSummariesRepo = {
    persist: (input) => {
      rows.push(input);
      return Promise.resolve({ id: `row-${String(rows.length)}` } as RecordingSummaryRecord);
    },
    findFor: () => Promise.resolve(null),
    summarisedIds: (_projectId, ids) =>
      Promise.resolve(new Set(ids.filter((id) => rows.some((row) => row.recordingId === id)))),
    latestStartedAt: () => Promise.resolve(null),
  };

  return { repo, rows };
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

  const deps: ReplayNarrationDeps = {
    lanes: { listDueLanes: () => Promise.resolve([LANE]) },
    sourceFor: () => Promise.resolve({ ok: true, source: fakeSource() }),
    summariesFor: () => rows.repo,
    contextFor: () => CTX,
    narrator: { port: { narrate: () => Promise.resolve(narrate()) }, resolvedModelId: MODEL_ID },
    perProjectCap: 10,
    listPages: 1,
    logger: {
      info: (message: string) => logs.push(message),
      error: (message: string) => logs.push(message),
      warn: (message: string) => logs.push(message),
    } as unknown as ReplayNarrationDeps["logger"],
    ...overrides,
  };

  return { deps, logs };
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

  test("the per-project cap bounds one tick and the rest are logged, not lost", async () => {
    const store = fakeRepo();
    const many = [recording("a"), recording("b"), recording("c")];

    const { deps, logs } = depsFor(store, {
      perProjectCap: 2,
      sourceFor: () =>
        Promise.resolve({ ok: true, source: fakeSource({ listRecordings: () => Promise.resolve(listOk(many)) }) }),
    });

    const outcome = await runReplayNarrationTick(deps);

    expect(outcome.summarised).toBe(2);
    expect(logs.join(" ")).toContain("the rest follow next tick");
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

    expect(outcome).toEqual({ lanesRead: 0, summarised: 0, skipped: 0, failed: 0 });
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
