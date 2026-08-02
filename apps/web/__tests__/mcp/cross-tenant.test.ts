import { describe, expect, test } from "bun:test";

import { NOT_FOUND } from "../../lib/mcp/refusals";
import { handleMcpRequest } from "../../lib/mcp/server";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  findingRecordFor,
  fixRecordFor,
  openFixRowFor,
  sseDataLine,
  toolCallRequest,
  KEY_A,
  KEY_B,
  ORG_A,
  ORG_B,
} from "./helpers/mcp-fixture";
import { modernToolCallRequest } from "./helpers/modern-envelope";

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A, [KEY_B]: ORG_B });

const NEVER_ISSUED = "fix-mcp-never-issued";

const ORG_B_FIX_ID = "fix-mcp-b-1";
const ORG_B_FINDING_ID = "finding-mcp-b-1";
const ORG_B_PROJECT_ID = "project-mcp-b";

const ORG_A_FIX_ID = "fix-mcp-a-1";
const ORG_A_FINDING_ID = "finding-mcp-a-1";
const ORG_A_PROJECT_ID = "project-mcp-a";

const RESULTS_BY = "2026-07-01T00:00:00.000Z";

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

function notFoundFrame(id: number = 1): string {
  const payload = JSON.stringify({
    result: { content: [{ type: "text", text: NOT_FOUND.message }], isError: true },
    jsonrpc: "2.0",
    id,
  });
  return `event: message\ndata: ${payload}\n\n`;
}

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

async function callAsOrgB(reads: ReturnType<typeof twoOrgStore>, tool: string, input: unknown) {
  return handleMcpRequest(toolCallRequest({ tool, input, key: KEY_B }), {
    credentials: CREDENTIALS,
    reads: reads.port,
  });
}

