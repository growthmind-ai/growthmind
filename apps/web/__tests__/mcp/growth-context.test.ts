import { serialiseFixSpecInput } from "@growthmind/core";
import {
  createFindingPayloadsRepo,
  createFindingsRepo,
  createFixesService,
  schema,
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
  BUSINESS_FACT_HEADINGS,
  BUSINESS_FACT_NOTES,
  FIX_SURFACE_FORBIDDEN_REFUSALS,
  MCP_TOOL,
  SURFACE_ROLE_NOTES,
  fixSpecEnvelopeSchema,
  getGrowthContextOutputSchema,
  type TenantContext,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import { POST } from "../../app/api/mcp/route";
import { callTool } from "../../lib/mcp/call-tool";
import { toGrowthContextRecord } from "../../lib/mcp/dto";
import type { GrowthContextAnswer } from "../../lib/mcp/read-port";
import {
  candidateFor,
  credentialFor,
  fakeReadPort,
  mintRealApiKey,
  openFixRowFor,
  sseDataLine,
  toolCallRequest,
} from "./helpers/mcp-fixture";

const ORG = "org-growth-context";
const PROJECT = "project-growth-context";

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

function persistedCount(numerator: number, denominator: number) {
  return {
    numerator,
    denominator,
    unit: "sessions" as const,
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    basis: { totalInWindow: denominator, kept: denominator, setAside: [] },
  };
}

function answerFor(overrides: {
  surface?: string | null;
  changeable?: { allowed: boolean; reason: "pricing_or_billing" | null } | null;
  whatMatters?: readonly { surface: string; role: "makes_money"; confirmedByAPerson: boolean }[];
  knownProblems?: readonly {
    findingId: string;
    fixId: string | null;
    headline: string;
    affected: ReturnType<typeof persistedCount>;
    lastSeenAt: Date;
  }[];
  declined?: readonly { headline: string; declinedAt: Date }[];
  business?: readonly {
    kind: "regime" | "who_counts" | "catalogue_scale";
    statement: string;
    statedByAPerson: boolean;
    readFrom: string | null;
    observed: boolean;
    seen: { sessions: number; of: number; from: Date; to: Date } | null;
  }[];
}): GrowthContextAnswer {
  return {
    outcome: "answered",
    record: toGrowthContextRecord({
      projectId: PROJECT,
      surface: overrides.surface ?? null,
      changeable: overrides.changeable ?? null,
      whatMatters: overrides.whatMatters ?? [],
      knownProblems: overrides.knownProblems ?? [],
      declined: overrides.declined ?? [],
      business: overrides.business ?? [],
    }),
  };
}

async function ask(answer: GrowthContextAnswer, input: Record<string, unknown> = {}) {
  const port = fakeReadPort({ growthContexts: [{ organizationId: ORG, answer }] }).port;

  return callTool(MCP_TOOL.GET_GROWTH_CONTEXT, input, port, credentialFor(ORG));
}

describe("get_growth_context", () => {
  test("answers what a page is for, in a sentence a person could read", async () => {
    const outcome = await ask(
      answerFor({
        surface: "/checkout",
        changeable: { allowed: true, reason: null },
        whatMatters: [{ surface: "/checkout", role: "makes_money", confirmedByAPerson: true }],
      }),
      { surface: "/checkout" },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected an answer");

    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.whatMatters[0]?.matters).toBe(SURFACE_ROLE_NOTES.makes_money);
    expect(parsed.whatMatters[0]?.confirmedByAPerson).toBe(true);
    expect(parsed.nothingKnownYet).toBe(false);
  });

  test("says a page is out of bounds, and says why, before any work starts", async () => {
    // The §5 answer an agent needs at brief time rather than after it has written the change.
    const outcome = await ask(
      answerFor({
        surface: "/checkout",
        changeable: { allowed: false, reason: "pricing_or_billing" },
      }),
      { surface: "/checkout" },
    );

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.changeable?.allowed).toBe(false);
    expect(parsed.changeable?.reason).toBe(FIX_SURFACE_FORBIDDEN_REFUSALS.pricing_or_billing);
  });

  test("carries the ideas a person already turned down, so they are not raised again", async () => {
    const outcome = await ask(
      answerFor({
        surface: "/onboarding",
        changeable: { allowed: true, reason: null },
        declined: [
          { headline: "Ask for a company name on the first screen", declinedAt: WINDOW_END },
        ],
      }),
      { surface: "/onboarding" },
    );

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.declined).toHaveLength(1);
    expect(parsed.declined[0]?.headline).toBe("Ask for a company name on the first screen");
    expect(parsed.declined[0]?.declinedAt).toBe(WINDOW_END.toISOString());
  });

  test("answers without a page named, and withholds a verdict it was not asked for", async () => {
    const outcome = await ask(
      answerFor({
        surface: null,
        whatMatters: [{ surface: "/checkout", role: "makes_money", confirmedByAPerson: false }],
      }),
      {},
    );

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.surface).toBeNull();
    expect(parsed.changeable).toBeNull();
    expect(parsed.whatMatters).toHaveLength(1);
  });

  test("says plainly that nothing is known yet, which is not a refusal", async () => {
    const outcome = await ask(answerFor({ surface: null }), {});

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.nothingKnownYet).toBe(true);
    expect(parsed.whatMatters).toEqual([]);
    expect(parsed.knownProblems).toEqual([]);
  });

  test("names the ids to choose between when a person runs more than one product", async () => {
    // Errors instruct: the refusal is only useful if it carries the caller's next call.
    const outcome = await ask({
      outcome: "ambiguous_project",
      projectIds: ["project-one", "project-two"],
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a refusal");

    expect(outcome.refusal.code).toBe("ambiguous_project");
    expect(outcome.refusal.message).toContain("project-one");
    expect(outcome.refusal.message).toContain("project-two");
    expect(outcome.refusal.message).toContain("projectId");
  });

  test("tells an agent to carry on when there is nothing set up at all", async () => {
    const outcome = await ask({ outcome: "no_project" });

    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.refusal.status).toBe(404);
    expect(outcome.refusal.message).toContain("not a reason to stop");
  });

  test("refuses input it cannot read rather than guessing at it", async () => {
    const outcome = await ask(answerFor({ surface: null }), { surface: 42 });

    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.refusal.code).toBe("malformed_request");
  });

  test("reads a problem's count through the same wire shape every other tool uses", async () => {
    const outcome = await ask(
      answerFor({
        surface: "/onboarding",
        changeable: { allowed: true, reason: null },
        knownProblems: [
          {
            findingId: "finding-1",
            fixId: "fix-1",
            headline: "People stop at the second step",
            affected: persistedCount(19, 28),
            lastSeenAt: WINDOW_END,
          },
        ],
      }),
      { surface: "/onboarding" },
    );

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.knownProblems[0]?.affected.numerator).toBe(19);
    expect(parsed.knownProblems[0]?.affected.denominator).toBe(28);
    expect(parsed.knownProblems[0]?.fixId).toBe("fix-1");
  });

  // An agent handed "regime: licensed by the Gambling Commission" and nothing else has no
  // way to know it must not ship the change it was about to.
  test("says what a fact means and whether it can stop a change shipping", async () => {
    const outcome = await ask(
      answerFor({
        surface: null,
        business: [
          {
            kind: "regime",
            statement: "Licensed by the UK Gambling Commission",
            statedByAPerson: true,
            readFrom: null,
            observed: false,
            seen: null,
          },
          {
            kind: "catalogue_scale",
            statement: "Tens of thousands of products",
            statedByAPerson: false,
            readFrom: "https://example.com/",
            observed: false,
            seen: null,
          },
        ],
      }),
      {},
    );

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.business[0]?.about).toBe("regime");
    expect(parsed.business[0]?.heading).toBe(BUSINESS_FACT_HEADINGS.regime);
    expect(parsed.business[0]?.means).toBe(BUSINESS_FACT_NOTES.regime);
    expect(parsed.business[0]?.binding).toBe(true);
    expect(parsed.business[0]?.toldToUs).toBe(true);

    // A shaping fact decides how a change is built, never whether it ships.
    expect(parsed.business[1]?.binding).toBe(false);
    expect(parsed.business[1]?.readFrom).toBe("https://example.com/");

    expect(parsed.nothingKnownYet).toBe(false);
  });

  test("cites an observed fact by its count and denominator, never by a page", async () => {
    const outcome = await ask(
      answerFor({
        surface: null,
        business: [
          {
            kind: "who_counts",
            statement: "Most people who finish setup are working alone",
            statedByAPerson: false,
            readFrom: null,
            observed: true,
            seen: {
              sessions: 41,
              of: 60,
              from: new Date("2026-07-12T00:00:00.000Z"),
              to: new Date("2026-07-19T00:00:00.000Z"),
            },
          },
        ],
      }),
      {},
    );

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.business[0]?.observed).toBe(true);
    expect(parsed.business[0]?.seenIn).toBe("Seen in 41 of 60 sessions, 12 Jul to 19 Jul");
  });
});

