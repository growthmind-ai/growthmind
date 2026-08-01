// The cross-tenant proof, with the credentials real (lane `mcpxk`).
//
// `./cross-tenant.test.ts` discharges the identity obligation
// `packages/shared/src/mcp/types.ts` handed forward, using a fake credential source
// that maps two opaque strings to two organizations. That proves the handler. It cannot
// prove the thing this sprint adds: that a credential resolved out of a real `api_keys`
// row lands in exactly one organization and can never be made to land in the other.
//
// So this file seeds two real organizations on one database. Real Better Auth sign-ups,
// real `member` rows, real tenant contexts. Mints one real credential in each through
// `createApiKeysRepo.mint`, and drives the real handler with the real production
// credential source over that database.
//
// The read port stays a fake, and that is the point rather than a shortcut. There is no
// `findings` table in this branch, so a real store would answer empty to
// everyone and every identity assertion below would be vacuously true. A surface that
// said "nothing here" to every question would pass all five rows perfectly and be
// useless. The fake store gives org B a fix, a finding and a project that genuinely
// exist, each test proves org B can read its own row first, and only then proves org A
// cannot tell it exists.
//
// Identically is taken literally, exactly as the sibling suite takes it: the
// comparisons are of status, content type and raw response text. A parsed comparison
// would hide a differing message, which is the leak these rows exist to catch.
//
// The rows are `WIRE-XR1…XR5`, and only `callWith` changed
//
// The surface moved to JSON-RPC over a real MCP transport. The claims here did not move
// at all. What moved is how a request is built and which band the answer arrives in.
// Both changes are inside `callWith` and the two constants below; every assertion
// still compares the same three fields over the same two real credentials.
//
// Request: fixture-minted, so it is a JSON-RPC `tools/call` on the legacy
//  leg carrying `accept: application/json, text/event-stream` — both values,
//  or the transport answers 406 before a credential is even looked at — with
//  the JSON-RPC `id` defaulting to 1 so two compared answers share it.
// Band: `NOT_FOUND` is now a tool execution error on HTTP 200, rendered by
//  the SDK as `text/event-stream` (rule 2). The status halves read 200
//  where they used to read 404; `NOT_FOUND.status` keeps its 404 and simply
//  stops being read on this path.
//
//  ⚠️ the per-row line for these rows still says `application/json`.
//  Round-1 residue from the abandoned `responseMode: "json"` pin — the band
//  paragraph and both say `text/event-stream`, measured on both legs
//  under all three modes, and they win. Do not "fix" it back.
//
// The exclusion list is empty and stays empty. No `id:` line is emitted on either leg,
// so two identical requests are byte-identical and no field has to be excluded from the
// comparison. `WIRE-R10` scans this file for `toMatchObject`, `objectContaining` and
// `JSON.parse(`; it contains none of them, and the one `toMatchObject` it used to carry
// (at the old line 232) is gone, see `WIRE-XR3`.
//
// ⚠️ `WIRE-XR5` is untouched, byte for byte. No id prefix, no band assertion, not a
// character. It resolves two real credentials with no HTTP anywhere near it, it doubles
// as the teammate row, and it is one of the three rows that prove PR #16's credential
// path is reused verbatim (row 43).
//
// Lane prefix `mcpxk`.
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

/**
 * The content type of every answer the SDK rendered, under the pinned `responseMode:
 * "sse"`. Measured exactly: no charset suffix, unlike the pre-SDK band's
 * `application/json;charset=utf-8`.
 */
const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

/**
 * The whole frame a `NOT_FOUND` tool execution error arrives in on the legacy leg, the
 * same construction the fake-credential sibling suite uses, built from the constant
 * rather than pasted so a reword fails `WIRE-R9` rather than silently rewriting this
 * expectation.
 *
 * `JSON.stringify` is not the banned direction. `WIRE-R10` bans `JSON.parse(` because
 * parsing a response discards key order, whitespace and framing. The bytes these rows
 * compare. Serialising an expectation pins key order instead of discarding it, and what
 * is compared is still a string against a string.
 */
function notFoundFrame(id: number = 1): string {
  const payload = JSON.stringify({
    result: { content: [{ type: "text", text: NOT_FOUND.message }], isError: true },
    jsonrpc: "2.0",
    id,
  });
  return `event: message\ndata: ${payload}\n\n`;
}

/** Ids nobody ever issued. Deliberately shaped like real ones, so a comparison is never
 * accidentally between two different kinds of wrong. */
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

  // Non-vacuity for the whole file: two organizations that are genuinely different, and
  // two credentials that are genuinely different.
  expect(ctxA.organizationId).not.toBe(ctxB.organizationId);
  expect(keyA).not.toBe(keyB);
});

afterAll(async () => {
  await dbHandle.close();
});

/** A store in which both organizations own real rows, keyed by the real organization
 * ids the sign-ups produced. */
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
  // The real credential source over the real two-organization database.
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

    // Non-vacuity: org B's fix exists, and org B's real credential reads it. The band
    // is asserted with the status, because a 200 that carried an empty success of some
    // other kind would satisfy a bare status check.
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

    // The band before the comparison: two wrong answers compare equal to each other all
    // day.
    expect(foreign.status).toBe(200);
    expect(foreign.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    // The tenant proof, over two real credentials. Load-bearing; never loosen.
    expect(foreign).toEqual(absent);

    // The measured frame, a contract pin, not the tenant proof.
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

    // Non-vacuity: the same narrowing, asked with the credential of the organization
    // that owns the project, returns the one fix in it.
    //
    // ⚠️ this half used `toMatchObject` and now does not. It was one of the five
    // loosenings `WIRE-R10` named at Wave 0-T1, and the only one in this file. The raw
    // frame is inspected by containment instead. No parse, no subset matcher, and
    // strictly more of the answer inside the assertion.
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

    // The shared answer is a well-formed empty list, not an error.
    expect(foreign.status).toBe(200);
    expect(foreign.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(foreign).toEqual(absent);

    expect(foreign.body).toContain('"totalOpen":0');
    expect(foreign.body).not.toContain(ORG_B_FIX_ID);
  });

  test("WIRE-XR4 — should scope every read to the organization the credential resolves to, never the request", async () => {
    const reads = twoOrgStore();

    // Every argument names something of the other organization's, and now names the
    // other organization itself as well. Under JSON-RPC a caller puts whatever it likes
    // in `params.arguments`, so the row asserts the stronger claim: an explicit
    // `organizationId` in the arguments reaches nothing, because no tool input schema
    // declares the key and the credential is the only place an organization id exists
    // on this path.
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

    // And the mirror, so this is a property of the credential rather than of whichever
    // organization happened to be seeded first.
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

    // Stated the other way round too, so a resolver that returned the same organization
    // for everything could not pass by matching one row.
    expect(resolvedA?.organizationId).not.toBe(ctxB.organizationId);
    expect(resolvedB?.organizationId).not.toBe(ctxA.organizationId);
  });
});
