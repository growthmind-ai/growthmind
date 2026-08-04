import { API_KEY_PREFIX, hashApiKeyMaterial, setLogSink, type LogRecord } from "@growthmind/shared";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  TENANCY_KEYS,
  bodyOf,
  clockAt,
  createFirstRunTestBed,
  leaks,
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

const AGENT_KEY = routeById("agent-key");
const CLOCK = clockAt(new Date("2026-08-04T10:00:00.000Z"));

// D-14's event seam: fired inside its own try/catch, so a recorder failure
// never touches the 200 (D8). The raw key is never a property (AC-46).
interface AgentKeyMintedEvent {
  readonly organizationId: string;
  readonly provider: string;
}

type AgentKeyRouteDeps = FirstRunRouteDeps & {
  readonly recordAgentKeyMinted?: ((event: AgentKeyMintedEvent) => void) | undefined;
};

let bed: FirstRunTestBed;

// 60s: a cold PGlite boot measured ~5.4s and blows bun's 5s default; same
// figure and reasoning as status.route.test.ts.
const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("agentkey");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(
  scope: SeededMemberScope | null,
  recordAgentKeyMinted?: (event: AgentKeyMintedEvent) => void,
): AgentKeyRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK, recordAgentKeyMinted };
}

async function rawRows(query: string): Promise<Record<string, unknown>[]> {
  const result = (await bed.db.execute(query)) as unknown as
    { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

async function keyRows(organizationId: string): Promise<Record<string, unknown>[]> {
  return rawRows(
    `select id, organization_id, name, key_hash, key_prefix from api_keys ` +
      `where organization_id = '${organizationId}'`,
  );
}

async function keyCount(): Promise<string> {
  const rows = await rawRows(`select count(*) as n from api_keys`);
  return String(rows[0]?.n);
}

describe("POST /api/first-run/agent/key — the mint (D-5, AC-1)", () => {
  test("mints one org-scoped key and returns the raw material once", async () => {
    const handle = await loadRouteHandler(AGENT_KEY);
    const scope = await bed.member("mint");

    const response = await handle(routeRequest(AGENT_KEY, { provider: "cursor" }), depsFor(scope));

    expect(response.status).toBe(200);

    const key = String((await bodyOf(response)).key);
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);

    const rows = await keyRows(scope.organizationId);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.organization_id)).toBe(scope.organizationId);
    expect(String(rows[0]?.key_hash)).toBe(hashApiKeyMaterial(key));
  });

  test("names the key from the picked assistant, server-side (AC-5)", async () => {
    const handle = await loadRouteHandler(AGENT_KEY);
    const scope = await bed.member("named");

    const response = await handle(routeRequest(AGENT_KEY, { provider: "cursor" }), depsFor(scope));
    expect(response.status).toBe(200);

    const rows = await keyRows(scope.organizationId);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.name)).toContain("Cursor");
  });

  test("refuses a non-assistant provider with a 4xx, never a 500 (D5, D9)", async () => {
    const handle = await loadRouteHandler(AGENT_KEY);
    const scope = await bed.member("refused");

    for (const body of [{ provider: "mixpanel" }, { provider: "nope" }, {}]) {
      const label = JSON.stringify(body);
      const response = await handle(routeRequest(AGENT_KEY, body), depsFor(scope));

      expect(`${label}: ${response.status}`).toBe(`${label}: 400`);

      const error = (await bodyOf(response)).error as { message?: unknown } | undefined;
      expect(typeof error?.message).toBe("string");
    }

    expect(await keyRows(scope.organizationId)).toHaveLength(0);
  });

  test("refuses a signed-out caller and writes no row", async () => {
    const handle = await loadRouteHandler(AGENT_KEY);

    const before = await keyCount();
    const response = await handle(routeRequest(AGENT_KEY, { provider: "codex" }), depsFor(null));

    expect(response.status).toBe(401);
    expect(((await bodyOf(response)).error as { code?: unknown } | undefined)?.code).toBe(
      "signed_out",
    );

    expect(await keyCount()).toBe(before);
  });

  test("returns no key id, prefix, name or timestamp — the body has exactly one property (AC-3)", async () => {
    const handle = await loadRouteHandler(AGENT_KEY);
    const scope = await bed.member("shape");

    const response = await handle(routeRequest(AGENT_KEY, { provider: "copilot" }), depsFor(scope));
    expect(response.status).toBe(200);

    const body = await bodyOf(response);
    expect(Object.keys(body)).toEqual(["key"]);

    const rows = await keyRows(scope.organizationId);
    const serialized = JSON.stringify(body);
    // key_prefix is the key's own first characters, so it is in the body by
    // construction. Line 145 is what proves nothing else rides along.
    for (const column of ["id", "name"] as const) {
      const value = String(rows[0]?.[column]);
      expect(`${column} leaked: ${serialized.includes(value)}`).toBe(`${column} leaked: false`);
    }
  });

  test("the strict object refuses a client-supplied organization, never strips it (D7)", async () => {
    const schemaUnderTest = await loadRouteInputSchema(AGENT_KEY);

    for (const key of [...TENANCY_KEYS, "organization_id"]) {
      const verdict = verifyRefusesUnknownKey(schemaUnderTest, AGENT_KEY.validBody, key);
      if (!verdict.ok) {
        throw new Error(`${AGENT_KEY.path} does not refuse "${key}": ${verdict.why}`);
      }
      expect(verdict.keys).toContain(key);
    }
  });
});

describe("POST /api/first-run/agent/key — the mint event (D-14, AC-46)", () => {
  test("records one event per mint, carrying the org and the provider and no key material", async () => {
    const handle = await loadRouteHandler(AGENT_KEY);
    const scope = await bed.member("event");

    const calls: AgentKeyMintedEvent[] = [];
    const record = (event: AgentKeyMintedEvent): void => {
      calls.push(event);
    };

    const first = await handle(
      routeRequest(AGENT_KEY, { provider: "codex" }),
      depsFor(scope, record),
    );
    expect(first.status).toBe(200);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ organizationId: scope.organizationId, provider: "codex" });

    const key = String((await bodyOf(first)).key);
    expect(leaks(JSON.stringify(calls), key)).toBeNull();
  });

  test("records a second event for a second identical mint", async () => {
    const handle = await loadRouteHandler(AGENT_KEY);
    const scope = await bed.member("event-twice");

    const calls: AgentKeyMintedEvent[] = [];
    const record = (event: AgentKeyMintedEvent): void => {
      calls.push(event);
    };

    const first = await handle(
      routeRequest(AGENT_KEY, { provider: "windsurf" }),
      depsFor(scope, record),
    );
    const second = await handle(
      routeRequest(AGENT_KEY, { provider: "windsurf" }),
      depsFor(scope, record),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  test("a recorder that throws never touches the 200 or the key (D8)", async () => {
    const handle = await loadRouteHandler(AGENT_KEY);
    const scope = await bed.member("event-throwing");

    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });

    try {
      const response = await handle(
        routeRequest(AGENT_KEY, { provider: "claude-code" }),
        depsFor(scope, () => {
          throw new Error("the capture client fell over");
        }),
      );

      expect(response.status).toBe(200);
      expect(String((await bodyOf(response)).key).startsWith(API_KEY_PREFIX)).toBe(true);
      expect(logged.some((record) => record.level === "error")).toBe(true);
    } finally {
      restore();
    }

    expect(await keyRows(scope.organizationId)).toHaveLength(1);
  });
});
