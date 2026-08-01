// GET /api/first-run/status — the one payload the whole surface reconciles
// against. Wave 0f, task 0f.1. ADD §9, 10 rows (8 at taskgen + AD-16a's two).
//
// ###########################################################################
// # THIS FILE CARRIES THE TENANCY BLOCK FOR ALL EIGHT ROUTES, AND ONE OF ITS
// # ROWS IS THE ONLY THING STANDING BETWEEN THIS SPRINT AND A D7 HOLE WITH A
// # PASSING SUITE IN FRONT OF IT.
// #
// # AD-16 says no first-run route accepts a `projectId` or an
// # `organizationId`, "and a test proves it by enumeration". Wave 0a measured
// # that the enumeration cannot:
// #
// #     z.object       + projectId -> success=true  data={"stepId":"…"}  200
// #     z.strictObject + projectId -> success=false code=unrecognized_keys 400
// #     Object.keys(shape) — IDENTICAL for both
// #
// # The repo has ZERO uses of `.strict()` today. An implementer copying the
// # nearest neighbour ships eight plain `z.object()` routes that accept a
// # client-supplied tenancy id, drop it, and answer 200 — with every
// # enumeration row green. So the enumeration row below is explicitly labelled
// # SHAPE ONLY, and it is followed by two BEHAVIOURAL rows that parse a real
// # body through every schema and assert `issue.code === "unrecognized_keys"`.
// #
// # AND THE DETECTOR ITSELF IS PROVEN. Three CONTROLS at the top of this file
// # run `verifyRefusesUnknownKey` against a REAL plain `z.object()`, a REAL
// # `z.strictObject()` and a REAL `.strict()`, and assert the first FAILS and
// # the other two PASS. A strictness check nobody ran against a real offender
// # is a strictness check nobody has. Those three are the only assertions in
// # this file expected to pass on the Wave 0 tree, and they are labelled.
// ###########################################################################
//
// Lane prefix `web-fr-status`.
import { createFindingsRepo, schema, type MeasuredCountRow } from "@growthmind/db";
import { CONNECTION_STATE_MESSAGES } from "@growthmind/shared";
import { eq } from "drizzle-orm";
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

/** Seeded into a `project_connections` row so the credential scan has a real
 *  needle. Fixture-shaped, never usable key material — this repo is public. */
const SEEDED_CIPHERTEXT_SECRET = "s3cret-onboarding-status-envelope-payload";

let bed: FirstRunTestBed;
let orgA: SeededMemberScope;
let orgB: SeededMemberScope;

beforeAll(async () => {
  // ONLY what exists on this tree. Provisioning a project needs the route,
  // which does not — so it is resolved lazily, inside the rows that need it.
  // A `beforeAll` that threw would replace every row's own named diagnostic
  // with one shared hook failure, and would take the three CONTROLS down with
  // it: exactly the misleading red `module-under-construction.ts` exists to
  // abolish, moved into the fixture.
  bed = await createFirstRunTestBed("status");
  orgA = await bed.member("a");
  orgB = await bed.member("b");
});

afterAll(async () => {
  await bed?.close();
});

const provisioned = new Map<string, Promise<string>>();

/** Memoized: the route provisions once per org, every row reads the same id. */
function projectFor(scope: SeededMemberScope): Promise<string> {
  const existing = provisioned.get(scope.organizationId);
  if (existing) return existing;
  const pending = provisionedProjectFor(scope);
  provisioned.set(scope.organizationId, pending);
  return pending;
}

/**
 * The org's project id, AS THE ROUTE PROVISIONS IT.
 *
 * DELIBERATELY NOT A SEEDED ROW, and the reason is a greenability trap rather
 * than a style preference. AD-7 gives `ensureProject` a `provisioning_key`
 * column set to the literal `org:<organizationId>` and set ONLY by the
 * automatic first-run path — a column ADD Wave 3's migration adds and which
 * therefore cannot be written by a fixture on THIS tree. A hand-seeded
 * `projects` row carries no such key, so `ensureProject` would not recognise
 * it and would provision a SECOND project beside it. Every row below would
 * then seed against one project and assert against another: red on the Wave 0
 * tree for the right reason, and still red after Wave 6 landed, for a reason
 * nobody could see.
 *
 * So the route provisions, and the fixture reads back what it provisioned.
 */
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

