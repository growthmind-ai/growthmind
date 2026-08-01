// The flagship proof of (edge taxonomy /; the obligation
// `packages/shared/src/mcp/types.ts` handed forward in writing).
//
// Wave 1 closed what a schema can close: no tool input accepts an organization key, so
// "give me another tenant's fixes" is not a sentence this contract can express. It then
// wrote down the one thing only a route can discharge:
//
// > Ids (`fixId`, `findingId`, `projectId`) are strings. The route must
// > resolve every id inside the credential's organization, and an id
// > belonging to another organization must answer identically to one that
// > does not exist. A distinguishable "not yours" is itself a cross-tenant
// > read.
//
// This file is that discharge, and it takes the word identically literally: the
// assertions compare status, content type and the raw response text, not parsed
// objects, which would hide a differing message, and not just the status code, which
// would hide everything else.
//
// Non-vacuity is asserted first in every case. A route that answered `not found` to
// everything would pass every identity assertion here perfectly and be useless, so each
// test proves the organization that owns the row gets it before proving the other one
// cannot tell it exists.
//
// The rows are `WIRE-X1…X5`, and the proof survived the transport
//
// The surface now speaks JSON-RPC over a real MCP transport. Three things moved and one
// thing did not, and the one that did not is the whole point of this file. The
// byte-identity between a foreign-org id and an id that does not exist is still
// assertable, over more bytes than before, with NO exclusions.
//
// What moved:
//
// 1. The request. Every row mints through `helpers/mcp-fixture.ts`, which now
//  produces a JSON-RPC `tools/call` on the legacy leg carrying
//  `accept: application/json, text/event-stream` — both values, or the
//  transport answers 406 before any of this is reached — and an `id`
//  defaulting to 1, so two compared answers share the id that is echoed
//  into both.
//
// 2. The band. `NOT_FOUND` stopped being an HTTP 404 and became a tool
//  Execution error on HTTP 200 (rule 2): the SDK renders it, so the
//  content type is `text/event-stream` and the body is an SSE frame. The
//  status halves below therefore read 200 where they used to read 404. That
//  is a named deviation, not a regression: `NOT_FOUND.status` keeps its 404
//  and simply stops being read on this path.
//
//  ⚠️ the per-row line for `WIRE-X1…X5` still says these rows assert
//  `application/json`. That is round-1 residue from the abandoned
//  `responseMode: "json"` pin; the own band paragraph and both say the
//  SDK-rendered band is `text/event-stream`, and they are correct. Measured
//  on both legs under all three modes. Do not "fix" it back.
//
// 3. The comparison got bigger. `fingerprint` compares the whole SSE frame
//  now — the `event:` line, the `data:` payload, the trailing blank line —
//  rather than a bare JSON object. Every byte the framing adds is inside the
//  proof.
//
// What did not move: The exclusion list, which is empty. The hazard the add feared. A
// spec-permitted per-event `id:` line varying between two otherwise identical requests.
// Was measured absent on both legs under `auto`/`sse`/ `json`. Foreign-org vs
// nonexistent is byte-identical; the same request twice is byte-identical. So
// `WIRE-R10`'s ban on `toMatchObject`, `objectContaining` and `JSON.parse(` survives
// untouched, and this file contains none of the three. Where a row needs the JSON-RPC
// payload rather than the whole frame it uses the fixture's `sseDataLine` extractor,
// which is `split`/`startsWith` and nothing else.
//
// Each row makes two assertions, and they are not the same assertion
//
// 1. The identity: foreign-org and nonexistent produce the same bytes. This is
//  the tenant proof and it is load-bearing. It is true whatever the
//  framing turns out to be, because it compares two answers on the same leg.
//
// 2. The measured frame: those bytes are the exact frame rule 2 pins.
//  This is a contract pin, not the tenant proof.
//
// IF fails and passes at wave 8, the transport is framing differently from what
// round 2 measured. Report the frame, fix `wire.ts` or re-measure. It is never a reason
// to loosen. A parsed or partial comparison in this file defeats the only thing it
// exists to prove, and `WIRE-R10` fails on the attempt.
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