describe("list_open_fixes keeps the order it was given", () => {
  test("does not re-sort the ranked list back into deadline order", async () => {
    // The read port ranks by expected value, which is what §6 means by urgency and what this
    // tool's description promises. A sort here on the readout date silently undid it.
    const soonest = openFixRowFor({
      fixId: "fix-later-deadline",
      findingId: "finding-worth-more",
      resultsBy: "2026-09-01T00:00:00.000Z",
    });
    const latest = openFixRowFor({
      fixId: "fix-sooner-deadline",
      findingId: "finding-worth-less",
      resultsBy: "2026-08-10T00:00:00.000Z",
    });

    const port = {
      listOpenFixes: () => Promise.resolve({ fixes: [soonest, latest], totalOpen: 2 }),
      getFix: () => Promise.resolve(null),
      getFinding: () => Promise.resolve(null),
      getGrowthContext: () => Promise.resolve({ outcome: "no_project" as const }),
    };

    const outcome = await callTool(MCP_TOOL.LIST_OPEN_FIXES, {}, port, credentialFor(ORG));

    if (!outcome.ok) throw new Error("expected an answer");
    const result = outcome.result as { fixes: readonly { fixId: string }[] };

    expect(result.fixes.map((fix) => fix.fixId)).toEqual([
      "fix-later-deadline",
      "fix-sooner-deadline",
    ]);
  });
});

