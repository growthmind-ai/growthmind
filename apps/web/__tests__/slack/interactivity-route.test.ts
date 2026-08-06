import { createHmac, randomUUID } from "node:crypto";

import { serialiseFixSpecInput } from "@growthmind/core";
import {
  createDismissalsRepo,
  createFindingPayloadsRepo,
  createFindingsRepo,
  createFixesService,
  schema,
  type FindingRecord,
} from "@growthmind/db";
import {
  createTestDb,
  scannedTextFor,
  seedAnalysisRun,
  seedOrgWithOwner,
  seedProject,
  type TestDbHandle,
} from "@growthmind/db/testing";
import {
  FINDING_BLOCK_ID_PREFIX,
  FIX_QUEUED_ACKNOWLEDGEMENT,
  GET_IT_FIXED_ACTION_ID,
  LIST_OPEN_FIXES_MAX_ITEMS,
  SLACK_INTERACTION_ACTOR,
  type TenantContext,
} from "@growthmind/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  loadModuleUnderConstruction,
  loadValueUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import { candidateFor } from "../mcp/helpers/mcp-fixture";

const INTERACTIVITY_URL = "http://localhost:3000/api/slack/interactivity";

const SIGNING_SECRET = "slack-fixture-signing-secret-never-real";

const CLEAN_TEXT = scannedTextFor(
  "People are leaving the reports page without going any further.",
  ["We saw sessions reach the reports page and stop there."],
);

const SIGNATURE_VERSION = "v0";

const ROUTE_SPECIFIER = underConstructionSpecifier("apps/web/app/api/slack/interactivity/route.ts");

const OWNED_BY = "ADD Wave 6 (Decision R-7), apps/web/app/api/slack/interactivity/route.ts";

// o-019-dismissal-wired: the Slack dismiss handler section. Loaded off the real module
// rather than duplicated as a literal, so these tests track whatever value production
// picks instead of drifting from a guessed constant.
const DISMISS_OWNED_BY =
  "ADD o-019-dismissal-wired (Slack dismiss handler section), packages/shared/src/delivery/interaction-ids.ts + messages.ts";

const INTERACTION_IDS_SPECIFIER = underConstructionSpecifier(
  "packages/shared/src/delivery/interaction-ids.ts",
);

const DELIVERY_MESSAGES_SPECIFIER = underConstructionSpecifier(
  "packages/shared/src/delivery/messages.ts",
);

function notUsefulActionId(): Promise<string> {
  return loadValueUnderConstruction<string>({
    modulePath: INTERACTION_IDS_SPECIFIER,
    exportName: "NOT_USEFUL_ACTION_ID",
    ownedBy: DISMISS_OWNED_BY,
  });
}

function dismissalAcknowledgement(): Promise<string> {
  return loadValueUnderConstruction<string>({
    modulePath: DELIVERY_MESSAGES_SPECIFIER,
    exportName: "DISMISSAL_ACKNOWLEDGEMENT",
    ownedBy: DISMISS_OWNED_BY,
  });
}

function dismissalAlreadyRecordedAcknowledgement(): Promise<string> {
  return loadValueUnderConstruction<string>({
    modulePath: DELIVERY_MESSAGES_SPECIFIER,
    exportName: "DISMISSAL_ALREADY_RECORDED_ACKNOWLEDGEMENT",
    ownedBy: DISMISS_OWNED_BY,
  });
}

type RouteHandler = (request: Request) => Promise<Response>;

async function loadRoute(): Promise<RouteHandler> {
  const namespace = await loadModuleUnderConstruction({
    modulePath: ROUTE_SPECIFIER,
    ownedBy: OWNED_BY,
  });

  const post = namespace.POST;
  if (typeof post !== "function") {
    throw new Error(
      `NOT IMPLEMENTED YET: the interactivity route exists but exports no callable POST. ${OWNED_BY} owns it.`,
    );
  }
  return post as RouteHandler;
}

interface AcknowledgementCall {
  readonly url: string;
  readonly body: unknown;
}

interface SeededOrg {
  readonly label: string;
  readonly ctx: TenantContext;
  readonly projectId: string;
  readonly channelId: string;
  readonly messageRef: string;
  readonly finding: FindingRecord;
}

