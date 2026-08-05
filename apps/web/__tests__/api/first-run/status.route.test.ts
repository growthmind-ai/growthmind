import {
  createApiKeysRepo,
  createFindingsRepo,
  eq,
  schema,
  type MeasuredCountRow,
  type ScopedDb,
} from "@growthmind/db";
import { CONNECTION_STATE_MESSAGES, type TenantContext } from "@growthmind/shared";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  enumerateShapeKeys,
  plainObjectControl,
  strictObjectControl,
  dotStrictControl,
  CONTROL_VALID_BODY,
} from "../../../../../packages/shared/__tests__/onboarding/probes/strict-zod-fixtures";
import { scannedTextFor, seedAnalysisRun, seedConnection } from "@growthmind/db/testing";
import {
  FIRST_RUN_API_DIR,
  FIRST_RUN_ROUTES,
  TENANCY_KEYS,
  bodyOf,
  clockAt,
  collectStrings,
  createFirstRunTestBed,
  leaks,
  loadRouteHandler,
  loadRouteInputSchema,
  readRouteSource,
  routeById,
  routeRequest,
  tenantOf,
  verifyRefusesUnknownKey,
  webLaneNames,
  type FirstRunTestBed,
  type SeededMemberScope,
} from "./helpers/first-run-route-contract";

const NAMES = webLaneNames("status");
const STATUS = routeById("status");
const ARM = routeById("arm");
const CLOCK = clockAt(new Date("2026-08-01T10:00:00.000Z"));

const SEEDED_CIPHERTEXT_SECRET = "s3cret-onboarding-status-envelope-payload";

let bed: FirstRunTestBed;
let orgA: SeededMemberScope;
let orgB: SeededMemberScope;

/**
 * Longer than bun's 5s default, and it is not a slow test being tolerated.
 *
 * The comment inside the hook below already names the cost of a `beforeAll`
 * that fails: one shared hook failure standing in for every row's own named
 * diagnostic, the three CONTROLS included. It reasons about the hook THROWING.
 * A TIMEOUT is the second way that hook fails, and it is the worse one — a
 * throw at least carries the message the fixture wrote, whereas the timeout is
 * an UNNAMED `a beforeEach/afterEach hook timed out` naming no route, no
 * contract and no owner. Same lost diagnostic, no replacement text at all.
 *
 * THE BUDGET IS FOR THE BOOT, NOT FOR THE ASSERTIONS. This hook boots a real
 * PGlite, runs the migrations, and signs two members up through Better Auth
 * (whose password hashing is deliberately slow). Measured warm on this machine
 * it costs ~1.5s — comfortable-looking, and misleading: a COLD boot, where the
 * wasm image is decompressed rather than reused, was measured at ~5.4s and blew
 * straight through bun's 5s default. Two agents reproduced that independently
 * with their own files excluded.
 *
 * It also only bites when a single file is run — the batch run shares the warm
 * image and hides it — so it is invisible until the one moment it is expensive.
 *
 * Same figure and same reasoning as `discover.route.test.ts`,
 * `analytics.route.test.ts` and `lifecycle.route.test.ts`; keep them in
 * agreement.
 */
const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("status");
  orgA = await bed.member("a");
  orgB = await bed.member("b");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

const provisioned = new Map<string, Promise<string>>();

function projectFor(scope: SeededMemberScope): Promise<string> {
  const existing = provisioned.get(scope.organizationId);
  if (existing) return existing;
  const pending = provisionedProjectFor(scope);
  provisioned.set(scope.organizationId, pending);
  return pending;
}

async function provisionedProjectFor(scope: SeededMemberScope): Promise<string> {
  const handle = await loadRouteHandler(STATUS);
  await handle(routeRequest(STATUS), depsFor(scope));

  const rows = await bed.db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, scope.organizationId));

  if (rows.length !== 1) {
    throw new Error(
      `expected GET ${STATUS.path} to provision EXACTLY ONE project for the caller's org ` +
        `(FR-O1, AD-7), found ${rows.length}. ${NAMES.orgName("x")}-lane fixture.`,
    );
  }
  return rows[0]!.id;
}

async function seedConnectionWithSecret(
  organizationId: string,
  projectId: string,
): Promise<string> {
  const connection = await seedConnection(bed.db, {
    organizationId,
    projectId,
    credentialCiphertext: `v1.deadbeef.aaaa.bbbb.${SEEDED_CIPHERTEXT_SECRET}`,
    credentialKeyId: "deadbeef",
  });

  return connection.id;
}

