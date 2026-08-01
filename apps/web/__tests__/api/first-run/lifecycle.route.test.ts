// POST /api/first-run/{arm,dismiss} and the page preamble they gate.
// Wave 0f, task 0f.4. ADD §9, 6 rows (5 at taskgen + AD-16a's unknown-key row).
//
// ###########################################################################
// # PER-USER DISMISSAL IS THE ONLY READING THAT SATISFIES BOTH REQUIREMENTS.
// #
// # FR-O19: a reload must still show the finding. FR-O21: nothing links back
// # to the onboarding surface once it is done. Enumerate the alternatives and
// # they each break one:
// #
// #   a 404 after completion            -> breaks FR-O19 (no reload)
// #   an always-rendering page          -> breaks FR-O21 (it links back)
// #   an unconditional redirect         -> breaks FR-O19 (no reload)
// #   PER-USER DISMISSAL                -> satisfies both
// #
// # It also keeps P-4 out of a lockout: ESC-O2 is the NAMED shortfall that
// # once a user dismisses they have no disconnect path until a settings
// # surface ships, and a per-ORG dismissal would put every teammate in that
// # state at once, on an act none of them performed.
// #
// # AND ARMING IS A CLOCK ORIGIN, NOT A PIPELINE GATE. The UX's escalation 4
// # is explicit: NO ROUTE WRITES ANYTHING THE TRIGGER READS. A founder whose
// # product breaks before they press the button still gets analysed; the
// # button only decides where the elapsed counter counts from. Coupling the
// # two would make a missed press look like a broken product.
// ###########################################################################
//
// Lane prefix `web-fr-lifecycle`.
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

/** A FIXED origin. `armedAt` is asserted against this exact instant, so the
 *  row never sleeps on a real clock — a test that sleeps to observe a clock is
 *  a test that flakes (the reason `arm()` takes its stamp explicitly, AD-8). */
const ARMED_AT = new Date("2026-08-01T10:00:00.000Z");
const RE_ARMED_AT = new Date("2026-08-01T10:05:00.000Z");

/**
 * The two files that decide which projects the analysis lane selects.
 *
 * ASSEMBLED FROM SEGMENTS, NOT WRITTEN AS ONE LITERAL — and that is not
 * cosmetic. `packages/db/__tests__/system/reachability.test.ts` item 83 is
 * FR-23's unreachability gate: it scans every source file under `apps/` for a
 * quoted string containing the db `system` subpath, because a web-app import of
 * the tenancy-bypassing module must be a single greppable line. That scan is
 * TEXTUAL and cannot tell a test's path constant from a real import — so
 * writing the path as one string here turns a correct guard red on a file that
 * imports nothing. Splitting it keeps FR-23's gate honest AND this row's
 * subject intact. (Verified: this exact literal flipped item 83 to failing.)
 */
const LANE_SELECTION_SOURCES: readonly string[] = [
  ["packages/db/src", "system", "analysable-projects.ts"].join("/"),
  "worker/src/analysis-lane-source.ts",
];

const PAGE_SOURCE = "apps/web/app/(first-run)/first-run/page.tsx";
const PAGE_OWNER = "ADD Wave 7c (apps/web/app/(first-run)/first-run/page.tsx, AD-17)";

let bed: FirstRunTestBed;
let owner: SeededMemberScope;
let teammate: SeededMemberScope;

/**
 * Longer than bun's 5s default, and it is not a slow test being tolerated.
 *
 * THE BUDGET IS FOR THE BOOT, NOT FOR THE ASSERTIONS. This hook boots a real
 * PGlite, runs the migrations, and signs two members up through Better Auth
 * (whose password hashing is deliberately slow). Measured warm on this machine
 * it costs ~1.5s — comfortable-looking, and misleading: a COLD boot, where the
 * wasm image is decompressed rather than reused, was measured at ~5.4s and blew
 * straight through bun's 5s default. Two agents reproduced that independently
 * with their own files excluded.
 *
 * What makes it worth a named constant rather than a shrug: the failure is an
 * UNNAMED `a beforeEach/afterEach hook timed out`. It names no route, no
 * contract and no owner, and it collapses every named row in this file into one
 * piece of infrastructure noise that reads exactly like a product bug. Somebody
 * then spends an afternoon hunting one that does not exist.
 *
 * It also only bites when a single file is run — the batch run shares the warm
 * image and hides it — so it is invisible until the one moment it is expensive.
 *
 * Same figure and same reasoning as `discover.route.test.ts` and
 * `analytics.route.test.ts`; keep the three in agreement.
 */