const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

const realFetch: typeof fetch = globalThis.fetch;

let handle: TestDbHandle;
let acknowledgements: AcknowledgementCall[] = [];
let acknowledgementThrows = false;
let seq = 0;

function digestFor(seed: string): string {
  return createHmac("sha256", "slackint-fixture").update(seed).digest("hex");
}

async function freshOrg(): Promise<SeededOrg> {
  seq += 1;
  const label = `slackint${String(seq)}`;

  const { ctx } = await seedOrgWithOwner(handle.db, {
    orgName: `Org ${label}`,
    userName: `Owner ${label}`,
    email: `owner-${label}-${randomUUID()}@example.com`,
  });
  const project = await seedProject(handle.db, {
    organizationId: ctx.organizationId,
    name: `Project ${label}`,
  });
  const run = await seedAnalysisRun(handle.db, { ctx, projectId: project.id });

  const signature = digestFor(`${label}-finding`);
  const finding = await createFindingsRepo(handle.db, ctx).persist({
    projectId: project.id,
    runId: run.id,
    signature,
    signatureVersion: 1,
    detector: "funnel_dropoff",
    summarySource: "model_rendered",
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
    finalClass: "confusing",
    surface: `/${label}/reports`,
    surfaceNormalisationVersion: 1,
    counts: [],
    confidenceBasis: "threshold_met",
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-08T00:00:00.000Z"),
    evidenceShape: `evidence-${label}`,
    evidenceShapeVersion: 1,
    resolvedModelId: null,
  });

  const channelId = `C0${label.toUpperCase()}`;
  const messageRef = `17539524${String(10 + seq)}.000100`;

  await handle.db.insert(schema.deliveries).values({
    id: randomUUID(),
    organizationId: ctx.organizationId,
    projectId: project.id,
    findingId: finding.id,
    signature,
    channelId,
    status: "posted",
    postedAt: new Date(),
    messageRef,
  });

  return { label, ctx, projectId: project.id, channelId, messageRef, finding };
}

async function seedPayloadFor(org: SeededOrg): Promise<void> {
  await createFindingPayloadsRepo(handle.db, org.ctx).upsertFor({
    findingId: org.finding.id,
    payload: serialiseFixSpecInput({ candidate: candidateFor(org.finding.surface), signals: [] }),
  });
}

async function seedDeliveryWithNoFinding(
  org: SeededOrg,
): Promise<{ channelId: string; messageRef: string }> {
  const channelId = `${org.channelId}GONE`;
  const messageRef = `17539525${String(10 + seq)}.000100`;

  await handle.db.insert(schema.deliveries).values({
    id: randomUUID(),
    organizationId: org.ctx.organizationId,
    projectId: org.projectId,
    findingId: `finding-deleted-${randomUUID()}`,
    signature: digestFor(`${org.label}-deleted`),
    channelId,
    status: "posted",
    postedAt: new Date(),
    messageRef,
  });

  return { channelId, messageRef };
}

function openFixesFor(ctx: TenantContext) {
  return createFixesService(handle.db, ctx).listOpen({
    projectId: null,
    limit: LIST_OPEN_FIXES_MAX_ITEMS,
  });
}

function readFixFor(ctx: TenantContext, fixId: string) {
  return createFixesService(handle.db, ctx).readFix(fixId);
}

interface BlockActionsInput {
  readonly org: SeededOrg;
  readonly actionId?: string;
  readonly value?: string;
  readonly teamId?: string;
  readonly userId?: string;
  readonly channelId?: string;
  readonly messageRef?: string;
}

function blockActionsPayload(input: BlockActionsInput): string {
  const value = input.value ?? input.org.finding.id;

  return JSON.stringify({
    type: "block_actions",
    team: { id: input.teamId ?? "T0SLACKWORKSPACE" },
    user: { id: input.userId ?? "U0SLACKPRESSER" },
    channel: { id: input.channelId ?? input.org.channelId },
    container: {
      channel_id: input.channelId ?? input.org.channelId,
      message_ts: input.messageRef ?? input.org.messageRef,
    },
    response_url: "https://hooks.slack.com/actions/T0SLACK/1234567890/abcdefghijklmnop",
    actions: [
      {
        type: "button",
        action_id: input.actionId ?? GET_IT_FIXED_ACTION_ID,
        block_id: `${FINDING_BLOCK_ID_PREFIX}${value}`,
        value,
      },
    ],
  });
}

