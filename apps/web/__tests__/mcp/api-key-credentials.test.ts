import { createHmac } from "node:crypto";

import { serialiseFixSpecInput } from "@growthmind/core";
import {
  createApiKeysRepo,
  createFindingPayloadsRepo,
  createFindingsRepo,
  createFixesService,
} from "@growthmind/db";
import {
  createTestDb,
  scannedTextFor,
  seedAnalysisRun,
  seedOrgWithOwner,
  seedProject,
} from "@growthmind/db/testing";
import { API_KEY_PREFIX, MCP_TOOL, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createApiKeyMcpCredentials } from "../../lib/mcp/credentials";
import { createLiveReadPort } from "../../lib/mcp/read-port-live";
import { NOT_FOUND, UNAUTHENTICATED } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  buildTestTenantContext,
  createTestOrganization,
  setupAuthTest,
  signUpTestUser,
  type AuthTestContext,
} from "../tenancy/helpers/auth-fixture";
import {
  candidateFor,
  fingerprint,
  mintRealApiKey,
  rpcRequest,
  sseDataLine,
  toolCallRequest,
  WINDOW_END,
  WINDOW_START,
  type MintedTestApiKey,
} from "./helpers/mcp-fixture";

const TEST_PASSWORD = "correct-horse-battery-staple";

const CLEAN_TEXT = scannedTextFor("People are leaving the reports page without going any further.", [
  "We saw sessions reach the reports page and stop there.",
]);

const UNKNOWN_BUT_WELL_FORMED = `${API_KEY_PREFIX}${"a".repeat(43)}`;

const MALFORMED = "definitely-not-a-key";

const TOOL_NAMES = [MCP_TOOL.GET_FINDING, MCP_TOOL.GET_FIX, MCP_TOOL.LIST_OPEN_FIXES].toSorted();

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";
const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

function notFoundFrame(id: number = 1): string {
  const payload = JSON.stringify({
    result: { content: [{ type: "text", text: NOT_FOUND.message }], isError: true },
    jsonrpc: "2.0",
    id,
  });
  return `event: message\ndata: ${payload}\n\n`;
}

let authCtx: AuthTestContext;
let ownerCtx: TenantContext;
let deps: McpServerDeps;

beforeAll(async () => {
  authCtx = await setupAuthTest();

  const owner = await signUpTestUser(authCtx.auth, {
    name: "Owner Mcpak",
    email: "owner-mcpak@example.com",
    password: TEST_PASSWORD,
  });
  const organization = await createTestOrganization(authCtx.db, {
    name: "Org Mcpak",
    ownerUserId: owner.id,
  });
  ownerCtx = await buildTestTenantContext(authCtx.db, {
    userId: owner.id,
    organizationId: organization.id,
  });

  deps = {
    credentials: createApiKeyMcpCredentials(authCtx.db),
    reads: createLiveReadPort(authCtx.db),
  };
});

afterAll(async () => {
  await authCtx.close();
});

async function mintApiKey(name: string): Promise<MintedTestApiKey> {
  return mintRealApiKey(authCtx.db, ownerCtx, name);
}

interface StockedOrganization {
  readonly key: string;
  readonly fixId: string;
}

// A whole other organization with one real, renderable fix in it. WIRE-A2's empty answer
// has to mean "Org Mcpak owns nothing", never "this port reads nothing".
async function stockedSiblingOrganization(label: string): Promise<StockedOrganization> {
  const surface = `/mcpak/${label}`;
  const org = await seedOrgWithOwner(authCtx.db, {
    orgName: `Org Mcpak ${label}`,
    userName: `Owner Mcpak ${label}`,
    email: `owner-mcpak-${label}@example.com`,
  });
  const project = await seedProject(authCtx.db, {
    organizationId: org.organizationId,
    name: `Mcpak ${label}`,
  });
  const run = await seedAnalysisRun(authCtx.db, { ctx: org.ctx, projectId: project.id });

  const finding = await createFindingsRepo(authCtx.db, org.ctx).persist({
    projectId: project.id,
    runId: run.id,
    signature: createHmac("sha256", "mcpak").update(surface).digest("hex"),
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
    evidenceShape: `mcpak-${label}`,
    evidenceShapeVersion: 1,
    resolvedModelId: null,
  });
  await createFindingPayloadsRepo(authCtx.db, org.ctx).upsertFor({
    findingId: finding.id,
    payload: serialiseFixSpecInput({ candidate: candidateFor(surface), signals: [] }),
  });

  const opened = await createFixesService(authCtx.db, org.ctx).openFor(finding.id);
  if (opened.outcome !== "opened") {
    throw new Error(`mcpak fixture: openFor answered "${opened.outcome}", not "opened"`);
  }

  const key = (await mintRealApiKey(authCtx.db, org.ctx, `agent-mcpak-${label}`)).raw;
  return { key, fixId: opened.fix.id };
}

