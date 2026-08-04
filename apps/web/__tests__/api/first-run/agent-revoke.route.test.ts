import { createApiKeysRepo, resolveApiKeyPrincipal } from "@growthmind/db";

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
const CLOCK = clockAt(new Date("2026-08-04T10:00:00.000Z"));

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

function depsFor(scope: SeededMemberScope | null): FirstRunRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK };
}

async function rawRows(query: string): Promise<Record<string, unknown>[]> {
  const result = (await bed.db.execute(query)) as unknown as
    | { rows?: Record<string, unknown>[] }
    | Record<string, unknown>[];
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
