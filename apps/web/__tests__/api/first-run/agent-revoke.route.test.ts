import { createApiKeysRepo, findUserNameById, resolveApiKeyPrincipal } from "@growthmind/db";
import type { DeliveryPoster, PostRequest, PostResult } from "@growthmind/shared";

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  bodyOf,
  clockAt,
  createFirstRunTestBed,
  loadRouteHandler,
  loadRouteInputSchema,
  routeById,
  routeRequest,
  tenantOf,
  verifyRefusesUnknownKey,
  type FirstRunRouteDeps,
  type FirstRunTestBed,
  type SeededMemberScope,
} from "./helpers/first-run-route-contract";

const AGENT_REVOKE = routeById("agent-revoke");
const SLACK_CONNECT = routeById("slack-connect");
const CLOCK = clockAt(new Date("2026-08-04T10:00:00.000Z"));

const BOT_TOKEN = "xoxb-b055-fixture-token-never-real";
const CHANNEL_ID = "C0B055REVOKE";

let bed: FirstRunTestBed;

// 60s: a cold PGlite boot measured ~5.4s and blows bun's 5s default; same
// figure and reasoning as status.route.test.ts.
const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("agentrevoke");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(
  scope: SeededMemberScope | null,
  extra?: Partial<FirstRunRouteDeps>,
): FirstRunRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK, ...extra };
}

interface RecordingPoster extends DeliveryPoster {
  readonly sent: PostRequest[];
}

function recordingPoster(result: PostResult): RecordingPoster {
  const sent: PostRequest[] = [];
  return {
    sent,
    post: async (request: PostRequest): Promise<PostResult> => {
      sent.push(request);
      return result;
    },
  };
}

const OK_POST: PostResult = { ok: true, messageRef: "1712345678.000200" };

async function connectSlack(scope: SeededMemberScope): Promise<void> {
  const handle = await loadRouteHandler(SLACK_CONNECT);
  const response = await handle(
    routeRequest(SLACK_CONNECT, { botToken: BOT_TOKEN, channelId: CHANNEL_ID }),
    depsFor(scope),
  );
  if (response.status !== 200) {
    throw new Error(`slack connect fixture failed with status ${response.status}`);
  }
}

async function rawRows(query: string): Promise<Record<string, unknown>[]> {
  const result = (await bed.db.execute(query)) as unknown as
    { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

async function revocations(organizationId: string): Promise<Record<string, unknown>[]> {
  return rawRows(
    `select id, revoked_at from api_keys where organization_id = '${organizationId}' order by id`,
  );
}

async function mintFor(scope: SeededMemberScope, name: string): Promise<string> {
  const minted = await createApiKeysRepo(bed.db, scope.ctx).mint({ name });
  return minted.raw;
}

describe("POST /api/first-run/agent/revoke — the org-wide revoke (D-5, AC-33)", () => {
  test("revokes every live key in the caller's org in one call", async () => {
    const handle = await loadRouteHandler(AGENT_REVOKE);
    const scope = await bed.member("every");

    await mintFor(scope, "first key");
    await mintFor(scope, "second key");

    const response = await handle(routeRequest(AGENT_REVOKE, {}), depsFor(scope));
    expect(response.status).toBe(200);

    const rows = await revocations(scope.organizationId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(`${String(row.id)} revoked: ${row.revoked_at !== null}`).toBe(
        `${String(row.id)} revoked: true`,
      );
    }
  });

  test("accepts no key id — the signature has nowhere to put one (D7)", async () => {
    const schemaUnderTest = await loadRouteInputSchema(AGENT_REVOKE);

    for (const key of ["keyId", "id"]) {
      const verdict = verifyRefusesUnknownKey(schemaUnderTest, AGENT_REVOKE.validBody, key);
      if (!verdict.ok) {
        throw new Error(
          `${AGENT_REVOKE.path} does not refuse a client-supplied "${key}": ${verdict.why}`,
        );
      }
      expect(verdict.keys).toContain(key);
    }
  });

  test("leaves another org's key live, and that key still authenticates (AC-20)", async () => {
    const handle = await loadRouteHandler(AGENT_REVOKE);
    const orgA = await bed.member("tenant-a");
    const orgB = await bed.member("tenant-b");

    await mintFor(orgA, "org a key");
    const keyB = await mintFor(orgB, "org b key");

    const response = await handle(routeRequest(AGENT_REVOKE, {}), depsFor(orgA));
    expect(response.status).toBe(200);

    const rowsB = await revocations(orgB.organizationId);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.revoked_at).toBeNull();

    const principal = await resolveApiKeyPrincipal(bed.db, keyB);
    expect(principal?.organizationId).toBe(orgB.organizationId);
  });

  test("is a safe no-op the second time, preserving the first revocation's timestamp (D4)", async () => {
    const handle = await loadRouteHandler(AGENT_REVOKE);
    const scope = await bed.member("twice");

    await mintFor(scope, "only key");

    const first = await handle(routeRequest(AGENT_REVOKE, {}), depsFor(scope));
    expect(first.status).toBe(200);
    const stampedAt = String((await revocations(scope.organizationId))[0]?.revoked_at);

    const second = await handle(routeRequest(AGENT_REVOKE, {}), depsFor(scope));
    expect(second.status).toBe(200);
    expect(await bodyOf(second)).toEqual(await bodyOf(first));

    expect(String((await revocations(scope.organizationId))[0]?.revoked_at)).toBe(stampedAt);
  });
});

// B-055's disclosure moved onto the notification spine in O-051: the route no longer
// composes a post, so its route-level announcement tests have no subject here. The same
// four guarantees are asserted where the behaviour now lives —
// packages/db/__tests__/notifications/wire-keys-revoked.test.ts (one emit per real
// transition with the pressing member as actor; nothing on a retried call) and
// worker/__tests__/tasks/notification-dispatch.test.ts (the sentence, with the actor's
// name resolved, posted exactly once to the org's channel).
describe("POST /api/first-run/agent/revoke — B-055's announcement has moved", () => {
  test("the route composes no Slack post of its own", () => {
    const source = readFileSync(
      path.join(
        import.meta.dir,
        "..",
        "..",
        "..",
        "app",
        "api",
        "first-run",
        "agent",
        "revoke",
        "route.ts",
      ),
      "utf8",
    );

    expect(source).not.toContain("poster");
    expect(source).not.toContain("agent-revoke-announcement");
  });
});