const MEASURED_COUNT: MeasuredCountRow = {
  numerator: 3,
  denominator: 10,
  unit: "sessions",
  timeframe: {
    start: new Date("2026-07-30T00:00:00.000Z"),
    end: new Date("2026-08-01T00:00:00.000Z"),
  },
  basis: { totalInWindow: 10, kept: 10, setAside: [], keptUnchecked: 0 },
};

async function seedFinding(
  scope: SeededMemberScope,
  projectId: string,
  overrides: { readonly headline: string; readonly windowEnd: Date },
): Promise<void> {
  const run = await seedAnalysisRun(bed.db, { ctx: scope.ctx, projectId });
  const repo = createFindingsRepo(bed.db, scope.ctx);
  const text = scannedTextFor(overrides.headline, ["One line of context, never a blob."]);
  await repo.persist({
    projectId,
    runId: run.id,
    signature: randomUUID(),
    signatureVersion: 1,
    summarySource: "model_rendered",
    headline: text.headline,
    context: text.context,
    finalClass: "funnel_dropoff",
    surface: "/checkout",
    surfaceNormalisationVersion: 1,
    counts: [MEASURED_COUNT],
    confidenceBasis: "few_sessions",
    windowStart: new Date("2026-07-30T00:00:00.000Z"),
    windowEnd: overrides.windowEnd,
    evidenceShape: "shape-v1",
    evidenceShapeVersion: 1,
    resolvedModelId: "model-fixture",
  });
}

function depsFor(scope: SeededMemberScope | null) {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK };
}

// An address the residual scanner classifies as `email_address`, distinctive enough that
// finding it anywhere in the payload can only be this row's persisted text.
const PII_OFFENDER = "dana.okonkwo@northwind.example";

const SEED_OWNER =
  "ADD O-021 Wave 1.4 (packages/db/src/testing/fixtures.ts — `seedUnscannedFinding`, the only " +
  "helper that writes a finding row whose persisted text never passed the residual scan)";

const SEED_MODULE = "packages/db/src/testing/index.ts";

// ADD Decision 4: only a row from THIS watch may make the screen terminal, so the planted
// row is stamped after the arm clock. The pre-armedAt case is I4, in packages/db.
const AFTER_ARMED_AT = new Date("2026-08-01T11:00:00.000Z");

interface SeedUnscannedFindingParams {
  readonly ctx: TenantContext;
  readonly projectId: string;
  readonly runId: string;
  readonly headline: string;
  readonly context: readonly string[];
  readonly signature?: string;
  readonly surface?: string;
  readonly counts?: readonly MeasuredCountRow[];
  readonly windowStart?: Date;
  readonly windowEnd?: Date;
  readonly createdAt?: Date;
  readonly evidenceShape?: string;
}

type SeedUnscannedFinding = (
  db: ScopedDb,
  params: SeedUnscannedFindingParams,
) => Promise<{ readonly id: string }>;

function loadSeedUnscannedFinding(): Promise<SeedUnscannedFinding> {
  return loadUnderConstruction<SeedUnscannedFinding>({
    modulePath: underConstructionSpecifier(SEED_MODULE),
    exportName: "seedUnscannedFinding",
    ownedBy: SEED_OWNER,
  });
}

describe("CONTROL — the strictness prober, run against real zod (AD-16a)", () => {
  test("CONTROL: a plain z.object() FAILS the prober — it accepts and strips a projectId", () => {
    const verdict = verifyRefusesUnknownKey(plainObjectControl(), CONTROL_VALID_BODY, "projectId");

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.why).toContain("ACCEPTED");
    expect(verdict.why).toContain("SILENTLY STRIPPED");
  });

  test("CONTROL: z.strictObject() and .strict() both PASS the prober, naming the offending key", () => {
    for (const [label, control] of [
      ["z.strictObject()", strictObjectControl()],
      [".strict()", dotStrictControl()],
    ] as const) {
      const verdict = verifyRefusesUnknownKey(control, CONTROL_VALID_BODY, "projectId");
      expect(`${label}:${verdict.ok}`).toBe(`${label}:true`);
      if (!verdict.ok) throw new Error(verdict.why);

      expect(verdict.keys).toEqual(["projectId"]);
    }
  });

  test("CONTROL: Object.keys(shape) is identical for all three — enumeration cannot enforce", () => {
    const plain = enumerateShapeKeys(plainObjectControl());
    const strict = enumerateShapeKeys(strictObjectControl());
    const dotted = enumerateShapeKeys(dotStrictControl());

    expect(plain).toEqual(["stepId"]);
    expect(strict).toEqual(plain);
    expect(dotted).toEqual(plain);
  });
});

