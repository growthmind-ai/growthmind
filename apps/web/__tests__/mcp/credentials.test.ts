// WHO GETS IN, AND — much more importantly — WHO DOES NOT (O-009).
//
// The decision this suite exists to hold is written out in
// `apps/web/lib/mcp/credentials.ts`: an MCP read uses a DIFFERENT kind of
// credential from event ingest, because a `write_key` is public by design.
// `docs/architecture.md` §4.2 calls it "spoofable by construction — the same
// accepted risk as every analytics SDK", and that risk is only acceptable
// because the capability it grants is "append activity to one project". A
// write key that also read findings would put an organization's entire growth
// backlog behind a string published in the customer's own page source.
//
// So this file mints a GENUINE, unrevoked, correctly-formatted write key
// against a REAL database — the same PGlite harness the tenancy suites use,
// with real migrations and real SQL — and proves the read surface refuses it.
// A fake credential source could not prove this: the whole claim is about the
// production resolution path, `isWriteKeyFormat` and the hash lookup included.
//
// NON-VACUITY IS ASSERTED EXPLICITLY. Every refusal test below is paired with
// a check that the same key DOES resolve through `resolveWriteKeyForIngest`, so
// a refusal caused by a broken fixture — an unmigrated table, a mis-seeded org,
// a typo in the presented material — cannot masquerade as the kind gate doing
// its job.
//
// Lane prefix `mcpcred`.
import { createProjectsRepo, createWriteKeysRepo, resolveWriteKeyForIngest } from "@growthmind/db";
import { WRITE_KEY_PREFIX, writeKeyKindSchema, type TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createWriteKeyMcpCredentials,
  presentedCredential,
  MCP_ADMISSIBLE_WRITE_KEY_KINDS,
} from "../../lib/mcp/credentials";
import { createAbsentReadPort } from "../../lib/mcp/read-port";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  buildTestTenantContext,
  createTestOrganization,
  setupAuthTest,
  signUpTestUser,
  type AuthTestContext,
} from "../tenancy/helpers/auth-fixture";
import { fingerprint, throwingCredentials, toolCallRequest } from "./helpers/mcp-fixture";

const TEST_PASSWORD = "correct-horse-battery-staple";

/** A well-formed key nobody ever minted: the right prefix, 43 base64url
 * characters, and no row behind it. */
const UNKNOWN_BUT_WELL_FORMED = `${WRITE_KEY_PREFIX}${"a".repeat(43)}`;

/** Not a key at all — refused by `isWriteKeyFormat` before the database is
 * touched. */
const MALFORMED = "definitely-not-a-key";

let authCtx: AuthTestContext;
let ownerCtx: TenantContext;
let projectId: string;
let deps: McpServerDeps;

beforeAll(async () => {
  authCtx = await setupAuthTest();

  const owner = await signUpTestUser(authCtx.auth, {
    name: "Owner Mcpcred",
    email: "owner-mcpcred@example.com",
    password: TEST_PASSWORD,
  });
  const organization = await createTestOrganization(authCtx.db, {
    name: "Org Mcpcred",
    ownerUserId: owner.id,
  });
  ownerCtx = await buildTestTenantContext(authCtx.db, {
    userId: owner.id,
    organizationId: organization.id,
  });

  const project = await createProjectsRepo(authCtx.db, ownerCtx).create({
    name: "Mcpcred Landing Page",
  });
  projectId = project.id;

  // THE REAL PRODUCTION CREDENTIAL SOURCE over the real database — not a fake,
  // and not a subclass. This is the object `app/api/mcp/route.ts` wires in.
  deps = {
    credentials: createWriteKeyMcpCredentials(authCtx.db),
    reads: createAbsentReadPort(() => {
      /* the absence line is asserted in route.test.ts, not here */
    }),
  };
});

afterAll(async () => {
  await authCtx.close();
});

async function mintKey(kind: "standard" | "simulation"): Promise<string> {
  const minted = await createWriteKeysRepo(authCtx.db, ownerCtx).mint({ projectId, kind });
  return minted.raw;
}

async function callWith(key: string | null) {
  return handleMcpRequest(toolCallRequest({ tool: "list_open_fixes", key }), deps);
}

