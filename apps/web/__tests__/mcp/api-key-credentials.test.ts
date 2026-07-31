// THE READ SURFACE ANSWERING A CREDENTIAL A PERSON ACTUALLY MINTED (O-009,
// ADD §8 lane `mcpak`).
//
// `./credentials.test.ts` proves what this surface REFUSES. This file is the
// other half — the first proof in this codebase that anything at all can get
// IN. Every credential below is minted through `createApiKeysRepo(...).mint()`
// against a REAL database (the same PGlite harness the tenancy suites use, real
// migrations, real SQL), presented as `Authorization: Bearer <material>` on a
// real `Request`, and resolved by the REAL production credential source
// `app/api/mcp/route.ts` wires in. A fake source could not prove any of it: the
// whole claim is about the production resolution path — `isApiKeyFormat`, the
// hash lookup and the revocation predicate included.
//
// THE READ PORT IS THE ABSENT ONE, AND ITS ANSWERS ARE THE ACCEPTANCE
// CRITERION RATHER THAN A GAP. There is no `findings` table in this branch
// (that is O-011's), so `list_open_fixes` answers with an empty list and a
// truthful window and both id lookups answer with the frozen `NOT_FOUND`. Those
// are the correct answers, not placeholders, and they are asserted here as
// such — see `../../lib/mcp/read-port.ts`'s header.
//
// NO TRY/CATCH APPEARS ANYWHERE IN THIS FILE, DELIBERATELY. `server.ts:179-194`
// already catches a throwing credential source, logs it and refuses; the
// closed-store test below drives that EXISTING guarantee through the NEW
// source. If a second catch is ever added inside the credential source to make
// that test pass, the store's failure becomes indistinguishable from a clean
// miss in the log — which is the thing ADD D-8 forbids.
//
// Lane prefix `mcpak`.
import { createApiKeysRepo } from "@growthmind/db";
import { createTestDb } from "@growthmind/db/testing";
import { API_KEY_PREFIX, MCP_TOOL, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createApiKeyMcpCredentials } from "../../lib/mcp/credentials";
import { createAbsentReadPort } from "../../lib/mcp/read-port";
import { NOT_FOUND } from "../../lib/mcp/refusals";
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
  toolCallRequest,
  type MintedTestApiKey,
} from "./helpers/mcp-fixture";

const TEST_PASSWORD = "correct-horse-battery-staple";
const MCP_URL = "http://localhost:3000/api/mcp";

/** A well-formed read credential nobody ever minted: the right scheme, 43
 * base64url characters, and no row behind it. The prefix comes from the
 * exported constant and never from a literal — `gmak_` and `gmwk_` differ at one
 * index, and a hand-typed literal here is exactly the D9 confusion the constants
 * exist to remove. */
const UNKNOWN_BUT_WELL_FORMED = `${API_KEY_PREFIX}${"a".repeat(43)}`;

/** Not a credential at all — refused by `isApiKeyFormat` before the database is
 * touched. */
const MALFORMED = "definitely-not-a-key";

/** The three tools, sorted, so the catalogue assertion does not rest on the
 * order the contract happens to declare them in. */
const TOOL_NAMES = [MCP_TOOL.GET_FINDING, MCP_TOOL.GET_FIX, MCP_TOOL.LIST_OPEN_FIXES].toSorted();

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

  // THE REAL PRODUCTION CREDENTIAL SOURCE over the real database — the object
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

/** `GET` is the catalogue, and it is authenticated like everything else — so it
 * needs a request builder the POST-shaped fixture helper does not provide. */
function catalogueRequest(key: string | null): Request {
  const headers = new Headers();
  if (key !== null) {
    headers.set("authorization", `Bearer ${key}`);
  }
  return new Request(MCP_URL, { method: "GET", headers });
}

async function callWith(
  key: string | null,
  tool: string = MCP_TOOL.LIST_OPEN_FIXES,
  input?: unknown,
): Promise<Response> {
  return handleMcpRequest(toolCallRequest({ tool, input, key }), deps);
}