/**
 * A `project_connections` row whose stored envelope carries a known needle.
 *
 * Inserted directly rather than through `seedConnection`, which hardcodes its
 * ciphertext — this row exists so `the response carries no credential in any
 * encoding` has something real to look for.
 */
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

/** One count, in the shape `measuredCountRowSchema` actually declares — the
 *  full row, not the three fields the onboarding view narrows it to. */
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

/** A real `findings` row through the real repository. */
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

/** The `deps` every row hands the handler. Carries NO project and NO org id. */
function depsFor(scope: SeededMemberScope | null) {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK };
}

// ===========================================================================
// CONTROLS — not §9 rows. These prove the strictness detector BITES.
// They are the only assertions in this file expected to PASS on this tree.
// ===========================================================================

describe("CONTROL — the strictness prober, run against real zod (AD-16a)", () => {
  test("CONTROL: a plain z.object() FAILS the prober — it accepts and strips a projectId", () => {
    const verdict = verifyRefusesUnknownKey(plainObjectControl(), CONTROL_VALID_BODY, "projectId");

    // THE PLANTED OFFENDER. If this ever reports `ok: true`, every strictness
    // row below is vacuous and the eight routes can ship non-strict unnoticed.
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
      // Measured trap 1: the names are on `issue.keys`, never on `issue.path`.
      expect(verdict.keys).toEqual(["projectId"]);
    }
  });

  test("CONTROL: Object.keys(shape) is identical for all three — enumeration cannot enforce", () => {
    const plain = enumerateShapeKeys(plainObjectControl());
    const strict = enumerateShapeKeys(strictObjectControl());
    const dotted = enumerateShapeKeys(dotStrictControl());

    // The measured fact AD-16a rests on, pinned so a zod bump that changed it
    // would surface here rather than as a silently weaker guarantee.
    expect(plain).toEqual(["stepId"]);
    expect(strict).toEqual(plain);
    expect(dotted).toEqual(plain);
  });
});

// ===========================================================================
// AD-16 / AD-16a — the tenancy block. One test, all eight schemas.
// ===========================================================================

