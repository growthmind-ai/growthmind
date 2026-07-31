// THE FLAGSHIP PROOF OF O-009 (edge taxonomy D7/D2; the obligation
// `packages/shared/src/mcp/types.ts` handed forward in writing).
//
// Wave 1 closed what a schema can close: no tool input accepts an organization
// key, so "give me another tenant's fixes" is not a sentence this contract can
// express. It then wrote down the one thing only a route can discharge:
//
//   > Ids (`fixId`, `findingId`, `projectId`) are strings. The route must
//   > resolve every id INSIDE the credential's organization, and an id
//   > belonging to ANOTHER organization must answer IDENTICALLY to one that
//   > does not exist. A distinguishable "not yours" is itself a cross-tenant
//   > read.
//
// This file is that discharge, and it takes the word IDENTICALLY literally: the
// assertions compare status, content type and the raw response TEXT — not
// parsed objects, which would hide a differing message, and not just the status
// code, which would hide everything else.
//
// NON-VACUITY IS ASSERTED FIRST IN EVERY CASE. A route that answered
// `not found` to everything would pass every identity assertion here perfectly
// and be useless, so each test proves the organization that OWNS the row gets
// it before proving the other one cannot tell it exists.
import { describe, expect, test } from "bun:test";

import { handleMcpRequest } from "../../lib/mcp/server";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  findingRecordFor,
  fixRecordFor,
  openFixRowFor,
  toolCallRequest,
  KEY_A,
  KEY_B,
  ORG_A,
  ORG_B,
} from "./helpers/mcp-fixture";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A, [KEY_B]: ORG_B });

/** An id nobody ever issued. Deliberately shaped like a real one, so the
 * comparison is not accidentally between two different KINDS of wrong. */
const NEVER_ISSUED = "fix-mcp-never-issued";

const ORG_B_FIX_ID = "fix-mcp-b-1";
const ORG_B_FINDING_ID = "finding-mcp-b-1";
const ORG_B_PROJECT_ID = "project-mcp-b";

const ORG_A_FIX_ID = "fix-mcp-a-1";
const ORG_A_FINDING_ID = "finding-mcp-a-1";
const ORG_A_PROJECT_ID = "project-mcp-a";

const RESULTS_BY = "2026-07-01T00:00:00.000Z";

function twoOrgStore() {
  return fakeReadPort({
    openFixes: [
      {
        organizationId: ORG_A,
        projectId: ORG_A_PROJECT_ID,
        row: openFixRowFor({
          fixId: ORG_A_FIX_ID,
          findingId: ORG_A_FINDING_ID,
          resultsBy: RESULTS_BY,
        }),
      },
      {
        organizationId: ORG_B,
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
        organizationId: ORG_A,
        record: fixRecordFor({
          fixId: ORG_A_FIX_ID,
          findingId: ORG_A_FINDING_ID,
          resultsBy: RESULTS_BY,
        }),
      },
      {
        organizationId: ORG_B,
        record: fixRecordFor({
          fixId: ORG_B_FIX_ID,
          findingId: ORG_B_FINDING_ID,
          resultsBy: RESULTS_BY,
        }),
      },
    ],
    findings: [
      {
        organizationId: ORG_A,
        record: findingRecordFor({ findingId: ORG_A_FINDING_ID, fixId: ORG_A_FIX_ID }),
      },
      {
        organizationId: ORG_B,
        record: findingRecordFor({ findingId: ORG_B_FINDING_ID, fixId: ORG_B_FIX_ID }),
      },
    ],
  });
}

async function callAsOrgA(reads: ReturnType<typeof twoOrgStore>, tool: string, input: unknown) {
  return handleMcpRequest(toolCallRequest({ tool, input, key: KEY_A }), {
    credentials: CREDENTIALS,
    reads: reads.port,
  });
}

