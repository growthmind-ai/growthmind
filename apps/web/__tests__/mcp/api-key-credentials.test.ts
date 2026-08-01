// The read surface answering a credential a person actually minted (lane `mcpak`).
//
// `./credentials.test.ts` proves what this surface refuses. This file is the other
// half. The first proof in this codebase that anything at all can get IN. Every
// credential below is minted through `createApiKeysRepo.mint` against a real
// database (the same PGlite harness the tenancy suites use, real migrations, real SQL),
// presented as `Authorization: Bearer <material>` on a real `Request`, and resolved by
// the real production credential source `app/api/mcp/route.ts` wires in. A fake source
// could not prove any of it: the whole claim is about the production resolution path,
// `isApiKeyFormat`, the hash lookup and the revocation predicate included.
//
// The read port is the absent one, and its answers are the acceptance criterion rather
// than a gap. There is no `findings` table in this branch, so
// `list_open_fixes` answers with an empty list and a truthful window and both id
// lookups answer with the frozen `NOT_FOUND`. Those are the correct answers, not
// placeholders, and they are asserted here as such. See `../../lib/mcp/read-port.ts`'s
// header.
//
// No try/catch appears anywhere in this file, deliberately. `server.ts:179-194` already
// catches a throwing credential source, logs it and refuses; the closed-store test
// below drives that existing guarantee through the new source. If a second catch is
// ever added inside the credential source to make that test pass, the store's failure
// becomes indistinguishable from a clean miss in the log, which is the thing add
// forbids.
//
// The rows are `WIRE-A1…A7`, and they span both bands
//
// This is the only file in the sprint whose rows sit on both sides of the `wire.ts`
// boundary, which is why the two content types are named as constants at the top and
// asserted by every row rather than left implicit.
//
// Pre-sdk 401 band, `WIRE-A5`, and the refusal halves of `WIRE-A1`, `WIRE-A4` and
// `WIRE-A6`: `{ 401, "application/json;charset=utf-8", '{"ok":false,"error":{…}}' }`,
// produced by `refusalResponse` before the SDK is in the call stack at all.
// Byte-identical to `origin/main` and measured era-identical. `WIRE-A5`'s four cases
// are identical by construction, not by the framing pin. Nothing about the transport
// can reach them.
//
// Sdk-rendered band, `WIRE-A2`, `WIRE-A3` and the success halves of the rest: `{ 200,
// "text/event-stream", 'event: message\ndata: {…}\n\n' }` under the pinned
// `responseMode: "sse"`.
//
// ⚠️ the per-row line for `WIRE-A1…A7` says `WIRE-A3` "asserts application/json". That
// is round-1 residue from the abandoned `responseMode: "json"` pin. the own band
// paragraph and say the SDK-rendered band is `text/event-stream`, measured on both legs
// under all three modes, and they win. Do not "fix" it back.
//
// Two claims moved, both named deviations rather than bugs:
//
// `WIRE-A1` reaches the catalogue through `tools/list`, not through a `GET`.
//  The catalogue moved onto the wire protocol, and `GET` is now only
//  ever a 405 carrying a sentence that says so.
// `WIRE-A3`'s `NOT_FOUND` is a tool execution error on HTTP 200 rather than
//  an HTTP 404 (rule 2). The sentence is byte-unchanged; only the door it
//  leaves by moved. `NOT_FOUND.status` keeps its 404 and stops being read
//  here.
//
// `WIRE-R10` scans this file for `toMatchObject`, `objectContaining` and `JSON.parse(`.
// The two `JSON.parse(` sites it named at Wave 0-T1 were in `WIRE-A3`; they are gone,
// replaced by the fixture's `sseDataLine` extractor and a frame built with
// `JSON.stringify`, which is the opposite direction and pins key order rather than
// discarding it.
//
// Lane prefix `mcpak`.
import { createApiKeysRepo } from "@growthmind/db";
import { createTestDb } from "@growthmind/db/testing";
import { API_KEY_PREFIX, MCP_TOOL, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createApiKeyMcpCredentials } from "../../lib/mcp/credentials";
import { createAbsentReadPort } from "../../lib/mcp/read-port";
import { NOT_FOUND, UNAUTHENTICATED } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  buildTestTenantContext,
  createTestOrganization,
  setupAuthTest,
  signUpTestUser,
  type AuthTestContext,
} from "../tenancy/helpers/auth-fixture";
import {
  fingerprint,
  mintRealApiKey,
  rpcRequest,
  sseDataLine,
  toolCallRequest,
  type MintedTestApiKey,
} from "./helpers/mcp-fixture";

const TEST_PASSWORD = "correct-horse-battery-staple";

/** A well-formed read credential nobody ever minted: the right scheme, 43 base64url
 * characters, and no row behind it. The prefix comes from the exported constant and
 * never from a literal, `gmak_` and `gmwk_` differ at one index, and a hand-typed
 * literal here is exactly the confusion the constants exist to remove. */
