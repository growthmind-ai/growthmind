import { createHmac, randomUUID } from "node:crypto";

import type { EvidenceSignal, FixSpecPayload, MeasuredCount } from "@growthmind/core";
import {
  measuredCount,
  rehydrateFixSpecInput,
  renderFixSpec,
  serialiseFixSpecInput,
} from "@growthmind/core";
import {
  createFindingPayloadsRepo,
  createFindingsRepo,
  createFixesService,
  type FindingRecord,
  type ScopedDb,
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
  LIST_OPEN_FIXES_MAX_ITEMS,
  MCP_TOOL,
  fixSpecEnvelopeSchema,
  getFindingOutputSchema,
  listOpenFixesOutputSchema,
  setLogSink,
  type LogRecord,
  type TenantContext,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import { POST } from "../../app/api/mcp/route";
import { NOT_FOUND, UNAVAILABLE } from "../../lib/mcp/refusals";
import {
  WINDOW_END,
  WINDOW_START,
  candidateFor,
  mintRealApiKey,
  sseDataLine,
  toolCallRequest,
} from "./helpers/mcp-fixture";

const KEPT = 25;

const EVENT_NAME = "checkout_payment_failed";

const CONTEXT_MARKER = "a sentence only this finding's narrative carries";

const CLEAN_TEXT = scannedTextFor(
  "People are leaving the reports page without going any further.",
  [CONTEXT_MARKER],
);

// An address the residual scanner classifies as `email_address`, distinctive enough that
// finding it anywhere downstream can only be this row's persisted text.
const PII_OFFENDER = "dana.okonkwo@northwind.example";

const SEED_OWNER =
  "ADD O-021 Wave 1.4 (packages/db/src/testing/fixtures.ts — `seedUnscannedFinding`, the only " +
  "helper that writes a finding row whose persisted text never passed the residual scan)";

const SEED_MODULE = "packages/db/src/testing/index.ts";

interface SeedUnscannedFindingParams {
  readonly ctx: TenantContext;
  readonly projectId: string;
  readonly runId: string;
  readonly headline: string;
  readonly context: readonly string[];
  readonly signature?: string;
  readonly surface?: string;
  readonly windowStart?: Date;
  readonly windowEnd?: Date;
  readonly createdAt?: Date;
  readonly evidenceShape?: string;
}

type SeedUnscannedFinding = (
  db: ScopedDb,
  params: SeedUnscannedFindingParams,
) => Promise<{ readonly id: string }>;

function loadSeedUnscannedFinding(): Promise<SeedUnscannedFinding> {
  return loadUnderConstruction<SeedUnscannedFinding>({
    modulePath: underConstructionSpecifier(SEED_MODULE),
    exportName: "seedUnscannedFinding",
    ownedBy: SEED_OWNER,
  });
}

const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

interface SeededOrg {
  readonly label: string;
  readonly ctx: TenantContext;
  readonly projectId: string;
  readonly runId: string;
  readonly key: string;
}

interface SeededFinding {
  readonly finding: FindingRecord;
  readonly payload: FixSpecPayload;
}

let handle: TestDbHandle;
let seq = 0;

function count(numerator: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: KEPT,
    unit: "sessions",
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    basis: { totalInWindow: KEPT, kept: KEPT, setAside: [] },
  });
}

function signalsFor(surface: string): readonly EvidenceSignal[] {
  return [
    {
      kind: "failure_correlated",
      eventName: EVENT_NAME,
      occurredAt: WINDOW_END,
      precedingActionName: "pressed pay",
      correlationWindowMs: 5_000,
      correlatedSessions: count(4),
    },
    {
      kind: "struggle",
      subkind: "repeated_attempt",
      surface,
      attempts: 3,
      strugglingSessions: count(6),
    },
  ];
}

function digestFor(seed: string): string {
  return createHmac("sha256", "live-reads-fixture").update(seed).digest("hex");
}

