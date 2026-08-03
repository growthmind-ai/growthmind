import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  blankComments,
  fixtureAt,
  offenders,
  webSources,
} from "../../first-run/helpers/first-run-source";
import {
  bodyOf,
  clockAt,
  createFirstRunTestBed,
  loadRouteHandler,
  loadRouteInputSchema,
  readRouteSource,
  routeById,
  routeRequest,
  tenantOf,
  verifyRefusesUnknownKey,
  type FirstRunRouteDeps,
  type FirstRunTestBed,
  type SeededMemberScope,
} from "./helpers/first-run-route-contract";

const INTEREST = routeById("interest");
const STATUS = routeById("status");
const CLOCK = clockAt(new Date("2026-08-03T10:00:00.000Z"));

const LIVE_PROVIDER = "posthog";
const UNKNOWN_PROVIDER = "jira";
const WEBHOOK_ENV = "INTEREST_SLACK_WEBHOOK";

// AD-6's event seam: the route calls it only when the insert claimed, inside
// try/catch, so its failure never touches the 200 (D8).
interface InterestNotedEvent {
  readonly organizationId: string;
  readonly userId: string;
  readonly provider: string;
}

type InterestRouteDeps = FirstRunRouteDeps & {
  readonly recordInterestNoted?: ((event: InterestNotedEvent) => void) | undefined;
};

let bed: FirstRunTestBed;
let owner: SeededMemberScope;
let teammate: SeededMemberScope;
let outsider: SeededMemberScope;

// 60s: a cold PGlite boot measured ~5.4s and blows bun's 5s default; same
// figure and reasoning as lifecycle.route.test.ts.
const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("interest");
  owner = await bed.member("owner");
  teammate = await bed.member("mate", owner.organizationId);
  outsider = await bed.member("outsider");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(
  scope: SeededMemberScope | null,
  recordInterestNoted?: (event: InterestNotedEvent) => void,
): InterestRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK, recordInterestNoted };
}

