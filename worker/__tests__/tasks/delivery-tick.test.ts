// The delivery lane's composition root, driven end to end.
//
// Every test calls `runDeliveryTick`. The real handler, the same plain function
// `taskList` invokes. Against fakes that hold real state: the ledger fake stores rows
// and answers the next claim from them, so "claim, post, then tick again" is a real
// sequence rather than a script of expected calls. A mock asserting `markPosted` was
// called would pass just as happily against a handler that never wrote anything a
// second tick could read.
//
// The ledger fake is typed as `DeliveriesRepo`. The shipped interface, not a
// hand-written look-alike, so it cannot drift into agreeing with a repository that no
// longer exists. The real SQL behind that interface is proven against a real database
// in `packages/db/__tests__/repositories/deliveries.repo.test.ts`; what this suite owns
// is the order the handler calls it in.
//
// No test here sleeps, opens a socket, or reads the wall clock.
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

/** A real 64-char lowercase hex digest, built through the real constructor. The branded
 * type has no other producer. */
function signatureFor(seed: string): SignatureHex {
  return signatureHex(seed.repeat(64).slice(0, 64));
}

const SIGNATURE = signatureFor("a1b2c3d4");
const OTHER_SIGNATURE = signatureFor("f9e8d7c6");

/** A count built by the one constructor. The brand cannot be faked, and the renderer
 * refuses anything that is not one. */
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

/** The renderer's deliver arm. `context` is the model-written prose. The one place in a
 * rendered message that could carry text nobody vetted, which is exactly what the
 * residual gate exists for. */
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

// Fakes with real state

interface FakeLedger {
  repoFor: (ctx: TenantContext) => DeliveriesRepo;
  rows: () => DeliveryRecord[];
  rowFor: (findingId: string) => DeliveryRecord | undefined;
  /** Seeds a row exactly as a previous tick would have left it. */
  seed: (row: Partial<DeliveryRecord> & { findingId: string; status: DeliveryRecord["status"] }) => void;
  /** Makes every read/write for one project throw. A repository fault, the class of
   * failure the per-lane isolation exists for. */
  breakProject: (projectId: string) => void;
}

/** The real table's unique tuple, in memory: `(organization_id, finding_id,
 * channel_id)`. Keying the fake on anything narrower would make it agree with a
 * double-post the real index refuses. */
function keyOf(organizationId: string, findingId: string, channelId: string): string {
  return `${organizationId}|${findingId}|${channelId}`;
}

