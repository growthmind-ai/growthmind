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

const UNKNOWN_BUT_WELL_FORMED = `${WRITE_KEY_PREFIX}${"a".repeat(43)}`;

const MALFORMED = "definitely-not-a-key";

const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

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
  test("WIRE-C1 — lets no key a website's own code carries even be presented here", async () => {
    const kinds = writeKeyKindSchema.options;
    expect(kinds.length).toBeGreaterThan(0);

    for (const kind of kinds) {
      const raw = await mintKey(kind);

      expect((await resolveWriteKeyForIngest(authCtx.db, raw))?.kind).toBe(kind);

      expect(isApiKeyFormat(raw)).toBe(false);
    }
  });

  test("WIRE-C2 — refuses a genuine unrevoked standard ingest key exactly as it refuses no key at all", async () => {
    const raw = await mintKey("standard");

    const asIngest = await resolveWriteKeyForIngest(authCtx.db, raw);
    expect(asIngest?.kind).toBe("standard");

    const withKey = await fingerprint(await callWith(raw));
    const withNothing = await fingerprint(await callWith(null));

    expect(withKey.status).toBe(401);
    expect(withKey.contentType).toBe(PRE_SDK_CONTENT_TYPE);

    expect(withKey).toEqual(withNothing);
  });

  test("WIRE-C3 — refuses a genuine unrevoked simulation ingest key exactly as it refuses no key at all", async () => {
    const raw = await mintKey("simulation");

    const asIngest = await resolveWriteKeyForIngest(authCtx.db, raw);
    expect(asIngest?.kind).toBe("simulation");

    const withKey = await fingerprint(await callWith(raw));
    const withNothing = await fingerprint(await callWith(null));

    expect(withKey.status).toBe(401);
    expect(withKey.contentType).toBe(PRE_SDK_CONTENT_TYPE);

    expect(withKey).toEqual(withNothing);
  });

  test("WIRE-C4 — a missing, malformed, unknown, revoked and wrong-family credential all answer identically", async () => {
    const live = await mintKey("standard");

    const revokedKey = await createWriteKeysRepo(authCtx.db, ownerCtx).mint({
      projectId,
      kind: "standard",
    });
    const revoked = await createWriteKeysRepo(authCtx.db, ownerCtx).revoke(revokedKey.key.id);

    expect(revoked?.revokedAt).not.toBeNull();
    expect(await resolveWriteKeyForIngest(authCtx.db, revokedKey.raw)).toBeNull();

    const answers = await Promise.all(
      [null, MALFORMED, UNKNOWN_BUT_WELL_FORMED, revokedKey.raw, live].map(async (key) =>
        fingerprint(await callWith(key)),
      ),
    );

    const [first] = answers;

    expect(first?.status).toBe(401);
    expect(first?.contentType).toBe(PRE_SDK_CONTENT_TYPE);

    for (const answer of answers) {
      expect(answer).toEqual(first);
    }
  });

  test("WIRE-C5 — a credential store that cannot be reached refuses rather than lets the request through", async () => {
    const failClosed = await fingerprint(
      await handleMcpRequest(toolCallRequest({ tool: "list_open_fixes", key: "anything" }), {
        credentials: throwingCredentials(),
        reads: deps.reads,
      }),
    );
    const withNothing = await fingerprint(await callWith(null));

    expect(failClosed.status).toBe(401);
    expect(failClosed.contentType).toBe(PRE_SDK_CONTENT_TYPE);

    expect(failClosed).toEqual(withNothing);
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

    const inQuery = new Request(`${url}?key=${UNKNOWN_BUT_WELL_FORMED}`, { method: "POST" });
    expect(presentedCredential(inQuery)).toBeNull();

    const bearer = new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${UNKNOWN_BUT_WELL_FORMED}` },
    });
    expect(presentedCredential(bearer)).toBe(UNKNOWN_BUT_WELL_FORMED);
  });
});
