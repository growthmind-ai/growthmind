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
// So this file mints GENUINE, unrevoked, correctly-formatted write keys
// against a REAL database — the same PGlite harness the tenancy suites use,
// with real migrations and real SQL — and proves the read surface refuses them.
// A fake credential source could not prove this: the whole claim is about the
// production resolution path, the format check and the hash lookup included.
//
// THE GUARANTEE IS UNCHANGED BY THIS SPRINT; ITS ENFORCEMENT MOVED EARLIER.
// The surface used to resolve a presented write key exactly as ingest does and
// then refuse it on KIND, after the database. It now runs
// `createApiKeyMcpCredentials`, whose format gate rejects `gmwk_` material
// BEFORE ANY DATABASE ACCESS — `gmak_` and `gmwk_` differ at index 2. So every
// row below proves something strictly stronger than it did: a write key is not
// merely inadmissible here, it can never even be looked up. `./
// api-key-credentials.test.ts` is the other half — what this surface now lets
// IN.
//
// NON-VACUITY IS ASSERTED EXPLICITLY. Every refusal test below is paired with
// a check that the same key DOES resolve through `resolveWriteKeyForIngest`, so
// a refusal caused by a broken fixture — an unmigrated table, a mis-seeded org,
// a typo in the presented material — cannot masquerade as the gate doing its
// job.
//
// Lane prefix `mcpcred`.
import { createProjectsRepo, createWriteKeysRepo, resolveWriteKeyForIngest } from "@growthmind/db";
import {
  isApiKeyFormat,
  WRITE_KEY_PREFIX,
  writeKeyKindSchema,
  type TenantContext,
  type WriteKeyKind,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createApiKeyMcpCredentials, presentedCredential } from "../../lib/mcp/credentials";
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

/** A well-formed INGEST key nobody ever minted: the right prefix for that
 * family, 43 base64url characters, and no row behind it. Well-formed for
 * ingest is exactly what makes it malformed here. */
const UNKNOWN_BUT_WELL_FORMED = `${WRITE_KEY_PREFIX}${"a".repeat(43)}`;

/** Not a key of either family — refused before the database is touched. */
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
    credentials: createApiKeyMcpCredentials(authCtx.db),
    reads: createAbsentReadPort(() => {
      /* the absence line is asserted in route.test.ts, not here */
    }),
  };
});

afterAll(async () => {
  await authCtx.close();
});

async function mintKey(kind: WriteKeyKind): Promise<string> {
  const minted = await createWriteKeysRepo(authCtx.db, ownerCtx).mint({ projectId, kind });
  return minted.raw;
}

async function callWith(key: string | null) {
  return handleMcpRequest(toolCallRequest({ tool: "list_open_fixes", key }), deps);
}

describe("the read surface admits no ingest credential, and says nothing about why", () => {
  test("lets no key a website's own code carries even be presented here", async () => {
    // The whole decision, as one self-enumerating assertion over the union
    // itself. Every member of `WriteKeyKind` is a credential shipped inside a
    // customer's page; a genuinely minted one of EVERY kind fails the read
    // format, so it is refused before the database is reached. Adding a kind to
    // `writeKeyKindSchema` extends this test automatically, and widening
    // `isApiKeyFormat` to accept ingest material fails it by name.
    const kinds = writeKeyKindSchema.options;
    expect(kinds.length).toBeGreaterThan(0);

    for (const kind of kinds) {
      const raw = await mintKey(kind);

      // NON-VACUITY, per kind: the key is real, live, and ingest accepts it
      // right now — so the refusal on the next line is this gate rather than a
      // dead fixture.
      expect((await resolveWriteKeyForIngest(authCtx.db, raw))?.kind).toBe(kind);

      expect(isApiKeyFormat(raw)).toBe(false);
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

  test("a missing, malformed, unknown, revoked and wrong-family credential all answer identically", async () => {
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
