import { createApiKeysRepo } from "@growthmind/db";
import {
  MCP_TOOL,
  MCP_TOOL_NAMES,
  fixSpecEnvelopeSchema,
  listOpenFixesOutputSchema,
  type TenantContext,
} from "@growthmind/shared";
import {
  Client,
  ProtocolError,
  SdkHttpError,
  StreamableHTTPClientTransport,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CallToolResult,
  type ClientOptions,
  type FetchLike,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GET, POST } from "../../app/api/mcp/route";
import { NOT_FOUND, UNAUTHENTICATED } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  MCP_PROTOCOL_ERA_TARGET,
  MCP_PROTOCOL_LEGACY_FLOOR,
  JSON_RPC_ERROR_CODE,
} from "../../lib/mcp/wire-constants";
import {
  buildTestTenantContext,
  createTestOrganization,
  setupAuthTest,
  signUpTestUser,
  type AuthTestContext,
} from "../tenancy/helpers/auth-fixture";
import {
  fakeCredentials,
  fakeReadPort,
  findingRecordFor,
  fixRecordFor,
  mintRealApiKey,
  openFixRowFor,
  sseDataLines,
  KEY_A,
  ORG_A,
} from "./helpers/mcp-fixture";

const MCP_ENDPOINT = new URL("https://real-client.invalid/api/mcp");

const CLIENT_INFO = { name: "growthmind-real-client-test", version: "0.0.0" } as const;

const EMPTY_LIST_STRUCTURED_CONTENT = {
  fixes: [],
  window: { returned: 0, totalOpen: 0, truncated: false },
} as const;

const NEVER_ISSUED_FIX = "fix-mcpe-never-issued";
const NEVER_ISSUED_FINDING = "finding-mcpe-never-issued";

const FAKE_DEPS: McpServerDeps = {
  credentials: fakeCredentials({ [KEY_A]: ORG_A }),
  reads: fakeReadPort().port,
};

type Serve = (request: Request) => Promise<Response>;

const serveReal: Serve = (request) => handleMcpRequest(request, FAKE_DEPS);

const serveMounted: Serve = (request) => (request.method === "POST" ? POST(request) : GET(request));

interface Exchange {
  readonly method: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

interface ClientWire {
  readonly fetch: FetchLike;
  readonly exchanges: readonly Exchange[];
}

function wireTo(serve: Serve, rewrite?: (body: string) => string): ClientWire {
  const exchanges: Exchange[] = [];

  const injected: FetchLike = async (url, init) => {
    const request = new Request(url, init);
    const method = request.method;

    const served = await serve(request);
    const body = await served.text();
    exchanges.push({
      method,
      status: served.status,
      contentType: served.headers.get("content-type"),
      body,
    });

    const shown = rewrite === undefined ? body : rewrite(body);
    const headers = new Headers(served.headers);
    headers.delete("content-length");

    return new Response(shown.length === 0 ? null : shown, {
      status: served.status,
      statusText: served.statusText,
      headers,
    });
  };

  return { fetch: injected, exchanges };
}

const STRUCTURED_CONTENT_KEY = "structuredContent";

function withoutStructuredContent(body: string): string {
  if (!body.includes(`"${STRUCTURED_CONTENT_KEY}"`)) {
    return body;
  }

  const payloads = sseDataLines(body);
  const framed = payloads.length === 1;
  const source = framed ? (payloads[0] as string) : body;

  const message = JSON.parse(source) as { result?: Record<string, unknown> };
  if (message.result !== undefined) {
    delete message.result[STRUCTURED_CONTENT_KEY];
  }

  const stripped = JSON.stringify(message);
  return framed ? `event: message\ndata: ${stripped}\n\n` : stripped;
}

function transportFor(wire: ClientWire, key: string): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: wire.fetch,

    requestInit: { headers: { authorization: `Bearer ${key}` } },
  });
}

async function openClient(wire: ClientWire, key: string, options?: ClientOptions): Promise<Client> {
  const client = new Client(CLIENT_INFO, options);
  await client.connect(transportFor(wire, key));
  return client;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function firstText(result: CallToolResult): string | undefined {
  const block = result.content[0];
  if (block === undefined || block.type !== "text") {
    return undefined;
  }
  return block.text;
}

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("mcpe: expected the call to reject, and it resolved");
}

