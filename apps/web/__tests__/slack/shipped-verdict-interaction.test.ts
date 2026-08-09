// D11: the founder's verdict, driven through the REAL POST /api/slack/interactivity with a
// signed payload against a real database. The org is derived from the posted message's
// (channel, ts) pair and from nowhere else — the Slack payload's team and user are never
// trusted. RED in Wave 0: the action ids, the two tables, the repository and the refusal
// sentences are absent, and each is loaded rather than statically imported so a missing export
// reddens its own test instead of taking the whole file down as one module error.
import { createHmac, randomUUID } from "node:crypto";

import { schema } from "@growthmind/db";
import {
  createTestDb,
  laneNames,
  seedNotification,
  seedNotificationSend,
  seedOrgWithOwner,
  seedProject,
  type TestDb,
  type TestDbHandle,
} from "@growthmind/db/testing";
import type { TenantContext } from "@growthmind/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  assertUnderConstruction,
  loadModuleUnderConstruction,
  loadUnderConstruction,
  loadValueUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";

const NAMES = laneNames("shipped-verdict");

const INTERACTIVITY_URL = "http://localhost:3000/api/slack/interactivity";

const SIGNING_SECRET = "slack-fixture-signing-secret-never-real";

const SIGNATURE_VERSION = "v0";

const ROUTE_OWNER = "O-053 wave 5 (apps/web/app/api/slack/interactivity/route.ts, ADD Decision 5d)";

const IDS_OWNER = "O-053 wave 1 (packages/shared/src/delivery/interaction-ids.ts, ADD Decision 5d)";

const COPY_OWNER = "O-053 wave 1 (packages/shared/src/findings/messages.ts, ADD Decision 6e)";

const REPO_OWNER = "O-053 wave 2 (packages/db/src/repositories/shipped-changes.repo.ts, R6)";

const SCHEMA_OWNER = "O-053 wave 1 (packages/db/src/schema/shipped-*.ts, ADD Decision 3c)";

// 60s: a cold PGlite boot blows bun's 5s default; the same figure every DB-backed suite uses.
const COLD_BOOT_BUDGET_MS = 60_000;

const PAGE = "/reports";

const CHANGE = "CSV export";

const CONTROL = "Export CSV";

const REPORTED_AT = new Date("2026-08-09T09:00:00.000Z");
const READOUT_DUE_AT = new Date("2026-08-23T09:00:00.000Z");
const READ_OUT_AT = new Date("2026-08-23T09:05:00.000Z");

const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

const realFetch: typeof fetch = globalThis.fetch;

interface AcknowledgementCall {
  readonly url: string;
  readonly body: unknown;
}

let handle: TestDbHandle;
let acknowledgements: AcknowledgementCall[] = [];
let seq = 0;

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
  return new Response("ok", { status: 200 });
}

const recordingFetch = recordAcknowledgement as unknown as typeof fetch;

beforeAll(async () => {
  handle = await createTestDb();
  globalForDb.__growthmindDb = handle.db;
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  delete globalForDb.__growthmindDb;
  delete process.env.SLACK_SIGNING_SECRET;
  globalThis.fetch = realFetch;
  await handle.close();
});

beforeEach(() => {
  acknowledgements = [];
  globalThis.fetch = recordingFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

type RouteHandler = (request: Request) => Promise<Response>;

async function loadRoute(): Promise<RouteHandler> {
  const namespace = await loadModuleUnderConstruction({
    modulePath: underConstructionSpecifier("apps/web/app/api/slack/interactivity/route.ts"),
    ownedBy: ROUTE_OWNER,
  });

  const post = namespace.POST;
  if (typeof post !== "function") {
    throw new Error(
      `NOT IMPLEMENTED YET: the interactivity route exports no callable POST. ${ROUTE_OWNER} owns it.`,
    );
  }
  return post as RouteHandler;
}

const actionId = (exportName: string): Promise<string> =>
  loadValueUnderConstruction<string>({
    modulePath: underConstructionSpecifier("packages/shared/src/delivery/interaction-ids.ts"),
    exportName,
    ownedBy: IDS_OWNER,
  });

const sentence = (exportName: string): Promise<string> =>
  loadValueUnderConstruction<string>({
    modulePath: underConstructionSpecifier("packages/shared/src/findings/messages.ts"),
    exportName,
    ownedBy: COPY_OWNER,
  });

// R6's pinned contract, mirrored so a Wave 2 signature drift fails at the call rather than here.
interface MirrorReportShippedInput {
  readonly projectId: string;
  readonly page: string;
  readonly description: string;
  readonly reportedAt: Date;
  readonly readoutDueAt: Date;
  readonly control?: string;
}

type CreateShippedChangesRepo = (
  db: TestDb,
  ctx: TenantContext,
) => { reportShipped(input: MirrorReportShippedInput): Promise<{ readonly id: string }> };

const loadShippedChangesRepo = (): Promise<CreateShippedChangesRepo> =>
  loadUnderConstruction<CreateShippedChangesRepo>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/shipped-changes.repo"),
    exportName: "createShippedChangesRepo",
    ownedBy: REPO_OWNER,
  });