/** An id nobody ever issued. Deliberately shaped like a real one, so the comparison is
 * not accidentally between two different kinds of wrong. */
const NEVER_ISSUED = "fix-mcp-never-issued";

const ORG_B_FIX_ID = "fix-mcp-b-1";
const ORG_B_FINDING_ID = "finding-mcp-b-1";
const ORG_B_PROJECT_ID = "project-mcp-b";

const ORG_A_FIX_ID = "fix-mcp-a-1";
const ORG_A_FINDING_ID = "finding-mcp-a-1";
const ORG_A_PROJECT_ID = "project-mcp-a";

const RESULTS_BY = "2026-07-01T00:00:00.000Z";

/**
 * The content type of every answer the SDK rendered, under the pinned `responseMode:
 * "sse"`. Measured exactly: no charset suffix, unlike the pre-SDK band's
 * `application/json;charset=utf-8`.
 */
const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

/**
 * The whole frame a `NOT_FOUND` tool execution error arrives in on the legacy leg,
 * built rather than pasted so a reword of `NOT_FOUND.message` moves this expectation
 * with it and fails `WIRE-R9` instead of here.
 *
 * Constructed with `JSON.stringify`, which is not the banned direction. `WIRE-R10` bans
 * `JSON.parse(` because parsing a response throws away key order, whitespace and
 * framing. The bytes this file exists to compare. Serialising an expectation does the
 * opposite: it pins key order rather than discarding it, and the resulting string is
 * compared as a string.
 *
 * ⚠️ per-leg by construction. The modern leg's result carries `resultType: "complete"`
 * and a `_meta.serverInfo` block this frame lacks, so this literal is authored against
 * the legacy leg. The one a stock client negotiates, and the one everything the fixture
 * mints lands on.
 */
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

    // Non-vacuity: org B's fix genuinely exists, and org B can read it. The band is
    // asserted here too, because "org B got a 200" is only interesting if the 200
    // carried the fix rather than an empty success of some other kind.
    const owned = await fingerprint(await callAsOrgB(reads, "get_fix", { fixId: ORG_B_FIX_ID }));
    expect(owned.status).toBe(200);
    expect(owned.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(owned.body).toContain(ORG_B_FIX_ID);
    expect(owned.body).not.toContain(NOT_FOUND.message);

    const foreign = await fingerprint(await callAsOrgA(reads, "get_fix", { fixId: ORG_B_FIX_ID }));
    const absent = await fingerprint(await callAsOrgA(reads, "get_fix", { fixId: NEVER_ISSUED }));

    // The band before the comparison. Two answers that were both the wrong kind of
    // answer compare equal to each other all day.
    expect(foreign.status).toBe(200);
    expect(foreign.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    //  the tenant proof. Load-bearing; never loosen this line.
    expect(foreign).toEqual(absent);

    //  the measured frame. A contract pin, not the tenant proof.
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

    // And the two tools answer each other byte for byte, so an agent cannot tell which
    // kind of thing it failed to find either.
    expect(foreign.body).toEqual(notFoundFrame());
  });

  test("WIRE-X3 — a project id from another organization answers byte-identically to a project id that does not exist", async () => {
    const reads = twoOrgStore();

    // Non-vacuity: the same narrowing, asked by the organization that owns the project,
    // returns the one fix in it.
    //
    // ⚠️ this half used `toMatchObject` and now does not. That was one of the five
    // loosenings `WIRE-R10` named at Wave 0-T1; a partial match here is exactly the
    // shape that lets a whole-body comparison rot into a subset comparison one row at a
    // time. The raw frame is inspected by containment instead. No parse, no subset
    // matcher, and strictly more of the answer.
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

    // The shared answer is a well-formed empty list, not an error. An empty result is a
    // legitimate answer, and it is the only truthful one.
    expect(foreign.status).toBe(200);
    expect(foreign.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(foreign).toEqual(absent);

    // The narrowed-to-nothing answer really is empty, and really does not name the row
    // it narrowed away from.
    expect(foreign.body).toContain('"totalOpen":0');
    expect(foreign.body).not.toContain(ORG_B_FIX_ID);
  });

  test("WIRE-X4 — the organization every read is scoped to comes from the credential and never from the request", async () => {
    const reads = twoOrgStore();

    // ⚠️ the arguments now carry an `organizationId`, and that is the row's new half.
    // Under the pre-protocol envelope a body could only name a tool and its input;
    // under JSON-RPC a caller can put anything it likes in `params.arguments`, so the
    // row asserts the stronger claim: even a request that explicitly names another
    // organization is read inside the credential's. No tool input schema declares the
    // key, so Zod strips it and it reaches nothing. This row is what proves the
    // stripping rather than assuming it.
    await callAsOrgA(reads, "list_open_fixes", {
      organizationId: ORG_B,
      projectId: ORG_B_PROJECT_ID,
    });
    await callAsOrgA(reads, "get_fix", { organizationId: ORG_B, fixId: ORG_B_FIX_ID });
    await callAsOrgA(reads, "get_finding", {
      organizationId: ORG_B,
      findingId: ORG_B_FINDING_ID,
    });

    // Every call carried org A's id even though every argument named something of org
    // B's. Length is asserted so a route that stopped reading at all would not pass
    // this by asking about nothing.
    expect(reads.organizationsAsked).toHaveLength(3);
    expect(reads.organizationsAsked.every((organizationId) => organizationId === ORG_A)).toBe(true);
    expect(reads.organizationsAsked).not.toContain(ORG_B);
  });

  test("WIRE-X5 — an organization reading its own list never sees another organization's open fixes", async () => {
    const reads = twoOrgStore();

    const print = await fingerprint(await callAsOrgA(reads, "list_open_fixes", {}));

    // ⚠️ the second `toMatchObject` `WIRE-R10` named, also gone. The row now asserts
    // the band, then the presence of what org A owns, then (and only then) the absence
    // of what it does not. An absence assertion over a body that was a 406 or a 401
    // passes forever while proving nothing.
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

// WIRE-X6, the same proof, on the other leg

describe("the crown jewel holds on the modern leg too", () => {
  /**
   * Why this row exists, and why it was missing (post-sprint audit).
   *
   * `WIRE-X1…X5` are authored entirely on the legacy leg, because the fixture mints
   * legacy-only requests by design and legacy is the leg a stock client negotiates.
   * That is the right default and it is not being changed. But the transport serves
   * both eras from one handler with no modern-off switch, so the modern leg is
   * reachable by any client that pins the era, and until this row, nothing asserted the
   * tenant boundary there. The property was measured identical; measured is not
   * asserted, and an unasserted security property is one a package upgrade can move in
   * silence.
   *
   * ⚠️ modern compared against modern, never against a legacy literal. The modern
   * result carries `resultType: "complete"` and a `_meta.serverInfo` block the legacy
   * frame lacks, so `notFoundFrame` above is not the expectation here and must not be
   * made into one. What this row compares is two answers on the same leg, which is
   * exactly what the identity claim is: a caller cannot tell a foreign id from an
   * absent one.
   *
   * `WIRE-R10` scans this file, so the comparison below is `fingerprint` and `toEqual`
   * like every other row here. No partial match, no parse.
   */
  test("WIRE-X6 — a fix id from another organization answers byte-identically to an absent one on the modern leg", async () => {
    const reads = twoOrgStore();
    const deps = { credentials: CREDENTIALS, reads: reads.port };

    // Non-vacuity first, as everywhere in this file: org B really can read its own fix
    // through the modern envelope, so the identity below is between two refusals rather
    // than between two answers of some other broken kind.
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

    // The band before the comparison, and it is the modern band: the answer really is a
    // tool execution error carrying our sentence, not a protocol rejection that two
    // requests would share for a reason of the transport's.
    expect(foreign.status).toBe(200);
    expect(foreign.body).toContain(NOT_FOUND.message);

    // The tenant proof, on this leg. Load-bearing; never loosen this line.
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
    // `WIRE-X4`'s claim, on the other leg. A modern envelope carries a `_meta` block
    // the legacy one does not, so `params` is a richer object here, and the row asserts
    // the enrichment changed nothing about where the organization comes from.
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