async function closeQuietly(client: Client): Promise<void> {
  await client.close();
}

describe("a real MCP client against the real exported handler", () => {
  test("WIRE-E1 — should complete the legacy initialize handshake with no client options at all", async () => {
    const wire = wireTo(serveReal);

    const client = new Client(CLIENT_INFO);

    try {
      await client.connect(transportFor(wire, KEY_A));

      expect(client.getProtocolEra()).toBe("legacy");

      expect(client.getNegotiatedProtocolVersion()).toBe(MCP_PROTOCOL_LEGACY_FLOOR);
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(MCP_PROTOCOL_LEGACY_FLOOR);

      await flush();
      expect(wire.exchanges).toHaveLength(3);

      const posts = wire.exchanges.filter((exchange) => exchange.method === "POST");
      const gets = wire.exchanges.filter((exchange) => exchange.method === "GET");
      expect(posts).toHaveLength(2);
      expect(gets).toHaveLength(1);

      expect(posts[0]?.status).toBe(200);
      expect(posts[0]?.contentType).toBe("text/event-stream");

      expect(posts[1]?.status).toBe(202);
      expect(posts[1]?.contentType).toBeNull();
      expect(posts[1]?.body).toBe("");

      expect(gets[0]?.status).toBe(405);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E2 — should list exactly three tools, each with an input schema its own parser accepted", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);

      expect(names).toEqual([...MCP_TOOL_NAMES]);

      for (const tool of listed.tools) {
        expect(tool.inputSchema).not.toBeNull();
        expect(typeof tool.inputSchema).toBe("object");
      }

      expect(names).not.toContain("report_shipped");
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E3 — should call list_open_fixes and receive a truthful empty with its denominators", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();

      const result = await client.callTool({
        name: MCP_TOOL.LIST_OPEN_FIXES,
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(EMPTY_LIST_STRUCTURED_CONTENT);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E4 — should receive the frozen not-found from get_fix as a tool execution error", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();

      const result = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });

      expect(result.isError).toBe(true);

      expect(firstText(result)).toBe(NOT_FOUND.message);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E5 — should receive the identical not-found from get_finding, byte-identical to get_fix's", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();

      const finding = await client.callTool({
        name: MCP_TOOL.GET_FINDING,
        arguments: { findingId: NEVER_ISSUED_FINDING },
      });
      const fix = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });

      expect(finding.isError).toBe(true);
      expect(firstText(finding)).toBe(NOT_FOUND.message);

      expect(firstText(finding)).toBe(firstText(fix) as string);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E7 — should let a client pinned to the modern era connect and list the same three tools", async () => {
    const wire = wireTo(serveReal);

    const client = await openClient(wire, KEY_A, {
      versionNegotiation: { mode: { pin: MCP_PROTOCOL_ERA_TARGET } },
    });

    try {
      expect(client.getProtocolEra()).toBe("modern");

      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual([...MCP_TOOL_NAMES]);

      const result = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toBe(NOT_FOUND.message);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E7 — should serve both eras from the same handler, interleaved, with no interference", async () => {
    const wire = wireTo(serveReal);
    const modern: ClientOptions = {
      versionNegotiation: { mode: { pin: MCP_PROTOCOL_ERA_TARGET } },
    };

    const clients = [
      await openClient(wire, KEY_A),
      await openClient(wire, KEY_A, modern),
      await openClient(wire, KEY_A),
      await openClient(wire, KEY_A, modern),
    ];

    try {
      expect(clients.map((client) => client.getProtocolEra())).toEqual([
        "legacy",
        "modern",
        "legacy",
        "modern",
      ]);

      for (const client of clients) {
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        expect(names).toEqual([...MCP_TOOL_NAMES]);
      }
    } finally {
      for (const client of clients) {
        await closeQuietly(client);
      }
    }
  });

  test("WIRE-E8 — should exercise the success path the way every real client does: list first, then call", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();
      const result = await client.callTool({
        name: MCP_TOOL.LIST_OPEN_FIXES,
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(EMPTY_LIST_STRUCTURED_CONTENT);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E8 — should resolve a deliberately broken result when the client never listed first, which proves nothing", async () => {
    const wire = wireTo(serveReal, withoutStructuredContent);
    const client = await openClient(wire, KEY_A);

    try {
      const result = await client.callTool({
        name: MCP_TOOL.LIST_OPEN_FIXES,
        arguments: {},
      });

      expect(result.isError).toBeFalsy();

      expect(result.structuredContent).toBeUndefined();
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E9(a) — should return structured content that satisfies the advertised output schema", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();
      const result = await client.callTool({
        name: MCP_TOOL.LIST_OPEN_FIXES,
        arguments: {},
      });

      const parsed = listOpenFixesOutputSchema.safeParse(result.structuredContent);
      expect(parsed.success ? parsed.data : parsed.error.issues).toEqual(
        EMPTY_LIST_STRUCTURED_CONTENT,
      );
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E9(b) — should make a real client reject a non-error result that omits structured content", async () => {
    const wire = wireTo(serveReal, withoutStructuredContent);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();

      const error = await rejection(() =>
        client.callTool({ name: MCP_TOOL.LIST_OPEN_FIXES, arguments: {} }),
      );

      expect(ProtocolError.isInstance(error)).toBe(true);
      expect((error as ProtocolError).code).toBe(JSON_RPC_ERROR_CODE.INVALID_REQUEST);

      expect(String((error as ProtocolError).message)).toContain(MCP_TOOL.LIST_OPEN_FIXES);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E9(c) — should resolve an isError result that carries no structured content", async () => {
    const wire = wireTo(serveReal);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();

      const result = await client.callTool({
        name: MCP_TOOL.GET_FINDING,
        arguments: { findingId: NEVER_ISSUED_FINDING },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(firstText(result)).toBe(NOT_FOUND.message);
    } finally {
      await closeQuietly(client);
    }
  });
});

const SEEDED_FIX_ID = "fix-mcpe-seeded";
const SEEDED_FINDING_ID = "finding-mcpe-seeded";
const SEEDED_RESULTS_BY = "2026-07-01T00:00:00.000Z";

const SEEDED_DEPS: McpServerDeps = {
  credentials: fakeCredentials({ [KEY_A]: ORG_A }),
  reads: fakeReadPort({
    openFixes: [
      {
        organizationId: ORG_A,
        projectId: "project-mcpe",
        row: openFixRowFor({
          fixId: SEEDED_FIX_ID,
          findingId: SEEDED_FINDING_ID,
          resultsBy: SEEDED_RESULTS_BY,
        }),
      },
    ],
    fixes: [
      {
        organizationId: ORG_A,
        record: fixRecordFor({
          fixId: SEEDED_FIX_ID,
          findingId: SEEDED_FINDING_ID,
          resultsBy: SEEDED_RESULTS_BY,
        }),
      },
    ],
    findings: [
      {
        organizationId: ORG_A,
        record: findingRecordFor({ findingId: SEEDED_FINDING_ID, fixId: SEEDED_FIX_ID }),
      },
    ],
  }).port,
};

const serveSeeded: Serve = (request) => handleMcpRequest(request, SEEDED_DEPS);

describe("a real MCP client reading real records out of a seeded store", () => {
  test("WIRE-E10 — should call all three tools through one listing client and have every result accepted", async () => {
    const wire = wireTo(serveSeeded);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();

      const listed = await client.callTool({
        name: MCP_TOOL.LIST_OPEN_FIXES,
        arguments: {},
      });
      const fix = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: SEEDED_FIX_ID },
      });
      const finding = await client.callTool({
        name: MCP_TOOL.GET_FINDING,
        arguments: { findingId: SEEDED_FINDING_ID },
      });

      expect(listed.isError).toBeFalsy();
      expect(fix.isError).toBeFalsy();
      expect(finding.isError).toBeFalsy();

      expect(listed.structuredContent).not.toBeUndefined();
      expect(fix.structuredContent).not.toBeUndefined();
      expect(finding.structuredContent).not.toBeUndefined();
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E10 — should answer get_fix with a rendered spec valid against the schema it advertises", async () => {
    const wire = wireTo(serveSeeded);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();
      const result = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: SEEDED_FIX_ID },
      });

      const parsed = fixSpecEnvelopeSchema.safeParse(result.structuredContent);
      if (!parsed.success) {
        throw new Error(`mcpe: get_fix answered a shape the contract refuses: ${parsed.error}`);
      }

      expect(parsed.data.fixId).toBe(SEEDED_FIX_ID);
      expect(parsed.data.findingId).toBe(SEEDED_FINDING_ID);

      expect(parsed.data.specText.length).toBeGreaterThan(0);
      expect(parsed.data.dateIsFinal).toBe(true);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E10 — should answer get_finding with evidence a real client accepted", async () => {
    const wire = wireTo(serveSeeded);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();
      const result = await client.callTool({
        name: MCP_TOOL.GET_FINDING,
        arguments: { findingId: SEEDED_FINDING_ID },
      });

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown> | undefined;
      expect(structured?.findingId).toBe(SEEDED_FINDING_ID);
      expect(structured?.fixId).toBe(SEEDED_FIX_ID);
      expect(Array.isArray(structured?.evidence)).toBe(true);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E10 — should still refuse an id nobody seeded, from the same store", async () => {
    const wire = wireTo(serveSeeded);
    const client = await openClient(wire, KEY_A);

    try {
      await client.listTools();
      const result = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });

      expect(result.isError).toBe(true);
      expect(firstText(result)).toBe(NOT_FOUND.message);
    } finally {
      await closeQuietly(client);
    }
  });
});