function signedRequest(input: {
  payloadText: string;
  signed?: boolean;
  headers?: Readonly<Record<string, string>>;
}): Request {
  const rawBody = `payload=${encodeURIComponent(input.payloadText)}`;
  const timestamp = String(Math.floor(Date.now() / 1000));

  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
    ...input.headers,
  });

  if (input.signed !== false) {
    const digest = createHmac("sha256", SIGNING_SECRET)
      .update(`${SIGNATURE_VERSION}:${timestamp}:${rawBody}`)
      .digest("hex");
    headers.set("x-slack-request-timestamp", timestamp);
    headers.set("x-slack-signature", `${SIGNATURE_VERSION}=${digest}`);
  }

  return new Request(INTERACTIVITY_URL, { method: "POST", headers, body: rawBody });
}

async function recordAcknowledgement(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

  if (!url.includes("hooks.slack.com")) {
    return realFetch(input, init);
  }

  const raw = typeof init?.body === "string" ? init.body : "";
  acknowledgements.push({ url, body: raw.length > 0 ? JSON.parse(raw) : null });

  if (acknowledgementThrows) {
    throw new Error("slack acknowledgement: hooks.slack.com refused the post");
  }
  return new Response("ok", { status: 200 });
}

const recordingFetch = recordAcknowledgement as unknown as typeof fetch;

beforeAll(async () => {
  handle = await createTestDb();
  globalForDb.__growthmindDb = handle.db;
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
});

afterAll(async () => {
  delete globalForDb.__growthmindDb;
  delete process.env.SLACK_SIGNING_SECRET;
  globalThis.fetch = realFetch;
  await handle.close();
});

