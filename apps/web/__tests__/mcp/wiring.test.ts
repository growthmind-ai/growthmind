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
// ===========================================================================
// O-013: THE ROWS ARE `WIRE-M1…M5`, AND THE PER-REQUEST INVARIANT IS WHY
// ===========================================================================
//
// THE INVARIANT AT LINES 38-40 ABOVE IS NOW LOAD-BEARING FOR A SECOND REASON.
// `getDb()` is called per request inside `resolveMcpDeps()`, and D-4 constructs
// the SDK handler per request too, with `await handler.close()` in a `finally`
// — precisely so a module-scope memoised handler cannot silently break it.
// `W0-P2(e)` measured that the `McpServerFactory` runs per EXCHANGE rather than
// once per handler, which is what makes the invariant hold rather than merely
// survive. If somebody memoises the handler at module scope to "save a
// construction", this suite is where it shows up.
//
// `mock.module` REMAINS BANNED, and the transport changed nothing about that.
// The stash is a VALUE the production code already reads; the O-006 pollution
// class needs a registry rewrite, and there is none here.
//
// ONE CLAIM INVERTS. `WIRE-M2` used to answer 200 to a `GET` — the catalogue.
// The catalogue moved onto the wire protocol as `tools/list` (D-4), so `GET` is
// now a 405 carrying the re-authored `WRONG_METHOD` sentence. The row is NOT
// dropped: `GET` stays an explicitly exported handler rather than being
// delegated to the SDK's own bodiless 405, because an agent that GETs must
// receive a sentence telling it what to send instead.
//
// ⚠️ `WIRE-M5` IS UNTOUCHED, BYTE FOR BYTE — no id prefix, no band assertion,
// not a character. It is the D11 producer/consumer wire proof and one of the
// three rows demonstrating that PR #16's credential path is reused verbatim
// (ADD §4 row 48).
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

/** A well-formed read credential nobody minted. The prefix is the exported
 * constant, never a literal. */
const UNKNOWN_BUT_WELL_FORMED = `${API_KEY_PREFIX}${"a".repeat(43)}`;

/** The two content-type bands (D-6), both measured exactly. `WIRE-M1` is in the
 * first; `WIRE-M2`, `WIRE-M3` and `WIRE-M4` are all in the second, because
 * every one of them is answered before `wire.ts` is called at all. */
const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";
const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

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

describe("the mounted route answers the credential store this sprint built", () => {
  test("WIRE-M1 — should answer 200 to a real minted credential through the mounted POST", async () => {
    // THE ASSERTION THE WHOLE SPRINT TURNS ON. On the wiring that shipped in
    // PR #15 this returns 401, because `resolveMcpDeps()` builds its source
    // from `write_keys` and refuses every row in it. The 401 to 200 flip is the
    // only proof that the new credential source is actually mounted.
    const print = await fingerprint(
      await POST(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: mintedRaw })),
    );

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    // ⚠️ A WHOLE-FRAME COMPARISON, BUILT RATHER THAN PASTED — AND THE REASON
    // MATTERS. The old row `toEqual`'d our pre-protocol `{ok, tool, result}`
    // envelope, which no MCP client has ever sent or read. Its replacement is
    // the JSON-RPC frame, and the frame has two halves with two different
    // amounts of evidence behind them:
    //
    //   - THE FRAMING is measured, exactly: `event: message\ndata: {…}\n\n`,
    //     three lines, no `id:` line, on both legs under all three response
    //     modes. It is pinned here as an equality, so a transport that starts
    //     emitting `\r\n`, a second event, or a per-event id fails THIS row
    //     first — which is the point. If it does fail, report the frame; do not
    //     "fix" it by deleting the assertion.
    //   - THE PAYLOAD's key order inside `structuredContent` is `wire.ts`'s to
    //     choose and was NOT measured, so it is asserted by containment. An
    //     equality against bytes nobody measured would fail at wave 8 for a
    //     reason that says nothing about this wire.
    //
    // NEVER `JSON.parse` HERE. `sseDataLine` is string operations only, and this
    // row's whole job is to prove the bytes the mounted route actually produced.
    const payload = sseDataLine(print.body);
    expect(print.body).toEqual(`event: message\ndata: ${payload}\n\n`);

    expect(payload).toContain('"jsonrpc":"2.0"');
    expect(payload).toContain('"id":1');
    expect(payload).toContain('"structuredContent"');
    expect(payload).toContain('"fixes":[]');
    expect(payload).toContain('"returned":0');
    expect(payload).toContain('"totalOpen":0');
    expect(payload).toContain('"truncated":false');
    // A truthful empty is a SUCCESS through the mounted route, not a refusal
    // that happened to carry an empty list.
    expect(payload).not.toContain('"isError":true');
  });

  test("WIRE-M2 — should answer 405 to the same credential through the mounted GET", async () => {
    // ⚠️ CLAIM INVERTED (D-4), AND THE ROW IS KEPT RATHER THAN DROPPED. The
    // credential is the SAME LIVE ONE `WIRE-M1` was served with, so this 405 is
    // about the METHOD and never about the key — which is the only way the
    // inversion proves anything.
    const print = await fingerprint(await GET(verbRequest({ method: "GET", key: mintedRaw })));

    // PRE-SDK 405 BAND: `GET` is an explicitly exported handler returning
    // `refusalResponse(WRONG_METHOD)`, never delegated to the SDK's own bodiless
    // 405, because an agent that GETs must receive a sentence telling it what to
    // do next.
    expect(print.status).toBe(405);
    expect(print.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(print.body).toContain(WRONG_METHOD.message);

    // The sentence names the method to send and the call that replaced the
    // catalogue, so this refusal instructs rather than merely reports.
    expect(WRONG_METHOD.message).toContain("POST");
    expect(WRONG_METHOD.message).toContain("tools/list");
  });

  test("WIRE-M3 — should still refuse an unknown well-formed credential through the mounted POST", async () => {
    // NEGATIVE CONTROL, AND IT IS LOAD-BEARING: without it, the 200 above could
    // mean an open door rather than a working credential.
    const print = await fingerprint(
      await POST(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: UNKNOWN_BUT_WELL_FORMED })),
    );

    expect(print.status).toBe(401);
    expect(print.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(print.body).toContain(UNAUTHENTICATED.message);
  });

  test("WIRE-M4 — should still refuse a genuine ingest key through the mounted POST", async () => {
    // NON-VACUITY: this key is real, live, and ingest would accept it — so the
    // refusal below is the read surface's decision and not a dead fixture.
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