describe("the read-only machine surface refuses across organizations without saying so", () => {
  test("WIRE-X1 — a fix id from another organization answers byte-identically to an id that does not exist", async () => {
    const reads = twoOrgStore();

    const owned = await fingerprint(await callAsOrgB(reads, "get_fix", { fixId: ORG_B_FIX_ID }));
    expect(owned.status).toBe(200);
    expect(owned.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(owned.body).toContain(ORG_B_FIX_ID);
    expect(owned.body).not.toContain(NOT_FOUND.message);

    const foreign = await fingerprint(await callAsOrgA(reads, "get_fix", { fixId: ORG_B_FIX_ID }));
    const absent = await fingerprint(await callAsOrgA(reads, "get_fix", { fixId: NEVER_ISSUED }));

    expect(foreign.status).toBe(200);
    expect(foreign.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(foreign).toEqual(absent);

    expect(foreign.body).toEqual(notFoundFrame());
  });

  test("WIRE-X2 — a finding id from another organization answers byte-identically to an id that does not exist", async () => {
    const reads = twoOrgStore();

    const owned = await fingerprint(
      await callAsOrgB(reads, "get_finding", { findingId: ORG_B_FINDING_ID }),
    );
    expect(owned.status).toBe(200);
    expect(owned.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(owned.body).toContain(ORG_B_FINDING_ID);
    expect(owned.body).not.toContain(NOT_FOUND.message);

    const foreign = await fingerprint(
      await callAsOrgA(reads, "get_finding", { findingId: ORG_B_FINDING_ID }),
    );
    const absent = await fingerprint(
      await callAsOrgA(reads, "get_finding", { findingId: NEVER_ISSUED }),
    );

    expect(foreign.status).toBe(200);
    expect(foreign.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(foreign).toEqual(absent);

    expect(foreign.body).toEqual(notFoundFrame());
  });

  test("WIRE-X3 — a project id from another organization answers byte-identically to a project id that does not exist", async () => {
    const reads = twoOrgStore();

    const owned = await fingerprint(
      await callAsOrgB(reads, "list_open_fixes", { projectId: ORG_B_PROJECT_ID }),
    );
    expect(owned.status).toBe(200);
    expect(owned.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(owned.body).toContain(ORG_B_FIX_ID);
    expect(owned.body).toContain('"totalOpen":1');

    const foreign = await fingerprint(
      await callAsOrgA(reads, "list_open_fixes", { projectId: ORG_B_PROJECT_ID }),
    );
    const absent = await fingerprint(
      await callAsOrgA(reads, "list_open_fixes", { projectId: "project-never-issued" }),
    );

    expect(foreign.status).toBe(200);
    expect(foreign.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(foreign).toEqual(absent);

    expect(foreign.body).toContain('"totalOpen":0');
    expect(foreign.body).not.toContain(ORG_B_FIX_ID);
  });

  test("WIRE-X4 — the organization every read is scoped to comes from the credential and never from the request", async () => {
    const reads = twoOrgStore();

    await callAsOrgA(reads, "list_open_fixes", {
      organizationId: ORG_B,
      projectId: ORG_B_PROJECT_ID,
    });
    await callAsOrgA(reads, "get_fix", { organizationId: ORG_B, fixId: ORG_B_FIX_ID });
    await callAsOrgA(reads, "get_finding", {
      organizationId: ORG_B,
      findingId: ORG_B_FINDING_ID,
    });

    expect(reads.organizationsAsked).toHaveLength(3);
    expect(reads.organizationsAsked.every((organizationId) => organizationId === ORG_A)).toBe(true);
    expect(reads.organizationsAsked).not.toContain(ORG_B);
  });

  test("WIRE-X5 — an organization reading its own list never sees another organization's open fixes", async () => {
    const reads = twoOrgStore();

    const print = await fingerprint(await callAsOrgA(reads, "list_open_fixes", {}));

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const payload = sseDataLine(print.body);
    expect(payload).toContain(ORG_A_FIX_ID);
    expect(payload).toContain(ORG_A_FINDING_ID);
    expect(payload).toContain('"status":"open"');
    expect(payload).toContain('"returned":1');
    expect(payload).toContain('"totalOpen":1');
    expect(payload).toContain('"truncated":false');

    expect(print.body).not.toContain(ORG_B_FIX_ID);
    expect(print.body).not.toContain(ORG_B_FINDING_ID);
  });
});

describe("the crown jewel holds on the modern leg too", () => {
  test("WIRE-X6 — a fix id from another organization answers byte-identically to an absent one on the modern leg", async () => {
    const reads = twoOrgStore();
    const deps = { credentials: CREDENTIALS, reads: reads.port };

    const owned = await fingerprint(
      await handleMcpRequest(
        modernToolCallRequest({ tool: "get_fix", input: { fixId: ORG_B_FIX_ID }, key: KEY_B }),
        deps,
      ),
    );
    expect(owned.status).toBe(200);
    expect(owned.body).toContain(ORG_B_FIX_ID);
    expect(owned.body).not.toContain(NOT_FOUND.message);

    const foreign = await fingerprint(
      await handleMcpRequest(
        modernToolCallRequest({ tool: "get_fix", input: { fixId: ORG_B_FIX_ID }, key: KEY_A }),
        deps,
      ),
    );
    const absent = await fingerprint(
      await handleMcpRequest(
        modernToolCallRequest({ tool: "get_fix", input: { fixId: NEVER_ISSUED }, key: KEY_A }),
        deps,
      ),
    );

    expect(foreign.status).toBe(200);
    expect(foreign.body).toContain(NOT_FOUND.message);

    expect(foreign).toEqual(absent);
  });

  test("WIRE-X6 — a finding id from another organization is indistinguishable from an absent one on the modern leg", async () => {
    const reads = twoOrgStore();
    const deps = { credentials: CREDENTIALS, reads: reads.port };

    const owned = await fingerprint(
      await handleMcpRequest(
        modernToolCallRequest({
          tool: "get_finding",
          input: { findingId: ORG_B_FINDING_ID },
          key: KEY_B,
        }),
        deps,
      ),
    );
    expect(owned.status).toBe(200);
    expect(owned.body).toContain(ORG_B_FINDING_ID);

    const foreign = await fingerprint(
      await handleMcpRequest(
        modernToolCallRequest({
          tool: "get_finding",
          input: { findingId: ORG_B_FINDING_ID },
          key: KEY_A,
        }),
        deps,
      ),
    );
    const absent = await fingerprint(
      await handleMcpRequest(
        modernToolCallRequest({
          tool: "get_finding",
          input: { findingId: NEVER_ISSUED },
          key: KEY_A,
        }),
        deps,
      ),
    );

    expect(foreign.status).toBe(200);
    expect(foreign.body).toContain(NOT_FOUND.message);
    expect(foreign).toEqual(absent);
  });

  test("WIRE-X6 — the organization is still the credential's when the request is modern and names another", async () => {
    const reads = twoOrgStore();
    const deps = { credentials: CREDENTIALS, reads: reads.port };

    await handleMcpRequest(
      modernToolCallRequest({
        tool: "list_open_fixes",
        input: { organizationId: ORG_B, projectId: ORG_B_PROJECT_ID },
        key: KEY_A,
      }),
      deps,
    );
    await handleMcpRequest(
      modernToolCallRequest({
        tool: "get_fix",
        input: { organizationId: ORG_B, fixId: ORG_B_FIX_ID },
        key: KEY_A,
      }),
      deps,
    );

    expect(reads.organizationsAsked).toHaveLength(2);
    expect(reads.organizationsAsked.every((organizationId) => organizationId === ORG_A)).toBe(true);
    expect(reads.organizationsAsked).not.toContain(ORG_B);
  });
});