describe("no first-run route accepts a tenancy id (AD-16, AD-16a)", () => {
  test("the route accepts no projectId and no organizationId in any input", async () => {
    for (const route of FIRST_RUN_ROUTES) {
      const schemaUnderTest = await loadRouteInputSchema(route);
      const keys = enumerateShapeKeys(schemaUnderTest);

      expect(`${route.id}:${keys === null ? "no-shape" : "has-shape"}`).toBe(
        `${route.id}:has-shape`,
      );
      expect(`${route.id}:${[...(keys ?? [])].toSorted().join(",")}`).toBe(
        `${route.id}:${[...route.declaredKeys].toSorted().join(",")}`,
      );
      for (const tenancyKey of TENANCY_KEYS) {
        expect(`${route.id}:${(keys ?? []).includes(tenancyKey)}`).toBe(`${route.id}:false`);
      }
    }
  });

  test("every first-run route schema refuses a client-supplied projectId or organizationId with unrecognized_keys, never by stripping it", async () => {
    for (const route of FIRST_RUN_ROUTES) {
      const schemaUnderTest = await loadRouteInputSchema(route);

      for (const tenancyKey of TENANCY_KEYS) {
        const verdict = verifyRefusesUnknownKey(schemaUnderTest, route.validBody, tenancyKey);
        if (!verdict.ok) {
          throw new Error(
            `${route.method} ${route.path} does not refuse a client-supplied "${tenancyKey}": ${verdict.why}`,
          );
        }
        expect(verdict.keys).toContain(tenancyKey);
      }
    }
  });

  test("every first-run route input schema is constructed strict", async () => {
    for (const route of FIRST_RUN_ROUTES) {
      const schemaUnderTest = await loadRouteInputSchema(route);
      const verdict = verifyRefusesUnknownKey(
        schemaUnderTest,
        route.validBody,
        "somethingNobodyDeclared",
      );
      if (!verdict.ok) {
        throw new Error(
          `${route.method} ${route.path} is not constructed with z.strictObject()/.strict(): ${verdict.why}`,
        );
      }
    }
  });

  test("every route file on disk is declared in FIRST_RUN_ROUTES — the ninth route cannot slip in", () => {
    const declared = FIRST_RUN_ROUTES.map((route) => route.sourcePath).toSorted();
    const onDisk = findRouteFiles(FIRST_RUN_API_DIR).toSorted();

    if (onDisk.length === 0) {
      throw new Error(
        `NOT IMPLEMENTED YET: ${FIRST_RUN_API_DIR}/ contains no route.ts at all. ` +
          `ADD Wave 6b creates the eight routes AD-16 declares. This is a Wave 0 red for the ` +
          `RIGHT reason: the surface that must satisfy AD-16 is absent.`,
      );
    }
    expect(onDisk).toEqual(declared);
  });
});

function findRouteFiles(repoRelativeDir: string): string[] {
  const root = path.join(import.meta.dir, "..", "..", "..", "..", "..");
  const absolute = path.join(root, repoRelativeDir);
  const found: string[] = [];

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "route.ts") {
        found.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };

  walk(absolute);
  return found;
}

