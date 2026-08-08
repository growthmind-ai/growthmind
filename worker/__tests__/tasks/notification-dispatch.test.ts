// The dispatch task, faked at exactly one seam — the poster — over a real database. Job
// 1's block pins the shipped post-once/honest-receipt behaviour; the job-2 block below it
// is RED in Wave 0 and is the ADD §4.4 contract: the lease, throw-only-for-retryable, the
// health edges, and the digest's multi-section render through this one path.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  backfillCompleteSentence,
  keysRevokedSentence,
  NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
} from "@growthmind/core";
import { schema } from "@growthmind/db";
import {
  createTestDb,
  seedNotification,
  seedNotificationSend,
  seedOrgWithOwner,
  type SeededOrgWithOwner,
  type TestDb,
} from "@growthmind/db/testing";
import {
  NOTIFICATION_SEND_FAILURE_REASONS,
  NOTIFICATION_SEND_NO_TARGET,
  type DeliveryPoster,
  type PostFailureCode,
  type PostRequest,
  type PostResult,
  type TenantContext,
} from "@growthmind/shared";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  dropSlackHealthCheckedAt,
  restoreSlackHealthCheckedAt,
  setSlackConnectionFields,
  slackConnectionRowFor,
} from "../../../packages/db/__tests__/helpers/o051-contracts";
import { seedSlackConnection } from "../helpers/onboarding-delivery-fixtures";

const PREFIX = "o051-dispatch-";
const CHANNEL = "C0DISPATCH";
const OWNER = "O-051 task 2.3 (worker/src/tasks/notification-dispatch.ts, ADD §5)";
const SCHEMA_OWNER = "O-051 task 0.2 (packages/db/src/schema/notifications.ts)";

const VENDOR_TEXT = "fixture: invalid_auth from the vendor, never a customer's sentence";

// 60s: a cold PGlite boot blows bun's 5s default; same figure as the route suites.
const COLD_BOOT_BUDGET_MS = 60_000;

interface LoudPoster extends DeliveryPoster {
  readonly posted: PostRequest[];
}

// Loud on purpose (writing-a-unit-test): a poster that must not be reached throws rather
// than returning undefined, so a wrong path fails visibly.
function loudPoster(options: { readonly fails?: PostFailureCode; readonly refuse?: boolean } = {}): LoudPoster {
  const posted: PostRequest[] = [];
  let nextRef = 1;

  return {
    posted,
    post(request: PostRequest): Promise<PostResult> {
      if (options.refuse === true) {
        throw new Error("o051-dispatch: this path must never reach the poster");
      }
      posted.push(request);
      if (options.fails !== undefined) {
        return Promise.resolve({ ok: false, code: options.fails, message: VENDOR_TEXT });
      }
      const messageRef = `o051-ref-${String(nextRef)}`;
      nextRef += 1;
      return Promise.resolve({ ok: true, messageRef });
    },
  };
}

interface MirrorNotificationDispatchDeps {
  readonly db: TestDb;
  readonly posterFor: (ctx: TenantContext) => Promise<DeliveryPoster | null>;
  readonly logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
}

type MirrorRunNotificationDispatch = (
  payload: unknown,
  deps: MirrorNotificationDispatchDeps,
) => Promise<void>;

const loadDispatch = (): Promise<MirrorRunNotificationDispatch> =>
  loadUnderConstruction<MirrorRunNotificationDispatch>({
    modulePath: underConstructionSpecifier("worker/src/tasks/notification-dispatch"),
    exportName: "runNotificationDispatch",
    ownedBy: OWNER,
  });

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

let db: TestDb;
let close: () => Promise<void>;
let orgCount = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await close();
});

interface Bed {
  readonly org: SeededOrgWithOwner;
  readonly ownerName: string;
  readonly notificationId: string;
  readonly payload: { organizationId: string; notificationId: string };
  readonly run: (poster: DeliveryPoster) => Promise<void>;
}

async function bedFor(label: string, options: { readonly slack: boolean }): Promise<Bed> {
  orgCount += 1;
  const ownerName = `${PREFIX}owner-${label}`;
  const org = await seedOrgWithOwner(db, {
    orgName: `${PREFIX}org-${label}`,
    userName: ownerName,
    email: `${PREFIX}${label}-${String(orgCount)}@example.com`,
  });

  if (options.slack) {
    await seedSlackConnection(
      db,
      { organizationId: org.organizationId, channelId: CHANNEL },
      SCHEMA_OWNER,
    );
  }

  const seeded = await seedNotification(db, {
    organizationId: org.organizationId,
    type: "keys_revoked",
    subjectKind: "agent_key",
    actorUserId: org.userId,
  });

  const payload = { organizationId: org.organizationId, notificationId: seeded.id };

  return {
    org,
    ownerName,
    notificationId: seeded.id,
    payload,
    run: async (poster) => {
      const run = await loadDispatch();
      await run(payload, { db, posterFor: () => Promise.resolve(poster), logger: silentLogger });
    },
  };
}

