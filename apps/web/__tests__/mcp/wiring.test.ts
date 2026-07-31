// THE COMPOSITION ROOT, DRIVEN THROUGH THE MOUNTED ROUTE (O-009, ADD §8 lane
// `mcpwire`). NEVER CUT — this file is the reason the sprint is not allowed to
// ship inert.
//
// ===========================================================================
// THE HOLE THIS FILE CLOSES, STATED PRECISELY
// ===========================================================================
//
// `resolveMcpDeps()` is exercised by EXACTLY ZERO tests today.
// `./route.test.ts` is the only file that imports the route module, and its
// only use of that import is `Object.keys(mcpRoute)`; every one of its ten
// `handleMcpRequest` calls builds its own deps literal, and `POST`/`GET` are
// never invoked anywhere in the codebase. So a perfect credential resolver
// could ship behind a route still wired to the write-key source and the entire
// suite would stay green — the D11 producer/consumer class that killed O-003's
// identity wire, live in this repo.
//
// Every other suite in this directory proves a COMPONENT. This one proves the
// WIRE: it imports the REAL exported `POST` and `GET` and drives real `Request`
// objects through them. Nothing here constructs an `McpServerDeps`; if the
// route's own composition is wrong, these tests fail, and they are the only
// tests that would.
//
// ---------------------------------------------------------------------------
// HOW THE DATABASE GETS IN, AND WHY IT IS NOT `mock.module`
// ---------------------------------------------------------------------------
//
// `getDb()` (`apps/web/lib/db.ts`) keeps one pool per process in a
// `globalThis.__growthmindDb` stash so Next.js hot reloads do not leak pools.
// This suite installs a PGlite handle into that stash before the first request
// and deletes it afterwards. That is a VALUE the production code already reads,
// not a patch of the module registry.
//
// `mock.module` IS FORBIDDEN HERE. It is a Bun process-global that rewrites the
// registry for the whole test run; registering one in O-006 corrupted an
// unrelated suite (`packages/core/__tests__/findings/signature-tuple.test.ts`).
//
// A STATIC IMPORT OF THE ROUTE IS CORRECT, not a dynamic one: `getDb()` is
// called per request inside `resolveMcpDeps()`, never at module load, so the
// stash only has to be installed before the first request.
//
// IF SOMEBODY LATER REFACTORS `lib/db.ts` AWAY FROM THE STASH, this suite fails
// LOUDLY rather than silently: `getDb()` would build a real pool, the query
// would fail, `server.ts`'s `authenticate()` would catch it and refuse, and
// these tests would report `expected 200, got 401` — a wrong answer, never a
// green one.
//
// Lane prefix `mcpwire`.
import {
  createApiKeysRepo,
  createProjectsRepo,
  createWriteKeysRepo,
  resolveWriteKeyForIngest,
} from "@growthmind/db";
import { API_KEY_PREFIX, MCP_TOOL, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GET, POST, resolveMcpDeps } from "../../app/api/mcp/route";
import {
  buildTestTenantContext,
  createTestOrganization,
  setupAuthTest,
  signUpTestUser,
  type AuthTestContext,
} from "../tenancy/helpers/auth-fixture";
import { fingerprint, toolCallRequest } from "./helpers/mcp-fixture";

const TEST_PASSWORD = "correct-horse-battery-staple";
const MCP_URL = "http://localhost:3000/api/mcp";

/** A well-formed read credential nobody minted. The prefix is the exported
 * constant, never a literal. */
const UNKNOWN_BUT_WELL_FORMED = `${API_KEY_PREFIX}${"a".repeat(43)}`;

const TOOL_NAMES = [MCP_TOOL.GET_FINDING, MCP_TOOL.GET_FIX, MCP_TOOL.LIST_OPEN_FIXES].toSorted();

/** The stash `getDb()` reads. Typed as `unknown` here because this suite only
 * ever writes and deletes it — it never calls a method on it through this
 * handle. */
const globalForDb = globalThis as unknown as { __growthmindDb?: unknown };

let authCtx: AuthTestContext;
let ownerCtx: TenantContext;
/** A real read credential, minted by the repository the CLI will call. */
let mintedRaw: string;
/** A real, unrevoked ingest key — the credential family this surface must keep
 * refusing after the swap. */
let writeKeyRaw: string;

beforeAll(async () => {
  authCtx = await setupAuthTest();

  // Installed BEFORE the first request; `resolveMcpDeps()` calls `getDb()` per
  // request, so nothing had to be imported dynamically to make this work.
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

function catalogueRequest(key: string | null): Request {
  const headers = new Headers();
  if (key !== null) {
    headers.set("authorization", `Bearer ${key}`);
  }
  return new Request(MCP_URL, { method: "GET", headers });
}

describe("the mounted route answers the credential store this sprint built", () => {
  test("should answer 200 to a real minted credential through the mounted POST", async () => {
    // THE ASSERTION THE WHOLE SPRINT TURNS ON. On the wiring that shipped in
    // PR #15 this returns 401, because `resolveMcpDeps()` builds its source
    // from `write_keys` and refuses every row in it. The 401 to 200 flip is the
    // only proof that the new credential source is actually mounted.
    const response = await POST(
      toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: mintedRaw }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      tool: MCP_TOOL.LIST_OPEN_FIXES,
      result: { fixes: [], window: { returned: 0, totalOpen: 0, truncated: false } },
    });
  });

  test("should answer 200 to the same credential through the mounted GET", async () => {
    const response = await GET(catalogueRequest(mintedRaw));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; tools: { name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.tools.map((tool) => tool.name).toSorted()).toEqual(TOOL_NAMES);
  });

  test("should still refuse an unknown well-formed credential through the mounted POST", async () => {
    // NEGATIVE CONTROL, AND IT IS LOAD-BEARING: without it, the 200 above could
    // mean an open door rather than a working credential.
    const response = await POST(
      toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: UNKNOWN_BUT_WELL_FORMED }),
    );

    expect(response.status).toBe(401);
  });

  test("should still refuse a genuine ingest key through the mounted POST", async () => {
    // NON-VACUITY: this key is real, live, and ingest would accept it — so the
    // refusal below is the read surface's decision and not a dead fixture.
    const asIngest = await resolveWriteKeyForIngest(authCtx.db, writeKeyRaw);
    expect(asIngest?.kind).toBe("standard");

    const withIngestKey = await POST(
      toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: writeKeyRaw }),
    );
    const withNothing = await POST(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: null }));

    expect(withIngestKey.status).toBe(401);
    expect(await fingerprint(withIngestKey)).toEqual(await fingerprint(withNothing));
  });

  test("should build its credential source from api keys", async () => {
    // The same claim as the rows above, one layer down and free of the
    // `getDb()` stash entirely — so this row survives any future change to how
    // the process gets its pool. `authCtx.db` is a `ScopedDb` already: no cast,
    // no `any`.
    const deps = resolveMcpDeps(authCtx.db);

    expect(await deps.credentials.resolve(mintedRaw)).toEqual({
      organizationId: ownerCtx.organizationId,
    });
    expect(await deps.credentials.resolve(writeKeyRaw)).toBeNull();
  });
});