async function rawRows(query: string): Promise<Record<string, unknown>[]> {
  const result = (await bed.db.execute(query)) as unknown as
    { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

async function interestRows(
  organizationId: string,
  provider: string,
): Promise<Record<string, unknown>[]> {
  return rawRows(
    `select provider, requested_by from provider_interest ` +
      `where organization_id = '${organizationId}' and provider = '${provider}'`,
  );
}

const ZOD_LEAKS = ["ZodError", '"issues"', "Invalid option", "unrecognized_keys\\"] as const;

async function expectPlainRefusal(response: Response, label: string): Promise<void> {
  expect(`${label}:${response.status}`).toBe(`${label}:400`);

  const body = await bodyOf(response);
  const error = body.error as { code?: unknown; message?: unknown } | undefined;
  expect(typeof error?.message).toBe("string");
  expect(String(error?.message).trim().length).toBeGreaterThan(0);

  const serialized = JSON.stringify(body);
  for (const leak of ZOD_LEAKS) {
    expect(`${label} leaks ${leak}: ${serialized.includes(leak)}`).toBe(
      `${label} leaks ${leak}: false`,
    );
  }
  expect(serialized).not.toMatch(/:\d+:\d+/);
}

describe("POST /api/first-run/interest — the register-interest wire (AD-6)", () => {
  test("the first tap returns 200 {noted:true} and persists one org-stamped row", async () => {
    const handle = await loadRouteHandler(INTEREST);

    const response = await handle(routeRequest(INTEREST, { provider: "mixpanel" }), depsFor(owner));

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ noted: true });

    const rows = await interestRows(owner.organizationId, "mixpanel");
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.requested_by)).toBe(owner.userId);
  });

  test("a repeat tap answers the same 200 with still exactly one row", async () => {
    const handle = await loadRouteHandler(INTEREST);

    const first = await handle(routeRequest(INTEREST, { provider: "gitlab" }), depsFor(owner));
    const second = await handle(routeRequest(INTEREST, { provider: "gitlab" }), depsFor(owner));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await bodyOf(second)).toEqual(await bodyOf(first));

    expect(await interestRows(owner.organizationId, "gitlab")).toHaveLength(1);
  });

  test("an unknown provider and the live provider each refuse with a plain 400, never a 500", async () => {
    const handle = await loadRouteHandler(INTEREST);

    for (const provider of [UNKNOWN_PROVIDER, LIVE_PROVIDER]) {
      const response = await handle(routeRequest(INTEREST, { provider }), depsFor(owner));
      await expectPlainRefusal(response, provider);

      expect(await interestRows(owner.organizationId, provider)).toHaveLength(0);
    }
  });

  test("a malformed body and a missing provider each refuse with 400, never a 500", async () => {
    const handle = await loadRouteHandler(INTEREST);

    await expectPlainRefusal(
      await handle(routeRequest(INTEREST, "{this is not json"), depsFor(owner)),
      "malformed",
    );
    await expectPlainRefusal(await handle(routeRequest(INTEREST, {}), depsFor(owner)), "empty");
  });

  test("the schema is strict: an unknown or tenancy key is refused by name, never stripped", async () => {
    const schemaUnderTest = await loadRouteInputSchema(INTEREST);

    for (const key of ["somethingNobodyDeclared", "projectId", "organizationId"]) {
      const verdict = verifyRefusesUnknownKey(schemaUnderTest, INTEREST.validBody, key);
      if (!verdict.ok) throw new Error(`${INTEREST.path} does not refuse "${key}": ${verdict.why}`);
      expect(verdict.keys).toContain(key);
    }

    const handle = await loadRouteHandler(INTEREST);
    const response = await handle(
      routeRequest(INTEREST, { provider: "mixpanel", projectId: "someone-elses-project" }),
      depsFor(owner),
    );
    await expectPlainRefusal(response, "unknown-key");
    expect(JSON.stringify(await bodyOf(response))).not.toContain("Unrecognized key");
  });

  test("no tenant context is refused with 401 and writes nothing", async () => {
    const handle = await loadRouteHandler(INTEREST);

    const before = await rawRows(`select count(*) as n from provider_interest`);
    const response = await handle(routeRequest(INTEREST, { provider: "codex" }), depsFor(null));

    expect(response.status).toBe(401);

    const after = await rawRows(`select count(*) as n from provider_interest`);
    expect(String(after[0]?.n)).toBe(String(before[0]?.n));
  });

  test("an org-A member cannot note into or read org B", async () => {
    const interest = await loadRouteHandler(INTEREST);
    const status = await loadRouteHandler(STATUS);

    const noted = await interest(routeRequest(INTEREST, { provider: "github" }), depsFor(outsider));
    expect(noted.status).toBe(200);

    expect(await interestRows(outsider.organizationId, "github")).toHaveLength(1);
    expect(await interestRows(owner.organizationId, "github")).toHaveLength(0);

    const body = await bodyOf(await status(routeRequest(STATUS), depsFor(owner)));
    expect((body.providerInterest as readonly string[] | undefined) ?? []).not.toContain("github");
  });

  test("the event seam fires exactly once per (org, provider), on first insert only", async () => {
    const handle = await loadRouteHandler(INTEREST);
    const scope = await bed.member("event");

    const calls: InterestNotedEvent[] = [];
    const record = (event: InterestNotedEvent): void => {
      calls.push(event);
    };

    const first = await handle(
      routeRequest(INTEREST, { provider: "claude-code" }),
      depsFor(scope, record),
    );
    expect(first.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      organizationId: scope.organizationId,
      userId: scope.userId,
      provider: "claude-code",
    });

    const repeat = await handle(
      routeRequest(INTEREST, { provider: "claude-code" }),
      depsFor(scope, record),
    );
    expect(repeat.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  test("a throwing event seam never touches the 200 or the row (D8)", async () => {
    const handle = await loadRouteHandler(INTEREST);
    const scope = await bed.member("event-throwing");

    const response = await handle(
      routeRequest(INTEREST, { provider: "cursor" }),
      depsFor(scope, () => {
        throw new Error("the capture client fell over");
      }),
    );

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ noted: true });
    expect(await interestRows(scope.organizationId, "cursor")).toHaveLength(1);
  });

  test("a teammate reads the noted provider from the status payload (W-24, D1)", async () => {
    const interest = await loadRouteHandler(INTEREST);
    const status = await loadRouteHandler(STATUS);

    const noted = await interest(routeRequest(INTEREST, { provider: "amplitude" }), depsFor(owner));
    expect(noted.status).toBe(200);

    const body = await bodyOf(await status(routeRequest(STATUS), depsFor(teammate)));

    expect(Array.isArray(body.providerInterest)).toBe(true);
    expect(body.providerInterest as readonly string[]).toContain("amplitude");
  });

  test("interestPingAvailable is computed server-side, per call, from the webhook env (W-24, AC-10)", async () => {
    const status = await loadRouteHandler(STATUS);
    const prior = process.env[WEBHOOK_ENV];

    try {
      process.env[WEBHOOK_ENV] = "https://hooks.slack.com/services/T000/B000/interest-fixture";
      const withHook = await bodyOf(await status(routeRequest(STATUS), depsFor(owner)));
      expect(withHook.interestPingAvailable).toBe(true);

      delete process.env[WEBHOOK_ENV];
      const without = await bodyOf(await status(routeRequest(STATUS), depsFor(owner)));
      expect(without.interestPingAvailable).toBe(false);
    } finally {
      if (prior === undefined) delete process.env[WEBHOOK_ENV];
      else process.env[WEBHOOK_ENV] = prior;
    }
  });
});