async function sendRowsFor(notificationId: string) {
  const rows = await db.select().from(schema.notificationSends);
  return rows.filter((row) => row.notificationId === notificationId);
}

async function slackDisconnectedRowsFor(organizationId: string) {
  const rows = await db.select().from(schema.notifications);
  return rows.filter(
    (row) => row.organizationId === organizationId && row.type === "slack_disconnected",
  );
}

describe("notification:dispatch posts the shared sentence once and records the honest receipt", () => {
  test("a valid job posts the core builder's sentence with the actor resolved, and writes sent + ref", async () => {
    const bed = await bedFor("posts-once", { slack: true });
    const poster = loudPoster();

    await bed.run(poster);

    expect(poster.posted).toHaveLength(1);
    const request = poster.posted[0];
    if (!request) throw new Error("the dispatch posted nothing");
    expect(request.channelId).toBe(CHANNEL);

    // Same sentence in Slack as in the bell — the core builder is the one home, with the
    // actor's name resolved from the row, never stored in the payload.
    const sentence = keysRevokedSentence({
      workspaceName: bed.org.organizationName,
      revokedByName: bed.ownerName,
    });
    expect(request.fallbackText).toContain(sentence);
    expect(JSON.stringify(request.blocks)).toContain(bed.ownerName);

    const sends = await sendRowsFor(bed.notificationId);
    expect(sends).toHaveLength(1);
    const send = sends[0];
    if (!send) throw new Error("the post left no receipt");
    expect(send.channel).toBe("slack");
    expect(send.status).toBe("sent");
    expect(send.target).toBe(CHANNEL);
    expect(send.messageRef).toBe("o051-ref-1");
    expect(send.sentAt).toBeInstanceOf(Date);
  });

  test("a poster failure writes failed with the closed-union code — never result.message — and the handler resolves", async () => {
    const bed = await bedFor("poster-fails", { slack: true });
    const poster = loudPoster({ fails: "rejected" });

    // No auto-retry in v1 (ADD D-1): a post failure records and completes, never throws.
    await bed.run(poster);

    const sends = await sendRowsFor(bed.notificationId);
    expect(sends).toHaveLength(1);
    const send = sends[0];
    if (!send) throw new Error("the failed post left no receipt");
    expect(send.status).toBe("failed");
    expect(send.failureReason).toBe("rejected");
    const closedUnion: readonly string[] = NOTIFICATION_SEND_FAILURE_REASONS;
    expect(closedUnion).toContain(String(send.failureReason));
    expect(send.messageRef).toBeNull();

    // The vendor's text never enters a column (the reason-code lesson).
    expect(JSON.stringify(sends)).not.toContain(VENDOR_TEXT);
  });

  test("a retry with a sent row already present posts nothing (D4)", async () => {
    const bed = await bedFor("retry", { slack: true });
    const poster = loudPoster();

    await bed.run(poster);
    await bed.run(poster);

    expect(poster.posted).toHaveLength(1);
    expect(await sendRowsFor(bed.notificationId)).toHaveLength(1);
  });

  test("no connection at dispatch time writes quiet: no_channel and never reaches the poster", async () => {
    const bed = await bedFor("disconnected", { slack: false });
    const poster = loudPoster({ refuse: true });

    // Disconnected between emit and dispatch — honest, and the chip explains it (ADD §5).
    await bed.run(poster);

    const sends = await sendRowsFor(bed.notificationId);
    expect(sends).toHaveLength(1);
    const send = sends[0];
    if (!send) throw new Error("the quiet path left no receipt");
    expect(send.status).toBe("quiet");
    expect(send.quietReason).toBe("no_channel");
    expect(send.target).toBe(NOTIFICATION_SEND_NO_TARGET);
    expect(poster.posted).toEqual([]);
  });

  test("an unknown notification id completes cleanly — a deleted org's job is not an error", async () => {
    const bed = await bedFor("unknown-row", { slack: true });
    const poster = loudPoster({ refuse: true });

    const run = await loadDispatch();
    await run(
      { organizationId: bed.org.organizationId, notificationId: "never-existed" },
      { db, posterFor: () => Promise.resolve(poster), logger: silentLogger },
    );

    expect(poster.posted).toEqual([]);
    expect(await sendRowsFor("never-existed")).toEqual([]);
  });

  test("a garbage payload rejects via the shared schema before any side effect", async () => {
    const bed = await bedFor("garbage", { slack: true });
    const poster = loudPoster({ refuse: true });
    const run = await loadDispatch();

    // Pre-side-effect throws are the one place a Graphile retry is safe (ADD §5).
    await expect(
      run(
        { nonsense: true },
        { db, posterFor: () => Promise.resolve(poster), logger: silentLogger },
      ),
    ).rejects.toThrow();

    expect(poster.posted).toEqual([]);
    expect(await sendRowsFor(bed.notificationId)).toEqual([]);
  });
});

