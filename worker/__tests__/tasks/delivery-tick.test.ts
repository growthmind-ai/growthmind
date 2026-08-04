import { expect, test } from "bun:test";

import { measuredCount, type MeasuredCount } from "@growthmind/core";
import type {
  ClaimDeliveryInput,
  ClaimDeliveryResult,
  DeliveriesRepo,
  DeliveryRecord,
  MarkFailedInput,
  MarkPostedInput,
  SignatureHex,
} from "@growthmind/db";
import { signatureHex } from "@growthmind/db";
import type { DeliveryPoster, PostRequest, PostResult, TenantContext } from "@growthmind/shared";
import { GET_IT_FIXED_ACTION_ID, deliveryFailureSentence } from "@growthmind/shared";

import { crontab, taskList } from "../../src/index";
import { GRAPHILE_TASK_NAME_PATTERN, TASK } from "../../src/task-names";
import type {
  DeliverableFinding,
  DeliverMessageInput,
  DeliveryLane,
  DeliveryTickDeps,
  DeliveryTickSummary,
} from "../../src/tasks/delivery-tick";
import { runDeliveryTick, textPostedFor } from "../../src/tasks/delivery-tick";

const NOW = new Date("2026-07-31T09:00:00.000Z");
const ORG = "org-acme";
const PROJECT = "project-checkout";
const CHANNEL = "C0GROWTH";

function signatureFor(seed: string): SignatureHex {
  return signatureHex(seed.repeat(64).slice(0, 64));
}

const SIGNATURE = signatureFor("a1b2c3d4");
const OTHER_SIGNATURE = signatureFor("f9e8d7c6");

function sessions(numerator: number, kept: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: kept,
    unit: "sessions",
    timeframe: {
      start: new Date("2026-07-20T00:00:00.000Z"),
      end: new Date("2026-07-27T00:00:00.000Z"),
    },
    basis: { totalInWindow: kept, kept, setAside: [] },
  });
}

function messageInput(context = "Sessions reached the payment step and left without finishing."): DeliverMessageInput {
  return {
    decision: "deliver",
    surfacePath: "/checkout/payment",
    observations: [{ label: "left before finishing", count: sessions(3, 28) }],
    explanation: {
      source: "model_rendered",
      headline: "The payment step is losing sessions",
      context,
    },
  };
}

function finding(
  findingId: string,
  overrides: { context?: string; signature?: SignatureHex } = {},
): DeliverableFinding {
  return {
    findingId,
    confidenceBasis: "threshold_met",
    sampleSize: { numerator: 3, denominator: 28 },
    signature: overrides.signature ?? SIGNATURE,
    message: overrides.context === undefined ? messageInput() : messageInput(overrides.context),
  };
}

function lane(overrides: Partial<DeliveryLane> = {}): DeliveryLane {
  return {
    organizationId: ORG,
    organizationName: "Acme",
    projectId: PROJECT,
    channelId: CHANNEL,
    deliveredThisWeek: 0,
    candidates: [finding("finding-1")],
    ...overrides,
  };
}

interface FakeLedger {
  repoFor: (ctx: TenantContext) => DeliveriesRepo;
  rows: () => DeliveryRecord[];
  rowFor: (findingId: string) => DeliveryRecord | undefined;
   
  seed: (row: Partial<DeliveryRecord> & { findingId: string; status: DeliveryRecord["status"] }) => void;

  breakProject: (projectId: string) => void;

  failMarkPostedOnce: () => void;
}

function keyOf(organizationId: string, findingId: string, channelId: string): string {
  return `${organizationId}|${findingId}|${channelId}`;
}