async function freshOrg(): Promise<SeededOrg> {
  seq += 1;
  const label = `live${String(seq)}`;

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
  const key = (await mintRealApiKey(handle.db, ctx, `agent-${label}`)).raw;

  return { label, ctx, projectId: project.id, runId: run.id, key };
}

async function seedFinding(org: SeededOrg, surface: string): Promise<FindingRecord> {
  return createFindingsRepo(handle.db, org.ctx).persist({
    projectId: org.projectId,
    runId: org.runId,
    signature: digestFor(`${org.label}${surface}`),
    signatureVersion: 1,
    summarySource: "model_rendered",
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
    finalClass: "confusing",
    surface,
    surfaceNormalisationVersion: 1,
    counts: [],
    confidenceBasis: "threshold_met",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: `evidence-${org.label}-${surface}`,
    evidenceShapeVersion: 1,
    resolvedModelId: null,
  });
}

async function seedFindingWithPayload(org: SeededOrg, surface: string): Promise<SeededFinding> {
  const finding = await seedFinding(org, surface);

  const payload = serialiseFixSpecInput({
    candidate: candidateFor(surface),
    signals: signalsFor(surface),
  });

  await createFindingPayloadsRepo(handle.db, org.ctx).upsertFor({
    findingId: finding.id,
    payload,
  });

  return { finding, payload };
}

// A row that reaches the table without passing the persist-time scan — the pre-sprint
// population. It carries a payload, so every read below would answer a record if the
// read-time gate were absent.
async function seedHeldFindingWithPayload(org: SeededOrg, surface: string): Promise<string> {
  const seed = await loadSeedUnscannedFinding();

  const row = await seed(handle.db, {
    ctx: org.ctx,
    projectId: org.projectId,
    runId: org.runId,
    signature: digestFor(`${org.label}${surface}held`),
    headline: `Someone typed ${PII_OFFENDER} into the box before leaving.`,
    context: [CONTEXT_MARKER],
    surface,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: `evidence-${org.label}-${surface}`,
  });

  await createFindingPayloadsRepo(handle.db, org.ctx).upsertFor({
    findingId: row.id,
    payload: serialiseFixSpecInput({
      candidate: candidateFor(surface),
      signals: signalsFor(surface),
    }),
  });

  return row.id;
}

async function mintFix(org: SeededOrg, findingId: string): Promise<string> {
  const result = await createFixesService(handle.db, org.ctx).openFor(findingId);
  if (result.outcome !== "opened") {
    throw new Error(`live-reads fixture: openFor answered "${result.outcome}", not "opened"`);
  }
  return result.fix.id;
}

interface ToolAnswer {
  readonly status: number;
  readonly body: string;
  readonly structured: unknown;
  readonly text: string;
}

async function callTool(key: string, tool: string, input: unknown = {}): Promise<ToolAnswer> {
  const response = await POST(toolCallRequest({ tool, input, key }));
  const body = await response.text();

  if (!body.startsWith("event: message")) {
    return { status: response.status, body, structured: undefined, text: body };
  }

  const frame = JSON.parse(sseDataLine(body)) as {
    result?: { structuredContent?: unknown; content?: readonly { text?: string }[] };
  };

  return {
    status: response.status,
    body,
    structured: frame.result?.structuredContent,
    text: (frame.result?.content ?? []).map((entry) => entry.text ?? "").join("\n"),
  };
}

beforeAll(async () => {
  handle = await createTestDb();
  globalForDb.__growthmindDb = handle.db;
});

afterAll(async () => {
  delete globalForDb.__growthmindDb;
  await handle.close();
});