const ENQUEUE_BANS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "addJob", pattern: /\baddJob\b/ },
  { name: "a TASK. constant", pattern: /\bTASK\./ },
  { name: "graphile", pattern: /graphile/i },
];

const enqueueRefsIn = (source: string): readonly string[] =>
  ENQUEUE_BANS.filter(({ pattern }) => pattern.test(blankComments(source))).map(({ name }) => name);

const PLANTED_ENQUEUE_ROUTE =
  `import { quickAddJob } from "graphile-worker";\n` +
  `export async function handle() {\n` +
  `  await addJob(TASK.PROVIDER_INTEREST_TICK, {});\n` +
  `  return Response.json({ noted: true });\n` +
  `}\n`;

const CLEAN_ROUTE = `export async function handle() {\n  return Response.json({ noted: true });\n}\n`;

const WEB_ENQUEUE = /graphile-worker|\baddJob\b/;

const PLANTED_WEB_ENQUEUE = fixtureAt(
  "apps/web/lib/first-run/planted-enqueue.ts",
  PLANTED_ENQUEUE_ROUTE,
);

const CLEAN_WEB_ROUTE = fixtureAt("apps/web/lib/first-run/clean-route.ts", CLEAN_ROUTE);

const COMMENT_ONLY_MENTION = fixtureAt(
  "apps/web/lib/first-run/comment-only.ts",
  `// the web tier never calls addJob; the graphile-worker sweep discovers the row\nexport const x = 1;\n`,
);

describe("the web tier never enqueues (AD-1, W-26/W-27)", () => {
  test("the interest route source contains no addJob, TASK., or graphile reference", () => {
    expect(enqueueRefsIn(PLANTED_ENQUEUE_ROUTE)).toEqual([
      "addJob",
      "a TASK. constant",
      "graphile",
    ]);
    expect(enqueueRefsIn(CLEAN_ROUTE)).toEqual([]);
    expect(enqueueRefsIn(COMMENT_ONLY_MENTION.source)).toEqual([]);

    const source = readRouteSource(INTEREST);
    expect(enqueueRefsIn(source)).toEqual([]);
  });

  test("no apps/web source imports graphile-worker or calls addJob", () => {
    expect(offenders([PLANTED_WEB_ENQUEUE], WEB_ENQUEUE)).not.toEqual([]);
    expect(offenders([CLEAN_WEB_ROUTE], WEB_ENQUEUE)).toEqual([]);
    expect(offenders([COMMENT_ONLY_MENTION], WEB_ENQUEUE)).toEqual([]);

    // The invariant covers the new route too — red until it exists on disk.
    readRouteSource(INTEREST);

    expect(offenders(webSources(), WEB_ENQUEUE)).toEqual([]);
  });
});
