import {
  createApiKeysRepo,
  createProjectsRepo,
  createWriteKeysRepo,
  resolveWriteKeyForIngest,
} from "@growthmind/db";
import { API_KEY_PREFIX, MCP_TOOL, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GET, POST, resolveMcpDeps } from "../../app/api/mcp/route";
import { UNAUTHENTICATED, WRONG_METHOD } from "../../lib/mcp/refusals";
import {
  buildTestTenantContext,
  createTestOrganization,
  setupAuthTest,
  signUpTestUser,
  type AuthTestContext,
} from "../tenancy/helpers/auth-fixture";
import { fingerprint, sseDataLine, toolCallRequest, verbRequest } from "./helpers/mcp-fixture";

const TEST_PASSWORD = "correct-horse-battery-staple";

const UNKNOWN_BUT_WELL_FORMED = `${API_KEY_PREFIX}${"a".repeat(43)}`;

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";
const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

let authCtx: AuthTestContext;
let ownerCtx: TenantContext;

let mintedRaw: string;

let writeKeyRaw: string;

beforeAll(async () => {
  authCtx = await setupAuthTest();

  globalForDb.__growthmindDb = authCtx.db;

  const owner = await signUpTestUser(authCtx.auth, {
    name: "Owner Mcpwire",
    email: "owner-mcpwire@example.com",
    password: TEST_PASSWORD,
  });
  const organization = await createTestOrganization(authCtx.db, {
    name: "Org Mcpwire",
    ownerUserId: owner.id,
  });
  ownerCtx = await buildTestTenantContext(authCtx.db, {
    userId: owner.id,
    organizationId: organization.id,
  });

  mintedRaw = (await createApiKeysRepo(authCtx.db, ownerCtx).mint({ name: "agent-mcpwire" })).raw;

  const project = await createProjectsRepo(authCtx.db, ownerCtx).create({
    name: "Mcpwire Landing Page",
  });
  writeKeyRaw = (
    await createWriteKeysRepo(authCtx.db, ownerCtx).mint({
      projectId: project.id,
      kind: "standard",
    })
  ).raw;
});

afterAll(async () => {
  delete globalForDb.__growthmindDb;
  await authCtx.close();
});

describe("the mounted route answers the credential store this sprint built", () => {
  test("WIRE-M1 — should answer 200 to a real minted credential through the mounted POST", async () => {
    const print = await fingerprint(
      await POST(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: mintedRaw })),
    );

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const payload = sseDataLine(print.body);
    expect(print.body).toEqual(`event: message\ndata: ${payload}\n\n`);

    expect(payload).toContain('"jsonrpc":"2.0"');
    expect(payload).toContain('"id":1');
    expect(payload).toContain('"structuredContent"');
    expect(payload).toContain('"fixes":[]');
    expect(payload).toContain('"returned":0');
    expect(payload).toContain('"totalOpen":0');
    expect(payload).toContain('"truncated":false');

    expect(payload).not.toContain('"isError":true');
  });

  test("WIRE-M2 — should answer 405 to the same credential through the mounted GET", async () => {
    const print = await fingerprint(await GET(verbRequest({ method: "GET", key: mintedRaw })));

    expect(print.status).toBe(405);
    expect(print.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(print.body).toContain(WRONG_METHOD.message);

    expect(WRONG_METHOD.message).toContain("POST");
    expect(WRONG_METHOD.message).toContain("tools/list");
  });

  test("WIRE-M3 — should still refuse an unknown well-formed credential through the mounted POST", async () => {
    const print = await fingerprint(
      await POST(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: UNKNOWN_BUT_WELL_FORMED })),
    );

    expect(print.status).toBe(401);
    expect(print.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(print.body).toContain(UNAUTHENTICATED.message);
  });

  test("WIRE-M4 — should still refuse a genuine ingest key through the mounted POST", async () => {
    const asIngest = await resolveWriteKeyForIngest(authCtx.db, writeKeyRaw);
    expect(asIngest?.kind).toBe("standard");

    const withIngestKey = await fingerprint(
      await POST(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: writeKeyRaw })),
    );
    const withNothing = await fingerprint(
      await POST(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: null })),
    );

    expect(withIngestKey.status).toBe(401);
    expect(withIngestKey.contentType).toBe(PRE_SDK_CONTENT_TYPE);

    expect(withIngestKey).toEqual(withNothing);
  });

  test("should build its credential source from api keys", async () => {
    const deps = resolveMcpDeps(authCtx.db);

    expect(await deps.credentials.resolve(mintedRaw)).toEqual({
      organizationId: ownerCtx.organizationId,
    });
    expect(await deps.credentials.resolve(writeKeyRaw)).toBeNull();
  });
});