interface RecordingLogger {
  readonly infos: string[];
  readonly errors: string[];
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function recordingLogger(): RecordingLogger {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    errors,
    info: (message) => {
      infos.push(message);
    },
    warn: () => undefined,
    error: (message) => {
      errors.push(message);
    },
  };
}

async function seedReceiptRow(
  bed: Bed,
  receipt: {
    readonly status: "pending" | "quiet";
    readonly quietReason?: "no_channel" | "digest";
    readonly claimedAt?: Date;
  },
): Promise<void> {
  await db.insert(schema.notificationSends).values({
    organizationId: bed.org.organizationId,
    notificationId: bed.notificationId,
    channel: "slack",
    target: receipt.status === "quiet" ? NOTIFICATION_SEND_NO_TARGET : CHANNEL,
    status: receipt.status,
    quietReason: receipt.quietReason ?? null,
    attempts: 1,
    claimedAt: receipt.claimedAt ?? null,
  });
}

describe("job 2 — the lease, the retry contract and the health edges (ADD §4.4, RED in Wave 0)", () => {
  test("a call_failed post writes the failed receipt and then throws a code, never vendor text (D-2)", async () => {
    const bed = await bedFor("retryable-throw", { slack: true });
    const poster = loudPoster({ fails: "call_failed" });

    let thrown: unknown = null;
    try {
      await bed.run(poster);
    } catch (error) {
      thrown = error;
    }

    // The receipt commits before the throw, so what Graphile retries is already honest.
    expect(thrown).not.toBeNull();
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain("call_failed");
    expect(message).not.toContain(VENDOR_TEXT);

    const sends = await sendRowsFor(bed.notificationId);
    expect(sends.map((send) => [send.status, send.failureReason])).toEqual([
      ["failed", "call_failed"],
    ]);
  });

  test("a not_authorised post writes failed and resolves — a credential that cannot open is not retried", async () => {
    const bed = await bedFor("not-retryable", { slack: true });
    const poster = loudPoster({ fails: "not_authorised" });

    await bed.run(poster);

    const sends = await sendRowsFor(bed.notificationId);
    expect(sends.map((send) => [send.status, send.failureReason])).toEqual([
      ["failed", "not_authorised"],
    ]);
  });

  test("a live lease held by another runner posts nothing and resolves — a held lease is not an error", async () => {
    const bed = await bedFor("held-lease", { slack: true });
    await seedReceiptRow(bed, { status: "pending", claimedAt: new Date() });

    const poster = loudPoster();
    await bed.run(poster);

    expect(poster.posted).toEqual([]);

    const sends = await sendRowsFor(bed.notificationId);
    expect(sends.map((send) => send.status)).toEqual(["pending"]);
    expect(sends[0]?.attempts).toBe(1);
  });

  test("a quiet no_channel receipt does not settle the dispatch once a channel exists (D-4's reconnect arm)", async () => {
    const bed = await bedFor("unsettled-quiet", { slack: true });
    await seedReceiptRow(bed, { status: "quiet", quietReason: "no_channel" });

    const poster = loudPoster();
    await bed.run(poster);

    expect(poster.posted).toHaveLength(1);
    const statuses = (await sendRowsFor(bed.notificationId)).map((send) => send.status);
    expect(statuses).toContain("sent");
  });

  test("a quiet digest receipt settles the dispatch: the summary owns it, it is never posted alone (D-8)", async () => {
    const bed = await bedFor("digest-settled", { slack: true });
    await seedReceiptRow(bed, { status: "quiet", quietReason: "digest" });

    const poster = loudPoster({ refuse: true });
    await bed.run(poster);

    expect(poster.posted).toEqual([]);
    const statuses = (await sendRowsFor(bed.notificationId)).map((send) => send.status);
    expect(statuses).toEqual(["quiet"]);
  });

  test("a connection-shaped failure records the failing health edge with the closed-union code (D-3)", async () => {
    const bed = await bedFor("health-failing", { slack: true });
    const poster = loudPoster({ fails: "channel_unavailable" });

    await bed.run(poster);

    const connection = await slackConnectionRowFor(db, bed.org.organizationId);
    expect(connection.health).toBe("failing");
    expect(connection.healthReasonCode).toBe("channel_unavailable");
  });

  test("a successful post records the healthy edge and clears the stored reason (D-3)", async () => {
    const bed = await bedFor("health-recovery", { slack: true });
    await setSlackConnectionFields(db, bed.org.organizationId, {
      health: "failing",
      healthReasonCode: "call_failed",
    });

    const poster = loudPoster();
    await bed.run(poster);

    expect(poster.posted).toHaveLength(1);
    const connection = await slackConnectionRowFor(db, bed.org.organizationId);
    expect(connection.health).toBe("healthy");
    expect(connection.healthReasonCode).toBeNull();
  });

  // CR-2, the north star inverted: `rejected` means our own renderer built a message the
  // channel refused. It must not move the health badge, must not raise slack_disconnected
  // into a channel that is working, and no recovery may repost it — only a code change can.
  test("a rejected post raises no slack_disconnected and is never reposted by a recovery", async () => {
    const bed = await bedFor("rejected-no-loop", { slack: true });

    await bed.run(loudPoster({ fails: "rejected" }));

    const afterRejected = await slackConnectionRowFor(db, bed.org.organizationId);
    expect(afterRejected.health).not.toBe("failing");
    expect(await slackDisconnectedRowsFor(bed.org.organizationId)).toHaveLength(0);

    const rejectedSends = await sendRowsFor(bed.notificationId);
    expect(rejectedSends.map((send) => [send.status, send.failureReason])).toEqual([
      ["failed", "rejected"],
    ]);

    // The next notification posts fine — the connection was never broken.
    const second = await seedNotification(db, {
      organizationId: bed.org.organizationId,
      type: "key_created",
      subjectKind: "agent_key",
      actorUserId: bed.org.userId,
    });
    const secondPoster = loudPoster();
    const run = await loadDispatch();
    await run(
      { organizationId: bed.org.organizationId, notificationId: second.id },
      { db, posterFor: () => Promise.resolve(secondPoster), logger: silentLogger },
    );
    expect(secondPoster.posted).toHaveLength(1);

    // The rescue re-runs the rejected row's job against the now-recorded-healthy world.
    const rescuePoster = loudPoster();
    await bed.run(rescuePoster);

    expect(rescuePoster.posted).toEqual([]);
    const finalSends = await sendRowsFor(bed.notificationId);
    expect(finalSends.map((send) => [send.status, send.failureReason])).toEqual([
      ["failed", "rejected"],
    ]);
    expect(await slackDisconnectedRowsFor(bed.org.organizationId)).toHaveLength(0);
  });

  test("the ratified cap of 5 yields five real post attempts, then the claim refuses (CR-3)", async () => {
    const bed = await bedFor("five-real-posts", { slack: true });
    const poster = loudPoster({ fails: "call_failed" });

    // Two drives past the cap, so the count below proves the refusal, not the loop's end.
    for (let drive = 0; drive < NOTIFICATION_DISPATCH_MAX_ATTEMPTS + 2; drive += 1) {
      await bed.run(poster).catch(() => undefined);
    }

    expect(poster.posted).toHaveLength(NOTIFICATION_DISPATCH_MAX_ATTEMPTS);

    const sends = await sendRowsFor(bed.notificationId);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.attempts).toBe(NOTIFICATION_DISPATCH_MAX_ATTEMPTS);
    expect(sends[0]?.status).toBe("failed");
  });

  test("a health write that throws is logged and cannot break the post — the receipt is already committed (D8)", async () => {
    const bed = await bedFor("health-isolated", { slack: true });
    const logger = recordingLogger();
    const posted: PostRequest[] = [];

    // The fault is injected on the poster seam so it lands after the post and on nothing
    // but the health write: the dropped column is one every recordHealth edge must stamp.
    const poster: DeliveryPoster = {
      post: async (request) => {
        posted.push(request);
        await dropSlackHealthCheckedAt(db);
        return { ok: true, messageRef: "o051-iso-1" };
      },
    };

    const run = await loadDispatch();
    try {
      await run(bed.payload, { db, posterFor: () => Promise.resolve(poster), logger });
    } finally {
      await restoreSlackHealthCheckedAt(db);
    }

    expect(posted).toHaveLength(1);
    const sends = await sendRowsFor(bed.notificationId);
    expect(sends.map((send) => send.status)).toEqual(["sent"]);

    // Isolated, not silent: the swallowed health fault must leave a trace (D8).
    expect(logger.errors.length).toBeGreaterThan(0);
  });
});