describe("GET /api/first-run/status (AD-16, AD-18, AD-3)", () => {
  test("the route derives its org from the session, never from the request", async () => {
    const handle = await loadRouteHandler(STATUS);
    const arm = await loadRouteHandler(ARM);

    await arm(routeRequest(ARM, {}), depsFor(orgA));

    const plain = await bodyOf(await handle(routeRequest(STATUS), depsFor(orgA)));
    const withForeignProject = await bodyOf(
      await handle(
        routeRequest(STATUS, undefined, {
          search: `?projectId=${await projectFor(orgB)}&organizationId=${orgB.organizationId}`,
        }),
        depsFor(orgA),
      ),
    );

    expect(withForeignProject).toEqual(plain);

    const asOrgB = await bodyOf(
      await handle(
        routeRequest(STATUS, undefined, {
          search: `?projectId=${await projectFor(orgA)}&organizationId=${orgA.organizationId}`,
        }),
        depsFor(orgB),
      ),
    );
    expect(asOrgB).not.toEqual(plain);
  });

  test("a signed-out caller gets 401, never data and never a 500", async () => {
    const handle = await loadRouteHandler(STATUS);
    const response = await handle(routeRequest(STATUS), depsFor(null));

    expect(response.status).toBe(401);

    const body = await bodyOf(response);
    expect(Object.keys(body)).not.toContain("finding");
    expect(Object.keys(body)).not.toContain("counter");
    expect(JSON.stringify(body)).not.toContain("stack");
    expect(JSON.stringify(body)).not.toMatch(/:\d+:\d+/);
  });

  test("the finding is fetched with limit 1 and returned as a single nullable object", async () => {
    const handle = await loadRouteHandler(STATUS);

    const empty = await bodyOf(await handle(routeRequest(STATUS), depsFor(orgB)));
    expect(empty.finding).toBeNull();

    await seedFinding(orgA, await projectFor(orgA), {
      headline: "Older finding",
      windowEnd: new Date("2026-07-31T00:00:00.000Z"),
    });
    await seedFinding(orgA, await projectFor(orgA), {
      headline: "Newest finding",
      windowEnd: new Date("2026-08-01T00:00:00.000Z"),
    });

    const body = await bodyOf(await handle(routeRequest(STATUS), depsFor(orgA)));

    expect(Array.isArray(body.finding)).toBe(false);
    expect(typeof body.finding).toBe("object");
    expect(body.finding).not.toBeNull();
    expect(JSON.stringify(body.finding)).toContain("Newest finding");
    expect(JSON.stringify(body.finding)).not.toContain("Older finding");

    // The read moved into the status service, which is now its only home: the route
    // ran a SECOND `listForProject(limit 1)` of its own to decide `findingUnavailable`,
    // and a third ran in the status builder to correlate the delivery, so the card,
    // the fault sentence and the delivery line could describe different rows (B-038).
    expect(readRouteSource(STATUS)).not.toContain("listForProject");

    // The THIRD former reader. Re-adding a finding read to the status builder passed
    // every other row on this branch.
    const builder = readFileSync(
      path.join(import.meta.dir, "../../../lib/first-run/status.ts"),
      "utf8",
    );
    expect(builder).not.toContain("listForProject");
    expect(builder).not.toContain("createFindingsRepo");

    const service = readFileSync(
      path.join(
        import.meta.dir,
        "../../../../../packages/db/src/services/first-run-status.service.ts",
      ),
      "utf8",
    );

    expect(service).toContain("listForProject");
    expect(service).toMatch(/limit:\s*1\b/);
    expect([...service.matchAll(/listForProject/g)]).toHaveLength(1);
  });

  test("a finding row whose jsonb fails the boundary parse yields a named degraded render, never a 500", async () => {
    const handle = await loadRouteHandler(STATUS);

    const healthy = await bodyOf(await handle(routeRequest(STATUS), depsFor(orgB)));

    const run = await seedAnalysisRun(bed.db, { ctx: orgB.ctx, projectId: await projectFor(orgB) });
    await bed.db.insert(schema.findings).values({
      organizationId: orgB.organizationId,
      projectId: await projectFor(orgB),
      runId: run.id,
      signature: randomUUID(),
      signatureVersion: 1,
      summarySource: "model_rendered",
      headline: "A row written by an older shape",

      context: "one blob that was never a string[]",
      finalClass: "funnel_dropoff",
      surface: "/checkout",
      surfaceNormalisationVersion: 1,
      counts: [{ numerator: 1 }],
      confidenceBasis: "few_sessions",
      windowStart: new Date("2026-07-30T00:00:00.000Z"),
      windowEnd: new Date("2026-08-01T00:00:00.000Z"),
      evidenceShape: "shape-v0",
      evidenceShapeVersion: 0,
      resolvedModelId: "model-fixture",
    });

    const response = await handle(routeRequest(STATUS), depsFor(orgB));

    expect(response.status).toBe(200);

    const body = await bodyOf(response);

    expect(body.finding).toBeNull();

    // The flag itself, not merely "the payload differs from the healthy one" — which
    // would pass for any other differing field, and was the only thing asserting this
    // wire end to end (B-038).
    expect(body.findingUnavailable).toBe(true);
    expect(healthy.findingUnavailable).toBe(false);

    expect(body).not.toEqual(healthy);

    const serialized = JSON.stringify(body);
    for (const leak of ["ZodError", "SyntaxError", "Invalid input", "expected array", "stack"]) {
      expect(serialized).not.toContain(leak);
    }
    expect(serialized).not.toMatch(/:\d+:\d+/);
  });

  test("an unknown body key rejects with a 4xx, never a 500", async () => {
    const schemaUnderTest = await loadRouteInputSchema(STATUS);
    const verdict = verifyRefusesUnknownKey(schemaUnderTest, {}, "projectId");
    if (!verdict.ok) throw new Error(verdict.why);

    const handle = await loadRouteHandler(STATUS);
    const response = await handle(
      routeRequest(STATUS, undefined, { search: "?projectId=whatever&nonsense=1" }),
      depsFor(orgA),
    );

    expect(response.status).toBeLessThan(500);
  });

  test("the response carries no expectedLag anywhere", async () => {
    const handle = await loadRouteHandler(STATUS);
    const body = await bodyOf(await handle(routeRequest(STATUS), depsFor(orgA)));

    const strings = collectStrings(body);
    expect(strings).not.toContain("expectedLag");
    expect(JSON.stringify(body)).not.toContain("expectedLag");

    for (const value of strings) {
      expect(value).not.toMatch(/\b\d+\s*(seconds?|secs?|minutes?|mins?)\b/i);
    }

    const sentences = new Set(Object.values(CONNECTION_STATE_MESSAGES));
    expect(strings.some((value) => sentences.has(value))).toBe(true);
  });

  test("the response carries no credential in any encoding", async () => {
    await seedConnectionWithSecret(orgA.organizationId, await projectFor(orgA));
    const handle = await loadRouteHandler(STATUS);
    const response = await handle(routeRequest(STATUS), depsFor(orgA));
    const raw = await response.clone().text();

    const found = leaks(raw, SEEDED_CIPHERTEXT_SECRET);
    expect(found).toBeNull();

    expect(raw).not.toContain("credentialCiphertext");
    expect(raw).not.toContain("credential_ciphertext");
    expect(raw).not.toContain("credentialKeyId");
  });
});

