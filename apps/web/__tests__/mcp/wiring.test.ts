import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createHmac } from "node:crypto";

import { serialiseFixSpecInput } from "@growthmind/core";
import {
  createApiKeysRepo,
  createFindingPayloadsRepo,
  createFindingsRepo,
  createFixesService,
  createProjectsRepo,
  createWriteKeysRepo,
  resolveWriteKeyForIngest,
  API_KEY_ACTOR_PREFIX,
  API_KEY_ACTOR_ROLE,
} from "@growthmind/db";
import { scannedTextFor, seedAnalysisRun } from "@growthmind/db/testing";
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
import {
  candidateFor,
  fingerprint,
  sseDataLine,
  toolCallRequest,
  verbRequest,
  WINDOW_END,
  WINDOW_START,
} from "./helpers/mcp-fixture";

const TEST_PASSWORD = "correct-horse-battery-staple";

const UNKNOWN_BUT_WELL_FORMED = `${API_KEY_PREFIX}${"a".repeat(43)}`;

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";
const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

const LIVE_SURFACE = "/mcpwire/reports";

const CLEAN_TEXT = scannedTextFor(
  "People are leaving the reports page without going any further.",
  ["We saw sessions reach the reports page and stop there."],
);

const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

let authCtx: AuthTestContext;
let ownerCtx: TenantContext;

let mintedRaw: string;
let mintedKeyId: string;

let writeKeyRaw: string;

let liveFixId: string;
let liveFindingId: string;

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

  const minted = await createApiKeysRepo(authCtx.db, ownerCtx).mint({ name: "agent-mcpwire" });
  mintedRaw = minted.raw;
  mintedKeyId = minted.key.id;

  const project = await createProjectsRepo(authCtx.db, ownerCtx).create({
    name: "Mcpwire Landing Page",
  });
  writeKeyRaw = (
    await createWriteKeysRepo(authCtx.db, ownerCtx).mint({
      projectId: project.id,
      kind: "standard",
    })
  ).raw;

  const run = await seedAnalysisRun(authCtx.db, { ctx: ownerCtx, projectId: project.id });
  const finding = await createFindingsRepo(authCtx.db, ownerCtx).persist({
    projectId: project.id,
    runId: run.id,
    signature: createHmac("sha256", "mcpwire").update(LIVE_SURFACE).digest("hex"),
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
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: "mcpwire-live-evidence",
    evidenceShapeVersion: 1,
    resolvedModelId: null,
  });
  await createFindingPayloadsRepo(authCtx.db, ownerCtx).upsertFor({
    findingId: finding.id,
    payload: serialiseFixSpecInput({ candidate: candidateFor(LIVE_SURFACE), signals: [] }),
  });

  const opened = await createFixesService(authCtx.db, ownerCtx).openFor(finding.id);
  if (opened.outcome !== "opened") {
    throw new Error(`mcpwire fixture: openFor answered "${opened.outcome}", not "opened"`);
  }

  liveFindingId = finding.id;
  liveFixId = opened.fix.id;
});

afterAll(async () => {
  delete globalForDb.__growthmindDb;
  await authCtx.close();
});

describe("the mounted route answers the credential store this sprint built", () => {
  test("WIRE-M1 — should answer a real minted credential with the row this organization owns", async () => {
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

    // The row itself, through the mounted route: an absent read port answers an empty list
    // here, so these four assertions are what makes the swap in resolveMcpDeps load-bearing.
    expect(payload).toContain(liveFixId);
    expect(payload).toContain(liveFindingId);
    expect(payload).toContain('"returned":1');
    expect(payload).toContain('"totalOpen":1');
    expect(payload).toContain('"truncated":false');

    expect(payload).not.toContain('"isError":true');
  });

  test("WIRE-M1 — and reads that fix back as a rendered spec through the mounted POST", async () => {
    const print = await fingerprint(
      await POST(
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: liveFixId }, key: mintedRaw }),
      ),
    );

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const payload = sseDataLine(print.body);
    expect(payload).toContain(liveFixId);
    expect(payload).toContain('"specText"');
    expect(payload).toContain(LIVE_SURFACE);

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
      context: {
        userId: `${API_KEY_ACTOR_PREFIX}${mintedKeyId}`,
        organizationId: ownerCtx.organizationId,
        organizationName: ownerCtx.organizationName,
        role: API_KEY_ACTOR_ROLE,
      },
    });
    expect(await deps.credentials.resolve(writeKeyRaw)).toBeNull();
  });

  test("should build its read port over the same database handle, not the absent one", async () => {
    const deps = resolveMcpDeps(authCtx.db);

    const page = await deps.reads.listOpenFixes({
      principal: ownerCtx,
      projectId: null,
      limit: 25,
    });

    expect(page.totalOpen).toBe(1);
    expect(page.fixes.map((fix) => fix.fixId)).toEqual([liveFixId]);
  });
});

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".turbo", "coverage"]);

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

const TEST_FILE_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

interface ScannedSource {
  readonly path: string;
  readonly source: string;
}

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function isTestPath(rel: string): boolean {
  const segments = rel.split("/");
  const name = segments.pop() ?? "";
  return (
    segments.includes("__tests__") || TEST_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
}

const DECLARATION = /\bfunction\s+createAbsentReadPort\s*\(/g;

const CALL = /(^|[^\w.])createAbsentReadPort\s*\(/;

const callsAbsentReadPort = (source: string): boolean =>
  CALL.test(source.replace(DECLARATION, "function __declaration__("));

const absentPortCallers = (files: readonly ScannedSource[]): readonly string[] =>
  files
    .filter((file) => !isTestPath(file.path) && callsAbsentReadPort(file.source))
    .map((file) => file.path);

const fixture = (filePath: string, source: string): ScannedSource => ({
  path: filePath,
  source,
});

const PLANTED_PRODUCTION_CALL = fixture(
  "apps/web/app/api/mcp/route.ts",
  `import { createAbsentReadPort } from "@/lib/mcp/read-port";

const absentReads = createAbsentReadPort((message) => logger.warn(message));
`,
);

const CLEAN_DECLARATION = fixture(
  "apps/web/lib/mcp/read-port.ts",
  `export function createAbsentReadPort(log: (message: string) => void): McpReadPort {
  return { listOpenFixes: () => Promise.resolve({ fixes: [], totalOpen: 0 }) };
}
`,
);

const CLEAN_TEST_CALL = fixture(
  "apps/web/__tests__/mcp/read-port.test.ts",
  `const port = createAbsentReadPort(() => {});
`,
);

describe("the production route binds the live read port", () => {
  test("binds no absent read port in the production route", () => {
    expect(absentPortCallers([PLANTED_PRODUCTION_CALL])).toEqual(["apps/web/app/api/mcp/route.ts"]);

    expect(absentPortCallers([CLEAN_DECLARATION])).toEqual([]);
    expect(absentPortCallers([CLEAN_TEST_CALL])).toEqual([]);

    const scanned: ScannedSource[] = listSourceFiles(path.join(REPO_ROOT, "apps")).map((file) => ({
      path: relative(file),
      source: readFileSync(file, "utf8"),
    }));

    expect(scanned.length).toBeGreaterThan(0);

    const production = scanned.filter((file) => !isTestPath(file.path));
    expect(production.length).toBeGreaterThan(0);
    expect(production.length).toBeLessThan(scanned.length);

    expect(absentPortCallers(scanned)).toEqual([]);
  });
});