// An address the residual scanner classifies as `email_address`, distinctive enough that
// finding it anywhere downstream can only be this row's persisted text.
const PII_OFFENDER = "dana.okonkwo@northwind.example";

const SEED_OWNER =
  "ADD O-021 Wave 1.4 (packages/db/src/testing/fixtures.ts — `seedUnscannedFinding`, the only " +
  "helper that writes a finding row whose persisted text never passed the residual scan)";

const SEED_MODULE = "packages/db/src/testing/index.ts";

const FIXES_SERVICE_SOURCE = path.join(
  import.meta.dir,
  "../../../../packages/db/src/services/fixes.service.ts",
);

const COLD_BOOT_BUDGET_MS = 60_000;

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

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[\t ]*\/\/.*$/gm, "");
}

function methodBodyOf(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`growth-context fixture: no \`${marker}\` in ${FIXES_SERVICE_SOURCE}`);
  }

  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`growth-context fixture: \`${marker}\` has no closing brace`);
}

interface LiveOrg {
  readonly label: string;
  readonly ctx: TenantContext;
  readonly projectId: string;
  readonly runId: string;
  readonly key: string;
}

interface LiveAnswer {
  readonly status: number;
  readonly body: string;
  readonly structured: unknown;
}

async function askLive(org: LiveOrg, tool: string, input: unknown = {}): Promise<LiveAnswer> {
  const response = await POST(toolCallRequest({ tool, input, key: org.key }));
  const body = await response.text();
  const frame = JSON.parse(sseDataLine(body)) as { result?: { structuredContent?: unknown } };

  return { status: response.status, body, structured: frame.result?.structuredContent };
}