type AnyTable = Parameters<TestDb["insert"]>[0];

function shippedTable(name: string): AnyTable {
  const table = (schema as unknown as Record<string, unknown>)[name];

  assertUnderConstruction(table !== undefined, {
    contract: `the \`${name}\` table on the @growthmind/db schema barrel`,
    ownedBy: SCHEMA_OWNER,
  });

  return table as AnyTable;
}

interface ChangeRow {
  readonly id: string;
  readonly organizationId: string;
  readonly state: string;
  readonly leadCount: string;
}

interface VerdictRow {
  readonly organizationId: string;
  readonly changeId: string;
  readonly verdict: string;
}

// The full change scope, never a "most recent verdict" helper: such a helper reports success on
// a second row that overwrote the founder's answer, which is exactly what AC-G12 catches.
async function verdictRowsFor(changeId: string): Promise<readonly VerdictRow[]> {
  const rows = (await handle.db
    .select()
    .from(shippedTable("shippedChangeVerdicts"))) as unknown as readonly VerdictRow[];
  return rows.filter((row) => row.changeId === changeId);
}

async function changeRow(changeId: string): Promise<ChangeRow> {
  const rows = (await handle.db
    .select()
    .from(shippedTable("shippedChanges"))) as unknown as readonly ChangeRow[];
  const found = rows.filter((row) => row.id === changeId);

  if (found.length !== 1) {
    throw new Error(
      `shipped-verdict fixture: expected exactly one change row for ${changeId}, found ${String(found.length)}`,
    );
  }
  return found[0] as ChangeRow;
}

interface PostedChange {
  readonly ctx: TenantContext;
  readonly organizationId: string;
  readonly changeId: string;
  readonly channelId: string;
  readonly messageRef: string;
}

async function seedPostedChange(
  label: string,
  options: { readonly readOut?: boolean } = {},
): Promise<PostedChange> {
  seq += 1;
  const suffix = `${label}-${String(seq)}`;

  const org = await seedOrgWithOwner(handle.db, {
    orgName: NAMES.orgName(suffix),
    userName: NAMES.userName(suffix),
    email: NAMES.email(suffix),
  });
  const project = await seedProject(handle.db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(suffix),
  });

  const createRepo = await loadShippedChangesRepo();
  const change = await createRepo(handle.db, org.ctx).reportShipped({
    projectId: project.id,
    page: PAGE,
    control: CONTROL,
    description: CHANGE,
    reportedAt: REPORTED_AT,
    readoutDueAt: READOUT_DUE_AT,
  });

  if (options.readOut !== false) {
    await handle.db.execute(
      `update shipped_changes set state = 'read_out', read_out_at = '${READ_OUT_AT.toISOString()}' where id = '${change.id}'`,
    );
  }

  const channelId = `C0VERDICT${String(seq).padStart(2, "0")}`;
  const messageRef = `17860000${String(10 + seq)}.000100`;

  const posted = await seedNotification(handle.db, {
    organizationId: org.organizationId,
    subjectKind: "shipped_change",
    subjectId: change.id,
    createdAt: READ_OUT_AT,
  });
  await seedNotificationSend(handle.db, {
    organizationId: org.organizationId,
    notificationId: posted.id,
    status: "sent",
    target: channelId,
    messageRef,
    sentAt: READ_OUT_AT,
  });

  return {
    ctx: org.ctx,
    organizationId: org.organizationId,
    changeId: change.id,
    channelId,
    messageRef,
  };
}

