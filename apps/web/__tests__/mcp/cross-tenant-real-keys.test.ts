import { createHmac } from "node:crypto";

import { serialiseFixSpecInput } from "@growthmind/core";
import {
  createApiKeysRepo,
  createFindingPayloadsRepo,
  createFindingsRepo,
  createFixesService,
  resolveApiKeyPrincipal,
  API_KEY_ACTOR_PREFIX,
  API_KEY_ACTOR_ROLE,
} from "@growthmind/db";
import {
  createTestDb,
  scannedTextFor,
  seedAnalysisRun,
  seedMember,
  seedProject,
  type TestDbHandle,
} from "@growthmind/db/testing";
import { MCP_TOOL, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { POST } from "../../app/api/mcp/route";
import { createApiKeyMcpCredentials } from "../../lib/mcp/credentials";
import { NOT_FOUND, UNAVAILABLE } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  buildTestTenantContext,
  createTestAuth,
  createTestOrganization,
  signUpTestUser,
} from "../tenancy/helpers/auth-fixture";
import {
  candidateFor,
  fakeReadPort,
  findingRecordFor,
  fingerprint,
  fixRecordFor,
  mintRealApiKey,
  openFixRowFor,
  sseDataLine,
  toolCallRequest,
} from "./helpers/mcp-fixture";

const TEST_PASSWORD = "correct-horse-battery-staple";

const CLEAN_TEXT = scannedTextFor(
  "People are leaving the reports page without going any further.",
  ["We saw sessions reach the reports page and stop there."],
);

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

function notFoundFrame(id: number = 1): string {
  const payload = JSON.stringify({
    result: { content: [{ type: "text", text: NOT_FOUND.message }], isError: true },
    jsonrpc: "2.0",
    id,
  });
  return `event: message\ndata: ${payload}\n\n`;
}

const NEVER_ISSUED_FIX = "fix-mcpxk-never-issued";
const NEVER_ISSUED_FINDING = "finding-mcpxk-never-issued";
const NEVER_ISSUED_PROJECT = "project-mcpxk-never-issued";

const ORG_A_FIX_ID = "fix-mcpxk-a-1";
const ORG_A_FINDING_ID = "finding-mcpxk-a-1";
const ORG_A_PROJECT_ID = "project-mcpxk-a";

const ORG_B_FIX_ID = "fix-mcpxk-b-1";
const ORG_B_FINDING_ID = "finding-mcpxk-b-1";
const ORG_B_PROJECT_ID = "project-mcpxk-b";

const RESULTS_BY = "2026-07-01T00:00:00.000Z";

let dbHandle: TestDbHandle;
let ctxA: TenantContext;
let ctxB: TenantContext;
let keyA: string;
let keyB: string;
let keyAId: string;
let keyBId: string;

const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

beforeAll(async () => {
  dbHandle = await createTestDb();
  globalForDb.__growthmindDb = dbHandle.db;
  const auth = createTestAuth(dbHandle.db);

  const ownerA = await signUpTestUser(auth, {
    name: "Owner Mcpxk A",
    email: "owner-a-mcpxk@example.com",
    password: TEST_PASSWORD,
  });
  const organizationA = await createTestOrganization(dbHandle.db, {
    name: "Org Mcpxk A",
    ownerUserId: ownerA.id,
  });
  ctxA = await buildTestTenantContext(dbHandle.db, {
    userId: ownerA.id,
    organizationId: organizationA.id,
  });

  const ownerB = await signUpTestUser(auth, {
    name: "Owner Mcpxk B",
    email: "owner-b-mcpxk@example.com",
    password: TEST_PASSWORD,
  });
  const organizationB = await createTestOrganization(dbHandle.db, {
    name: "Org Mcpxk B",
    ownerUserId: ownerB.id,
  });
  ctxB = await buildTestTenantContext(dbHandle.db, {
    userId: ownerB.id,
    organizationId: organizationB.id,
  });

  const mintedA = await createApiKeysRepo(dbHandle.db, ctxA).mint({ name: "agent-mcpxk-a" });
  const mintedB = await createApiKeysRepo(dbHandle.db, ctxB).mint({ name: "agent-mcpxk-b" });
  keyA = mintedA.raw;
  keyB = mintedB.raw;
  keyAId = mintedA.key.id;
  keyBId = mintedB.key.id;

  expect(ctxA.organizationId).not.toBe(ctxB.organizationId);
  expect(keyA).not.toBe(keyB);
});