function createFakeLedger(): FakeLedger {
  const stored = new Map<string, DeliveryRecord>();
  const broken = new Set<string>();
  let nextId = 1;
  let markPostedFailures = 0;

  function guard(projectId: string): void {
    if (broken.has(projectId)) {
      throw new Error(`the ledger is unavailable for project ${projectId}`);
    }
  }

  function newRow(ctx: TenantContext, input: ClaimDeliveryInput): DeliveryRecord {
    const row: DeliveryRecord = {
      id: `delivery-${String(nextId)}`,
      organizationId: ctx.organizationId,
      projectId: input.projectId,
      findingId: input.findingId,
      signature: input.signature,
      channelId: input.channelId,
      status: "pending",
      claimedAt: input.claimedAt,
      postedAt: null,
      failedAt: null,
      failureReason: null,
      messageRef: null,
      attempts: 1,
      createdAt: input.claimedAt,
    };
    nextId += 1;
    return row;
  }

  return {
    rows: () => [...stored.values()],
    rowFor: (findingId) => [...stored.values()].find((row) => row.findingId === findingId),
    breakProject: (projectId) => broken.add(projectId),
    failMarkPostedOnce: () => {
      markPostedFailures += 1;
    },
    seed: (row) => {
      const full: DeliveryRecord = {
        id: `delivery-seed-${row.findingId}`,
        organizationId: ORG,
        projectId: PROJECT,
        signature: OTHER_SIGNATURE,
        channelId: CHANNEL,
        claimedAt: NOW,
        postedAt: null,
        failedAt: null,
        failureReason: null,
        messageRef: null,
        attempts: 1,
        createdAt: NOW,
        ...row,
      };
      stored.set(keyOf(full.organizationId, full.findingId, full.channelId), full);
    },
    repoFor: (ctx) => ({
       
      claimForPost(input: ClaimDeliveryInput): Promise<ClaimDeliveryResult> {
        guard(input.projectId);
        const key = keyOf(ctx.organizationId, input.findingId, input.channelId);
        const existing = stored.get(key);

        if (!existing) {
          const row = newRow(ctx, input);
          stored.set(key, row);
          return Promise.resolve({ claimed: true, delivery: row });
        }

        if (existing.status !== "failed") {
          return Promise.resolve({ claimed: false, delivery: existing });
        }

        const reclaimed: DeliveryRecord = {
          ...existing,
          status: "pending",
          claimedAt: input.claimedAt,
          attempts: existing.attempts + 1,
          failedAt: null,
          failureReason: null,
        };
        stored.set(key, reclaimed);
        return Promise.resolve({ claimed: true, delivery: reclaimed });
      },

      markPosted(input: MarkPostedInput): Promise<DeliveryRecord | null> {
        if (markPostedFailures > 0) {
          markPostedFailures -= 1;
          throw new Error("the ledger refused the write that records the post");
        }

        const key = keyOf(ctx.organizationId, input.findingId, input.channelId);
        const existing = stored.get(key);
        if (!existing) return Promise.resolve(null);

        const posted: DeliveryRecord = {
          ...existing,
          status: "posted",
           
          postedAt: existing.postedAt ?? input.postedAt,
          messageRef: existing.messageRef ?? input.messageRef,
          failedAt: null,
          failureReason: null,
        };
        stored.set(key, posted);
        return Promise.resolve(posted);
      },

      markFailed(input: MarkFailedInput): Promise<DeliveryRecord | null> {
        const key = keyOf(ctx.organizationId, input.findingId, input.channelId);
        const existing = stored.get(key);
         
        if (!existing || existing.status === "posted") return Promise.resolve(null);

        const failed: DeliveryRecord = {
          ...existing,
          status: "failed",
          failedAt: input.failedAt,
          failureReason: input.reason,
        };
        stored.set(key, failed);
        return Promise.resolve(failed);
      },

      findFor(findingId: string, channelId: string): Promise<DeliveryRecord | null> {
        return Promise.resolve(stored.get(keyOf(ctx.organizationId, findingId, channelId)) ?? null);
      },

      findLatestForSignature(
        projectId: string,
        signature: SignatureHex,
      ): Promise<DeliveryRecord | null> {
        const match = [...stored.values()].find(
          (row) =>
            row.organizationId === ctx.organizationId &&
            row.projectId === projectId &&
            row.signature === signature,
        );
        return Promise.resolve(match ?? null);
      },

      listPendingForProject(projectId: string, staleClaimsBefore: Date): Promise<DeliveryRecord[]> {
        guard(projectId);
        return Promise.resolve(
          [...stored.values()].filter(
            (row) =>
              row.organizationId === ctx.organizationId &&
              row.projectId === projectId &&
              row.status === "pending" &&
              row.claimedAt.getTime() >= staleClaimsBefore.getTime(),
          ),
        );
      },
    }),
  };
}

interface FakePoster {
  poster: DeliveryPoster;
  posts: PostRequest[];
}

function createFakePoster(answer?: (request: PostRequest) => PostResult): FakePoster {
  const posts: PostRequest[] = [];
  return {
    posts,
    poster: {
      post(request: PostRequest): Promise<PostResult> {
        posts.push(request);
        const result = answer?.(request) ?? { ok: true as const, messageRef: "1753952400.000100" };
        return Promise.resolve(result);
      },
    },
  };
}