beforeEach(() => {
  acknowledgements = [];
  acknowledgementThrows = false;
  globalThis.fetch = recordingFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("POST /api/slack/interactivity", () => {
  test("rejects an unsigned interactivity request at the route", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();

    const response = await POST(
      signedRequest({ payloadText: blockActionsPayload({ org }), signed: false }),
    );

    expect(response.status).toBe(401);
    expect((await openFixesFor(org.ctx)).totalOpen).toBe(0);
    expect(acknowledgements).toHaveLength(0);
  });

  test("mints a fix from a signed press", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    await seedPayloadFor(org);

    const response = await POST(signedRequest({ payloadText: blockActionsPayload({ org }) }));

    expect(response.status).toBe(200);

    const page = await openFixesFor(org.ctx);
    expect(page.totalOpen).toBe(1);
    expect(page.rows.map((row) => row.findingId)).toEqual([org.finding.id]);
  });

  test("derives the finding id from the delivery row rather than the Slack payload", async () => {
    const POST = await loadRoute();
    const pressed = await freshOrg();
    const other = await freshOrg();
    await seedPayloadFor(pressed);
    await seedPayloadFor(other);

    const response = await POST(
      signedRequest({
        payloadText: blockActionsPayload({ org: pressed, value: other.finding.id }),
      }),
    );

    expect(response.status).toBe(200);

    const page = await openFixesFor(pressed.ctx);
    expect(page.rows.map((row) => row.findingId)).toEqual([pressed.finding.id]);
    expect(page.rows.map((row) => row.findingId)).not.toContain(other.finding.id);

    expect((await openFixesFor(other.ctx)).totalOpen).toBe(0);
  });

  test("resolves the acting organization without trusting a Slack-supplied id", async () => {
    const POST = await loadRoute();
    const pressed = await freshOrg();
    const other = await freshOrg();
    await seedPayloadFor(pressed);

    const response = await POST(
      signedRequest({
        payloadText: blockActionsPayload({
          org: pressed,
          teamId: other.ctx.organizationId,
          userId: other.ctx.userId,
        }),
      }),
    );

    expect(response.status).toBe(200);

    const page = await openFixesFor(pressed.ctx);
    expect(page.totalOpen).toBe(1);

    const read = await readFixFor(pressed.ctx, page.rows[0]?.fixId ?? "");

    expect(read?.fix.organizationId).toBe(pressed.ctx.organizationId);
    expect(read?.fix.organizationId).not.toBe(other.ctx.organizationId);
    expect(read?.fix.openedBy).toBe(SLACK_INTERACTION_ACTOR);

    expect((await openFixesFor(other.ctx)).totalOpen).toBe(0);
  });

  test("treats a duplicate Slack interactivity payload as a no-op", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    await seedPayloadFor(org);

    const payloadText = blockActionsPayload({ org });
    const first = await POST(signedRequest({ payloadText }));
    const second = await POST(signedRequest({ payloadText }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect((await openFixesFor(org.ctx)).totalOpen).toBe(1);
    expect(acknowledgements).toHaveLength(1);
  });

  test("posts no acknowledgement when Slack marks the delivery a retry", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    await seedPayloadFor(org);

    const response = await POST(
      signedRequest({
        payloadText: blockActionsPayload({ org }),
        headers: { "x-slack-retry-num": "1", "x-slack-retry-reason": "http_timeout" },
      }),
    );

    expect(response.status).toBe(200);
    expect((await openFixesFor(org.ctx)).totalOpen).toBe(1);
    expect(acknowledgements).toHaveLength(0);
  });

  test("rejects a malformed interactivity body with a 4xx", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();

    const notJson = await POST(signedRequest({ payloadText: "this is not json at all" }));
    const wrongShape = await POST(
      signedRequest({ payloadText: JSON.stringify({ type: "view_submission" }) }),
    );

    expect(notJson.status).toBe(400);
    expect(wrongShape.status).toBe(400);

    expect((await openFixesFor(org.ctx)).totalOpen).toBe(0);
  });

  test("refuses a press on a finding that no longer exists", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    const orphan = await seedDeliveryWithNoFinding(org);

    const response = await POST(
      signedRequest({
        payloadText: blockActionsPayload({
          org,
          channelId: orphan.channelId,
          messageRef: orphan.messageRef,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect((await openFixesFor(org.ctx)).totalOpen).toBe(0);

    expect(acknowledgements).toHaveLength(1);
    const said = String((acknowledgements[0]?.body as { text?: unknown } | undefined)?.text);

    expect(said.length).toBeGreaterThan(0);
    expect(said).not.toContain(org.finding.id);
    expect(said).not.toMatch(/[{}<>[\]`_]|https?:\/\//);
  });

  test("commits the fix when the Slack acknowledgement post throws", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    await seedPayloadFor(org);
    acknowledgementThrows = true;

    const response = await POST(signedRequest({ payloadText: blockActionsPayload({ org }) }));

    expect(response.status).toBe(200);
    expect((await openFixesFor(org.ctx)).totalOpen).toBe(1);
  });

  test("acknowledges a press to the whole channel rather than only the presser", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    await seedPayloadFor(org);

    await POST(signedRequest({ payloadText: blockActionsPayload({ org }) }));

    expect(acknowledgements).toHaveLength(1);

    expect(new URL(String(acknowledgements[0]?.url)).host).toBe("hooks.slack.com");
    expect(acknowledgements[0]?.body).toEqual({
      response_type: "in_channel",
      text: FIX_QUEUED_ACKNOWLEDGEMENT,
    });
  });

  test("ignores an action it does not declare", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    await seedPayloadFor(org);

    const response = await POST(
      signedRequest({
        payloadText: blockActionsPayload({ org, actionId: "not.a.growthmind.action" }),
      }),
    );

    expect(response.status).toBe(200);
    expect((await openFixesFor(org.ctx)).totalOpen).toBe(0);
    expect(acknowledgements).toHaveLength(0);
  });

  test("refuses a body larger than a press could ever be, before it verifies anything", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    await seedPayloadFor(org);

    const request = new Request(INTERACTIVITY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `payload=${"x".repeat(64 * 1024 + 1)}`,
    });

    const response = await POST(request);

    // An unsigned request that reached the signature check would be a 401, so the 413 is the
    // evidence the ceiling is enforced ahead of it rather than behind it.
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("");

    expect((await openFixesFor(org.ctx)).totalOpen).toBe(0);
    expect(acknowledgements).toHaveLength(0);
  });

  test("mints once when two identical presses arrive at the same time", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    await seedPayloadFor(org);

    const payloadText = blockActionsPayload({ org });

    const [first, second] = await Promise.all([
      POST(signedRequest({ payloadText })),
      POST(signedRequest({ payloadText })),
    ]);

    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);

    expect((await openFixesFor(org.ctx)).totalOpen).toBe(1);
    expect(acknowledgements).toHaveLength(1);
  });

  test("refuses interactivity when no signing secret is configured", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();

    delete process.env.SLACK_SIGNING_SECRET;

    let dbTouches = 0;
    globalForDb.__growthmindDb = new Proxy(
      {},
      {
        get() {
          dbTouches += 1;
          throw new Error("the interactivity route reached the database with no signing secret");
        },
      },
    );

    try {
      const response = await POST(signedRequest({ payloadText: blockActionsPayload({ org }) }));

      expect(dbTouches).toBe(0);
      expect(response.status).toBe(200);

      // Empty on purpose. Slack documents only the empty acknowledgement for an
      // interactivity request; a non-empty body's treatment is undocumented, and the
      // nearest documented sibling renders it as a message — which here would replace
      // the finding card the button sits on. The operator is told through the log.
      const said = await response.text();
      expect(said).toBe("");
    } finally {
      globalForDb.__growthmindDb = handle.db;
      process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
    }
  });

  test("records a dismissal from a signed Slack press, resolved through resolveDeliveryForInteraction's tenant context, never interaction.user.id", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    const actionId = await notUsefulActionId();

    const response = await POST(
      signedRequest({ payloadText: blockActionsPayload({ org, actionId }) }),
    );

    expect(response.status).toBe(200);

    const dismissal = await createDismissalsRepo(handle.db, org.ctx).findFor(
      org.finding.id,
      "not_useful",
    );

    expect(dismissal).not.toBeNull();
    expect(dismissal?.projectId).toBe(org.projectId);
    // Never the presser's Slack id: the row is attributed to the system actor, the
    // same as "Get it fixed"'s `openedBy` (SLACK_INTERACTION_ACTOR), per the ADD's
    // cross-cutting decision — no Slack-user-to-org-member mapping exists.
    expect(dismissal?.dismissedByUserId).toBeNull();
    expect(dismissal?.dismissedByUserId).not.toBe("U0SLACKPRESSER");
  });

  test("posts the acknowledgement sentence on first dismissal and the already-recorded sentence on a second distinct press", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    const actionId = await notUsefulActionId();
    const acknowledgement = await dismissalAcknowledgement();
    const alreadyRecorded = await dismissalAlreadyRecordedAcknowledgement();

    const first = await POST(
      signedRequest({ payloadText: blockActionsPayload({ org, actionId }) }),
    );
    expect(first.status).toBe(200);

    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0]?.body).toEqual({
      response_type: "in_channel",
      text: acknowledgement,
    });

    // A different presser, so the payload's identity hash differs from the first
    // press and this is not the redelivery/duplicate-payload path (that is a
    // separate test below).
    const second = await POST(
      signedRequest({
        payloadText: blockActionsPayload({ org, actionId, userId: "U0SLACKPRESSER2" }),
      }),
    );
    expect(second.status).toBe(200);

    expect(acknowledgements).toHaveLength(2);
    expect(acknowledgements[1]?.body).toEqual({
      response_type: "in_channel",
      text: alreadyRecorded,
    });
  });

  test("treats a duplicate Slack interactivity payload as a no-op for the dismiss action, same as open_fix", async () => {
    const POST = await loadRoute();
    const org = await freshOrg();
    const actionId = await notUsefulActionId();

    const payloadText = blockActionsPayload({ org, actionId });
    const first = await POST(signedRequest({ payloadText }));
    const second = await POST(signedRequest({ payloadText }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const dismissal = await createDismissalsRepo(handle.db, org.ctx).findFor(
      org.finding.id,
      "not_useful",
    );
    expect(dismissal).not.toBeNull();

    expect(acknowledgements).toHaveLength(1);
  });
});