const UNKNOWN_BUT_WELL_FORMED = `${API_KEY_PREFIX}${"a".repeat(43)}`;

/** Not a credential at all. Refused by `isApiKeyFormat` before the database is touched. */
const MALFORMED = "definitely-not-a-key";

/** The three tools, sorted, so the catalogue assertion does not rest on the order the
 * contract happens to declare them in. */
const TOOL_NAMES = [MCP_TOOL.GET_FINDING, MCP_TOOL.GET_FIX, MCP_TOOL.LIST_OPEN_FIXES].toSorted();

/** The two content-type bands, both measured exactly. The pre-SDK band carries the
 * charset suffix `Response.json` adds; the SDK-rendered band, under the pinned
 * `responseMode: "sse"`, carries none. */
const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";
const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

/**
 * The whole frame a `NOT_FOUND` tool execution error arrives in on the legacy leg,
 * built from the constant rather than pasted so a reword of the sentence fails
 * `WIRE-R9` instead of quietly rewriting this expectation with it.
 *
 * `JSON.stringify` is not the banned direction. `WIRE-R10` bans `JSON.parse(` because
 * parsing a response throws away key order, whitespace and framing. The bytes an
 * identity row compares. Serialising an expectation pins key order instead of
 * discarding it, and the comparison is still string against string.
 */
function notFoundFrame(id: number = 1): string {
  const payload = JSON.stringify({
    result: { content: [{ type: "text", text: NOT_FOUND.message }], isError: true },
    jsonrpc: "2.0",
    id,
  });
  return `event: message\ndata: ${payload}\n\n`;
}

let authCtx: AuthTestContext;
let ownerCtx: TenantContext;
let deps: McpServerDeps;

beforeAll(async () => {
  authCtx = await setupAuthTest();

  const owner = await signUpTestUser(authCtx.auth, {
    name: "Owner Mcpak",
    email: "owner-mcpak@example.com",
    password: TEST_PASSWORD,
  });
  const organization = await createTestOrganization(authCtx.db, {
    name: "Org Mcpak",
    ownerUserId: owner.id,
  });
  ownerCtx = await buildTestTenantContext(authCtx.db, {
    userId: owner.id,
    organizationId: organization.id,
  });

  // The real production credential source over the real database. The object
  // `app/api/mcp/route.ts` wires in, not a fake and not a subclass.
  deps = {
    credentials: createApiKeyMcpCredentials(authCtx.db),
    reads: createAbsentReadPort(() => {
      /* the absence line is asserted in route.test.ts, not here */
    }),
  };
});

afterAll(async () => {
  await authCtx.close();
});

async function mintApiKey(name: string): Promise<MintedTestApiKey> {
  return mintRealApiKey(authCtx.db, ownerCtx, name);
}

/** The catalogue, as an MCP client asks for it: a JSON-RPC `tools/list` on the POST.
 * The `GET` this helper used to build is now a 405, and the row that proves it lives in
 * `./route.test.ts` (`WIRE-R7`) and `./wiring.test.ts` (`WIRE-M2`). */
async function catalogueWith(key: string | null): Promise<Response> {
  return handleMcpRequest(rpcRequest({ method: "tools/list", key }), deps);
}

async function callWith(
  key: string | null,
  tool: string = MCP_TOOL.LIST_OPEN_FIXES,
  input?: unknown,
): Promise<Response> {
  return handleMcpRequest(toolCallRequest({ tool, input, key }), deps);
}