describe("no first-run route accepts a tenancy id (AD-16, AD-16a)", () => {
  // ------------------------------------------------------------------ row 2
  test("the route accepts no projectId and no organizationId in any input", async () => {
    // SHAPE ONLY. This row DOES NOT STAND ALONE — Wave 0a measured that
    // `Object.keys(shape)` is identical for `z.object` and `z.strictObject`,
    // so a green here says nothing about refusal. The next two rows are the
    // half that bites. Kept because a DECLARED tenancy key is a different,
    // louder defect than a merely-tolerated one.
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

  // ------------------------------------------------------------------ row 3
  test("every first-run route schema refuses a client-supplied projectId or organizationId with unrecognized_keys, never by stripping it", async () => {
    // THE ROW THAT DETECTS A PLAIN z.object(). Enumeration cannot.
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

  // ------------------------------------------------------------------ row 4
  test("every first-run route input schema is constructed strict", async () => {
    // AD-16a's rule directly: a schema whose DECLARED keys are correct but
    // whose constructor is `z.object()` fails HERE, on a key that has nothing
    // to do with tenancy — because the defect is the constructor, not the
    // key list. The six no-input routes are the sharp end: a non-strict
    // `z.object({})` accepts ANYTHING AT ALL.
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
    // AD-16's "that test also catches the next route somebody adds", made
    // mechanical. A new `route.ts` under the first-run API tree with no
    // descriptor here fails, which forces the author to declare its input
    // keys — and the three rows above then run against it automatically.
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

/** Every `route.ts` under a repo-relative directory, repo-relative. */
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

// ===========================================================================
// The status route's own behaviour
// ===========================================================================

describe("GET /api/first-run/status (AD-16, AD-18, AD-3)", () => {
  // ------------------------------------------------------------------ row 1
  test("the route derives its org from the session, never from the request", async () => {
    const handle = await loadRouteHandler(STATUS);
    const arm = await loadRouteHandler(ARM);

    // Arm ONLY org A, so the two orgs have genuinely different answers and a
    // leak would be visible rather than a coincidence of two empty states.
    await arm(routeRequest(ARM, {}), depsFor(orgA));

    // The SAME session, with and without a request that names org B's project.
    const plain = await bodyOf(await handle(routeRequest(STATUS), depsFor(orgA)));
    const withForeignProject = await bodyOf(
      await handle(
        routeRequest(STATUS, undefined, {
          search: `?projectId=${await projectFor(orgB)}&organizationId=${orgB.organizationId}`,
        }),
        depsFor(orgA),
      ),
    );

    // THE REQUEST CHANGES NOTHING. A value that cannot arrive cannot be
    // mis-scoped (AD-16's rationale, at the wire).
    expect(withForeignProject).toEqual(plain);

    // THE SESSION CHANGES EVERYTHING. Same request shape, other tenant,
    // different answer — which is what proves the first assertion is not
    // green because the route returns a constant.
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

  // ------------------------------------------------------------------ row 5
  test("a signed-out caller gets 401, never data and never a 500", async () => {
    const handle = await loadRouteHandler(STATUS);
    const response = await handle(routeRequest(STATUS), depsFor(null));

    expect(response.status).toBe(401);

    // Never a 500, and never data behind the 401: the whole reconciled payload
    // is exactly what a signed-out caller must not receive.
    const body = await bodyOf(response);
    expect(Object.keys(body)).not.toContain("finding");
    expect(Object.keys(body)).not.toContain("counter");
    expect(JSON.stringify(body)).not.toContain("stack");
    expect(JSON.stringify(body)).not.toMatch(/:\d+:\d+/);
  });

  // ------------------------------------------------------------------ row 6
  test("the finding is fetched with limit 1 and returned as a single nullable object", async () => {
    const handle = await loadRouteHandler(STATUS);

    // Nothing persisted yet: `null`, and NOT `[]`. An empty array is the shape
    // a renderer maps over, which is how deviation 1 dies (B5/AD-18).
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

    // A SINGLE NULLABLE OBJECT, NOT AN ARRAY — the structural half of B5.
    expect(Array.isArray(body.finding)).toBe(false);
    expect(typeof body.finding).toBe("object");
    expect(body.finding).not.toBeNull();
    expect(JSON.stringify(body.finding)).toContain("Newest finding");
    expect(JSON.stringify(body.finding)).not.toContain("Older finding");

    // AD-18: "`limit: 1` is enforced IN THE CALL, never in the renderer." The
    // behavioural half above cannot tell a route that asked for one row from
    // one that asked for fifty and rendered the first, so the literal is
    // asserted in the route's own source.
    const source = readRouteSource(STATUS);
    expect(source).toContain("listForProject");
    expect(source).toMatch(/limit:\s*1\b/);
  });

  // ------------------------------------------------------------------ row 7
  test("a finding row whose jsonb fails the boundary parse yields a named degraded render, never a 500", async () => {
    const handle = await loadRouteHandler(STATUS);

    // The healthy no-finding answer, captured BEFORE the bad row exists — the
    // baseline the degraded answer must differ from.
    const healthy = await bodyOf(await handle(routeRequest(STATUS), depsFor(orgB)));

    // D5: prod contains EVERY SHAPE EVER WRITTEN. `findings.repo.ts:166-172`
    // parses both jsonb columns on the way out and THROWS on a shape the
    // current schema never declared — so a legacy row is a real 500 waiting
    // for a route that does not catch it.
    const run = await seedAnalysisRun(bed.db, { ctx: orgB.ctx, projectId: await projectFor(orgB) });
    await bed.db.insert(schema.findings).values({
      organizationId: orgB.organizationId,
      projectId: await projectFor(orgB),
      runId: run.id,
      signature: randomUUID(),
      signatureVersion: 1,
      summarySource: "model_rendered",
      headline: "A row written by an older shape",
      // The legacy shape: a blob where an array of lines is declared.
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

    // NEVER A 500.
    expect(response.status).toBe(200);

    const body = await bodyOf(response);
    // No half-finding: an unreadable row does not become a partly-rendered one.
    expect(body.finding).toBeNull();

    // NAMED, not silent. The degraded answer must be distinguishable from
    // "nothing has been found yet" — a customer told nothing cannot act, and
    // silent degradation is a bug (EC-O5).
    expect(body).not.toEqual(healthy);

    // And named in OUR words, never zod's or the runtime's.
    const serialized = JSON.stringify(body);
    for (const leak of ["ZodError", "SyntaxError", "Invalid input", "expected array", "stack"]) {
      expect(serialized).not.toContain(leak);
    }
    expect(serialized).not.toMatch(/:\d+:\d+/);
  });

  // ------------------------------------------------------------------ row 8
  test("an unknown body key rejects with a 4xx, never a 500", async () => {
    // The status route's declared input is NONE, so its unknown-key surface is
    // its `inputSchema` plus whatever a client can attach to a GET. Both are
    // asserted: the schema refuses (EC-O9/AC-O33), and a query string carrying
    // a tenancy id is neither honoured nor fatal.
    const schemaUnderTest = await loadRouteInputSchema(STATUS);
    const verdict = verifyRefusesUnknownKey(schemaUnderTest, {}, "projectId");
    if (!verdict.ok) throw new Error(verdict.why);

    const handle = await loadRouteHandler(STATUS);
    const response = await handle(
      routeRequest(STATUS, undefined, { search: "?projectId=whatever&nonsense=1" }),
      depsFor(orgA),
    );

    // A 4xx or a clean 200 that ignored it — never a 500.
    expect(response.status).toBeLessThan(500);
  });

  // ------------------------------------------------------------------ row 9
  test("the response carries no expectedLag anywhere", async () => {
    const handle = await loadRouteHandler(STATUS);
    const body = await bodyOf(await handle(routeRequest(STATUS), depsFor(orgA)));

    // R-AD3 AT THE WIRE. `describeExpectedLag` computes
    // `pollIntervalSeconds + 25` and `+ 220`; with the shipped column default
    // of 60 that is "85 seconds… 280 seconds" in front of a customer. The scan
    // is DEEP and includes object keys, because the field reaches the screen
    // through a nested counter object, not a top-level one.
    const strings = collectStrings(body);
    expect(strings).not.toContain("expectedLag");
    expect(JSON.stringify(body)).not.toContain("expectedLag");

    // R-LATENCY: nothing on this wire promises a duration in any form.
    for (const value of strings) {
      expect(value).not.toMatch(/\b\d+\s*(seconds?|secs?|minutes?|mins?)\b/i);
    }

    // A positive control on the scan itself: the response DOES carry the
    // connection-state sentence, so an empty `strings` cannot make the four
    // assertions above vacuously green.
    const sentences = new Set(Object.values(CONNECTION_STATE_MESSAGES));
    expect(strings.some((value) => sentences.has(value))).toBe(true);
  });

  // ----------------------------------------------------------------- row 10
  test("the response carries no credential in any encoding", async () => {
    await seedConnectionWithSecret(orgA.organizationId, await projectFor(orgA));
    const handle = await loadRouteHandler(STATUS);
    const response = await handle(routeRequest(STATUS), depsFor(orgA));
    const raw = await response.clone().text();

    // Not just the verbatim string: URL-encoded, JSON-escaped, base64,
    // base64url, hex and a 12-char prefix. `connections.service.ts:154-165`
    // names why an exact-string scrub is insufficient — a leaky upstream can
    // echo a secret back in a form the scrub never looks for.
    const found = leaks(raw, SEEDED_CIPHERTEXT_SECRET);
    expect(found).toBeNull();

    // The whole envelope column, and the key fingerprint, are equally absent.
    expect(raw).not.toContain("credentialCiphertext");
    expect(raw).not.toContain("credential_ciphertext");
    expect(raw).not.toContain("credentialKeyId");
  });
});