function createFakeLedger(): FakeLedger {
  const stored = new Map<string, DeliveryRecord>();
  const broken = new Set<string>();
  let nextId = 1;

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
      // The atomic claim, with the real repository's rule: a row that exists is only
      // re-claimable when it is `failed`.
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
        const key = keyOf(ctx.organizationId, input.findingId, input.channelId);
        const existing = stored.get(key);
        if (!existing) return Promise.resolve(null);

        const posted: DeliveryRecord = {
          ...existing,
          status: "posted",
          // `coalesce` semantics, a replay never moves the first-post instant.
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
        // The real repository's `status <> 'posted'` guard: a late failure signal must
        // never rewrite a posted row into a re-claimable one.
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

      listPendingForProject(projectId: string): Promise<DeliveryRecord[]> {
        guard(projectId);
        return Promise.resolve(
          [...stored.values()].filter(
            (row) =>
              row.organizationId === ctx.organizationId &&
              row.projectId === projectId &&
              row.status === "pending",
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

/** The port, faked. Default behaviour is the happy one; a test that cares passes its
 * own answer, including one that throws, which the port forbids and the handler must
 * survive anyway. */
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
}

function harness(input: {
  lanes: readonly DeliveryLane[];
  ledger?: FakeLedger;
  answer?: (request: PostRequest) => PostResult;
}): Harness {
  const ledger = input.ledger ?? createFakeLedger();
  const poster = createFakePoster(input.answer);
  const logs = createRecordingLogger();

  const deps: DeliveryTickDeps = {
    lanes: { listDueLanes: () => Promise.resolve(input.lanes) },
    deliveriesFor: ledger.repoFor,
    poster: poster.poster,
    now: () => NOW,
    logger: logs.logger,
  };

  return { run: () => runDeliveryTick(deps), ledger, posted: poster.posts, logs };
}

// The happy path

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

test("a second tick over an already-posted finding posts nothing and leaves the row untouched", async () => {
  // The guarantee across two real ticks: the first tick's persisted row is what stops
  // the second, not an in-memory flag.
  const scene = harness({ lanes: [lane()] });

  await scene.run();
  const summary = await scene.run();

  expect(scene.posted.length).toBe(1);
  expect(summary.posted).toBe(0);
  expect(summary.notClaimed).toBe(1);
  expect(scene.ledger.rowFor("finding-1")?.status).toBe("posted");
});

// The claim

test("a post another worker already owns is never attempted", async () => {
  const ledger = createFakeLedger();
  // Exactly what an overlapping tick leaves behind: someone is mid-post.
  ledger.seed({ findingId: "finding-1", status: "pending", signature: SIGNATURE });

  // The lane must still reach the claim to be a real test of it, so the open finding IS
  // the one being delivered. The scheduler has nothing to withhold, and the claim is
  // the only thing that can refuse.
  const scene = harness({
    lanes: [lane({ candidates: [finding("finding-1")] })],
    ledger,
  });

  const summary = await scene.run();

  expect(scene.posted.length).toBe(0);
  expect(summary.notClaimed + summary.nothingToday).toBe(1);
  expect(summary.posted).toBe(0);
  // Nothing about the other worker's row was rewritten by ours.
  expect(ledger.rowFor("finding-1")?.status).toBe("pending");
  expect(ledger.rowFor("finding-1")?.attempts).toBe(1);
});

test("a finding still pending for the project withholds a different finding from the same lane", async () => {
  // The wire from `listPendingForProject` into `decideDelivery`'s `openFindingIds`. A
  // value the handler must read rather than be told.
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

// Failure paths, every one of them terminal

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
  expect(row?.failureReason).toContain("Slack channel");
  expect(row?.postedAt).toBeNull();

  // "Leaves the finding deliverable" is a claim about the next tick, so it is asserted
  // by taking one: a failed row is re-claimable.
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
  // A row left `pending` is what jams the lane forever. The one state this path must
  // never produce.
  expect(row?.status).not.toBe("pending");
  // The thrown error's own text never reaches the customer-facing column: it can carry
  // vendor detail, ids and stack text. It goes to the log instead.
  expect(row?.failureReason).not.toContain("slack.com");
  expect(row?.failureReason).not.toContain("T0123");
  expect(scene.logs.error.some((line) => line.includes("socket hang up"))).toBe(true);
});

test("no lane can leave a delivery stuck pending, whatever the poster does", async () => {
  // The invariant stated as one assertion over every failure shape at once.
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

// The residual PII gate

test("generated text carrying personal data is never posted and the recorded reason quotes none of it", async () => {
  // No cohort noun anywhere in this sentence, deliberately: the renderer drops model
  // prose that calls sessions people, and prose it drops is prose the residual gate
  // never gets to refuse. This fixture reaches the gate.
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
  // Never an echo: not the address, not the local part, not the domain, not the
  // sentence it sat in. Recording the match would copy the personal data into the very
  // place we refused to send it.
  expect(row?.failureReason).not.toContain("hannah");
  expect(row?.failureReason).not.toContain("northwind-shop.example.com");
  expect(row?.failureReason).not.toContain("@");
  for (const line of scene.logs.all()) {
    expect(line).not.toContain("hannah");
    expect(line).not.toContain("northwind-shop.example.com");
  }
});

test("the residual gate scans the exact text the poster is handed", async () => {
  // The proof: a gate that clears one string while a different string is posted is a
  // gate that does nothing. `textPostedFor` is the one derivation, and it is derived
  // from the request object itself.
  const scene = harness({ lanes: [lane()] });
  await scene.run();

  const request = scene.posted[0];
  expect(request).toBeDefined();

  const scanned = textPostedFor(request as PostRequest);
  expect(scanned).not.toBeNull();
  expect(scanned).toContain((request as PostRequest).fallbackText);
  // Every block's prose is inside the scanned string. A block the gate cannot see is
  // prose that reaches Slack uncleared.
  for (const block of (request as PostRequest).blocks) {
    const text = (block as { text: string }).text;
    expect(scanned).toContain(JSON.stringify(text).slice(1, -1));
  }
});

test("a message the residual gate cannot read is refused rather than cleared", async () => {
  // Fail direction, made explicit: `null` means "cannot be cleared", never "clean". A
  // block graph JSON cannot represent is the realistic shape.
  const circular: { text: string; self?: unknown } = { text: "hello" };
  circular.self = circular;

  expect(
    textPostedFor({ channelId: CHANNEL, blocks: [circular], fallbackText: "hello" }),
  ).toBeNull();
});

// Nothing today

test("nothing_today is logged with its reason, posts nothing, and writes no delivery row", async () => {
  const scene = harness({ lanes: [lane({ candidates: [] })] });

  const summary = await scene.run();

  expect(summary.nothingToday).toBe(1);
  expect(scene.posted.length).toBe(0);
  // The `deliveries` table has no row shape for a nothing-today (no `finding_id`) so
  // there must be nothing here at all.
  expect(scene.ledger.rows()).toEqual([]);
  expect(scene.logs.info.some((line) => line.includes("no_findings_ready"))).toBe(true);
});

test("a lane that decides nothing_today on every tick still never posts", async () => {
  // What stops a nothing-today being sent repeatedly is that it is never sent at all.
  // There is no persisted key on which "did we already say this?" could be asked (see
  // the handler's header, TODO).
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

// Isolation

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
    lanesErrored: 0,
  });
  expect(scene.posted.length).toBe(0);
  expect(scene.ledger.rows()).toEqual([]);
});

// Wiring

test("the delivery tick is registered under its TASK constant and scheduled exactly once", () => {
  expect(taskList[TASK.DELIVERY_TICK]).toBeDefined();

  const scheduled = crontab
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim().split(/\s+/)[5]);

  expect(scheduled.filter((name) => name === TASK.DELIVERY_TICK).length).toBe(1);
});

test("the delivery task name parses as a Graphile Worker crontab identifier", () => {
  // The separator must be a colon. A dot passes every unit test and then crashes the
  // worker on boot with "Invalid command specification in line N of crontab". A failure
  // only a running container ever sees.
  expect(GRAPHILE_TASK_NAME_PATTERN.test(TASK.DELIVERY_TICK)).toBe(true);
  expect(TASK.DELIVERY_TICK).not.toContain(".");
});