describe("the read surface answers a credential a person minted, and nothing else", () => {
  test("WIRE-A1 — should reach tools/list with a real minted credential", async () => {
    const { raw } = await mintApiKey("agent-catalogue");

    const print = await fingerprint(await catalogueWith(raw));

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    for (const name of TOOL_NAMES) {
      expect(print.body).toContain(name);
    }

    // Non-vacuity: the same request without the credential is refused, so the 200 above
    // came from the credential rather than from an open catalogue. Asserted in the
    // pre-SDK band, because authentication runs before the transport is reached and
    // this is where that shows.
    const anonymous = await fingerprint(await catalogueWith(null));
    expect(anonymous.status).toBe(401);
    expect(anonymous.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(anonymous.body).toContain(UNAUTHENTICATED.message);
    for (const name of TOOL_NAMES) {
      expect(anonymous.body).not.toContain(name);
    }
  });

  test("WIRE-A2 — should answer list_open_fixes with an empty list and a truthful window", async () => {
    const { raw } = await mintApiKey("agent-list-open-fixes");

    const print = await fingerprint(await callWith(raw));

    expect(print.status).toBe(200);
    expect(print.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    // An empty list is a well-formed answer and the only truthful one here: there is no
    // table an open fix could be in yet.
    //
    // Read from `structuredContent`, which is not a cosmetic change. A tool that
    // advertises an output schema and answers without schema-valid structured content
    // is rejected by a real client that has listed first. Measured, `ProtocolError
    // -32600`. The window's three numbers are asserted individually rather than as one
    // serialised literal, because the key order inside `structuredContent` is
    // `wire.ts`'s to choose and this row is about the numbers being truthful, not about
    // their order.
    const payload = sseDataLine(print.body);
    expect(payload).toContain('"structuredContent"');
    expect(payload).toContain('"fixes":[]');
    expect(payload).toContain('"returned":0');
    expect(payload).toContain('"totalOpen":0');
    expect(payload).toContain('"truncated":false');

    // A truthful empty is a success, not a refusal wearing an empty list.
    expect(payload).not.toContain('"isError":true');
  });

  test("WIRE-A3 — should answer get_fix and get_finding with the frozen not-found", async () => {
    const { raw } = await mintApiKey("agent-not-found");

    const fixOne = await fingerprint(
      await callWith(raw, MCP_TOOL.GET_FIX, { fixId: "fix-mcpak-one" }),
    );
    const fixTwo = await fingerprint(
      await callWith(raw, MCP_TOOL.GET_FIX, { fixId: "fix-mcpak-two" }),
    );

    // The band, before the identity. `NOT_FOUND` now leaves as a tool execution error
    // on HTTP 200 rather than an HTTP 404 (rule 2). A named deviation. The sentence is
    // byte-unchanged, which is the half that matters.
    expect(fixOne.status).toBe(200);
    expect(fixOne.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(fixOne).toEqual(fixTwo);
    expect(fixOne.body).toEqual(notFoundFrame());

    const findingOne = await fingerprint(
      await callWith(raw, MCP_TOOL.GET_FINDING, { findingId: "finding-mcpak-one" }),
    );
    const findingTwo = await fingerprint(
      await callWith(raw, MCP_TOOL.GET_FINDING, { findingId: "finding-mcpak-two" }),
    );

    expect(findingOne.status).toBe(200);
    expect(findingOne.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    expect(findingOne).toEqual(findingTwo);
    expect(findingOne.body).toEqual(notFoundFrame());

    // And the two tools answer each other byte for byte, so an agent cannot tell which
    // kind of thing it failed to find either.
    expect(fixOne).toEqual(findingOne);

    // The sentence itself, said out loud in this file so a reword shows up in this diff
    // as well as in `WIRE-R9`'s.
    expect(sseDataLine(fixOne.body)).toContain(NOT_FOUND.message);
    expect(sseDataLine(fixOne.body)).toContain('"isError":true');
  });

  test("WIRE-A4 — should refuse a credential revoked between two requests", async () => {
    const minted = await mintApiKey("agent-revoked-live");

    const before = await fingerprint(await callWith(minted.raw));
    expect(before.status).toBe(200);
    expect(before.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const revoked = await createApiKeysRepo(authCtx.db, ownerCtx).revoke(minted.id);
    // Non-vacuity: the revocation really happened and really landed on this row.
    expect(revoked?.revokedAt).not.toBeNull();

    // The same process, the same `deps` object, the same credential source. A
    // process-level memo would make this pass request 1 and fail request 2 with no
    // other test noticing, which is why add states "holds no cache" as a requirement
    // rather than an omission. The per-request handler lifecycle keeps that true after
    // the transport landed: nothing is memoised at module scope.
    const after = await fingerprint(await callWith(minted.raw));
    expect(after.status).toBe(401);
    expect(after.contentType).toBe(PRE_SDK_CONTENT_TYPE);
    expect(after.body).toContain(UNAUTHENTICATED.message);
  });

  test("WIRE-A5 — should answer missing, malformed, unknown and revoked credentials identically", async () => {
    // Non-vacuity first: a live credential is admitted, so the four identical refusals
    // below are this gate working rather than a surface that refuses everything.
    const live = await mintApiKey("agent-fingerprint-live");
    const admitted = await fingerprint(await callWith(live.raw));
    expect(admitted.status).toBe(200);
    expect(admitted.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);

    const revokedKey = await mintApiKey("agent-fingerprint-revoked");
    const revoked = await createApiKeysRepo(authCtx.db, ownerCtx).revoke(revokedKey.id);
    expect(revoked?.revokedAt).not.toBeNull();

    const answers = [];
    for (const key of [null, MALFORMED, UNKNOWN_BUT_WELL_FORMED, revokedKey.raw]) {
      answers.push(await fingerprint(await callWith(key)));
    }

    // Status, content type and body text, never parsed objects, which would hide
    // exactly the differing message these four rows exist to catch.
    //
    // ⚠️ these four are identical by construction, not by the framing pin.
    // Authentication runs on the raw `Request` before `wire.ts` is called at all, so
    // `responseMode` cannot reach this path and neither can the transport's `Accept`
    // 406. `WIRE-G6` asserts against this exact frame from the other side. Keep it
    // stable.
    expect(answers).toHaveLength(4);
    const [first] = answers;
    expect(first?.status).toBe(401);
    expect(first?.contentType).toBe(PRE_SDK_CONTENT_TYPE);

    for (const answer of answers) {
      expect(answer).toEqual(first);
    }
  });

  test("WIRE-A6 — should refuse rather than admit when the credential store cannot be reached", async () => {
    const { raw } = await mintApiKey("agent-closed-store");

    // Its own PGlite instance, closed before the request, so the suite's live database
    // is untouched. A well-formed credential is presented on purpose: a malformed one
    // would never reach the store and would prove nothing.
    const closed = await createTestDb();
    await closed.close();

    const refused = await fingerprint(
      await handleMcpRequest(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: raw }), {
        credentials: createApiKeyMcpCredentials(closed.db),
        reads: deps.reads,
      }),
    );
    const withNothing = await fingerprint(await callWith(null));

    // Nothing thrown out of `handleMcpRequest` (the awaits above are the assertion) and
    // the answer is the one presenting no credential gets.
    expect(refused.status).toBe(401);
    expect(refused.contentType).toBe(PRE_SDK_CONTENT_TYPE);

    expect(refused).toEqual(withNothing);
  });

  test("WIRE-A7 — should never carry the credential material in any response body", async () => {
    const { raw } = await mintApiKey("agent-never-echoed");
    // Non-vacuity: `not.toContain` on an empty needle passes against anything.
    expect(raw.length).toBeGreaterThan(40);

    // ⚠️ the precondition is the point of this row's rewrite, and it is not decoration.
    // An absence assertion is vacuous unless it first proves the body is the one it
    // means to inspect: five 406s from the transport carry no credential material
    // either, and this row would pass forever while the wire behind it answered nothing
    // correctly. So each case declares the status and the band it expects, asserts
    // both, and only then scans.
    //
    // The scan is over the whole JSON-RPC frame, `_meta` included, by construction:
    // `fingerprint.body` is `await response.text` verbatim. The `event:` line, the
    // `data:` payload and everything inside it. There is no field of the answer this
    // scan cannot see, which is what "the scan widens to the whole frame" means.
    const cases: readonly {
      readonly name: string;
      readonly status: number;
      readonly contentType: string;
      readonly presented: string;
      readonly run: () => Promise<Response>;
    }[] = [
      {
        name: "tools/list",
        status: 200,
        contentType: SDK_RENDERED_CONTENT_TYPE,
        presented: raw,
        run: () => catalogueWith(raw),
      },
      {
        name: "a list_open_fixes call",
        status: 200,
        contentType: SDK_RENDERED_CONTENT_TYPE,
        presented: raw,
        run: () => callWith(raw),
      },
      {
        name: "a get_fix miss",
        status: 200,
        contentType: SDK_RENDERED_CONTENT_TYPE,
        presented: raw,
        run: () => callWith(raw, MCP_TOOL.GET_FIX, { fixId: "fix-mcpak-echo" }),
      },
      {
        name: "a get_finding miss",
        status: 200,
        contentType: SDK_RENDERED_CONTENT_TYPE,
        presented: raw,
        run: () => callWith(raw, MCP_TOOL.GET_FINDING, { findingId: "finding-mcpak-echo" }),
      },
      {
        name: "a refusal of an unknown credential",
        status: 401,
        contentType: PRE_SDK_CONTENT_TYPE,
        presented: UNKNOWN_BUT_WELL_FORMED,
        run: () => callWith(UNKNOWN_BUT_WELL_FORMED),
      },
    ];

    expect(cases).toHaveLength(5);

    for (const { name, status, contentType, presented, run } of cases) {
      const print = await fingerprint(await run());

      // The precondition, per case, named so a failure says which one.
      expect(`${name}: ${print.status}`).toBe(`${name}: ${status}`);
      expect(`${name}: ${print.contentType}`).toBe(`${name}: ${contentType}`);

      // Now the absences: neither the material this request presented nor the live
      // minted material appears anywhere in the frame.
      expect(print.body).not.toContain(presented);
      expect(print.body).not.toContain(raw);
    }
  });

  // Non-vacuity for the scanner itself. `not.toContain` on a body the scan cannot see
  // is the failure mode the row above is built to avoid, so the needle is proved
  // findable in a control that really does carry it.
  test("WIRE-A7 — the credential scan does find the material when it is present", async () => {
    const { raw } = await mintApiKey("agent-scan-control");
    const control = `event: message\ndata: {"result":{"_meta":{"echoed":"${raw}"}},"jsonrpc":"2.0","id":1}\n\n`;

    expect(control).toContain(raw);
  });
});