describe("GET /api/first-run/status — a finding whose persisted text is held (O-021)", () => {
  test("a persisted finding with a planted PII offender returns findingUnavailable true and no dirty text, driven through the real route handler", async () => {
    const handle = await loadRouteHandler(STATUS);
    const arm = await loadRouteHandler(ARM);
    const scope = await bed.member("pii-held");
    const projectId = await projectFor(scope);

    await arm(routeRequest(ARM, {}), depsFor(scope));

    const healthy = await bodyOf(await handle(routeRequest(STATUS), depsFor(scope)));
    expect(healthy.findingUnavailable).toBe(false);
    expect(Date.parse(String(healthy.armedAt))).toBeLessThan(AFTER_ARMED_AT.getTime());

    const seed = await loadSeedUnscannedFinding();
    const run = await seedAnalysisRun(bed.db, { ctx: scope.ctx, projectId });

    await seed(bed.db, {
      ctx: scope.ctx,
      projectId,
      runId: run.id,
      signature: randomUUID(),
      headline: `A visitor typed ${PII_OFFENDER} into the box and left.`,
      context: ["One line of context, never a blob."],
      surface: "/checkout",
      counts: [MEASURED_COUNT],
      windowStart: new Date("2026-07-30T00:00:00.000Z"),
      windowEnd: new Date("2026-08-01T00:00:00.000Z"),
      createdAt: AFTER_ARMED_AT,
    });

    const response = await handle(routeRequest(STATUS), depsFor(scope));

    expect(response.status).toBe(200);

    const body = await bodyOf(response);

    expect(body.findingUnavailable).toBe(true);
    expect(body.finding).toBeNull();
    expect(JSON.stringify(body)).not.toContain(PII_OFFENDER);
  });
});

const AGENT_PROVIDER_COUNT = 5;

async function mintKeyFor(scope: SeededMemberScope, name: string): Promise<string> {
  const minted = await createApiKeysRepo(bed.db, scope.ctx).mint({ name });
  return minted.raw;
}