describe("the read-only machine surface refuses across organizations without saying so", () => {
  test("a fix id from another organization answers byte-identically to an id that does not exist", async () => {
    const reads = twoOrgStore();

    // NON-VACUITY: org B's fix genuinely exists, and org B can read it.
    const owned = await handleMcpRequest(
      toolCallRequest({ tool: "get_fix", input: { fixId: ORG_B_FIX_ID }, key: KEY_B }),
      { credentials: CREDENTIALS, reads: reads.port },
    );
    expect(owned.status).toBe(200);

    const foreign = await callAsOrgA(reads, "get_fix", { fixId: ORG_B_FIX_ID });
    const absent = await callAsOrgA(reads, "get_fix", { fixId: NEVER_ISSUED });

    expect(await fingerprint(foreign)).toEqual(await fingerprint(absent));
    expect(foreign.status).toBe(404);
  });

  test("a finding id from another organization answers byte-identically to an id that does not exist", async () => {
    const reads = twoOrgStore();

    const owned = await handleMcpRequest(
      toolCallRequest({ tool: "get_finding", input: { findingId: ORG_B_FINDING_ID }, key: KEY_B }),
      { credentials: CREDENTIALS, reads: reads.port },
    );
    expect(owned.status).toBe(200);

    const foreign = await callAsOrgA(reads, "get_finding", { findingId: ORG_B_FINDING_ID });
    const absent = await callAsOrgA(reads, "get_finding", { findingId: NEVER_ISSUED });

    expect(await fingerprint(foreign)).toEqual(await fingerprint(absent));
    expect(foreign.status).toBe(404);
  });

  test("a project id from another organization answers byte-identically to a project id that does not exist", async () => {
    const reads = twoOrgStore();

    // NON-VACUITY: the same narrowing, asked by the organization that owns the
    // project, returns the one fix in it.
    const owned = await handleMcpRequest(
      toolCallRequest({
        tool: "list_open_fixes",
        input: { projectId: ORG_B_PROJECT_ID },
        key: KEY_B,
      }),
      { credentials: CREDENTIALS, reads: reads.port },
    );
    const ownedBody: unknown = await owned.json();
    expect(ownedBody).toMatchObject({ ok: true, result: { window: { totalOpen: 1 } } });

    const foreign = await callAsOrgA(reads, "list_open_fixes", { projectId: ORG_B_PROJECT_ID });
    const absent = await callAsOrgA(reads, "list_open_fixes", {
      projectId: "project-never-issued",
    });

    expect(await fingerprint(foreign)).toEqual(await fingerprint(absent));
    // And the shared answer is a well-formed empty list, not an error — an
    // empty result is a legitimate answer, and it is the only truthful one.
    expect(foreign.status).toBe(200);
  });

  test("the organization every read is scoped to comes from the credential and never from the request", async () => {
    const reads = twoOrgStore();

    await callAsOrgA(reads, "list_open_fixes", { projectId: ORG_B_PROJECT_ID });
    await callAsOrgA(reads, "get_fix", { fixId: ORG_B_FIX_ID });
    await callAsOrgA(reads, "get_finding", { findingId: ORG_B_FINDING_ID });

    // Every call carried org A's id even though every argument named something
    // of org B's. Length is asserted so a route that stopped reading at all
    // would not pass this by asking about nothing.
    expect(reads.organizationsAsked).toHaveLength(3);
    expect(reads.organizationsAsked.every((organizationId) => organizationId === ORG_A)).toBe(true);
  });

  test("an organization reading its own list never sees another organization's open fixes", async () => {
    const reads = twoOrgStore();

    const response = await callAsOrgA(reads, "list_open_fixes", {});
    const body: unknown = await response.json();

    expect(body).toMatchObject({
      ok: true,
      result: {
        fixes: [{ fixId: ORG_A_FIX_ID, findingId: ORG_A_FINDING_ID, status: "open" }],
        window: { returned: 1, totalOpen: 1, truncated: false },
      },
    });
    expect(JSON.stringify(body)).not.toContain(ORG_B_FIX_ID);
    expect(JSON.stringify(body)).not.toContain(ORG_B_FINDING_ID);
  });
});