interface PressInput {
  readonly posted: PostedChange;
  readonly action: string;
  readonly value?: string;
  readonly channelId?: string;
  readonly messageRef?: string;
  readonly teamId?: string;
  readonly userId?: string;
}

function blockActionsPayload(input: PressInput): string {
  const channelId = input.channelId ?? input.posted.channelId;

  return JSON.stringify({
    type: "block_actions",
    team: { id: input.teamId ?? "T0SLACKWORKSPACE" },
    user: { id: input.userId ?? "U0FOUNDER" },
    channel: { id: channelId },
    container: {
      channel_id: channelId,
      message_ts: input.messageRef ?? input.posted.messageRef,
    },
    response_url: "https://hooks.slack.com/actions/T0SLACK/1234567890/abcdefghijklmnop",
    actions: [
      {
        type: "button",
        action_id: input.action,
        value: input.value ?? input.posted.changeId,
      },
    ],
  });
}

function signedRequest(input: {
  readonly payloadText: string;
  readonly headers?: Readonly<Record<string, string>>;
}): Request {
  const rawBody = `payload=${encodeURIComponent(input.payloadText)}`;
  const timestamp = String(Math.floor(Date.now() / 1000));

  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
    ...input.headers,
  });

  const digest = createHmac("sha256", SIGNING_SECRET)
    .update(`${SIGNATURE_VERSION}:${timestamp}:${rawBody}`)
    .digest("hex");
  headers.set("x-slack-request-timestamp", timestamp);
  headers.set("x-slack-signature", `${SIGNATURE_VERSION}=${digest}`);

  return new Request(INTERACTIVITY_URL, { method: "POST", headers, body: rawBody });
}

async function press(
  input: PressInput,
  headers?: Readonly<Record<string, string>>,
): Promise<Response> {
  const POST = await loadRoute();
  return POST(
    signedRequest({
      payloadText: blockActionsPayload(input),
      ...(headers === undefined ? {} : { headers }),
    }),
  );
}

describe("a keep press on the real interactivity route records the verdict against the change", () => {
  test("one verdict row valued keep, and the change row closed", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const posted = await seedPostedChange("keep");

    const response = await press({ posted, action: keep });

    expect(response.status).toBe(200);

    const rows = await verdictRowsFor(posted.changeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("keep");
    expect(rows[0]?.organizationId).toBe(posted.organizationId);

    expect((await changeRow(posted.changeId)).state).toBe("closed");
  });

  test("each of the three verdicts records its own answer, and none of them grades it", async () => {
    const cases = [
      { exportName: "SHIPPED_VERDICT_KEEP_ACTION_ID", verdict: "keep" },
      { exportName: "SHIPPED_VERDICT_KILL_ACTION_ID", verdict: "kill" },
      { exportName: "SHIPPED_VERDICT_LEAVE_ACTION_ID", verdict: "leave" },
    ] as const;

    expect(cases.length).toBe(3);

    for (const entry of cases) {
      const action = await actionId(entry.exportName);
      const posted = await seedPostedChange(entry.verdict);

      await press({ posted, action });

      const rows = await verdictRowsFor(posted.changeId);
      expect({ verdict: entry.verdict, recorded: rows.map((row) => row.verdict) }).toEqual({
        verdict: entry.verdict,
        recorded: [entry.verdict],
      });
    }
  });
});