interface RecordingLogger {
  info: string[];
  error: string[];
  all: () => string[];
}

function createRecordingLogger(): RecordingLogger & { logger: DeliveryTickDeps["logger"] } {
  const info: string[] = [];
  const error: string[] = [];
  return {
    info,
    error,
    all: () => [...info, ...error],
    logger: {
      info: (message: string) => info.push(message),
      error: (message: string) => error.push(message),
    },
  };
}

interface Harness {
  run: () => Promise<DeliveryTickSummary>;
  ledger: FakeLedger;
  posted: PostRequest[];
  logs: RecordingLogger;
   
  resolved: TenantContext[];
}

function harness(input: {
  lanes: readonly DeliveryLane[];
  ledger?: FakeLedger;
  answer?: (request: PostRequest) => PostResult;
   
  connectedOrgIds?: readonly string[];
}): Harness {
  const ledger = input.ledger ?? createFakeLedger();
  const poster = createFakePoster(input.answer);
  const logs = createRecordingLogger();
  const resolved: TenantContext[] = [];

  const deps: DeliveryTickDeps = {
    lanes: { listDueLanes: () => Promise.resolve(input.lanes) },
    deliveriesFor: ledger.repoFor,
     
    posterFor: (ctx: TenantContext) => {
      resolved.push(ctx);
      if (input.connectedOrgIds !== undefined && !input.connectedOrgIds.includes(ctx.organizationId)) {
        return Promise.resolve(null);
      }
      return Promise.resolve(poster.poster);
    },
    now: () => NOW,
    logger: logs.logger,
  };

  return { run: () => runDeliveryTick(deps), ledger, posted: poster.posts, logs, resolved };
}

test("a deliverable finding with clean text is claimed, posted, and recorded posted exactly once", async () => {
  const scene = harness({ lanes: [lane()] });

  const summary = await scene.run();

  expect(summary.posted).toBe(1);
  expect(summary.failed).toBe(0);
  expect(scene.posted.length).toBe(1);
  expect(scene.posted[0]?.channelId).toBe(CHANNEL);

  const row = scene.ledger.rowFor("finding-1");
  expect(row?.status).toBe("posted");
  expect(row?.messageRef).toBe("1753952400.000100");
  expect(row?.attempts).toBe(1);
  expect(row?.failureReason).toBeNull();
});

// `PostRequest.blocks` is `readonly unknown[]`, so the intermediate model reaching Slack
// verbatim typechecks. Only an assertion on the posted shape can see it.
test("carries the delivered blocks through the Block Kit converter", async () => {
  const scene = harness({ lanes: [lane()] });

  await scene.run();

  expect(scene.posted).toHaveLength(1);

  const blocks = scene.posted[0]?.blocks ?? [];
  expect(blocks.length).toBeGreaterThan(0);

  for (const block of blocks) {
    const type = (block as { type?: unknown }).type;
    expect({ block, typeOfType: typeof type }).toEqual({ block, typeOfType: "string" });
    expect(block).not.toHaveProperty("kind");
  }

  const actions = blocks.find((block) => (block as { type?: unknown }).type === "actions") as
    | { readonly block_id?: unknown; readonly elements?: readonly { action_id?: unknown }[] }
    | undefined;

  expect(actions).toBeDefined();
  expect((actions?.elements ?? []).map((element) => element.action_id)).toContain(
    GET_IT_FIXED_ACTION_ID,
  );
});

test("a second tick over an already-posted finding posts nothing and leaves the row untouched", async () => {
   
  const scene = harness({ lanes: [lane()] });

  await scene.run();
  const summary = await scene.run();

  expect(scene.posted.length).toBe(1);
  expect(summary.posted).toBe(0);
  expect(summary.notClaimed).toBe(1);
  expect(scene.ledger.rowFor("finding-1")?.status).toBe("posted");
});

test("a post another worker already owns is never attempted", async () => {
  const ledger = createFakeLedger();
   
  ledger.seed({ findingId: "finding-1", status: "pending", signature: SIGNATURE });

  const scene = harness({
    lanes: [lane({ candidates: [finding("finding-1")] })],
    ledger,
  });

  const summary = await scene.run();

  expect(scene.posted.length).toBe(0);
  expect(summary.notClaimed + summary.nothingToday).toBe(1);
  expect(summary.posted).toBe(0);
   
  expect(ledger.rowFor("finding-1")?.status).toBe("pending");
  expect(ledger.rowFor("finding-1")?.attempts).toBe(1);
});

