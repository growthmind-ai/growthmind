// D11: the machine surface's first write, driven through POST /api/mcp with a real bearer key
// against a real database. A producer test plus a consumer test proves nothing about the wire,
// so every row here goes through the route handler. RED in Wave 0 — the tool, the refusals, the
// table and the emitter are all absent, and each is loaded rather than statically imported so a
// missing export reddens its own test instead of taking the whole file down as one module error.
import { randomUUID } from "node:crypto";

import { schema } from "@growthmind/db";
import {
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  seedProject,
  type TestDb,
  type TestDbHandle,
} from "@growthmind/db/testing";
import {
  FIX_RESULTS_WINDOW_DAYS,
  FORBIDDEN_PRODUCT_JARGON,
  MCP_TOOL,
  SHIPPED_ALREADY_ANSWERED_TEMPLATE,
  SHIPPED_CLOCK_UNCHANGED_TEMPLATE,
  SHIPPED_PROMISE_TEMPLATE,
  SHIPPED_WATCHING_AGAIN_TEMPLATE,
  type TenantContext,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  assertUnderConstruction,
  loadValueUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import { POST } from "../../app/api/mcp/route";
import type { McpRefusal } from "../../lib/mcp/refusals";
import { mintRealApiKey, rpcRequest, sseDataLine, toolCallRequest } from "./helpers/mcp-fixture";

const NAMES = laneNames("mcp-report-shipped");

const TOOL_OWNER = "O-053 wave 1 (packages/shared/src/mcp/tools.ts, ADD Decision 4a)";

const REFUSAL_OWNER = "O-053 wave 5 (apps/web/lib/mcp/refusals.ts, ADD Decision 4c)";

const SCHEMA_OWNER = "O-053 wave 1 (packages/db/src/schema/shipped-changes.ts, ADD Decision 3c)";

// 60s: a cold PGlite boot blows bun's 5s default; the same figure every DB-backed suite uses.
const COLD_BOOT_BUDGET_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1_000;

const PAGE = "/reports";

const CHANGE = "CSV export";

// The five spellings ADD Decision 4d names. A key it misses still hits the strict-schema
// refusal, so both branches refuse — but only these five get the sentence that names the rule.
const CALLER_DATE_KEYS = [
  "readoutDate",
  "readout_date",
  "resultsBy",
  "results_by",
  "date",
] as const;

const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

let handle: TestDbHandle;
let seq = 0;

beforeAll(async () => {
  handle = await createTestDb();
  globalForDb.__growthmindDb = handle.db;
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  delete globalForDb.__growthmindDb;
  await handle.close();
});

function reportShippedToolName(): string {
  const name = (MCP_TOOL as unknown as Readonly<Record<string, string | undefined>>).REPORT_SHIPPED;

  assertUnderConstruction(typeof name === "string" && name.length > 0, {
    contract: "`MCP_TOOL.REPORT_SHIPPED`, the name the first write tool answers to",
    ownedBy: TOOL_OWNER,
  });

  return name;
}

const refusal = (exportName: string): Promise<McpRefusal> =>
  loadValueUnderConstruction<McpRefusal>({
    modulePath: underConstructionSpecifier("apps/web/lib/mcp/refusals.ts"),
    exportName,
    ownedBy: REFUSAL_OWNER,
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
  readonly projectId: string | null;
  readonly page: string;
  readonly description: string;
  readonly controlLabel: string;
  readonly state: string;
  readonly reportedAt: Date;
  readonly readoutDueAt: Date;
}

// The whole table, filtered in the test: a "find one" helper would report success on a second
// row nobody asked for, which is the exact class AC-G5 exists to catch (.ai/patterns.md #1).
async function allChangeRows(): Promise<readonly ChangeRow[]> {
  const rows = await handle.db.select().from(shippedTable("shippedChanges"));
  return rows as unknown as readonly ChangeRow[];
}

async function changeRowsFor(organizationId: string): Promise<readonly ChangeRow[]> {
  return (await allChangeRows()).filter((row) => row.organizationId === organizationId);
}

async function notificationRowsFor(organizationId: string) {
  const rows = await handle.db.select().from(schema.notifications);
  return rows.filter((row) => row.organizationId === organizationId);
}

// The change's own notifications, not the org's. Minting the fixture's key emits `key_created`
// and the first authenticated call by a coding agent emits `agent_first_contact`, both before
// any report — so a count over the whole org counts the fixture. Every assertion below pairs
// this with the unfiltered count, so the narrowing is never over an empty set.
async function changeNotificationsFor(organizationId: string) {
  return (await notificationRowsFor(organizationId)).filter(
    (row) => String(row.subjectKind) === "shipped_change",
  );
}

interface SeededOrg {
  readonly ctx: TenantContext;
  readonly organizationId: string;
  readonly projectId: string;
  readonly key: string;
}

async function freshOrg(label: string): Promise<SeededOrg> {
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
  const key = (await mintRealApiKey(handle.db, org.ctx, `agent-${suffix}`)).raw;

  return { ctx: org.ctx, organizationId: org.organizationId, projectId: project.id, key };
}

interface ToolAnswer {
  readonly status: number;
  readonly body: string;
  readonly isError: boolean;
  readonly text: string;
  readonly structured: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frameResultOf(body: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(sseDataLine(body));
  if (!isRecord(parsed) || !isRecord(parsed.result)) {
    throw new Error(`report_shipped: the frame carried no JSON-RPC result. Body: ${body}`);
  }
  return parsed.result;
}

async function report(key: string, input: unknown): Promise<ToolAnswer> {
  const response = await POST(toolCallRequest({ tool: reportShippedToolName(), input, key }));
  const body = await response.text();

  if (!body.startsWith("event: message")) {
    return { status: response.status, body, isError: true, text: body, structured: undefined };
  }

  const result = frameResultOf(body);
  const content = Array.isArray(result.content) ? result.content : [];

  return {
    status: response.status,
    body,
    isError: result.isError === true,
    text: content
      .map((entry) => (isRecord(entry) && typeof entry.text === "string" ? entry.text : ""))
      .join("\n"),
    structured: result.structuredContent,
  };
}

describe("the coding agent reports a change through the real MCP route", () => {
  test("a bearer-authenticated report writes one row, emits one acknowledgement, and names the product's date", async () => {
    const org = await freshOrg("write");

    const answer = await report(org.key, {
      description: CHANGE,
      page: PAGE,
      projectId: org.projectId,
    });

    expect(answer.status).toBe(200);
    expect(answer.isError).toBe(false);

    const rows = await changeRowsFor(org.organizationId);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    if (!row) throw new Error("unreachable: the length assertion above proves the row");

    expect(row.page).toBe(PAGE);
    expect(row.description).toBe(CHANGE);
    expect(row.projectId).toBe(org.projectId);

    // The product's date, not the caller's: reported_at plus the window the product already
    // owns. FIX_RESULTS_WINDOW_DAYS' role is copied here, never a new duration.
    expect(row.readoutDueAt.getTime() - row.reportedAt.getTime()).toBe(
      FIX_RESULTS_WINDOW_DAYS * DAY_MS,
    );

    // FR-5.1: the promise is made at report time, so the answer states the date it will land.
    const due = row.readoutDueAt;
    const day = due.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
    const month = due.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
    expect(answer.text).toContain(`${day} ${month}`);

    // D1: the acknowledgement is the org's, addressed by the change and not by the key that
    // reported it. One row, so a second emitter would fail here rather than pass quietly.
    const notifications = await changeNotificationsFor(org.organizationId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.audience).toBe("org");
    expect(String(notifications[0]?.subjectKind)).toBe("shipped_change");
    expect(notifications[0]?.subjectId).toBe(row.id);

    // Non-vacuity: the filter above narrows a real set, so "one row" is a claim about this
    // report rather than about a predicate that matches nothing.
    expect((await notificationRowsFor(org.organizationId)).length).toBeGreaterThan(
      notifications.length,
    );
  });
});

// Asserted at the rendered value rather than at the template: the placeholders carry the change,
// the page and the date, so the literal segments around them are the sentence.
function rendersTemplate(text: string, template: string): boolean {
  const segments = template
    .split(/\{[a-zA-Z]+\}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 3);

  return segments.length > 0 && segments.every((segment) => text.includes(segment));
}

async function moveToClosed(changeId: string): Promise<void> {
  await handle.db.execute(`update shipped_changes set state = 'closed' where id = '${changeId}'`);
}

async function moveToReadOutMeasuringNothing(changeId: string): Promise<void> {
  await handle.db.execute(
    `update shipped_changes set state = 'read_out', readout_outcome = 'too_few' where id = '${changeId}'`,
  );
}

describe("a re-report is answered, and never with a second promise", () => {
  test("the same change reported twice says the date has not moved, and starts no second clock", async () => {
    const org = await freshOrg("re-report");
    const input = { description: CHANGE, page: PAGE, projectId: org.projectId };

    const first = await report(org.key, input);
    expect(first.isError).toBe(false);
    expect(rendersTemplate(first.text, SHIPPED_PROMISE_TEMPLATE)).toBe(true);

    const clock = (await changeRowsFor(org.organizationId))[0]?.readoutDueAt.toISOString();
    expect(clock).toBeDefined();

    const again = await report(org.key, { ...input, description: "CSV export, with headings" });

    expect(again.isError).toBe(false);
    expect(rendersTemplate(again.text, SHIPPED_CLOCK_UNCHANGED_TEMPLATE)).toBe(true);

    // FR-5.5: the sentence that promises a date belongs to the first report alone.
    expect(rendersTemplate(again.text, SHIPPED_PROMISE_TEMPLATE)).toBe(false);

    const rows = await changeRowsFor(org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe("CSV export, with headings");
    expect(rows[0]?.readoutDueAt.toISOString()).toBe(clock);
    expect(await changeNotificationsFor(org.organizationId)).toHaveLength(1);
  });

  test("a report landing after the change was answered is refused, not acknowledged", async () => {
    const org = await freshOrg("re-report-late");
    const input = { description: CHANGE, page: PAGE, projectId: org.projectId };

    const first = await report(org.key, input);
    expect(first.isError).toBe(false);

    const changeId = (await changeRowsFor(org.organizationId))[0]?.id ?? "";
    expect(changeId).not.toBe("");
    await moveToClosed(changeId);

    const late = await report(org.key, { ...input, description: "a different change, same page" });

    // An `ok` here would hand the agent a date that has already gone, and the description the
    // founder's verdict hangs on would have been rewritten underneath it.
    expect(late.isError).toBe(true);

    const rows = await changeRowsFor(org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe(CHANGE);
    expect(rows[0]?.state).toBe("closed");
  });

  test("a report landing after a readout that measured nothing is watched again, not turned away", async () => {
    const org = await freshOrg("re-report-unmeasured");
    const input = { description: CHANGE, page: PAGE, projectId: org.projectId };

    const first = await report(org.key, input);
    expect(first.isError).toBe(false);

    const before = (await changeRowsFor(org.organizationId))[0];
    expect(before?.id).toBeDefined();
    await moveToReadOutMeasuringNothing(before?.id ?? "");

    const again = await report(org.key, { ...input, description: "CSV export, second pass" });

    // "I already answered on that one" was false here — we told the founder we had nothing.
    expect(again.isError).toBe(false);
    expect(rendersTemplate(again.text, SHIPPED_WATCHING_AGAIN_TEMPLATE)).toBe(true);
    expect(rendersTemplate(again.text, SHIPPED_ALREADY_ANSWERED_TEMPLATE)).toBe(false);

    const rows = await changeRowsFor(org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("reported");
    expect(rows[0]?.description).toBe("CSV export, second pass");
    expect(rows[0]?.readoutDueAt.getTime()).toBeGreaterThan(
      before?.readoutDueAt.getTime() ?? Number.MAX_SAFE_INTEGER,
    );

    // The new date is announced in the channel too, not only to the assistant that asked.
    expect(await changeNotificationsFor(org.organizationId)).toHaveLength(2);
  });
});

describe("the page is written down the way the spine writes it", () => {
  const SPELLINGS = ["/Reports", "/reports/", "https://app.example.com/reports?t=1"] as const;

  test("every spelling of one page lands on one row under the canonical path", async () => {
    const org = await freshOrg("page-spelling");

    for (const page of SPELLINGS) {
      const answer = await report(org.key, {
        description: CHANGE,
        page,
        projectId: org.projectId,
      });

      expect({ page, isError: answer.isError }).toEqual({ page, isError: false });
    }

    // One row, because a stored `/Reports` matches nothing the spine holds and forks the change
    // key away from the same change reported with a trailing slash.
    const rows = await changeRowsFor(org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.page).toBe(PAGE);
  });

  test("a page address we cannot read is refused with the field named, and writes nothing", async () => {
    const org = await freshOrg("page-unreadable");

    const answer = await report(org.key, {
      description: CHANGE,
      page: "   ",
      projectId: org.projectId,
    });

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("page");

    expect(await changeRowsFor(org.organizationId)).toHaveLength(0);
  });

  test("an answer in words is refused out loud at report time, and writes nothing", async () => {
    // The caller is an LLM, so prose is the likeliest wrong input and the one a normalise-and-
    // accept policy cannot see: `/reports page` books a change key no visit ever joins, and the
    // agent learns nothing until the readout answers out of nothing a fortnight later.
    const org = await freshOrg("page-prose");

    for (const page of ["Reports page", "the reports page", "mailto:someone@example.test"]) {
      const answer = await report(org.key, { description: CHANGE, page, projectId: org.projectId });

      expect({ page, isError: answer.isError }).toEqual({ page, isError: true });

      // Errors instruct: the refusal names the field and shows the shape it wanted.
      expect(answer.text).toContain("page");
      expect(answer.text).toContain("/reports");
    }

    expect(await changeRowsFor(org.organizationId)).toHaveLength(0);
  });
});

describe("the agent may not choose the date it is marked on", () => {
  test("a report carrying its own readout date is refused with the rule named, and writes nothing", async () => {
    const dateIsOurs = await refusal("DATE_IS_OURS");
    const org = await freshOrg("date");

    expect(CALLER_DATE_KEYS.length).toBeGreaterThan(0);

    for (const key of CALLER_DATE_KEYS) {
      const answer = await report(org.key, {
        description: CHANGE,
        page: PAGE,
        projectId: org.projectId,
        [key]: "2026-08-23T00:00:00.000Z",
      });

      expect({ key, isError: answer.isError }).toEqual({ key, isError: true });
      expect({ key, text: answer.text }).toEqual({ key, text: dateIsOurs.message });
    }

    expect(await changeRowsFor(org.organizationId)).toHaveLength(0);
    expect(await changeNotificationsFor(org.organizationId)).toHaveLength(0);
    expect((await notificationRowsFor(org.organizationId)).length).toBeGreaterThan(0);
  });

  test("the refusal is a 400 that names the rule in plain English", async () => {
    const dateIsOurs = await refusal("DATE_IS_OURS");

    expect(dateIsOurs.status).toBe(400);
    expect(dateIsOurs.code).toBe("malformed_request");

    // "Names the rule": it says the date is ours and when we will answer, rather than only
    // reporting that a field was rejected.
    expect(dateIsOurs.message.toLowerCase()).toContain("date");
    expect(dateIsOurs.message.length).toBeGreaterThan(0);

    for (const jargon of FORBIDDEN_PRODUCT_JARGON) {
      expect(dateIsOurs.message.toLowerCase()).not.toContain(jargon);
    }
  });

  test("the control: the same report without a date is accepted, so the refusal is about the date", async () => {
    const org = await freshOrg("date-control");

    const answer = await report(org.key, {
      description: CHANGE,
      page: PAGE,
      projectId: org.projectId,
    });

    expect(answer.isError).toBe(false);
    expect(await changeRowsFor(org.organizationId)).toHaveLength(1);
  });
});

describe("a report that names no page is refused with the field named", () => {
  test("the refusal names page, carries a 400, and writes nothing", async () => {
    const org = await freshOrg("no-page");

    const answer = await report(org.key, { description: CHANGE, projectId: org.projectId });

    expect(answer.status).toBe(200);
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("page");
    expect(answer.text).toContain(reportShippedToolName());

    expect(await changeRowsFor(org.organizationId)).toHaveLength(0);
    expect(await changeNotificationsFor(org.organizationId)).toHaveLength(0);
    expect((await notificationRowsFor(org.organizationId)).length).toBeGreaterThan(0);
  });
});

describe("one organization cannot report against another's product (AC-G5, D7)", () => {
  test("org A reporting against org B's project id is refused as a 404 and writes nothing anywhere", async () => {
    const notOurProject = await refusal("NOT_OUR_PROJECT");
    const orgA = await freshOrg("tenant-a");
    const orgB = await freshOrg("tenant-b");

    const answer = await report(orgA.key, {
      description: CHANGE,
      page: PAGE,
      projectId: orgB.projectId,
    });

    expect(answer.isError).toBe(true);
    expect(answer.text).toBe(notOurProject.message);

    // Never a 403: a forbidden would confirm the guessed id names a real product.
    expect(notOurProject.status).toBe(404);
    expect(notOurProject.status).not.toBe(403);
    expect(notOurProject.code).toBe("not_found");

    // Nor may the refusal echo the id back, which would confirm it just as loudly.
    expect(notOurProject.message).not.toContain(orgB.projectId);
    expect(answer.body).not.toContain(orgB.projectId);

    expect(await changeRowsFor(orgA.organizationId)).toHaveLength(0);
    expect(await changeRowsFor(orgB.organizationId)).toHaveLength(0);

    // The control beside the refusal: org A reporting against its OWN project writes a row,
    // so the two empties above are about the tenant boundary and not about a dead write path.
    const own = await report(orgA.key, {
      description: CHANGE,
      page: PAGE,
      projectId: orgA.projectId,
    });
    expect(own.isError).toBe(false);
    expect(await changeRowsFor(orgA.organizationId)).toHaveLength(1);
    expect(await changeRowsFor(orgB.organizationId)).toHaveLength(0);
  });

  test("an unguessable id belonging to nobody answers exactly as another organization's id does", async () => {
    const notOurProject = await refusal("NOT_OUR_PROJECT");
    const org = await freshOrg("tenant-nobody");

    const answer = await report(org.key, {
      description: CHANGE,
      page: PAGE,
      projectId: randomUUID(),
    });

    expect(answer.isError).toBe(true);
    expect(answer.text).toBe(notOurProject.message);
    expect(await changeRowsFor(org.organizationId)).toHaveLength(0);
  });
});

describe("the wire says which tool writes (AC-G1)", () => {
  test("tools/list advertises report_shipped with readOnlyHint false and the other four with true", async () => {
    const org = await freshOrg("tools-list");
    const writeName = reportShippedToolName();

    const response = await POST(rpcRequest({ method: "tools/list", key: org.key }));
    const body = await response.text();

    expect(response.status).toBe(200);

    const tools = frameResultOf(body).tools;
    if (!Array.isArray(tools)) {
      throw new Error(`report_shipped: tools/list carried no tools array. Body: ${body}`);
    }

    const hints = new Map<string, unknown>();
    for (const entry of tools) {
      if (!isRecord(entry) || typeof entry.name !== "string") {
        throw new Error(`report_shipped: a tools/list entry carried no name. Body: ${body}`);
      }
      const annotations = entry.annotations;
      if (!isRecord(annotations)) {
        throw new Error(`report_shipped: ${entry.name} advertised no annotations. Body: ${body}`);
      }
      hints.set(entry.name, annotations.readOnlyHint);
    }

    expect(hints.get(writeName)).toBe(false);

    const reads = [...hints.entries()].filter(([name]) => name !== writeName);

    // Non-vacuity: four reads on the wire, or "every other tool is read-only" is a claim about
    // an empty set. The four-read pin is the load-bearing half of the outcome's own gate.
    expect(reads).toHaveLength(4);
    for (const [name, hint] of reads) {
      expect({ name, hint }).toEqual({ name, hint: true });
    }

    expect(hints.size).toBe(5);
    expect([...hints.entries()].filter(([, hint]) => hint === false).map(([name]) => name)).toEqual(
      [writeName],
    );
  });
});