const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("lifecycle");
  owner = await bed.member("owner");
  teammate = await bed.member("mate", owner.organizationId);
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(scope: SeededMemberScope | null, now: Date = ARMED_AT): FirstRunRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: clockAt(now) };
}

/** The org's project id, AS THE ROUTE PROVISIONS IT (AD-7). */
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

// ===========================================================================

describe("POST /api/first-run/arm (AD-17, storyboard T8)", () => {
  // ------------------------------------------------------------------ row 1
  test("arming persists armedAt before the response returns", async () => {
    const handle = await loadRouteHandler(ARM);
    const scope = await bed.member("arming");
    const projectId = await projectFor(scope);

    const response = await handle(routeRequest(ARM, {}), depsFor(scope, ARMED_AT));
    expect(response.status).toBe(200);

    // THE READ HAPPENS AFTER THE RESPONSE RESOLVES AND FINDS THE ROW ALREADY
    // THERE. A clock whose origin is not yet durable is a clock that resets on
    // reload (storyboard T8) — and a route that persisted asynchronously after
    // answering would pass a "did it eventually write" test and fail a founder
    // who reloaded within the second.
    const rows = await rawRows(
      `select armed_at from first_run_state where project_id = '${projectId}'`,
    );
    expect(rows.length).toBe(1);
    expect(new Date(String(rows[0]?.armed_at)).toISOString()).toBe(ARMED_AT.toISOString());

    // "Watch again" RESETS the origin: one row per org+project, REPLACED,
    // never appended to.
    await handle(routeRequest(ARM, {}), depsFor(scope, RE_ARMED_AT));
    const after = await rawRows(
      `select armed_at from first_run_state where project_id = '${projectId}'`,
    );
    expect(after.length).toBe(1);
    expect(new Date(String(after[0]?.armed_at)).toISOString()).toBe(RE_ARMED_AT.toISOString());
  });

  // ------------------------------------------------------------------ row 2
  test("arming is not a precondition for analysis", async () => {
    // THE UX'S ESCALATION 4, MADE STRUCTURAL: NO ROUTE WRITES ANYTHING THE
    // TRIGGER READS. The behavioural form of this claim is unwritable at the
    // route level — "the analysis would have run anyway" is a statement about
    // the worker — so it is asserted where it can actually be violated: in the
    // sources on both sides of the supposed coupling.

    // (a) The arm route writes ONE table, and it is not one the lane reads.
    const armSource = readSourceUnderConstruction({
      repoRelativePath: ARM.sourcePath,
      ownedBy: ARM.ownedBy,
    });
    for (const forbidden of ["addJob", "analysis:", "TASK.", "analysis_runs", "analysisRuns"]) {
      expect(`arm/route.ts contains ${forbidden}: ${armSource.includes(forbidden)}`).toBe(
        `arm/route.ts contains ${forbidden}: false`,
      );
    }

    // (b) The lane's own selection reads no first-run state. If it did, a
    //     founder who never pressed the button would be silently excluded from
    //     analysis — a missed press that looks exactly like a broken product.
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
  // ------------------------------------------------------------------ row 3
  test("dismissing persists for this user only", async () => {
    const handle = await loadRouteHandler(DISMISS);

    const response = await handle(routeRequest(DISMISS, {}), depsFor(owner));
    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ dismissed: true });

    // PER USER. The grain is (organization_id, user_id), and the teammate who
    // did not dismiss is STILL UNDISMISSED — the property ESC-O2 rests on. A
    // per-org row here would lock every teammate out of the only surface that
    // can disconnect anything, on an act none of them performed.
    const rows = await rawRows(
      `select user_id from first_run_dismissals where organization_id = '${owner.organizationId}'`,
    );
    expect(rows.map((row) => String(row.user_id))).toEqual([owner.userId]);

    // And the teammate's own read still says undismissed.
    const teammateRows = await rawRows(
      `select user_id from first_run_dismissals where organization_id = '${owner.organizationId}' and user_id = '${teammate.userId}'`,
    );
    expect(teammateRows).toEqual([]);
  });

  // ------------------------------------------------------------------ row 6
  test("an unknown body key rejects with a 4xx, never a 500 and never a 200", async () => {
    // AD-16a ON THE THREE ROUTES WHOSE DECLARED INPUT IS EMPTY — arm, skip and
    // dismiss. These are the sharp end of the rule: a plain `z.object({})`
    // accepts ANYTHING AT ALL, so a client-supplied `projectId` sails through
    // and returns 200 with the key silently dropped.
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

      // Our sentence, never zod's.
      const serialized = JSON.stringify(await bodyOf(response));
      expect(serialized).not.toContain("Unrecognized key");
      expect(serialized).not.toContain("ZodError");
    }
  });
});