test("a finding still pending for the project withholds a different finding from the same lane", async () => {
   
  const ledger = createFakeLedger();
  ledger.seed({ findingId: "finding-open", status: "pending" });

  const scene = harness({
    lanes: [lane({ candidates: [finding("finding-2")] })],
    ledger,
  });

  const summary = await scene.run();

  expect(summary.nothingToday).toBe(1);
  expect(scene.posted.length).toBe(0);
  expect(ledger.rowFor("finding-2")).toBeUndefined();
  expect(scene.logs.info.some((line) => line.includes("one_already_open"))).toBe(true);
});

test("a poster that refuses records the delivery failed and leaves the finding deliverable", async () => {
  const scene = harness({
    lanes: [lane()],
    answer: () => ({
      ok: false,
      code: "channel_unavailable",
      message: "We could not find that Slack channel. Pick another one and we will try again.",
    }),
  });

  const summary = await scene.run();

  expect(summary.failed).toBe(1);
  expect(summary.posted).toBe(0);

  const row = scene.ledger.rowFor("finding-1");
  expect(row?.status).toBe("failed");
  expect(row?.postedAt).toBeNull();

  // The shipped sentence for the code, not the fake's own text: the fake's message is
  // a distinctive string that must never reach the customer-facing column.
  expect(row?.failureReason).toBe(deliveryFailureSentence("channel_unavailable"));
  expect(row?.failureReason).not.toContain("Pick another one");

  // "Leaves the finding deliverable" is a claim about the next tick, so take one.
  const second = await scene.run();
  expect(second.posted + second.failed).toBe(1);
  expect(scene.ledger.rowFor("finding-1")?.attempts).toBe(2);
});

test("a poster that throws still reaches a terminal failed state and never escapes the tick", async () => {
  const scene = harness({
    lanes: [lane()],
    answer: () => {
      throw new Error("socket hang up: slack.com/api/chat.postMessage team=T0123");
    },
  });

  const summary = await scene.run();

  expect(summary.failed).toBe(1);
  const row = scene.ledger.rowFor("finding-1");
  expect(row?.status).toBe("failed");
   
  expect(row?.status).not.toBe("pending");
   
  expect(row?.failureReason).not.toContain("slack.com");
  expect(row?.failureReason).not.toContain("T0123");
  expect(scene.logs.error.some((line) => line.includes("socket hang up"))).toBe(true);
});

// The message is live in the channel with a button on it, and a `pending` row carries no
// message reference: the interactivity route resolves nothing, and the lane source counts the
// finding as spoken for forever, so the press is silently dead and the finding never returns.
test("a post the ledger cannot record leaves no delivery pending and the finding still reaches the channel", async () => {
  const ledger = createFakeLedger();
  ledger.failMarkPostedOnce();

  const scene = harness({ lanes: [lane()], ledger });

  const summary = await scene.run();

  expect(scene.posted.length).toBe(1);
  expect(summary.failed).toBe(1);
  expect(summary.posted).toBe(0);

  const row = ledger.rowFor("finding-1");
  expect(row?.status).not.toBe("pending");
  expect(row?.status).toBe("failed");

  expect(row?.messageRef).toBeNull();
  expect(
    scene.logs.error.some((line) => line.includes("could not be recorded as posted")),
  ).toBe(true);

  // "Still reaches the channel" is a claim about the next tick, so take one: the row is
  // re-claimable, and the message it posts carries a reference a press can resolve.
  const second = await scene.run();
  expect(second.posted).toBe(1);
  expect(scene.posted.length).toBe(2);

  const recovered = ledger.rowFor("finding-1");
  expect(recovered?.status).toBe("posted");
  expect(recovered?.messageRef).toBe("1753952400.000100");
  expect(recovered?.attempts).toBe(2);
});

test("no lane can leave a delivery stuck pending, whatever the poster does", async () => {
   
  const answers: (() => PostResult)[] = [
    () => ({ ok: false, code: "call_failed", message: "We could not reach Slack just now." }),
    () => ({ ok: false, code: "not_authorised", message: "Slack refused our access." }),
    () => ({ ok: false, code: "rejected", message: "Slack would not accept that message." }),
    () => {
      throw new Error("unexpected");
    },
  ];

  for (const answer of answers) {
    const scene = harness({ lanes: [lane()], answer });
    await scene.run();
    for (const row of scene.ledger.rows()) {
      expect(row.status).not.toBe("pending");
    }
  }
});