describe("job 2 — the digest renders through the one dispatch path (ADD D-8, RED in Wave 0)", () => {
  const MEMBER_COUNTS = { sessionsTouched: 12, eventsPersisted: 340 } as const;

  interface DigestBed {
    readonly organizationId: string;
    readonly digestId: string;
    readonly run: (poster: DeliveryPoster) => Promise<void>;
  }

  async function digestBed(): Promise<DigestBed> {
    orgCount += 1;
    const org = await seedOrgWithOwner(db, {
      orgName: `${PREFIX}org-digest-${String(orgCount)}`,
      userName: `${PREFIX}owner-digest`,
      email: `${PREFIX}digest-${String(orgCount)}@example.com`,
    });
    await seedSlackConnection(
      db,
      { organizationId: org.organizationId, channelId: CHANNEL },
      SCHEMA_OWNER,
    );
    await setSlackConnectionFields(db, org.organizationId, { channelName: "growth" });

    const memberOne = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "backfill_complete",
      subjectKind: "source_connection",
      subjectId: randomUUID(),
      payload: { type: "backfill_complete", v: 1, ...MEMBER_COUNTS },
    });
    const memberTwo = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "backfill_complete",
      subjectKind: "source_connection",
      subjectId: randomUUID(),
      payload: { type: "backfill_complete", v: 1, sessionsTouched: 7, eventsPersisted: 90 },
    });
    for (const member of [memberOne, memberTwo]) {
      await seedNotificationSend(db, {
        organizationId: org.organizationId,
        notificationId: member.id,
        status: "quiet",
        quietReason: "digest",
        target: NOTIFICATION_SEND_NO_TARGET,
      });
    }

    const digest = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "digest",
      subjectKind: "organization",
      subjectId: org.organizationId,
      payload: {
        type: "digest",
        v: 1,
        notificationIds: [memberOne.id, memberTwo.id],
        totalCount: 3,
      },
    });

    return {
      organizationId: org.organizationId,
      digestId: digest.id,
      run: async (poster) => {
        const run = await loadDispatch();
        await run(
          { organizationId: org.organizationId, notificationId: digest.id },
          { db, posterFor: () => Promise.resolve(poster), logger: silentLogger },
        );
      },
    };
  }

  test("a digest posts one multi-section message whose lines are the shared builders' sentences", async () => {
    const bed = await digestBed();
    const poster = loudPoster();

    await bed.run(poster);

    expect(poster.posted).toHaveLength(1);
    const request = poster.posted[0];
    if (!request) throw new Error("the digest posted nothing");

    const sections = (request.blocks as readonly { type?: string }[]).filter(
      (block) => block.type === "section",
    );
    expect(sections.length).toBeGreaterThanOrEqual(2);

    // One home per sentence: a member's line in the summary is the same builder output the
    // bell renders, never a second copy authored inside the digest.
    expect(JSON.stringify(request.blocks)).toContain(backfillCompleteSentence(MEMBER_COUNTS));
  });

  test("the digest's receipt is an ordinary sent row carrying the channel label", async () => {
    const bed = await digestBed();

    await bed.run(loudPoster());

    const sends = await sendRowsFor(bed.digestId);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.status).toBe("sent");
    expect(sends[0]?.target).toBe(CHANNEL);
    expect(sends[0]?.channelLabel).toBe("growth");
  });

  test("the shipped one-section types still post exactly one section", async () => {
    const bed = await bedFor("one-section", { slack: true });
    const poster = loudPoster();

    await bed.run(poster);

    const request = poster.posted[0];
    if (!request) throw new Error("the post never happened");
    const sections = (request.blocks as readonly { type?: string }[]).filter(
      (block) => block.type === "section",
    );
    expect(sections).toHaveLength(1);
  });
});