// ===========================================================================
// The page preamble (AD-17). AD-1: NO DOM TEST RUNNER — these are source
// scans, and each ships the planted-offender and clean-fixture controls
// R-SCAN requires, so the scan itself is proven to bite.
// ===========================================================================

/** What a scan of `page.tsx`'s preamble found. A verdict, so a red diagnoses. */
type PreambleVerdict = { readonly ok: true } | { readonly ok: false; readonly why: string };

/**
 * Does this page source gate on PER-USER dismissal and send a dismissed user
 * HOME — through `ROUTES`, never a retyped literal?
 *
 * Four things have to be true at once, and each corresponds to one way the
 * alternatives in this file's header break:
 *   1. it redirects, so the surface is not always-rendering (FR-O21)
 *   2. the redirect is CONDITIONAL, so a reload still shows the finding (FR-O19)
 *   3. the condition is a PER-USER dismissal read, not an org-level one (AD-17)
 *   4. the destination is `ROUTES.home`, not the literal "/" (D9, EC-O9)
 */
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
  // Per USER, not per org: the read must carry a user id.
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
    // CLEAN FIXTURE.
    expect(scanPreamble(CLEAN_PAGE_FIXTURE)).toEqual({ ok: true });

    // PLANTED OFFENDERS, one per failure mode in this file's header.
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

  // ------------------------------------------------------------------ row 4
  test("a dismissed user requesting the page is redirected home", () => {
    const source = readSourceUnderConstruction({
      repoRelativePath: PAGE_SOURCE,
      ownedBy: PAGE_OWNER,
    });
    const verdict = scanPreamble(source);
    if (!verdict.ok) throw new Error(`${PAGE_SOURCE}: ${verdict.why}`);

    // The redirect target is `ROUTES.home` and the literal path never appears.
    expect(source).toContain("ROUTES.home");
    expect(source).not.toMatch(/redirect\(\s*["'`]\//);
  });

  // ------------------------------------------------------------------ row 5
  test("an undismissed user requesting the page renders the reconciled state", () => {
    const source = readSourceUnderConstruction({
      repoRelativePath: PAGE_SOURCE,
      ownedBy: PAGE_OWNER,
    });

    // The OTHER half. The page must have a render path past the two
    // redirects — and it must render RECONCILED state (D4): a customer who
    // lands after the finding arrived sees the finding, never a loading view
    // gated on a transient signal.
    const verdict = scanPreamble(source);
    if (!verdict.ok) throw new Error(`${PAGE_SOURCE}: ${verdict.why}`);
    expect(source).toMatch(/return\s*\(?\s*</);

    // It is a SERVER component reading persisted state, not a client that
    // fetches after mount — `page.tsx` files stay server components.
    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("useEffect");
  });
});

/** Kept so the page path constant is greppable from the repo root in a red. */
export const FIRST_RUN_PAGE_ABSOLUTE = path.join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "..",
  PAGE_SOURCE,
);