describe("the read surface answers a credential a person minted, and nothing else", () => {
  test("should reach the catalogue with a real minted credential", async () => {
    const { raw } = await mintApiKey("agent-catalogue");

    const response = await handleMcpRequest(catalogueRequest(raw), deps);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { ok: boolean; tools: { name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.tools.map((tool) => tool.name).toSorted()).toEqual(TOOL_NAMES);

    // NON-VACUITY: the same request without the credential is refused, so the
    // 200 above came from the credential rather than from an open catalogue.
    const anonymous = await handleMcpRequest(catalogueRequest(null), deps);
    expect(anonymous.status).toBe(401);
  });

  test("should answer list_open_fixes with an empty list and a truthful window", async () => {
    const { raw } = await mintApiKey("agent-list-open-fixes");

    const response = await callWith(raw);
    expect(response.status).toBe(200);

    // An empty list is a well-formed answer and the only truthful one here:
    // there is no table an open fix could be in yet. `toEqual` rather than
    // `toMatchObject`, so a fabricated row could not hide inside a partial
    // match.
    expect(await response.json()).toEqual({
      ok: true,
      tool: MCP_TOOL.LIST_OPEN_FIXES,
      result: { fixes: [], window: { returned: 0, totalOpen: 0, truncated: false } },
    });
  });

  test("should answer get_fix and get_finding with the frozen not-found", async () => {
    const { raw } = await mintApiKey("agent-not-found");

    const frozen = { ok: false, error: { code: NOT_FOUND.code, message: NOT_FOUND.message } };

    const fixOne = await callWith(raw, MCP_TOOL.GET_FIX, { fixId: "fix-mcpak-one" });
    const fixTwo = await callWith(raw, MCP_TOOL.GET_FIX, { fixId: "fix-mcpak-two" });
    expect(fixOne.status).toBe(404);
    const fixOnePrint = await fingerprint(fixOne);
    expect(fixOnePrint).toEqual(await fingerprint(fixTwo));
    expect(JSON.parse(fixOnePrint.body)).toEqual(frozen);

    const findingOne = await callWith(raw, MCP_TOOL.GET_FINDING, {
      findingId: "finding-mcpak-one",
    });
    const findingTwo = await callWith(raw, MCP_TOOL.GET_FINDING, {
      findingId: "finding-mcpak-two",
    });
    expect(findingOne.status).toBe(404);
    const findingOnePrint = await fingerprint(findingOne);
    expect(findingOnePrint).toEqual(await fingerprint(findingTwo));
    expect(JSON.parse(findingOnePrint.body)).toEqual(frozen);
  });

  test("should refuse a credential revoked between two requests", async () => {
    const minted = await mintApiKey("agent-revoked-live");

    const before = await callWith(minted.raw);
    expect(before.status).toBe(200);

    const revoked = await createApiKeysRepo(authCtx.db, ownerCtx).revoke(minted.id);
    // NON-VACUITY: the revocation really happened and really landed on this row.
    expect(revoked?.revokedAt).not.toBeNull();

    // THE SAME PROCESS, THE SAME `deps` OBJECT, THE SAME CREDENTIAL SOURCE. A
    // process-level memo would make this pass request 1 and fail request 2 with
    // no other test noticing — which is why ADD D-11 states "holds no cache" as
    // a requirement rather than an omission.
    const after = await callWith(minted.raw);
    expect(after.status).toBe(401);
  });

  test("should answer missing, malformed, unknown and revoked credentials identically", async () => {
    // NON-VACUITY FIRST: a live credential is admitted, so the four identical
    // refusals below are this gate working rather than a surface that refuses
    // everything.
    const live = await mintApiKey("agent-fingerprint-live");
    expect((await callWith(live.raw)).status).toBe(200);

    const revokedKey = await mintApiKey("agent-fingerprint-revoked");
    const revoked = await createApiKeysRepo(authCtx.db, ownerCtx).revoke(revokedKey.id);
    expect(revoked?.revokedAt).not.toBeNull();

    const answers = [];
    for (const key of [null, MALFORMED, UNKNOWN_BUT_WELL_FORMED, revokedKey.raw]) {
      answers.push(await fingerprint(await callWith(key)));
    }

    // Status, content type and body TEXT — never parsed objects, which would
    // hide exactly the differing message these four rows exist to catch.
    expect(answers).toHaveLength(4);
    const [first] = answers;
    for (const answer of answers) {
      expect(answer).toEqual(first);
    }
    expect(first?.status).toBe(401);
  });

  test("should refuse rather than admit when the credential store cannot be reached", async () => {
    const { raw } = await mintApiKey("agent-closed-store");

    // Its OWN PGlite instance, closed before the request, so the suite's live
    // database is untouched. A well-formed credential is presented on purpose:
    // a malformed one would never reach the store and would prove nothing.
    const closed = await createTestDb();
    await closed.close();

    const refused = await handleMcpRequest(
      toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: raw }),
      { credentials: createApiKeyMcpCredentials(closed.db), reads: deps.reads },
    );
    const withNothing = await callWith(null);

    // Nothing thrown out of `handleMcpRequest` — the awaits above are the
    // assertion — and the answer is the one presenting no credential gets.
    expect(await fingerprint(refused)).toEqual(await fingerprint(withNothing));
  });

  test("should never carry the credential material in any response body", async () => {
    const { raw } = await mintApiKey("agent-never-echoed");
    // NON-VACUITY: `not.toContain` on an empty needle passes against anything.
    expect(raw.length).toBeGreaterThan(40);

    const responses = [
      await handleMcpRequest(catalogueRequest(raw), deps),
      await callWith(raw),
      await callWith(raw, MCP_TOOL.GET_FIX, { fixId: "fix-mcpak-echo" }),
      await callWith(raw, MCP_TOOL.GET_FINDING, { findingId: "finding-mcpak-echo" }),
      await callWith(UNKNOWN_BUT_WELL_FORMED),
    ];

    const bodies = [];
    for (const response of responses) {
      bodies.push((await fingerprint(response)).body);
    }

    expect(bodies).toHaveLength(5);
    for (const body of bodies) {
      expect(body).not.toContain(raw);
    }
  });
});