async function catalogueWith(key: string | null): Promise<Response> {
  return handleMcpRequest(rpcRequest({ method: "tools/list", key }), deps);
}

async function callWith(
  key: string | null,
  tool: string = MCP_TOOL.LIST_OPEN_FIXES,
  input?: unknown,
): Promise<Response> {
  return handleMcpRequest(toolCallRequest({ tool, input, key }), deps);
}

describe("the read surface answers a credential a person minted, and nothing else", () => {
  test("WIRE-A1 — should reach tools/list with a real minted credential", async () => {
    const { raw } = await mintApiKey("agent-catalogue");

    const print = await fingerprint(await catalogueWith(raw));

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    for (const name of TOOL_NAMES) {
      expect(print.body).toContain(name);
    }

    const anonymous = await fingerprint(await catalogueWith(null));
    expect(anonymous.status).toBe(401);
    expect(anonymous.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(anonymous.body).toContain(UNAUTHENTICATED.message);
    for (const name of TOOL_NAMES) {
      expect(anonymous.body).not.toContain(name);
    }
  });

  test("WIRE-A2 — should answer list_open_fixes with an empty list and a truthful window", async () => {
    const { raw } = await mintApiKey("agent-list-open-fixes");
    const sibling = await stockedSiblingOrganization("list-control");

    const print = await fingerprint(await callWith(raw));

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const payload = sseDataLine(print.body);
    expect(payload).toContain('"structuredContent"');
    expect(payload).toContain('"fixes":[]');
    expect(payload).toContain('"returned":0');
    expect(payload).toContain('"totalOpen":0');
    expect(payload).toContain('"truncated":false');
    expect(payload).not.toContain(sibling.fixId);

    expect(payload).not.toContain('"isError":true');

    const stocked = sseDataLine((await fingerprint(await callWith(sibling.key))).body);
    expect(stocked).toContain(sibling.fixId);
    expect(stocked).toContain('"returned":1');
    expect(stocked).toContain('"totalOpen":1');
  });

  test("WIRE-A3 — should answer get_fix and get_finding with the frozen not-found", async () => {
    const { raw } = await mintApiKey("agent-not-found");

    const fixOne = await fingerprint(
      await callWith(raw, MCP_TOOL.GET_FIX, { fixId: "fix-mcpak-one" }),
    );
    const fixTwo = await fingerprint(
      await callWith(raw, MCP_TOOL.GET_FIX, { fixId: "fix-mcpak-two" }),
    );

    expect(fixOne.status).toBe(200);
    expect(fixOne.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(fixOne).toEqual(fixTwo);
    expect(fixOne.body).toEqual(notFoundFrame());

    const findingOne = await fingerprint(
      await callWith(raw, MCP_TOOL.GET_FINDING, { findingId: "finding-mcpak-one" }),
    );
    const findingTwo = await fingerprint(
      await callWith(raw, MCP_TOOL.GET_FINDING, { findingId: "finding-mcpak-two" }),
    );

    expect(findingOne.status).toBe(200);
    expect(findingOne.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(findingOne).toEqual(findingTwo);
    expect(findingOne.body).toEqual(notFoundFrame());

    expect(fixOne).toEqual(findingOne);

    expect(sseDataLine(fixOne.body)).toContain(NOT_FOUND.message);
    expect(sseDataLine(fixOne.body)).toContain('"isError":true');
  });

  test("WIRE-A4 — should refuse a credential revoked between two requests", async () => {
    const minted = await mintApiKey("agent-revoked-live");

    const before = await fingerprint(await callWith(minted.raw));
    expect(before.status).toBe(200);
    expect(before.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const revoked = await createApiKeysRepo(authCtx.db, ownerCtx).revoke(minted.id);

    expect(revoked?.revokedAt).not.toBeNull();

    const after = await fingerprint(await callWith(minted.raw));
    expect(after.status).toBe(401);
    expect(after.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(after.body).toContain(UNAUTHENTICATED.message);
  });

  test("WIRE-A5 — should answer missing, malformed, unknown and revoked credentials identically", async () => {
    const live = await mintApiKey("agent-fingerprint-live");
    const admitted = await fingerprint(await callWith(live.raw));
    expect(admitted.status).toBe(200);
    expect(admitted.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const revokedKey = await mintApiKey("agent-fingerprint-revoked");
    const revoked = await createApiKeysRepo(authCtx.db, ownerCtx).revoke(revokedKey.id);
    expect(revoked?.revokedAt).not.toBeNull();

    const answers = [];
    for (const key of [null, MALFORMED, UNKNOWN_BUT_WELL_FORMED, revokedKey.raw]) {
      answers.push(await fingerprint(await callWith(key)));
    }

    expect(answers).toHaveLength(4);
    const [first] = answers;
    expect(first?.status).toBe(401);
    expect(first?.contentType).toBe(PRE_SDK_CONTENT_TYPE);

    for (const answer of answers) {
      expect(answer).toEqual(first);
    }
  });

  test("WIRE-A6 — should refuse rather than admit when the credential store cannot be reached", async () => {
    const { raw } = await mintApiKey("agent-closed-store");

    const closed = await createTestDb();
    await closed.close();

    const refused = await fingerprint(
      await handleMcpRequest(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: raw }), {
        credentials: createApiKeyMcpCredentials(closed.db),
        reads: deps.reads,
      }),
    );
    const withNothing = await fingerprint(await callWith(null));

    expect(refused.status).toBe(401);
    expect(refused.contentType).toBe(PRE_SDK_CONTENT_TYPE);

    expect(refused).toEqual(withNothing);
  });

  test("WIRE-A7 — should never carry the credential material in any response body", async () => {
    const { raw } = await mintApiKey("agent-never-echoed");

    expect(raw.length).toBeGreaterThan(40);

    const cases: readonly {
      readonly name: string;
      readonly status: number;
      readonly contentType: string;
      readonly presented: string;
      readonly run: () => Promise<Response>;
    }[] = [
      {
        name: "tools/list",
        status: 200,
        contentType: SDK_RENDERED_CONTENT_TYPE,
        presented: raw,
        run: () => catalogueWith(raw),
      },
      {
        name: "a list_open_fixes call",
        status: 200,
        contentType: SDK_RENDERED_CONTENT_TYPE,
        presented: raw,
        run: () => callWith(raw),
      },
      {
        name: "a get_fix miss",
        status: 200,
        contentType: SDK_RENDERED_CONTENT_TYPE,
        presented: raw,
        run: () => callWith(raw, MCP_TOOL.GET_FIX, { fixId: "fix-mcpak-echo" }),
      },
      {
        name: "a get_finding miss",
        status: 200,
        contentType: SDK_RENDERED_CONTENT_TYPE,
        presented: raw,
        run: () => callWith(raw, MCP_TOOL.GET_FINDING, { findingId: "finding-mcpak-echo" }),
      },
      {
        name: "a refusal of an unknown credential",
        status: 401,
        contentType: PRE_SDK_CONTENT_TYPE,
        presented: UNKNOWN_BUT_WELL_FORMED,
        run: () => callWith(UNKNOWN_BUT_WELL_FORMED),
      },
    ];

    expect(cases).toHaveLength(5);

    for (const { name, status, contentType, presented, run } of cases) {
      const print = await fingerprint(await run());

      expect(`${name}: ${print.status}`).toBe(`${name}: ${status}`);
      expect(`${name}: ${print.contentType}`).toBe(`${name}: ${contentType}`);

      expect(print.body).not.toContain(presented);
      expect(print.body).not.toContain(raw);
    }
  });

  test("WIRE-A7 — the credential scan does find the material when it is present", async () => {
    const { raw } = await mintApiKey("agent-scan-control");
    const control = `event: message\ndata: {"result":{"_meta":{"echoed":"${raw}"}},"jsonrpc":"2.0","id":1}\n\n`;

    expect(control).toContain(raw);
  });
});

import * as sharedModule from "@growthmind/shared";

interface ApiKeyUseSummary {
  readonly liveCount: number;
  readonly anyUsed: boolean;
}

interface AgentConnection {
  readonly kind: string;
}

const SHARED_EXPORTS: Record<string, unknown> = { ...sharedModule };

function toAgentConnection(use: ApiKeyUseSummary): AgentConnection {
  const derive = SHARED_EXPORTS.toAgentConnection;
  if (typeof derive !== "function") {
    throw new Error("@growthmind/shared exports no `toAgentConnection` yet (O-026 D-6).");
  }
  return (derive as (summary: ApiKeyUseSummary) => AgentConnection)(use);
}

function liveKeyUseOf(ctx: TenantContext): Promise<ApiKeyUseSummary> {
  const repo: Record<string, unknown> = createApiKeysRepo(authCtx.db, ctx) as unknown as Record<
    string,
    unknown
  >;
  const read = repo.liveKeyUse;
  if (typeof read !== "function") {
    throw new Error("ApiKeysRepo has no `liveKeyUse` method yet (O-026 D-6).");
  }
  return (read as () => Promise<ApiKeyUseSummary>).call(repo);
}

async function lastUsedAtOf(keyId: string): Promise<unknown> {
  const result = (await authCtx.db.execute(
    `select last_used_at from api_keys where id = '${keyId}'`,
  )) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];

  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`WIRE-A8: no api_keys row for the key just minted (${keyId}).`);
  }
  return row.last_used_at;
}

async function freshOrganizationWithOneKey(
  label: string,
): Promise<{ readonly ctx: TenantContext; readonly key: MintedTestApiKey }> {
  const org = await seedOrgWithOwner(authCtx.db, {
    orgName: `Org Mcpak ${label}`,
    userName: `Owner Mcpak ${label}`,
    email: `owner-mcpak-${label}@example.com`,
  });
  const key = await mintRealApiKey(authCtx.db, org.ctx, `agent-${label}`);

  return { ctx: org.ctx, key };
}

describe("the step completes on first contact, derived from the key's own last-used stamp", () => {
  test("WIRE-A8 — should stamp the key on the first call that presents it", async () => {
    const { key } = await freshOrganizationWithOneKey("first-contact");

    expect(await lastUsedAtOf(key.id)).toBeNull();

    const print = await fingerprint(await catalogueWith(key.raw));
    expect(print.status).toBe(200);

    expect(await lastUsedAtOf(key.id)).not.toBeNull();
  });

  test("WIRE-A8 — should read waiting before that call and connected after it", async () => {
    const { ctx, key } = await freshOrganizationWithOneKey("connection-flip");

    expect(toAgentConnection(await liveKeyUseOf(ctx))).toEqual({ kind: "waiting" });

    const print = await fingerprint(await catalogueWith(key.raw));
    expect(print.status).toBe(200);

    expect(toAgentConnection(await liveKeyUseOf(ctx))).toEqual({ kind: "connected" });
  });

  test("WIRE-A8 — should leave a neighbouring organization's step unconnected", async () => {
    const mine = await freshOrganizationWithOneKey("stamp-mine");
    const theirs = await freshOrganizationWithOneKey("stamp-theirs");

    expect((await fingerprint(await catalogueWith(mine.key.raw))).status).toBe(200);

    expect(await lastUsedAtOf(theirs.key.id)).toBeNull();
    expect(toAgentConnection(await liveKeyUseOf(theirs.ctx))).toEqual({ kind: "waiting" });
  });
});
