import type { ScopedDb } from "@growthmind/db";
import { createTestDb, seedOrgWithOwner, type TestDbHandle } from "@growthmind/db/testing";
import { MCP_TOOL } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createApiKeyMcpCredentials, type McpCredentialSource } from "../../lib/mcp/credentials";
import { createLiveReadPort } from "../../lib/mcp/read-port-live";
import { UNAUTHENTICATED, UNAVAILABLE } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  fakeCredentials,
  fingerprint,
  mintRealApiKey,
  sseDataLine,
  throwingReadPort,
  toolCallRequest,
  KEY_A,
  ORG_A,
} from "./helpers/mcp-fixture";
import {
  carriesFilePath,
  carriesStackFrame,
  watchForUnhandledRejections,
} from "./helpers/wire-probes";

import { setLogSink, type LogRecord } from "@growthmind/shared";
const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function brokenReadDeps(): McpServerDeps {
  return { credentials: CREDENTIALS, reads: throwingReadPort() };
}

describe("WIRE-B1 — a read that throws becomes a detail-free answer with the fault logged", () => {
  test("answers with the unavailable sentence, carries no stack frame or file path, and logs once", async () => {
    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });

    try {
      const response = await handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }),
        brokenReadDeps(),
      );
      const body = await response.text();

      expect(body).toContain(UNAVAILABLE.message);

      expect(carriesStackFrame(body)).toBe(false);
      expect(carriesFilePath(body)).toBe(false);
      expect(body).not.toContain("mcp fixture");

      expect(logged).toHaveLength(1);
      expect(logged[0]?.level).toBe("error");
    } finally {
      restore();
    }
  });

  test("the leak scanners do fire on the fixture's own error text and a stack frame", () => {
    const leaky =
      "Error: mcp fixture: the read port is unreachable\n    at listOpenFixes (apps/web/lib/mcp/call-tool.ts:70:11)";

    expect(carriesStackFrame(leaky)).toBe(true);
    expect(carriesFilePath(leaky)).toBe(true);
    expect(carriesStackFrame(UNAVAILABLE.message)).toBe(false);
    expect(carriesFilePath(UNAVAILABLE.message)).toBe(false);
  });
});

describe("WIRE-B2 — no unhandled rejection escapes the mounted handler", () => {
  test("a rejecting port still comes back as a Response, with nothing left unhandled", async () => {
    const watched = await watchForUnhandledRejections(async () =>
      handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: "fix-anything" }, key: KEY_A }),
        brokenReadDeps(),
      ),
    );

    expect(watched.result).toBeInstanceOf(Response);

    expect(await watched.result.text()).toContain(UNAVAILABLE.message);

    expect(watched.unhandled).toEqual([]);
  });
});

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";
const STAMP_FAULT = "wire-b3: the last-used stamp is down";

/** A cold PGlite boot was measured at 5.4s; bun's 5s default would replace this file's named reds with one hook timeout. */
const COLD_BOOT_BUDGET_MS = 60_000;

type ApiKeyUseStamp = (db: ScopedDb, keyId: string) => Promise<void>;

interface StampProbe {
  readonly credentials: McpCredentialSource;
  readonly stampedKeyIds: readonly string[];
}

function credentialsWhoseStampThrows(db: ScopedDb): StampProbe {
  const stampedKeyIds: string[] = [];

  const withStamp = createApiKeyMcpCredentials as unknown as (
    scoped: ScopedDb,
    stamp: ApiKeyUseStamp,
  ) => McpCredentialSource;

  const credentials = withStamp(db, (_scoped: ScopedDb, keyId: string) => {
    stampedKeyIds.push(keyId);
    throw new Error(STAMP_FAULT);
  });

  return { credentials, stampedKeyIds };
}

describe("WIRE-B3 — a stamp that throws never refuses an otherwise-valid call", () => {
  let handle: TestDbHandle;
  let db: ScopedDb;
  let rawKey: string;
  let keyId: string;

  beforeAll(async () => {
    handle = await createTestDb();
    db = handle.db;

    const org = await seedOrgWithOwner(handle.db, {
      orgName: "Org Wire B3",
      userName: "Owner Wire B3",
      email: "owner-wire-b3@example.com",
    });

    const minted = await mintRealApiKey(handle.db, org.ctx, "agent-stamp-fault");
    rawKey = minted.raw;
    keyId = minted.id;
  }, COLD_BOOT_BUDGET_MS);

  afterAll(async () => {
    await handle?.close();
  });

  async function driveWithFaultyStamp(key: string | null): Promise<{
    readonly print: Awaited<ReturnType<typeof fingerprint>>;
    readonly stampedKeyIds: readonly string[];
  }> {
    const probe = credentialsWhoseStampThrows(db);
    const print = await fingerprint(
      await handleMcpRequest(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key }), {
        credentials: probe.credentials,
        reads: createLiveReadPort(db),
      }),
    );

    return { print, stampedKeyIds: probe.stampedKeyIds };
  }

  test("should reach the stamp and still answer 200 with the real tool result", async () => {
    const { print, stampedKeyIds } = await driveWithFaultyStamp(rawKey);

    expect(stampedKeyIds).toEqual([keyId]);

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const payload = sseDataLine(print.body);
    expect(payload).toContain('"fixes":[]');
    expect(payload).toContain('"totalOpen":0');
    expect(payload).not.toContain('"isError":true');
  });

  test("should never turn a stamp fault into the refusal a missing credential gets", async () => {
    const stamped = await driveWithFaultyStamp(rawKey);
    const anonymous = await driveWithFaultyStamp(null);

    expect(stamped.stampedKeyIds).toEqual([keyId]);
    expect(anonymous.stampedKeyIds).toEqual([]);

    expect(anonymous.print.status).toBe(401);
    expect(anonymous.print.body).toContain(UNAUTHENTICATED.message);

    expect(stamped.print.status).not.toBe(anonymous.print.status);
    expect(stamped.print.body).not.toContain(UNAUTHENTICATED.message);
  });

  test("should log the stamp fault exactly once, carrying no credential material", async () => {
    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });

    try {
      const { stampedKeyIds } = await driveWithFaultyStamp(rawKey);
      expect(stampedKeyIds).toEqual([keyId]);

      const errors = logged.filter((record) => record.level === "error");
      expect(errors).toHaveLength(1);
      expect(JSON.stringify(errors)).not.toContain(rawKey);
    } finally {
      restore();
    }
  });
});
