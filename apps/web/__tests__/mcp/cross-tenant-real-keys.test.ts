import { createApiKeysRepo, resolveApiKeyForRead } from "@growthmind/db";
import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { MCP_TOOL, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createApiKeyMcpCredentials } from "../../lib/mcp/credentials";
import { NOT_FOUND } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  buildTestTenantContext,
  createTestAuth,
  createTestOrganization,
  signUpTestUser,
} from "../tenancy/helpers/auth-fixture";
import {
  fakeReadPort,
  findingRecordFor,
  fingerprint,
  fixRecordFor,
  openFixRowFor,
  toolCallRequest,
} from "./helpers/mcp-fixture";

const TEST_PASSWORD = "correct-horse-battery-staple";

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

beforeAll(async () => {
  dbHandle = await createTestDb();
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

  keyA = (await createApiKeysRepo(dbHandle.db, ctxA).mint({ name: "agent-mcpxk-a" })).raw;
  keyB = (await createApiKeysRepo(dbHandle.db, ctxB).mint({ name: "agent-mcpxk-b" })).raw;

  expect(ctxA.organizationId).not.toBe(ctxB.organizationId);
  expect(keyA).not.toBe(keyB);
});

afterAll(async () => {
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
    const resolvedA = await resolveApiKeyForRead(dbHandle.db, keyA);
    const resolvedB = await resolveApiKeyForRead(dbHandle.db, keyB);

    expect(resolvedA).toEqual({ organizationId: ctxA.organizationId });
    expect(resolvedB).toEqual({ organizationId: ctxB.organizationId });

    expect(resolvedA?.organizationId).not.toBe(ctxB.organizationId);
    expect(resolvedB?.organizationId).not.toBe(ctxA.organizationId);
  });
});