describe("the MCP route reading real rows", () => {
  test("returns a real fix through the MCP route entry point, not the read port", async () => {
    const org = await freshOrg();
    const seeded = await seedFindingWithPayload(org, "/live/reports");
    const fixId = await mintFix(org, seeded.finding.id);

    const answer = await callTool(org.key, MCP_TOOL.LIST_OPEN_FIXES);

    expect(answer.status).toBe(200);

    const output = listOpenFixesOutputSchema.parse(answer.structured);

    expect(output.fixes).toHaveLength(1);
    expect(output.fixes[0]?.fixId).toBe(fixId);
    expect(output.fixes[0]?.findingId).toBe(seeded.finding.id);
    expect(output.window).toEqual({ returned: 1, totalOpen: 1, truncated: false });
  });

  test("answers empty-but-valid for an organization with no fixes", async () => {
    const empty = await freshOrg();

    const answer = await callTool(empty.key, MCP_TOOL.LIST_OPEN_FIXES);

    expect(answer.status).toBe(200);
    expect(JSON.stringify(answer.structured)).toBe(
      '{"fixes":[],"window":{"returned":0,"totalOpen":0,"truncated":false}}',
    );

    // The control: empty must mean "this organization has nothing", never "nothing is
    // ever read". A sibling organization with one fix has to answer one.
    const stocked = await freshOrg();
    const seeded = await seedFindingWithPayload(stocked, "/live/empty-control");
    await mintFix(stocked, seeded.finding.id);

    const sibling = listOpenFixesOutputSchema.parse(
      (await callTool(stocked.key, MCP_TOOL.LIST_OPEN_FIXES)).structured,
    );
    expect(sibling.window).toEqual({ returned: 1, totalOpen: 1, truncated: false });
  });

  test("returns one fix at limit 1 and caps at 25", async () => {
    const org = await freshOrg();

    for (let index = 0; index < 30; index += 1) {
      const seeded = await seedFindingWithPayload(org, `/live/step-${String(index)}`);
      await mintFix(org, seeded.finding.id);
    }

    const one = listOpenFixesOutputSchema.parse(
      (await callTool(org.key, MCP_TOOL.LIST_OPEN_FIXES, { limit: 1 })).structured,
    );

    expect(one.fixes).toHaveLength(1);
    expect(one.window).toEqual({ returned: 1, totalOpen: 30, truncated: true });

    const capped = listOpenFixesOutputSchema.parse(
      (await callTool(org.key, MCP_TOOL.LIST_OPEN_FIXES)).structured,
    );

    expect(capped.fixes).toHaveLength(LIST_OPEN_FIXES_MAX_ITEMS);
    expect(capped.window).toEqual({
      returned: LIST_OPEN_FIXES_MAX_ITEMS,
      totalOpen: 30,
      truncated: true,
    });
  });

  test("renders fix-spec sentences from a stored spec input", async () => {
    const org = await freshOrg();
    const seeded = await seedFindingWithPayload(org, "/live/exports");
    const fixId = await mintFix(org, seeded.finding.id);

    const answer = await callTool(org.key, MCP_TOOL.GET_FIX, { fixId });

    expect(answer.status).toBe(200);

    const envelope = fixSpecEnvelopeSchema.parse(answer.structured);
    const expected = renderFixSpec(rehydrateFixSpecInput(seeded.payload));

    expect(envelope.specText).toBe(expected.sentences.join("\n"));
    expect(envelope.findingId).toBe(seeded.finding.id);
    expect(envelope.status).toBe("open");
  });

  test("answers a finding with the observations behind it", async () => {
    const org = await freshOrg();
    const surface = "/live/signup";
    const seeded = await seedFindingWithPayload(org, surface);
    await mintFix(org, seeded.finding.id);

    const answer = await callTool(org.key, MCP_TOOL.GET_FINDING, {
      findingId: seeded.finding.id,
    });

    expect(answer.status).toBe(200);

    const output = getFindingOutputSchema.parse(answer.structured);

    expect(output.evidence.length).toBeGreaterThanOrEqual(1);

    const observed = new Set([EVENT_NAME, surface]);
    for (const row of output.evidence) {
      expect({ label: row.label, observed: observed.has(row.label) }).toEqual({
        label: row.label,
        observed: true,
      });
    }
  });

  test("refuses a finding it has no observations for rather than inventing them", async () => {
    const org = await freshOrg();

    // The control: a sibling finding in the same organization, with a payload, answers a
    // real record — so the refusal below cannot pass by nothing ever being read.
    const answerable = await seedFindingWithPayload(org, "/live/answerable");
    const answered = await callTool(org.key, MCP_TOOL.GET_FINDING, {
      findingId: answerable.finding.id,
    });
    expect(getFindingOutputSchema.parse(answered.structured).findingId).toBe(answerable.finding.id);

    const finding = await seedFinding(org, "/live/no-payload");

    const answer = await callTool(org.key, MCP_TOOL.GET_FINDING, { findingId: finding.id });

    expect(answer.status).toBe(200);
    expect(answer.text).toBe(NOT_FOUND.message);
    expect(answer.body).not.toContain(UNAVAILABLE.message);

    const text = finding.text;
    if (text.held) throw new Error("the seeded finding is the clean control and must not hold");

    for (const sentence of text.context) {
      expect(answer.body).not.toContain(sentence);
    }
    expect(answer.body).not.toContain(CONTEXT_MARKER);
  });
});