describe("the read surface admits no ingest credential, and says nothing about why", () => {
  test("admits no kind of key that a website's own code carries", () => {
    // The whole decision, as one assertion. Every member of `WriteKeyKind` is a
    // credential shipped inside a customer's page; none may appear here. Adding
    // one to the admissible list fails this test by name.
    const ingestKinds: readonly string[] = writeKeyKindSchema.options;
    expect(ingestKinds.length).toBeGreaterThan(0);
    for (const kind of ingestKinds) {
      expect(MCP_ADMISSIBLE_WRITE_KEY_KINDS).not.toContain(kind);
    }
  });

  test("refuses a genuine unrevoked standard ingest key exactly as it refuses no key at all", async () => {
    const raw = await mintKey("standard");

    // NON-VACUITY: this key is real, live, and would be accepted by ingest.
    const asIngest = await resolveWriteKeyForIngest(authCtx.db, raw);
    expect(asIngest?.kind).toBe("standard");

    const withKey = await callWith(raw);
    const withNothing = await callWith(null);

    expect(await fingerprint(withKey)).toEqual(await fingerprint(withNothing));
    expect(withKey.status).toBe(401);
  });

  test("refuses a genuine unrevoked simulation ingest key exactly as it refuses no key at all", async () => {
    const raw = await mintKey("simulation");

    const asIngest = await resolveWriteKeyForIngest(authCtx.db, raw);
    expect(asIngest?.kind).toBe("simulation");

    const withKey = await callWith(raw);
    const withNothing = await callWith(null);

    expect(await fingerprint(withKey)).toEqual(await fingerprint(withNothing));
  });

  test("a missing, malformed, unknown, revoked and wrong-kind credential all answer identically", async () => {
    const live = await mintKey("standard");

    const revokedKey = await createWriteKeysRepo(authCtx.db, ownerCtx).mint({
      projectId,
      kind: "standard",
    });
    const revoked = await createWriteKeysRepo(authCtx.db, ownerCtx).revoke(revokedKey.key.id);
    // NON-VACUITY: the revocation really happened, and ingest really stops
    // accepting it — so the identical answer below is not a coincidence of two
    // keys that were both already dead.
    expect(revoked?.revokedAt).not.toBeNull();
    expect(await resolveWriteKeyForIngest(authCtx.db, revokedKey.raw)).toBeNull();

    const answers = await Promise.all(
      [null, MALFORMED, UNKNOWN_BUT_WELL_FORMED, revokedKey.raw, live].map(async (key) =>
        fingerprint(await callWith(key)),
      ),
    );

    const [first] = answers;
    for (const answer of answers) {
      expect(answer).toEqual(first);
    }
    expect(first?.status).toBe(401);
  });

  test("a credential store that cannot be reached refuses rather than lets the request through", async () => {
    const failClosed = await handleMcpRequest(
      toolCallRequest({ tool: "list_open_fixes", key: "anything" }),
      {
        credentials: throwingCredentials(),
        reads: deps.reads,
      },
    );
    const withNothing = await callWith(null);

    expect(await fingerprint(failClosed)).toEqual(await fingerprint(withNothing));
  });

  test("only an Authorization Bearer header counts as presenting a credential", () => {
    const url = "http://localhost:3000/api/mcp";
    const headerless = new Request(url, { method: "POST" });
    expect(presentedCredential(headerless)).toBeNull();

    const wrongScheme = new Request(url, {
      method: "POST",
      headers: { authorization: `Basic ${UNKNOWN_BUT_WELL_FORMED}` },
    });
    expect(presentedCredential(wrongScheme)).toBeNull();

    // A query parameter is NOT a credential here: it lands in access logs and
    // browser history, and accepting one would put keys in both.
    const inQuery = new Request(`${url}?key=${UNKNOWN_BUT_WELL_FORMED}`, { method: "POST" });
    expect(presentedCredential(inQuery)).toBeNull();

    const bearer = new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${UNKNOWN_BUT_WELL_FORMED}` },
    });
    expect(presentedCredential(bearer)).toBe(UNKNOWN_BUT_WELL_FORMED);
  });
});
