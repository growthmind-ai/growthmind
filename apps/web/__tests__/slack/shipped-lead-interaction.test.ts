// HC-3: the reply path is two buttons over the two counts already computed, and nothing else.
// Driven through the REAL POST /api/slack/interactivity, with the structural half proving that
// no free text is received or stored anywhere. RED in Wave 0 — the action ids, the table, the
// repository, the refusal sentence and the readout renderer are absent, and each is loaded
// rather than statically imported so a missing export reddens its own test alone.
import { createHmac } from "node:crypto";

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
import { slackInteractionPayloadSchema, type TenantContext } from "@growthmind/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  atPageInput,
  mustBuild,
  shippedCorpus,
} from "../../../../packages/core/__tests__/shipped/fixtures";
import {
  assertUnderConstruction,
  loadModuleUnderConstruction,
  loadUnderConstruction,
  loadValueUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import { resolveSlackAction } from "../../lib/slack/interaction-router";

const NAMES = laneNames("shipped-lead");

const INTERACTIVITY_URL = "http://localhost:3000/api/slack/interactivity";

const SIGNING_SECRET = "slack-fixture-signing-secret-never-real";

const SIGNATURE_VERSION = "v0";

const ROUTE_PATH = "apps/web/app/api/slack/interactivity/route.ts";

const ROUTE_OWNER = `O-053 wave 5 (${ROUTE_PATH}, ADD Decision 5d)`;

const IDS_OWNER = "O-053 wave 1 (packages/shared/src/delivery/interaction-ids.ts, ADD Decision 5d)";

const COPY_OWNER = "O-053 wave 1 (packages/shared/src/findings/messages.ts, ADD Decision 6e)";

const REPO_OWNER = "O-053 wave 2 (packages/db/src/repositories/shipped-changes.repo.ts, R6)";

const SCHEMA_OWNER = "O-053 wave 1 (packages/db/src/schema/shipped-*.ts, ADD Decision 3c)";

const CORE_OWNER = "O-053 wave 3 (packages/core/src/shipped/{corpus,counts,readout}.ts)";

// 60s: a cold PGlite boot blows bun's 5s default; the same figure every DB-backed suite uses.
const COLD_BOOT_BUDGET_MS = 60_000;

const PAGE = "/reports";

const CHANGE = "CSV export";

const CONTROL = "Export CSV";

const REPORTED_AT = new Date("2026-08-09T09:00:00.000Z");
const READOUT_DUE_AT = new Date("2026-08-23T09:00:00.000Z");
const READ_OUT_AT = new Date("2026-08-23T09:05:00.000Z");

// A column whose name says a person's own words landed in it. `description` is the assistant's
// report and `abandoned_reason` is a closed-union code, so neither is one of these.
const REPLY_TEXT_COLUMN_MARKERS = [
  "reply",
  "comment",
  "note",
  "free_text",
  "freetext",
  "message",
  "body",
  "prose",
  "remark",
  "feedback",
] as const;

const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

const realFetch: typeof fetch = globalThis.fetch;

interface AcknowledgementCall {
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
  acknowledgements.push({ body: raw.length > 0 ? JSON.parse(raw) : null });
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
    modulePath: underConstructionSpecifier(ROUTE_PATH),
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

// The web workspace declares no drizzle-orm dependency, so the column list comes off the table
// object itself rather than through `getTableColumns`. A column carries both a `name` and a
// `columnType`; the table's own methods carry only the former.
function columnNamesOf(table: AnyTable): readonly string[] {
  return Object.values(table as unknown as Record<string, unknown>)
    .filter(
      (value): value is { readonly name: string } =>
        typeof (value as { name?: unknown } | null)?.name === "string" &&
        typeof (value as { columnType?: unknown } | null)?.columnType === "string",
    )
    .map((column) => column.name);
}

interface ChangeRow {
  readonly id: string;
  readonly state: string;
  readonly leadCount: string;
}

async function changeRow(changeId: string): Promise<ChangeRow> {
  const rows = (await handle.db
    .select()
    .from(shippedTable("shippedChanges"))) as unknown as readonly ChangeRow[];
  const found = rows.filter((row) => row.id === changeId);

  if (found.length !== 1) {
    throw new Error(
      `shipped-lead fixture: expected exactly one change row for ${changeId}, found ${String(found.length)}`,
    );
  }
  return found[0] as ChangeRow;
}

interface PostedChange {
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

  if (options.readOut === true) {
    await handle.db.execute(
      `update shipped_changes set state = 'read_out', read_out_at = '${READ_OUT_AT.toISOString()}' where id = '${change.id}'`,
    );
  }

  const channelId = `C0LEAD${String(seq).padStart(2, "0")}`;
  const messageRef = `17861111${String(10 + seq)}.000100`;

  const posted = await seedNotification(handle.db, {
    organizationId: org.organizationId,
    subjectKind: "shipped_change",
    subjectId: change.id,
    createdAt: REPORTED_AT,
  });
  await seedNotificationSend(handle.db, {
    organizationId: org.organizationId,
    notificationId: posted.id,
    status: "sent",
    target: channelId,
    messageRef,
    sentAt: REPORTED_AT,
  });

  return { changeId: change.id, channelId, messageRef };
}

function signedRequest(payloadText: string): Request {
  const rawBody = `payload=${encodeURIComponent(payloadText)}`;
  const timestamp = String(Math.floor(Date.now() / 1000));

  const digest = createHmac("sha256", SIGNING_SECRET)
    .update(`${SIGNATURE_VERSION}:${timestamp}:${rawBody}`)
    .digest("hex");

  return new Request(INTERACTIVITY_URL, {
    method: "POST",
    headers: new Headers({
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": `${SIGNATURE_VERSION}=${digest}`,
    }),
    body: rawBody,
  });
}

async function press(posted: PostedChange, action: string): Promise<Response> {
  const POST = await loadRoute();

  return POST(
    signedRequest(
      JSON.stringify({
        type: "block_actions",
        team: { id: "T0SLACKWORKSPACE" },
        user: { id: "U0FOUNDER" },
        channel: { id: posted.channelId },
        container: { channel_id: posted.channelId, message_ts: posted.messageRef },
        response_url: "https://hooks.slack.com/actions/T0SLACK/1234567890/abcdefghijklmnop",
        actions: [{ type: "button", action_id: action, value: posted.changeId }],
      }),
    ),
  );
}

// The two counts the reply may switch between, rendered from the STORED lead so the press and
// the readout are one wire rather than a producer test beside a consumer test (D11).
type AtPageInput = ReturnType<typeof atPageInput>;

type BuildOutcome =
  { readonly ok: true; readonly corpus: unknown } | { readonly ok: false; readonly reason: string };

const loadCore = async (): Promise<{
  readonly build: (input: AtPageInput) => BuildOutcome;
  readonly counts: (corpus: unknown) => unknown;
  readonly render: (input: {
    readonly changeId: string;
    readonly change: string;
    readonly page: string;
    readonly leadCount: string;
    readonly result: { readonly kind: "claim"; readonly corpus: unknown; readonly counts: unknown };
  }) => { readonly body: string };
}> => ({
  build: await loadUnderConstruction<(input: AtPageInput) => BuildOutcome>({
    modulePath: underConstructionSpecifier("packages/core/src/shipped/corpus"),
    exportName: "buildAtPageCorpus",
    ownedBy: CORE_OWNER,
  }),
  counts: await loadUnderConstruction<(corpus: unknown) => unknown>({
    modulePath: underConstructionSpecifier("packages/core/src/shipped/counts"),
    exportName: "shippedCounts",
    ownedBy: CORE_OWNER,
  }),
  render: await loadUnderConstruction<
    (input: {
      readonly changeId: string;
      readonly change: string;
      readonly page: string;
      readonly leadCount: string;
      readonly result: {
        readonly kind: "claim";
        readonly corpus: unknown;
        readonly counts: unknown;
      };
    }) => { readonly body: string }
  >({
    modulePath: underConstructionSpecifier("packages/core/src/shipped/readout"),
    exportName: "renderShippedReadout",
    ownedBy: CORE_OWNER,
  }),
});

// The longest literal run between a template's tokens. Derived rather than copied, so a PL
// rewording of the sentence moves the probe with it instead of silently breaking the ordering
// assertion below.
function longestLiteral(template: string): string {
  const runs = template
    .split(/\{[^}]*\}/)
    .map((run) => run.trim())
    .filter((run) => run.length > 0);

  return runs.toSorted((left, right) => right.length - left.length)[0] ?? "";
}

async function readoutBodyLeadingOn(changeId: string, leadCount: string): Promise<string> {
  const core = await loadCore();

  // Twelve recorded sessions across three people, five of whom touched the change and two of
  // whom came back: both counts are statable, so which one leads is the only variable.
  const corpus = mustBuild(
    core.build(
      atPageInput(
        shippedCorpus({
          totalSessions: 200,
          atPage: 20,
          recordedAtPage: 12,
          touchedAtPage: 5,
          identityGroups: [0, 1, 2],
        }),
        { kind: "recorded" },
      ),
    ),
  );

  return core.render({
    changeId,
    change: CHANGE,
    page: PAGE,
    leadCount,
    result: { kind: "claim", corpus, counts: core.counts(corpus) },
  }).body;
}

describe("a lead-count press inside the window switches which count the readout leads on", () => {
  test("the press stores repeat and the readout rendered from the stored value leads on repeat", async () => {
    const repeatAction = await actionId("SHIPPED_LEAD_REPEAT_ACTION_ID");
    const reachSentence = longestLiteral(await sentence("SHIPPED_REACH_TEMPLATE"));
    const repeatSentence = longestLiteral(await sentence("SHIPPED_REPEAT_TEMPLATE"));

    // The probes have to be distinct, or the ordering assertion below is comparing a string
    // with itself and is green whatever the renderer does.
    expect(reachSentence.length).toBeGreaterThan(0);
    expect(repeatSentence.length).toBeGreaterThan(0);
    expect(reachSentence).not.toBe(repeatSentence);

    const posted = await seedPostedChange("switch");
    expect((await changeRow(posted.changeId)).leadCount).toBe("reach");

    // The control first: while the stored lead is reach, reach leads.
    const before = await readoutBodyLeadingOn(posted.changeId, "reach");
    expect(before).toContain(reachSentence);
    expect(before).toContain(repeatSentence);
    expect(before.indexOf(reachSentence)).toBeLessThan(before.indexOf(repeatSentence));

    const response = await press(posted, repeatAction);
    expect(response.status).toBe(200);

    const stored = (await changeRow(posted.changeId)).leadCount;
    expect(stored).toBe("repeat");

    const after = await readoutBodyLeadingOn(posted.changeId, stored);
    expect(after).toContain(reachSentence);
    expect(after).toContain(repeatSentence);
    expect(after.indexOf(repeatSentence)).toBeLessThan(after.indexOf(reachSentence));
  });

  test("a reach press leaves the lead where it already is rather than failing", async () => {
    const reachAction = await actionId("SHIPPED_LEAD_REACH_ACTION_ID");
    const posted = await seedPostedChange("reach-press");

    const response = await press(posted, reachAction);

    expect(response.status).toBe(200);
    expect((await changeRow(posted.changeId)).leadCount).toBe("reach");
  });
});

describe("a change requested after the readout is refused out loud, never silently accepted", () => {
  test("the press is refused with the too-late sentence and the stored lead is unchanged", async () => {
    const repeatAction = await actionId("SHIPPED_LEAD_REPEAT_ACTION_ID");
    const tooLate = await sentence("SHIPPED_LEAD_TOO_LATE_REFUSAL");
    const posted = await seedPostedChange("too-late", { readOut: true });

    const response = await press(posted, repeatAction);

    expect(response.status).toBe(200);
    expect((await changeRow(posted.changeId)).leadCount).toBe("reach");

    expect(acknowledgements).toHaveLength(1);
    expect((acknowledgements[0]?.body as { text?: unknown } | undefined)?.text).toBe(tooLate);
  });

  test("the control: the same press before the readout is accepted, so the refusal is about the timing", async () => {
    const repeatAction = await actionId("SHIPPED_LEAD_REPEAT_ACTION_ID");
    const posted = await seedPostedChange("timing-control");

    await press(posted, repeatAction);

    expect((await changeRow(posted.changeId)).leadCount).toBe("repeat");
  });
});

describe("no column and no route stores free text from a reply", () => {
  test("the two shipped tables carry no column a person's own words could land in", () => {
    const changeColumns = columnNamesOf(shippedTable("shippedChanges"));
    const verdictColumns = columnNamesOf(shippedTable("shippedChangeVerdicts"));

    // Non-vacuity: the scan is over real column lists carrying the anchors it should see, not
    // over two empty arrays.
    expect(changeColumns).toContain("description");
    expect(changeColumns).toContain("lead_count");
    expect(verdictColumns).toContain("verdict");
    expect(REPLY_TEXT_COLUMN_MARKERS.length).toBeGreaterThan(0);

    for (const column of [...changeColumns, ...verdictColumns]) {
      for (const marker of REPLY_TEXT_COLUMN_MARKERS) {
        expect({ column, marker, carries: column.includes(marker) }).toEqual({
          column,
          marker,
          carries: false,
        });
      }
    }
  });

  test("the interactivity payload the route parses drops any message text Slack sends with it", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const planted = "the founder typed a whole sentence here and it must reach nothing";

    const parsed = slackInteractionPayloadSchema.parse({
      type: "block_actions",
      channel: { id: "C0LEADTEXT" },
      container: { channel_id: "C0LEADTEXT", message_ts: "1786222222.000100" },
      response_url: "https://hooks.slack.com/actions/T0SLACK/1/abc",
      message: { text: planted },
      actions: [{ type: "button", action_id: keep, value: "change-id" }],
    });

    expect(Object.keys(parsed)).not.toContain("message");
    expect(JSON.stringify(parsed)).not.toContain(planted);
  });

  test("the route reads no message text, and the buttons it does read are wired", async () => {
    const keep = await actionId("SHIPPED_VERDICT_KEEP_ACTION_ID");
    const repeatAction = await actionId("SHIPPED_LEAD_REPEAT_ACTION_ID");

    // Non-vacuity: "reads no text" is only a claim about this route if the route reads the
    // buttons at all. An unrouted action id means the scan below is over a dead path.
    expect(resolveSlackAction(keep).action).not.toBe("ignore");
    expect(resolveSlackAction(repeatAction).action).not.toBe("ignore");

    const source = readSourceUnderConstruction({
      repoRelativePath: ROUTE_PATH,
      ownedBy: ROUTE_OWNER,
    });

    const readsMessageText = /\bmessage\s*(\?\.|\.|\[)\s*["']?(text|blocks)/;

    expect(source).not.toMatch(readsMessageText);

    // The scanner's own positive control, so a matcher that silently stopped matching cannot
    // report this route clean.
    expect("const said = payload.message.text;").toMatch(readsMessageText);
  });

  test("no Slack Events API surface was added to receive a sentence in the first place", async () => {
    // The anchor that makes the absence mean something: choosing buttons over an Events
    // subscription is only a decision once a reply path exists at all.
    expect((await actionId("SHIPPED_LEAD_REPEAT_ACTION_ID")).length).toBeGreaterThan(0);

    const routes = [
      ...new Bun.Glob("apps/web/app/api/slack/**/route.ts").scanSync({
        cwd: new URL("../../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      }),
    ].map((entry) => entry.replaceAll("\\", "/"));

    // Non-vacuity: the glob found the routes that do exist, so the absence below is a real one.
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).toContain(ROUTE_PATH);

    for (const route of routes) {
      expect({ route, isEvents: route.includes("/slack/events/") }).toEqual({
        route,
        isEvents: false,
      });
    }
  });
});