async function keyRowsFor(organizationId: string): Promise<Record<string, unknown>[]> {
  const result = (await bed.db.execute(
    `select id, name, key_hash, key_prefix from api_keys where organization_id = '${organizationId}'`,
  )) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

// D-3's column. Absent until the 0015 migration lands, so this names itself
// rather than surfacing as an opaque SQL error.
async function stampEveryKeyOf(organizationId: string): Promise<void> {
  try {
    await bed.db.execute(
      `update api_keys set last_used_at = now() where organization_id = '${organizationId}'`,
    );
  } catch (error) {
    throw new Error(
      `NOT IMPLEMENTED YET: api_keys carries no last_used_at column, so first contact cannot be ` +
        `stamped. ADD O-026 D-3 (packages/db/src/schema/api-keys.ts + migration 0015) owns it. ` +
        `This is a Wave 0 red for the RIGHT reason.`,
      { cause: error },
    );
  }
}

function agentConnectionOf(body: Record<string, unknown>): unknown {
  return body.agentConnection;
}

describe("GET /api/first-run/status — the agent panel's payload (D-6, AC-36)", () => {
  test("carries mcpUrl, agentConnection and agentProviderOrder as required fields on a fresh org", async () => {
    const handle = await loadRouteHandler(STATUS);
    const fresh = await bed.member("agent-fresh");

    const body = await bodyOf(await handle(routeRequest(STATUS), depsFor(fresh)));

    expect(typeof body.mcpUrl).toBe("string");
    expect(String(body.mcpUrl).length).toBeGreaterThan(0);

    expect(agentConnectionOf(body)).toEqual({ kind: "none" });

    expect(Array.isArray(body.agentProviderOrder)).toBe(true);
    expect(body.agentProviderOrder as readonly string[]).toHaveLength(AGENT_PROVIDER_COUNT);
  });

  test("never carries raw key material, a key hash, a prefix, an id or a name (AC-3, AC-46)", async () => {
    const handle = await loadRouteHandler(STATUS);
    const scope = await bed.member("agent-secrecy");

    const raw = await mintKeyFor(scope, "Cursor (2026-08-04)");

    const response = await handle(routeRequest(STATUS), depsFor(scope));
    const body = await bodyOf(response);

    // The precondition: a live key with no stamp reads waiting, so the payload
    // is provably describing this key when the leak scan runs.
    expect(agentConnectionOf(body)).toEqual({ kind: "waiting" });

    const serialized = JSON.stringify(body);
    expect(leaks(serialized, raw)).toBeNull();

    const rows = await keyRowsFor(scope.organizationId);
    for (const column of ["id", "name", "key_hash", "key_prefix"] as const) {
      const value = String(rows[0]?.[column]);
      expect(`${column} leaked: ${serialized.includes(value)}`).toBe(`${column} leaked: false`);
    }
    expect(serialized).not.toContain("keyHash");
    expect(serialized).not.toContain("key_hash");
  });

  test("reads connected for a teammate who minted nothing (AC-19, D1/D2)", async () => {
    const handle = await loadRouteHandler(STATUS);
    const minter = await bed.member("agent-minter");
    const teammate = await bed.member("agent-teammate", minter.organizationId);

    await mintKeyFor(minter, "Codex (2026-08-04)");
    await stampEveryKeyOf(minter.organizationId);

    const body = await bodyOf(await handle(routeRequest(STATUS), depsFor(teammate)));

    expect(agentConnectionOf(body)).toEqual({ kind: "connected" });
  });

  test("reads none for a member of another org, with nothing of theirs in the payload (AC-20, D7)", async () => {
    const handle = await loadRouteHandler(STATUS);
    const connected = await bed.member("agent-other-connected");
    const outsider = await bed.member("agent-outsider");

    const raw = await mintKeyFor(connected, "Windsurf (2026-08-04)");
    await stampEveryKeyOf(connected.organizationId);

    const body = await bodyOf(await handle(routeRequest(STATUS), depsFor(outsider)));

    expect(agentConnectionOf(body)).toEqual({ kind: "none" });

    const serialized = JSON.stringify(body);
    expect(leaks(serialized, raw)).toBeNull();
    expect(serialized).not.toContain(connected.organizationId);

    const rows = await keyRowsFor(connected.organizationId);
    for (const column of ["id", "name", "key_prefix"] as const) {
      const value = String(rows[0]?.[column]);
      expect(`${column} leaked: ${serialized.includes(value)}`).toBe(`${column} leaked: false`);
    }
  });
});
