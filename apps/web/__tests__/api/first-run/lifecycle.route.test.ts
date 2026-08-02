import { eq, schema } from "@growthmind/db";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import path from "node:path";

import { readSourceUnderConstruction } from "../../../../../packages/shared/__tests__/onboarding/module-under-construction";
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

const ARM = routeById("arm");
const DISMISS = routeById("dismiss");
const SKIP = routeById("slack-skip");
const STATUS = routeById("status");

const ARMED_AT = new Date("2026-08-01T10:00:00.000Z");
const RE_ARMED_AT = new Date("2026-08-01T10:05:00.000Z");

const LANE_SELECTION_SOURCES: readonly string[] = [
  ["packages/db/src", "system", "analysable-projects.ts"].join("/"),
  "worker/src/analysis-lane-source.ts",
];

const PAGE_SOURCE = "apps/web/app/(first-run)/first-run/page.tsx";
const PAGE_OWNER = "ADD Wave 7c (apps/web/app/(first-run)/first-run/page.tsx, AD-17)";

let bed: FirstRunTestBed;
let owner: SeededMemberScope;
let teammate: SeededMemberScope;

beforeAll(async () => {
  bed = await createFirstRunTestBed("lifecycle");
  owner = await bed.member("owner");
  teammate = await bed.member("mate", owner.organizationId);
});

afterAll(async () => {
  await bed?.close();
});

function depsFor(scope: SeededMemberScope | null, now: Date = ARMED_AT): FirstRunRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: clockAt(now) };
}

const provisioned = new Map<string, Promise<string>>();
function projectFor(scope: SeededMemberScope): Promise<string> {
  const existing = provisioned.get(scope.organizationId);
  if (existing) return existing;
  const pending = (async () => {
    const handle = await loadRouteHandler(STATUS);
    await handle(routeRequest(STATUS), depsFor(scope));
    const rows = await bed.db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, scope.organizationId));
    if (rows.length !== 1) {
      throw new Error(
        `expected the first-run routes to provision EXACTLY ONE project per org (FR-O1, AD-7), found ${rows.length}`,
      );
    }
    return rows[0]!.id;
  })();
  provisioned.set(scope.organizationId, pending);
  return pending;
}

async function rawRows(query: string): Promise<Record<string, unknown>[]> {
  const result = (await bed.db.execute(query)) as unknown as
    { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

describe("POST /api/first-run/arm (AD-17, storyboard T8)", () => {
  test("arming persists armedAt before the response returns", async () => {
    const handle = await loadRouteHandler(ARM);
    const scope = await bed.member("arming");
    const projectId = await projectFor(scope);

    const response = await handle(routeRequest(ARM, {}), depsFor(scope, ARMED_AT));
    expect(response.status).toBe(200);

    const rows = await rawRows(
      `select armed_at from first_run_state where project_id = '${projectId}'`,
    );
    expect(rows.length).toBe(1);
    expect(new Date(String(rows[0]?.armed_at)).toISOString()).toBe(ARMED_AT.toISOString());

    await handle(routeRequest(ARM, {}), depsFor(scope, RE_ARMED_AT));
    const after = await rawRows(
      `select armed_at from first_run_state where project_id = '${projectId}'`,
    );
    expect(after.length).toBe(1);
    expect(new Date(String(after[0]?.armed_at)).toISOString()).toBe(RE_ARMED_AT.toISOString());
  });

  test("arming is not a precondition for analysis", async () => {
    const armSource = readSourceUnderConstruction({
      repoRelativePath: ARM.sourcePath,
      ownedBy: ARM.ownedBy,
    });
    for (const forbidden of ["addJob", "analysis:", "TASK.", "analysis_runs", "analysisRuns"]) {
      expect(`arm/route.ts contains ${forbidden}: ${armSource.includes(forbidden)}`).toBe(
        `arm/route.ts contains ${forbidden}: false`,
      );
    }

    for (const laneFile of LANE_SELECTION_SOURCES) {
      const source = readSourceUnderConstruction({
        repoRelativePath: laneFile,
        ownedBy: "ADD Wave 5 (the analysis lane) — already shipped where present",
      });
      for (const forbidden of ["first_run_state", "firstRunState", "armed_at", "armedAt"]) {
        expect(`${laneFile} contains ${forbidden}: ${source.includes(forbidden)}`).toBe(
          `${laneFile} contains ${forbidden}: false`,
        );
      }
    }
  });
});

describe("POST /api/first-run/dismiss (AD-17, ESC-O2)", () => {
  test("dismissing persists for this user only", async () => {
    const handle = await loadRouteHandler(DISMISS);

    const response = await handle(routeRequest(DISMISS, {}), depsFor(owner));
    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ dismissed: true });

    const rows = await rawRows(
      `select user_id from first_run_dismissals where organization_id = '${owner.organizationId}'`,
    );
    expect(rows.map((row) => String(row.user_id))).toEqual([owner.userId]);

    const teammateRows = await rawRows(
      `select user_id from first_run_dismissals where organization_id = '${owner.organizationId}' and user_id = '${teammate.userId}'`,
    );
    expect(teammateRows).toEqual([]);
  });

  test("an unknown body key rejects with a 4xx, never a 500 and never a 200", async () => {
    for (const route of [ARM, DISMISS, SKIP]) {
      const schemaUnderTest = await loadRouteInputSchema(route);
      const verdict = verifyRefusesUnknownKey(schemaUnderTest, {}, "projectId");
      if (!verdict.ok) throw new Error(`${route.path}: ${verdict.why}`);

      const handle = await loadRouteHandler(route);
      const response = await handle(
        routeRequest(route, { projectId: "someone-elses-project" }),
        depsFor(owner),
      );
      expect(`${route.id}:${response.status}`).toBe(`${route.id}:400`);

      const serialized = JSON.stringify(await bodyOf(response));
      expect(serialized).not.toContain("Unrecognized key");
      expect(serialized).not.toContain("ZodError");
    }
  });
});