describe("get_growth_context and get_fix over real rows, driven through POST /api/mcp", () => {
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

  async function freshOrg(): Promise<LiveOrg> {
    seq += 1;
    const label = `growth${String(seq)}`;

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

  async function attachPayload(org: LiveOrg, findingId: string, surface: string): Promise<void> {
    await createFindingPayloadsRepo(handle.db, org.ctx).upsertFor({
      findingId,
      payload: serialiseFixSpecInput({ candidate: candidateFor(surface), signals: [] }),
    });
  }

  async function seedCleanFinding(
    org: LiveOrg,
    input: { readonly surface: string; readonly headline: string },
  ): Promise<string> {
    const text = scannedTextFor(input.headline, ["One line of context, never a blob."]);
    const record = await createFindingsRepo(handle.db, org.ctx).persist({
      projectId: org.projectId,
      runId: org.runId,
      signature: randomUUID(),
      signatureVersion: 1,
      summarySource: "model_rendered",
      headline: text.headline,
      context: text.context,
      finalClass: "confusing",
      surface: input.surface,
      surfaceNormalisationVersion: 1,
      counts: [],
      confidenceBasis: "threshold_met",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      evidenceShape: `evidence-${org.label}-${input.surface}`,
      evidenceShapeVersion: 1,
      resolvedModelId: null,
    });

    return record.id;
  }

  async function seedHeldFinding(org: LiveOrg, surface: string): Promise<string> {
    const seed = await loadSeedUnscannedFinding();

    const row = await seed(handle.db, {
      ctx: org.ctx,
      projectId: org.projectId,
      runId: org.runId,
      signature: randomUUID(),
      headline: `Someone typed ${PII_OFFENDER} into the box before leaving.`,
      context: ["One line of context, never a blob."],
      surface,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      evidenceShape: `evidence-${org.label}-${surface}`,
    });

    return row.id;
  }

  async function decline(org: LiveOrg, findingId: string, dismissedAt: Date): Promise<void> {
    await handle.db.insert(schema.dismissals).values({
      organizationId: org.ctx.organizationId,
      projectId: org.projectId,
      findingId,
      signature: randomUUID(),
      action: "not_useful",
      dismissedAt,
    });
  }

  test("get_growth_context omits a knownProblems/declined entry with a planted PII offender, driven through POST /api/mcp", async () => {
    const org = await freshOrg();

    const known = await seedCleanFinding(org, {
      surface: "/growth/onboarding",
      headline: "People stop at the second step",
    });
    await attachPayload(org, known, "/growth/onboarding");

    const heldKnown = await seedHeldFinding(org, "/growth/held-known");
    await attachPayload(org, heldKnown, "/growth/held-known");

    const declined = await seedCleanFinding(org, {
      surface: "/growth/declined",
      headline: "Ask for a company name on the first screen",
    });
    await decline(org, declined, WINDOW_END);

    const heldDeclined = await seedHeldFinding(org, "/growth/held-declined");
    await decline(org, heldDeclined, WINDOW_START);

    const answer = await askLive(org, MCP_TOOL.GET_GROWTH_CONTEXT);

    expect(answer.status).toBe(200);

    const parsed = getGrowthContextOutputSchema.parse(answer.structured);

    expect(parsed.knownProblems.map((problem) => problem.findingId)).toEqual([known]);
    expect(parsed.declined.map((idea) => idea.headline)).toEqual([
      "Ask for a company name on the first screen",
    ]);
    expect(answer.body).not.toContain(PII_OFFENDER);
  });

  test("get_fix never reads findings.headline or findings.context for any candidate", async () => {
    const readFix = methodBodyOf(
      withoutComments(readFileSync(FIXES_SERVICE_SOURCE, "utf8")),
      "async readFix(",
    );

    expect(readFix).not.toContain("findings.");

    const org = await freshOrg();
    const heldId = await seedHeldFinding(org, "/growth/held-fix");
    await attachPayload(org, heldId, "/growth/held-fix");

    const opened = await createFixesService(handle.db, org.ctx).openFor(heldId);
    if (opened.outcome !== "opened") {
      throw new Error(`growth-context fixture: openFor answered "${opened.outcome}"`);
    }

    const answer = await askLive(org, MCP_TOOL.GET_FIX, { fixId: opened.fix.id });
    const envelope = fixSpecEnvelopeSchema.parse(answer.structured);

    expect(envelope.findingId).toBe(heldId);
    expect(envelope.specText.length).toBeGreaterThan(0);
  });
});