describe("a real MCP client whose real credential is revoked mid-session", () => {
  const TEST_PASSWORD = "correct-horse-battery-staple";

  const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

  let authCtx: AuthTestContext;
  let ownerCtx: TenantContext;

  let revokedKey: string;
  let revokedKeyId: string;
  let liveKey: string;

  beforeAll(async () => {
    authCtx = await setupAuthTest();

    globalForDb.__growthmindDb = authCtx.db;

    const owner = await signUpTestUser(authCtx.auth, {
      name: "Owner Mcpe",
      email: "owner-mcpe@example.com",
      password: TEST_PASSWORD,
    });
    const organization = await createTestOrganization(authCtx.db, {
      name: "Org Mcpe",
      ownerUserId: owner.id,
    });
    ownerCtx = await buildTestTenantContext(authCtx.db, {
      userId: owner.id,
      organizationId: organization.id,
    });

    const revoking = await mintRealApiKey(authCtx.db, ownerCtx, "agent-mcpe-revoked");
    revokedKey = revoking.raw;
    revokedKeyId = revoking.id;
    liveKey = (await mintRealApiKey(authCtx.db, ownerCtx, "agent-mcpe-live")).raw;

    expect(revokedKey).not.toBe(liveKey);
  });

  afterAll(async () => {
    delete globalForDb.__growthmindDb;
    await authCtx.close();
  });

  test("WIRE-E6 — should refuse the very next call after the credential is revoked, with no restart", async () => {
    const wire = wireTo(serveMounted);
    const client = await openClient(wire, revokedKey);
    const pidBefore = process.pid;

    try {
      const before = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });
      expect(before.isError).toBe(true);
      expect(firstText(before)).toBe(NOT_FOUND.message);

      const revoked = await createApiKeysRepo(authCtx.db, ownerCtx).revoke(revokedKeyId);
      expect(revoked?.id).toBe(revokedKeyId);

      const error = await rejection(() =>
        client.callTool({ name: MCP_TOOL.GET_FIX, arguments: { fixId: NEVER_ISSUED_FIX } }),
      );

      expect(SdkHttpError.isInstance(error)).toBe(true);
      expect((error as SdkHttpError).status).toBe(401);

      expect(String((error as SdkHttpError).message)).toContain(UNAUTHENTICATED.message);

      expect(process.pid).toBe(pidBefore);
    } finally {
      await closeQuietly(client);
    }
  });

  test("WIRE-E6 — should still serve a second live credential in the same process", async () => {
    const wire = wireTo(serveMounted);
    const client = await openClient(wire, liveKey);

    try {
      const result = await client.callTool({
        name: MCP_TOOL.GET_FIX,
        arguments: { fixId: NEVER_ISSUED_FIX },
      });

      expect(result.isError).toBe(true);
      expect(firstText(result)).toBe(NOT_FOUND.message);
    } finally {
      await closeQuietly(client);
    }
  });
});