afterAll(async () => {
  delete globalForDb.__growthmindDb;
  await dbHandle.close();
});

function twoOrgStore() {
  return fakeReadPort({
    openFixes: [
      {
        organizationId: ctxA.organizationId,
        projectId: ORG_A_PROJECT_ID,
        row: openFixRowFor({
          fixId: ORG_A_FIX_ID,
          findingId: ORG_A_FINDING_ID,
          resultsBy: RESULTS_BY,
        }),
      },
      {
        organizationId: ctxB.organizationId,
        projectId: ORG_B_PROJECT_ID,
        row: openFixRowFor({
          fixId: ORG_B_FIX_ID,
          findingId: ORG_B_FINDING_ID,
          resultsBy: RESULTS_BY,
        }),
      },
    ],
    fixes: [
      {
        organizationId: ctxA.organizationId,
        record: fixRecordFor({
          fixId: ORG_A_FIX_ID,
          findingId: ORG_A_FINDING_ID,
          resultsBy: RESULTS_BY,
        }),
      },
      {
        organizationId: ctxB.organizationId,
        record: fixRecordFor({
          fixId: ORG_B_FIX_ID,
          findingId: ORG_B_FINDING_ID,
          resultsBy: RESULTS_BY,
        }),
      },
    ],
    findings: [
      {
        organizationId: ctxA.organizationId,
        record: findingRecordFor({ findingId: ORG_A_FINDING_ID, fixId: ORG_A_FIX_ID }),
      },
      {
        organizationId: ctxB.organizationId,
        record: findingRecordFor({ findingId: ORG_B_FINDING_ID, fixId: ORG_B_FIX_ID }),
      },
    ],
  });
}

function depsFor(reads: ReturnType<typeof twoOrgStore>): McpServerDeps {
  return { credentials: createApiKeyMcpCredentials(dbHandle.db), reads: reads.port };
}

async function callWith(
  reads: ReturnType<typeof twoOrgStore>,
  key: string,
  tool: string,
  input: unknown,
): Promise<Response> {
  return handleMcpRequest(toolCallRequest({ tool, input, key }), depsFor(reads));
}

