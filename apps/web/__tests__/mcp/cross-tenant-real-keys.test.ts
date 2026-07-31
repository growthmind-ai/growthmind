// THE CROSS-TENANT PROOF, WITH THE CREDENTIALS REAL (O-009, ADD §8 lane
// `mcpxk`).
//
// `./cross-tenant.test.ts` discharges the identity obligation
// `packages/shared/src/mcp/types.ts` handed forward, using a FAKE credential
// source that maps two opaque strings to two organizations. That proves the
// handler. It cannot prove the thing this sprint adds: that a credential
// resolved out of a real `api_keys` row lands in exactly one organization and
// can never be made to land in the other.
//
// So this file seeds TWO REAL ORGANIZATIONS on ONE database — real Better Auth
// sign-ups, real `member` rows, real tenant contexts — mints ONE REAL
// CREDENTIAL in each through `createApiKeysRepo(...).mint()`, and drives the
// real handler with the real production credential source over that database.
//
// THE READ PORT STAYS A FAKE, AND THAT IS THE POINT RATHER THAN A SHORTCUT.
// There is no `findings` table in this branch (O-011's), so a real store would
// answer empty to everyone and every identity assertion below would be
// vacuously true — a surface that said "nothing here" to every question would
// pass all five rows perfectly and be useless. The fake store gives org B a fix,
// a finding and a project that GENUINELY EXIST, each test proves org B can read
// its own row first, and only then proves org A cannot tell it exists.
//
// IDENTICALLY IS TAKEN LITERALLY, exactly as the sibling suite takes it: the
// comparisons are of status, content type and raw response TEXT. A parsed
// comparison would hide a differing message, which is the leak these rows exist
// to catch.
//
// Lane prefix `mcpxk`.
import { createApiKeysRepo, resolveApiKeyForRead } from "@growthmind/db";
import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { MCP_TOOL, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createApiKeyMcpCredentials } from "../../lib/mcp/credentials";
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

/** Ids nobody ever issued. Deliberately shaped like real ones, so a comparison
 * is never accidentally between two different KINDS of wrong. */
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

  // NON-VACUITY FOR THE WHOLE FILE: two organizations that are genuinely
  // different, and two credentials that are genuinely different.
  expect(ctxA.organizationId).not.toBe(ctxB.organizationId);
  expect(keyA).not.toBe(keyB);
});

afterAll(async () => {
  await dbHandle.close();
});

/** A store in which BOTH organizations own real rows, keyed by the real
 * organization ids the sign-ups produced. */
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
  // THE REAL credential source over the real two-organization database.
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
  test("should answer another organization's fix id exactly as an id that does not exist", async () => {
    const reads = twoOrgStore();

    // NON-VACUITY: org B's fix exists, and org B's REAL credential reads it.
    const owned = await callWith(reads, keyB, MCP_TOOL.GET_FIX, { fixId: ORG_B_FIX_ID });
    expect(owned.status).toBe(200);

    const foreign = await callWith(reads, keyA, MCP_TOOL.GET_FIX, { fixId: ORG_B_FIX_ID });
    const absent = await callWith(reads, keyA, MCP_TOOL.GET_FIX, { fixId: NEVER_ISSUED_FIX });

    expect(await fingerprint(foreign)).toEqual(await fingerprint(absent));
    expect(foreign.status).toBe(404);
  });

  test("should answer another organization's finding id exactly as an id that does not exist", async () => {
    const reads = twoOrgStore();

    const owned = await callWith(reads, keyB, MCP_TOOL.GET_FINDING, {
      findingId: ORG_B_FINDING_ID,
    });
    expect(owned.status).toBe(200);

    const foreign = await callWith(reads, keyA, MCP_TOOL.GET_FINDING, {
      findingId: ORG_B_FINDING_ID,
    });
    const absent = await callWith(reads, keyA, MCP_TOOL.GET_FINDING, {
      findingId: NEVER_ISSUED_FINDING,
    });

    expect(await fingerprint(foreign)).toEqual(await fingerprint(absent));
    expect(foreign.status).toBe(404);
  });

  test("should answer another organization's project id exactly as a project id that does not exist", async () => {
    const reads = twoOrgStore();

    // NON-VACUITY: the same narrowing, asked with the credential of the
    // organization that owns the project, returns the one fix in it.
    const owned = await callWith(reads, keyB, MCP_TOOL.LIST_OPEN_FIXES, {
      projectId: ORG_B_PROJECT_ID,
    });
    expect(await owned.json()).toMatchObject({ ok: true, result: { window: { totalOpen: 1 } } });

    const foreign = await callWith(reads, keyA, MCP_TOOL.LIST_OPEN_FIXES, {
      projectId: ORG_B_PROJECT_ID,
    });
    const absent = await callWith(reads, keyA, MCP_TOOL.LIST_OPEN_FIXES, {
      projectId: NEVER_ISSUED_PROJECT,
    });

    expect(await fingerprint(foreign)).toEqual(await fingerprint(absent));
    // The shared answer is a well-formed empty list, not an error.
    expect(foreign.status).toBe(200);
  });

  test("should scope every read to the organization the credential resolves to, never the request", async () => {
    const reads = twoOrgStore();

    // Every argument names something of the OTHER organization's.
    await callWith(reads, keyA, MCP_TOOL.LIST_OPEN_FIXES, { projectId: ORG_B_PROJECT_ID });
    await callWith(reads, keyA, MCP_TOOL.GET_FIX, { fixId: ORG_B_FIX_ID });
    await callWith(reads, keyA, MCP_TOOL.GET_FINDING, { findingId: ORG_B_FINDING_ID });

    expect(reads.organizationsAsked).toHaveLength(3);
    expect(reads.organizationsAsked.every((id) => id === ctxA.organizationId)).toBe(true);

    // And the mirror, so this is a property of the credential rather than of
    // whichever organization happened to be seeded first.
    const mirror = twoOrgStore();
    await callWith(mirror, keyB, MCP_TOOL.LIST_OPEN_FIXES, { projectId: ORG_A_PROJECT_ID });
    await callWith(mirror, keyB, MCP_TOOL.GET_FIX, { fixId: ORG_A_FIX_ID });
    await callWith(mirror, keyB, MCP_TOOL.GET_FINDING, { findingId: ORG_A_FINDING_ID });

    expect(mirror.organizationsAsked).toHaveLength(3);
    expect(mirror.organizationsAsked.every((id) => id === ctxB.organizationId)).toBe(true);
  });

  test("should never resolve one organization's credential to the other organization", async () => {
    const resolvedA = await resolveApiKeyForRead(dbHandle.db, keyA);
    const resolvedB = await resolveApiKeyForRead(dbHandle.db, keyB);

    expect(resolvedA).toEqual({ organizationId: ctxA.organizationId });
    expect(resolvedB).toEqual({ organizationId: ctxB.organizationId });

    // Stated the other way round too, so a resolver that returned the same
    // organization for everything could not pass by matching one row.
    expect(resolvedA?.organizationId).not.toBe(ctxB.organizationId);
    expect(resolvedB?.organizationId).not.toBe(ctxA.organizationId);
  });
});