type PreambleVerdict = { readonly ok: true } | { readonly ok: false; readonly why: string };

function scanPreamble(source: string): PreambleVerdict {
  if (!source.includes("redirect(")) {
    return {
      ok: false,
      why: "the page never redirects — an always-rendering surface breaks FR-O21",
    };
  }
  if (!/ROUTES\.home/.test(source)) {
    return {
      ok: false,
      why: 'the dismissed branch does not send the user to ROUTES.home (a retyped "/" is a silent dead redirect, D9)',
    };
  }
  if (!/ROUTES\.signIn/.test(source)) {
    return {
      ok: false,
      why: "no tenant-context branch: a signed-out caller must reach ROUTES.signIn",
    };
  }
  if (!/isDismissed|dismissed/i.test(source)) {
    return {
      ok: false,
      why: "the redirect is not gated on a dismissal read — an unconditional redirect breaks FR-O19 (a reload must show the finding)",
    };
  }

  if (!/isDismissed\s*\(\s*[^)]*user/i.test(source)) {
    return {
      ok: false,
      why: "the dismissal read does not name a user — a per-org dismissal locks every teammate out on an act none of them performed (AD-17, ESC-O2)",
    };
  }
  return { ok: true };
}

const CLEAN_PAGE_FIXTURE = `
  const ctx = await getTenantContext();
  if (!ctx) redirect(ROUTES.signIn);
  const dismissed = await repo.isDismissed(ctx.userId);
  if (dismissed) redirect(ROUTES.home);
  return <FirstRunClient status={status} />;
`;

describe("the first-run page preamble (AD-17, AD-1 — source scans with controls)", () => {
  test("CONTROL: the preamble scan accepts a correct page and rejects each way of getting it wrong", () => {
    expect(scanPreamble(CLEAN_PAGE_FIXTURE)).toEqual({ ok: true });

    const offenders: readonly (readonly [string, string])[] = [
      ["always renders", "return <FirstRunClient status={status} />;"],
      [
        "unconditional redirect",
        "const ctx = await getTenantContext();\nif (!ctx) redirect(ROUTES.signIn);\nredirect(ROUTES.home);",
      ],
      [
        "retyped literal",
        'const ctx = await getTenantContext();\nif (!ctx) redirect(ROUTES.signIn);\nif (await repo.isDismissed(ctx.userId)) redirect("/");',
      ],
      [
        "per-org dismissal",
        "const ctx = await getTenantContext();\nif (!ctx) redirect(ROUTES.signIn);\nif (await repo.isDismissed(ctx.organizationId)) redirect(ROUTES.home);",
      ],
    ];

    for (const [label, source] of offenders) {
      const verdict = scanPreamble(source);
      expect(`${label}: ${verdict.ok}`).toBe(`${label}: false`);
    }
  });

  test("a dismissed user requesting the page is redirected home", () => {
    const source = readSourceUnderConstruction({
      repoRelativePath: PAGE_SOURCE,
      ownedBy: PAGE_OWNER,
    });
    const verdict = scanPreamble(source);
    if (!verdict.ok) throw new Error(`${PAGE_SOURCE}: ${verdict.why}`);

    expect(source).toContain("ROUTES.home");
    expect(source).not.toMatch(/redirect\(\s*["'`]\//);
  });

  test("an undismissed user requesting the page renders the reconciled state", () => {
    const source = readSourceUnderConstruction({
      repoRelativePath: PAGE_SOURCE,
      ownedBy: PAGE_OWNER,
    });

    const verdict = scanPreamble(source);
    if (!verdict.ok) throw new Error(`${PAGE_SOURCE}: ${verdict.why}`);
    expect(source).toMatch(/return\s*\(?\s*</);

    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("useEffect");
  });
});

export const FIRST_RUN_PAGE_ABSOLUTE = path.join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "..",
  PAGE_SOURCE,
);
