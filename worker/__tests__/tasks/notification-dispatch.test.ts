// The dispatch task (ADD §5): posts the shared sentence once and records the honest
// receipt — faked at exactly one seam, the poster, over a real database. RED in Wave 0:
// the handler is a throwing stub, so every case below fails on behavior. The handler is
// loaded by name so this file also names the deps contract Wave 2 must satisfy.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { keysRevokedSentence } from "@growthmind/core";
import { schema } from "@growthmind/db";
import {
  createTestDb,
  seedNotification,
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