describe("two real organizations, two real credentials, and no way from one to the other", () => {
  test("WIRE-XR1 — should answer another organization's fix id exactly as an id that does not exist", async () => {
    const reads = twoOrgStore();

    const owned = await fingerprint(
      await callWith(reads, keyB, MCP_TOOL.GET_FIX, { fixId: ORG_B_FIX_ID }),
    );
    expect(owned.status).toBe(200);
    expect(owned.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(owned.body).toContain(ORG_B_FIX_ID);
    expect(owned.body).not.toContain(NOT_FOUND.message);

    const foreign = await fingerprint(
      await callWith(reads, keyA, MCP_TOOL.GET_FIX, { fixId: ORG_B_FIX_ID }),
    );
    const absent = await fingerprint(
      await callWith(reads, keyA, MCP_TOOL.GET_FIX, { fixId: NEVER_ISSUED_FIX }),
    );

    expect(foreign.status).toBe(200);
    expect(foreign.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(foreign).toEqual(absent);

    expect(foreign.body).toEqual(notFoundFrame());
  });

  test("WIRE-XR2 — should answer another organization's finding id exactly as an id that does not exist", async () => {
    const reads = twoOrgStore();

    const owned = await fingerprint(
      await callWith(reads, keyB, MCP_TOOL.GET_FINDING, { findingId: ORG_B_FINDING_ID }),
    );
    expect(owned.status).toBe(200);
    expect(owned.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(owned.body).toContain(ORG_B_FINDING_ID);
    expect(owned.body).not.toContain(NOT_FOUND.message);

    const foreign = await fingerprint(
      await callWith(reads, keyA, MCP_TOOL.GET_FINDING, { findingId: ORG_B_FINDING_ID }),
    );
    const absent = await fingerprint(
      await callWith(reads, keyA, MCP_TOOL.GET_FINDING, { findingId: NEVER_ISSUED_FINDING }),
    );

    expect(foreign.status).toBe(200);
    expect(foreign.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(foreign).toEqual(absent);
    expect(foreign.body).toEqual(notFoundFrame());
  });

  test("WIRE-XR3 — should answer another organization's project id exactly as a project id that does not exist", async () => {
    const reads = twoOrgStore();

    const owned = await fingerprint(
      await callWith(reads, keyB, MCP_TOOL.LIST_OPEN_FIXES, { projectId: ORG_B_PROJECT_ID }),
    );
    expect(owned.status).toBe(200);
    expect(owned.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(owned.body).toContain(ORG_B_FIX_ID);
    expect(owned.body).toContain('"totalOpen":1');

    const foreign = await fingerprint(
      await callWith(reads, keyA, MCP_TOOL.LIST_OPEN_FIXES, { projectId: ORG_B_PROJECT_ID }),
    );
    const absent = await fingerprint(
      await callWith(reads, keyA, MCP_TOOL.LIST_OPEN_FIXES, { projectId: NEVER_ISSUED_PROJECT }),
    );

    expect(foreign.status).toBe(200);
    expect(foreign.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(foreign).toEqual(absent);

    expect(foreign.body).toContain('"totalOpen":0');
    expect(foreign.body).not.toContain(ORG_B_FIX_ID);
  });

  test("WIRE-XR4 — should scope every read to the organization the credential resolves to, never the request", async () => {
    const reads = twoOrgStore();

    await callWith(reads, keyA, MCP_TOOL.LIST_OPEN_FIXES, {
      organizationId: ctxB.organizationId,
      projectId: ORG_B_PROJECT_ID,
    });
    await callWith(reads, keyA, MCP_TOOL.GET_FIX, {
      organizationId: ctxB.organizationId,
      fixId: ORG_B_FIX_ID,
    });
    await callWith(reads, keyA, MCP_TOOL.GET_FINDING, {
      organizationId: ctxB.organizationId,
      findingId: ORG_B_FINDING_ID,
    });

    expect(reads.organizationsAsked).toHaveLength(3);
    expect(reads.organizationsAsked.every((id) => id === ctxA.organizationId)).toBe(true);
    expect(reads.organizationsAsked).not.toContain(ctxB.organizationId);

    const mirror = twoOrgStore();
    await callWith(mirror, keyB, MCP_TOOL.LIST_OPEN_FIXES, {
      organizationId: ctxA.organizationId,
      projectId: ORG_A_PROJECT_ID,
    });
    await callWith(mirror, keyB, MCP_TOOL.GET_FIX, {
      organizationId: ctxA.organizationId,
      fixId: ORG_A_FIX_ID,
    });
    await callWith(mirror, keyB, MCP_TOOL.GET_FINDING, {
      organizationId: ctxA.organizationId,
      findingId: ORG_A_FINDING_ID,
    });

    expect(mirror.organizationsAsked).toHaveLength(3);
    expect(mirror.organizationsAsked.every((id) => id === ctxB.organizationId)).toBe(true);
    expect(mirror.organizationsAsked).not.toContain(ctxA.organizationId);
  });

  test("should never resolve one organization's credential to the other organization", async () => {
    const resolvedA = await resolveApiKeyPrincipal(dbHandle.db, keyA);
    const resolvedB = await resolveApiKeyPrincipal(dbHandle.db, keyB);

    expect(resolvedA).toEqual({
      userId: `${API_KEY_ACTOR_PREFIX}${keyAId}`,
      organizationId: ctxA.organizationId,
      organizationName: ctxA.organizationName,
      role: API_KEY_ACTOR_ROLE,
    });
    expect(resolvedB).toEqual({
      userId: `${API_KEY_ACTOR_PREFIX}${keyBId}`,
      organizationId: ctxB.organizationId,
      organizationName: ctxB.organizationName,
      role: API_KEY_ACTOR_ROLE,
    });

    expect(resolvedA?.organizationId).not.toBe(ctxB.organizationId);
    expect(resolvedB?.organizationId).not.toBe(ctxA.organizationId);
  });
});

const LIVE_SURFACE = "/mcpxk/reports";

interface LiveFixture {
  readonly findingId: string;
  readonly fixId: string;
}

async function seedLiveFixInOrgB(): Promise<LiveFixture> {
  const project = await seedProject(dbHandle.db, {
    organizationId: ctxB.organizationId,
    name: "Mcpxk Live",
  });
  const run = await seedAnalysisRun(dbHandle.db, { ctx: ctxB, projectId: project.id });

  const finding = await createFindingsRepo(dbHandle.db, ctxB).persist({
    projectId: project.id,
    runId: run.id,
    signature: createHmac("sha256", "mcpxk").update(LIVE_SURFACE).digest("hex"),
    signatureVersion: 1,
    detector: "funnel_dropoff",
    summarySource: "model_rendered",
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
    finalClass: "confusing",
    surface: LIVE_SURFACE,
    surfaceNormalisationVersion: 1,
    counts: [],
    confidenceBasis: "threshold_met",
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-08T00:00:00.000Z"),
    evidenceShape: "mcpxk-live-evidence",
    evidenceShapeVersion: 1,
    resolvedModelId: null,
  });

  await createFindingPayloadsRepo(dbHandle.db, ctxB).upsertFor({
    findingId: finding.id,
    payload: serialiseFixSpecInput({ candidate: candidateFor(LIVE_SURFACE), signals: [] }),
  });

  const opened = await createFixesService(dbHandle.db, ctxB).openFor(finding.id);
  if (opened.outcome !== "opened" && opened.outcome !== "already_open") {
    throw new Error(`cross-tenant fixture: openFor answered "${opened.outcome}"`);
  }

  return { findingId: finding.id, fixId: opened.fix.id };
}

// WIRE-R10 bans parsed comparison in this suite: a partial match here is how a
// refusal's byte identity quietly drifts. The frame is returned unparsed and every
// assertion below reads it as bytes.
async function liveCall(key: string, tool: string, input: unknown) {
  const response = await POST(toolCallRequest({ tool, input, key }));
  const body = await response.text();

  return {
    status: response.status,
    body,
    frame: body.startsWith("event: message") ? sseDataLine(body) : body,
  };
}

describe("the mounted route reading real rows for two real organizations", () => {
  test("refuses org B's fix to org A's key on every tool", async () => {
    const live = await seedLiveFixInOrgB();

    // The control: without it every assertion below passes on a port that answers nothing.
    const owned = await liveCall(keyB, MCP_TOOL.GET_FIX, { fixId: live.fixId });
    expect(owned.frame).toContain(live.fixId);
    expect(owned.frame).not.toContain(NOT_FOUND.message);

    const ownedList = await liveCall(keyB, MCP_TOOL.LIST_OPEN_FIXES, {});
    expect(ownedList.body).toContain(live.fixId);

    const foreignList = await liveCall(keyA, MCP_TOOL.LIST_OPEN_FIXES, {});
    expect(foreignList.body).not.toContain(live.fixId);
    expect(foreignList.body).toContain('"totalOpen":0');

    for (const [tool, foreignInput, absentInput] of [
      [MCP_TOOL.GET_FIX, { fixId: live.fixId }, { fixId: NEVER_ISSUED_FIX }],
      [MCP_TOOL.GET_FINDING, { findingId: live.findingId }, { findingId: NEVER_ISSUED_FINDING }],
    ] as const) {
      const foreign = await fingerprint(
        await POST(toolCallRequest({ tool, input: foreignInput, key: keyA })),
      );
      const absent = await fingerprint(
        await POST(toolCallRequest({ tool, input: absentInput, key: keyA })),
      );

      expect(foreign).toEqual(absent);
      expect(foreign.body).toContain(NOT_FOUND.message);
      expect(foreign.body).not.toContain(UNAVAILABLE.message);
    }
  });

  test("reads the same fix through a teammate's own key in the same organization", async () => {
    const live = await seedLiveFixInOrgB();

    const teammate = await signUpTestUser(createTestAuth(dbHandle.db), {
      name: "Teammate Mcpxk B",
      email: "teammate-b-mcpxk@example.com",
      password: TEST_PASSWORD,
    });
    await seedMember(dbHandle.db, {
      organizationId: ctxB.organizationId,
      userId: teammate.id,
      role: "member",
    });
    const teammateCtx = await buildTestTenantContext(dbHandle.db, {
      userId: teammate.id,
      organizationId: ctxB.organizationId,
    });
    const teammateKey = (await mintRealApiKey(dbHandle.db, teammateCtx, "agent-mcpxk-mate")).raw;

    expect(teammateCtx.userId).not.toBe(ctxB.userId);
    expect(teammateKey).not.toBe(keyB);

    const byOwner = await liveCall(keyB, MCP_TOOL.GET_FIX, { fixId: live.fixId });
    const byTeammate = await liveCall(teammateKey, MCP_TOOL.GET_FIX, { fixId: live.fixId });

    expect(byTeammate.frame).toContain(live.fixId);
    expect(byTeammate.frame).toBe(byOwner.frame);
  });
});
