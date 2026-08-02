import { createFindingsRepo, eq, schema, type MeasuredCountRow } from "@growthmind/db";
import { CONNECTION_STATE_MESSAGES } from "@growthmind/shared";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  enumerateShapeKeys,
  plainObjectControl,
  strictObjectControl,
  dotStrictControl,
  CONTROL_VALID_BODY,
} from "../../../../../packages/shared/__tests__/onboarding/probes/strict-zod-fixtures";
import { seedAnalysisRun } from "../../../../../packages/db/__tests__/helpers/fixtures";
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

beforeAll(async () => {
  bed = await createFirstRunTestBed("status");
  orgA = await bed.member("a");
  orgB = await bed.member("b");
});

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
  const id = randomUUID();
  await bed.db.insert(schema.projectConnections).values({
    id,
    organizationId,
    projectId,
    sourceKind: "posthog",
    host: "https://eu.posthog.example.invalid",
    sourceProjectId: "00000",
    credentialCiphertext: `v1.deadbeef.aaaa.bbbb.${SEEDED_CIPHERTEXT_SECRET}`,
    credentialKeyId: "deadbeef",
    isActive: true,
    health: "healthy",
    watermarkAt: null,
    nextPollAt: new Date(),
    pollIntervalSeconds: 60,
  });
  return id;
}

const MEASURED_COUNT: MeasuredCountRow = {
  numerator: 3,
  denominator: 10,
  unit: "sessions",
  timeframe: {
    start: new Date("2026-07-30T00:00:00.000Z"),
    end: new Date("2026-08-01T00:00:00.000Z"),
  },
  basis: { totalInWindow: 10, kept: 10, setAside: [] },
};

async function seedFinding(
  scope: SeededMemberScope,
  projectId: string,
  overrides: { readonly headline: string; readonly windowEnd: Date },
): Promise<void> {
  const run = await seedAnalysisRun(bed.db, { ctx: scope.ctx, projectId });
  const repo = createFindingsRepo(bed.db, scope.ctx);
  await repo.persist({
    projectId,
    runId: run.id,
    signature: randomUUID(),
    signatureVersion: 1,
    summarySource: "model_rendered",
    headline: overrides.headline,
    context: ["One line of context, never a blob."],
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

    const source = readRouteSource(STATUS);
    expect(source).toContain("listForProject");
    expect(source).toMatch(/limit:\s*1\b/);
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