describe("the MCP route withholding a row whose persisted text is held (O-021)", () => {
  test("get_finding returns null for a persisted finding with a planted PII offender, driven through POST /api/mcp", async () => {
    const org = await freshOrg();

    // The control: a clean sibling in the same organization answers a real record, so the
    // refusal below cannot pass by nothing ever being read.
    const clean = await seedFindingWithPayload(org, "/live/held-control");
    const control = await callTool(org.key, MCP_TOOL.GET_FINDING, {
      findingId: clean.finding.id,
    });
    expect(getFindingOutputSchema.parse(control.structured).findingId).toBe(clean.finding.id);

    const heldId = await seedHeldFindingWithPayload(org, "/live/held-finding");

    const answer = await callTool(org.key, MCP_TOOL.GET_FINDING, { findingId: heldId });

    expect(answer.status).toBe(200);
    expect(answer.text).toBe(NOT_FOUND.message);
    expect(answer.body).not.toContain(UNAVAILABLE.message);
    expect(answer.body).not.toContain(PII_OFFENDER);
  });

  test("list_open_fixes omits a row with a planted PII offender and totalOpen reflects the omission, driven through POST /api/mcp", async () => {
    const org = await freshOrg();

    const clean = await seedFindingWithPayload(org, "/live/open-clean");
    const cleanFixId = await mintFix(org, clean.finding.id);

    const heldId = await seedHeldFindingWithPayload(org, "/live/open-held");
    await mintFix(org, heldId);

    const answer = await callTool(org.key, MCP_TOOL.LIST_OPEN_FIXES);

    expect(answer.status).toBe(200);

    const output = listOpenFixesOutputSchema.parse(answer.structured);

    expect(output.fixes.map((fix) => fix.fixId)).toEqual([cleanFixId]);
    expect(output.window).toEqual({ returned: 1, totalOpen: 1, truncated: false });
    expect(answer.body).not.toContain(PII_OFFENDER);
  });

  test("no MCP response body or log argument for a held finding contains the planted offender", async () => {
    const org = await freshOrg();
    const heldId = await seedHeldFindingWithPayload(org, "/live/held-logs");
    await mintFix(org, heldId);

    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });

    let bodies: string;
    try {
      const read = await callTool(org.key, MCP_TOOL.GET_FINDING, { findingId: heldId });
      const listed = await callTool(org.key, MCP_TOOL.LIST_OPEN_FIXES);
      bodies = `${read.body}\n${listed.body}`;
    } finally {
      restore();
    }

    // The withhold has to have been logged at all, or the search below is of an empty
    // haystack and reports green over nothing.
    expect(logged.filter((record) => record.level === "error").length).toBeGreaterThan(0);

    expect(bodies).not.toContain(PII_OFFENDER);
    expect(JSON.stringify(logged)).not.toContain(PII_OFFENDER);
  });
});