describe("a press the resolved message does not vouch for writes nothing", () => {
  test("a value that does not match the resolved subject is refused with no write", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const posted = await seedPostedChange("value-mismatch");

    const response = await press({ posted, action: keep, value: randomUUID() });

    expect(response.status).toBe(200);
    expect(await verdictRowsFor(posted.changeId)).toHaveLength(0);
    expect((await changeRow(posted.changeId)).state).toBe("read_out");
  });

  test("the control: the same press carrying the resolved subject does write, so the refusal is about the value", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const posted = await seedPostedChange("value-control");

    await press({ posted, action: keep });

    expect(await verdictRowsFor(posted.changeId)).toHaveLength(1);
  });

  test("a press on a pair nobody posted resolves to no organization and writes nothing", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const posted = await seedPostedChange("unknown-pair");

    const response = await press({
      posted,
      action: keep,
      channelId: "C0NOBODYATALL",
      messageRef: "1786000000.999999",
    });

    expect(response.status).toBe(200);
    expect(await verdictRowsFor(posted.changeId)).toHaveLength(0);
    expect((await changeRow(posted.changeId)).state).toBe("read_out");
  });
});

describe("a verdict pressed out of order is refused and never overwrites the first answer", () => {
  test("a press on a row not yet read out leaves it reported with no verdict row", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const tooEarly = await sentence("SHIPPED_VERDICT_TOO_EARLY_REFUSAL");
    const posted = await seedPostedChange("too-early", { readOut: false });

    const response = await press({ posted, action: keep });

    expect(response.status).toBe(200);
    expect(await verdictRowsFor(posted.changeId)).toHaveLength(0);
    expect((await changeRow(posted.changeId)).state).toBe("reported");

    expect(acknowledgements).toHaveLength(1);
    expect((acknowledgements[0]?.body as { text?: unknown } | undefined)?.text).toBe(tooEarly);
  });

  test("a press on an already-closed row keeps one verdict row and it is the first one", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const kill = await actionId("SHIPPED_VERDICT_KILL_ACTION_ID");
    const tooLate = await sentence("SHIPPED_VERDICT_TOO_LATE_REFUSAL");
    const posted = await seedPostedChange("already-closed");

    await press({ posted, action: keep });
    const second = await press({ posted, action: kill });

    expect(second.status).toBe(200);

    const rows = await verdictRowsFor(posted.changeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("keep");

    const said = acknowledgements.map((call) => (call.body as { text?: unknown }).text);
    expect(said).toContain(tooLate);
  });
});

describe("a Slack redelivery of a verdict press writes nothing a second time (D4)", () => {
  test("the same payload replayed with a retry header leaves one verdict row and posts no second acknowledgement", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const posted = await seedPostedChange("redelivery");

    const first = await press({ posted, action: keep });
    expect(first.status).toBe(200);
    expect(await verdictRowsFor(posted.changeId)).toHaveLength(1);
    expect(acknowledgements).toHaveLength(1);

    const replay = await press({ posted, action: keep }, { "x-slack-retry-num": "1" });

    expect(replay.status).toBe(200);
    expect(await verdictRowsFor(posted.changeId)).toHaveLength(1);
    expect(acknowledgements).toHaveLength(1);
  });
});

describe("the organization comes from the posted message and from nowhere else (D7)", () => {
  test("a Slack-supplied team and user cannot move the verdict to another organization", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const pressed = await seedPostedChange("tenancy-pressed");
    const other = await seedPostedChange("tenancy-other");

    await press({
      posted: pressed,
      action: keep,
      teamId: other.organizationId,
      userId: "U0INTRUDER",
    });

    const mine = await verdictRowsFor(pressed.changeId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.organizationId).toBe(pressed.organizationId);
    expect(mine[0]?.organizationId).not.toBe(other.organizationId);

    expect(await verdictRowsFor(other.changeId)).toHaveLength(0);
    expect((await changeRow(other.changeId)).state).toBe("read_out");
  });

  test("one organization's channel under another's change id crosses nothing", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const orgA = await seedPostedChange("cross-a");
    const orgB = await seedPostedChange("cross-b");

    // Org B's posted message, carrying org A's change id as the button's value. The resolved
    // subject is org B's change, so the value check refuses and neither row moves.
    const response = await press({ posted: orgB, action: keep, value: orgA.changeId });

    expect(response.status).toBe(200);
    expect(await verdictRowsFor(orgA.changeId)).toHaveLength(0);
    expect(await verdictRowsFor(orgB.changeId)).toHaveLength(0);
    expect((await changeRow(orgA.changeId)).state).toBe("read_out");
    expect((await changeRow(orgB.changeId)).state).toBe("read_out");
  });
});