test("generated text carrying personal data is never posted and the recorded reason quotes none of it", async () => {
   
  const leak = "One session emailed hannah.reed@northwind-shop.example.com from the payment step.";
  const scene = harness({
    lanes: [lane({ candidates: [finding("finding-1", { context: leak })] })],
  });

  const summary = await scene.run();

  expect(scene.posted.length).toBe(0);
  expect(summary.blockedByPii).toBe(1);
  expect(summary.failed).toBe(1);

  const row = scene.ledger.rowFor("finding-1");
  expect(row?.status).toBe("failed");
  expect(row?.failureReason).toContain("email address");
   
  expect(row?.failureReason).not.toContain("hannah");
  expect(row?.failureReason).not.toContain("northwind-shop.example.com");
  expect(row?.failureReason).not.toContain("@");
  for (const line of scene.logs.all()) {
    expect(line).not.toContain("hannah");
    expect(line).not.toContain("northwind-shop.example.com");
  }
});

function stringsAt(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  const nested = (value as { readonly text?: unknown }).text;
  return typeof nested === "string" ? [nested] : [];
}

// Block Kit spreads one message's text across three positions: a section's at `text.text`, a
// context's at `elements[].text`, a button's label at `elements[].text.text`. All of it, plus
// the ids Growthmind mints into `block_id` and a button's `value`, is bytes on the wire.
function deliveredStringsIn(block: unknown): readonly string[] {
  const shape = block as {
    readonly block_id?: unknown;
    readonly text?: unknown;
    readonly elements?: readonly unknown[];
  };

  const found: string[] = [...stringsAt(shape.block_id), ...stringsAt(shape.text)];

  for (const element of shape.elements ?? []) {
    const part = element as { readonly text?: unknown; readonly value?: unknown };
    found.push(...stringsAt(part.text), ...stringsAt(part.value));
  }

  return found;
}

test("the residual gate scans the exact text the poster is handed", async () => {
   
  const scene = harness({ lanes: [lane()] });
  await scene.run();

  const request = scene.posted[0];
  expect(request).toBeDefined();

  const scanned = textPostedFor(request as PostRequest);
  expect(scanned.text).not.toBeNull();
  expect(scanned.text).toContain((request as PostRequest).fallbackText);

  const blocks = (request as PostRequest).blocks;
  expect(blocks.length).toBeGreaterThan(0);

  for (const block of blocks) {
    const strings = deliveredStringsIn(block);

    // A block the reader cannot see into is the failure this test exists to catch: it would
    // otherwise pass with nothing asserted while unscanned text went to Slack.
    expect({ block, readable: strings.length > 0 }).toEqual({ block, readable: true });

    for (const text of strings) {
      expect(scanned.text).toContain(JSON.stringify(text).slice(1, -1));
    }
  }
});

test("a message the residual gate cannot read is refused rather than cleared", async () => {

  const circular: { text: string; self?: unknown } = { text: "hello" };
  circular.self = circular;

  const scanned = textPostedFor({ channelId: CHANNEL, blocks: [circular], fallbackText: "hello" });

  expect(scanned.text).toBeNull();

  // The cause travels with the refusal: a serialisation bug and a real PII block
  // both end as blocked_by_pii, so the log line is the only thing telling them apart.
  // Not pinned to the engine's wording — runtimes phrase a cyclic-structure throw
  // differently — only to the cause being carried rather than discarded.
  expect(scanned.cause).not.toBeNull();
  expect((scanned.cause ?? "").length).toBeGreaterThan(0);
});

test("nothing_today is logged with its reason, posts nothing, and writes no delivery row", async () => {
  const scene = harness({ lanes: [lane({ candidates: [] })] });

  const summary = await scene.run();

  expect(summary.nothingToday).toBe(1);
  expect(scene.posted.length).toBe(0);
   
  expect(scene.ledger.rows()).toEqual([]);
  expect(scene.logs.info.some((line) => line.includes("no_findings_ready"))).toBe(true);
});

test("a lane that decides nothing_today on every tick still never posts", async () => {
   
  const scene = harness({ lanes: [lane({ candidates: [] })] });

  await scene.run();
  await scene.run();
  await scene.run();

  expect(scene.posted.length).toBe(0);
  expect(scene.ledger.rows()).toEqual([]);
});

test("a spent weekly budget withholds delivery without touching the ledger", async () => {
  const scene = harness({ lanes: [lane({ deliveredThisWeek: 3 })] });

  const summary = await scene.run();

  expect(summary.nothingToday).toBe(1);
  expect(scene.posted.length).toBe(0);
  expect(scene.ledger.rows()).toEqual([]);
  expect(scene.logs.info.some((line) => line.includes("budget_spent"))).toBe(true);
});

test("one project failing does not stop a sibling project from delivering", async () => {
  const ledger = createFakeLedger();
  ledger.breakProject("project-broken");

  const scene = harness({
    lanes: [
      lane({ projectId: "project-broken", candidates: [finding("finding-broken")] }),
      lane({ projectId: PROJECT, candidates: [finding("finding-healthy")] }),
    ],
    ledger,
  });

  const summary = await scene.run();

  expect(summary.lanesErrored).toBe(1);
  expect(summary.posted).toBe(1);
  expect(scene.posted.length).toBe(1);
  expect(ledger.rowFor("finding-healthy")?.status).toBe("posted");
  expect(scene.logs.error.some((line) => line.includes("project-broken"))).toBe(true);
});

test("a tick with no due lanes is a clean no-op", async () => {
  const scene = harness({ lanes: [] });

  const summary = await scene.run();

  expect(summary).toEqual({
    lanesConsidered: 0,
    posted: 0,
    failed: 0,
    blockedByPii: 0,
    nothingToday: 0,
    notClaimed: 0,
    notConnected: 0,
    lanesErrored: 0,
  });
  expect(scene.posted.length).toBe(0);
  expect(scene.ledger.rows()).toEqual([]);
   
  expect(scene.resolved).toEqual([]);
});

test("the poster is resolved from the lane's tenant context and never from the message", async () => {
   
  const scene = harness({ lanes: [lane()] });

  await scene.run();

  expect(scene.resolved).toHaveLength(1);

  const ctx = scene.resolved[0] as TenantContext;
  expect(ctx.organizationId).toBe(ORG);
   
  expect(JSON.stringify(ctx)).not.toContain("channelId");
  expect(JSON.stringify(ctx)).not.toContain(CHANNEL);
});

test("a lane whose poster resolves null is skipped before anything is claimed, not failed", async () => {
   
  const scene = harness({
    lanes: [lane({ candidates: [finding("finding-1")] })],
    connectedOrgIds: [],
  });

  const summary = await scene.run();

  expect(summary.notConnected).toBe(1);
  expect(summary.lanesErrored).toBe(0);
  expect(summary.failed).toBe(0);
  expect(summary.posted).toBe(0);
  expect(scene.posted.length).toBe(0);

  expect(scene.ledger.rows()).toEqual([]);

  expect(scene.logs.all().some((line) => line.includes(ORG))).toBe(true);
});

test("one organization with no channel does not cost a sibling organization its delivery", async () => {
   
  const scene = harness({
    lanes: [
      lane({
        organizationId: "org-gone",
        projectId: "project-gone",
        candidates: [finding("finding-gone")],
      }),
      lane({ candidates: [finding("finding-live")] }),
    ],
    connectedOrgIds: [ORG],
  });

  const summary = await scene.run();

  expect(summary.lanesConsidered).toBe(2);
  expect(summary.notConnected).toBe(1);
  expect(summary.posted).toBe(1);
  expect(summary.lanesErrored).toBe(0);
  expect(summary.failed).toBe(0);

  expect(scene.resolved.map((ctx) => ctx.organizationId)).toEqual(["org-gone", ORG]);
  expect(scene.ledger.rowFor("finding-gone")).toBeUndefined();
  expect(scene.ledger.rowFor("finding-live")?.status).toBe("posted");
});

test("the delivery tick is registered under its TASK constant and scheduled exactly once", () => {
  expect(taskList[TASK.DELIVERY_TICK]).toBeDefined();

  const scheduled = crontab
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim().split(/\s+/)[5]);

  expect(scheduled.filter((name) => name === TASK.DELIVERY_TICK).length).toBe(1);
});

test("the delivery task name parses as a Graphile Worker crontab identifier", () => {
   
  expect(GRAPHILE_TASK_NAME_PATTERN.test(TASK.DELIVERY_TICK)).toBe(true);
  expect(TASK.DELIVERY_TICK).not.toContain(".");
});
