// POST /api/settings/pages/role — the only path that produces a role the nightly derivation
// will not write over. Everything the deriver proposes is `confirmedAt: null`; this is where
// a person disagrees with it.
import { createGrowthContextRepo, ensureProject } from "@growthmind/db";
import { URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { FirstRunRouteDeps } from "../../../lib/first-run/deps";
import {
  bodyOf,
  clockAt,
  createFirstRunTestBed,
  loadRouteHandler,
  loadRouteInputSchema,
  routeRequest,
  tenantOf,
  verifyRefusesUnknownKey,
  type FirstRunRouteDescriptor,
  type FirstRunTestBed,
  type SeededMemberScope,
} from "../first-run/helpers/first-run-route-contract";

const CLOCK_AT = new Date("2026-08-04T20:00:00.000Z");
const CLOCK = clockAt(CLOCK_AT);

const KNOWN = "/onboarding/connect";
const MONEY = "/checkout";

const ROLE: FirstRunRouteDescriptor = {
  id: "settings-pages-role",
  path: "/api/settings/pages/role",
  method: "POST",
  modulePath: "apps/web/app/api/settings/pages/role/route",
  sourcePath: "apps/web/app/api/settings/pages/role/route.ts",
  declaredKeys: ["surface", "role", "changeable"],
  validBody: { surface: KNOWN, role: "first_value" },
  ownedBy: "the post-setup control surface",
};

let bed: FirstRunTestBed;

const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("settings-pages-role");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(scope: SeededMemberScope | null): FirstRunRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK };
}

function derived(surface: string) {
  return {
    surface,
    role: "keeps_people" as const,
    basis: "observed_from_behaviour" as const,
    confirmedAt: null,
    normalisationVersion: URL_PATH_NORMALISATION_VERSION,
  };
}

async function projectFor(scope: SeededMemberScope): Promise<string> {
  const { projectId } = await ensureProject(bed.db, scope.ctx);
  return projectId;
}

async function seedRoles(scope: SeededMemberScope, surfaces: readonly string[]): Promise<void> {
  await createGrowthContextRepo(bed.db, scope.ctx).save({
    projectId: await projectFor(scope),
    surfaces: surfaces.map(derived),
    confirmedChangeable: [],
  });
}

async function state(
  scope: SeededMemberScope | null,
  body: Record<string, unknown>,
): Promise<Response> {
  const handle = await loadRouteHandler(ROLE);
  return handle(routeRequest(ROLE, body), depsFor(scope));
}

async function rolesFor(scope: SeededMemberScope) {
  return createGrowthContextRepo(bed.db, scope.ctx).findForProject(await projectFor(scope));
}

describe("POST /api/settings/pages/role", () => {
  test("the body schema is strict and names no tenancy key", async () => {
    const inputSchema = await loadRouteInputSchema(ROLE);

    expect(inputSchema.safeParse({ surface: KNOWN, role: "first_value" }).success).toBe(true);
    expect(
      inputSchema.safeParse({ surface: KNOWN, role: "first_value", organizationId: "org-x" })
        .success,
    ).toBe(false);
  });

  test("refuses a body carrying a tenancy key it does not declare", async () => {
    const inputSchema = await loadRouteInputSchema(ROLE);

    for (const key of ["projectId", "organizationId"]) {
      expect(verifyRefusesUnknownKey(inputSchema, ROLE.validBody, key).ok).toBe(true);
    }
  });

  test("refuses a caller who is not signed in", async () => {
    const response = await state(null, { surface: KNOWN, role: "first_value" });

    expect(response.status).toBe(401);
  });

  test("refuses a role that is not one of the stated ones", async () => {
    const scope = await bed.member("bad-role");
    await seedRoles(scope, [KNOWN]);

    expect((await state(scope, { surface: KNOWN, role: "very_important" })).status).toBe(400);
  });

  test("refuses a page this project has never been seen to have", async () => {
    // Without this any string would mint a roled surface, and a typo would sit in the
    // ranking answering for a page that does not exist.
    const scope = await bed.member("unknown-page");
    await seedRoles(scope, [KNOWN]);

    const response = await state(scope, { surface: "/invented", role: "first_value" });

    expect(response.status).toBe(404);
    expect((await rolesFor(scope))?.bySurface.has("/invented")).toBe(false);
  });

  test("records what a person said, as theirs and not as a guess", async () => {
    const scope = await bed.member("states-it");
    await seedRoles(scope, [KNOWN]);

    const response = await state(scope, { surface: KNOWN, role: "first_value" });
    expect(response.status).toBe(200);
    expect(bodyOf(response)).resolves.toMatchObject({ saved: true });

    const roled = (await rolesFor(scope))?.bySurface.get(KNOWN);

    expect(roled?.role).toBe("first_value");
    expect(roled?.basis).toBe("stated_by_customer");
    expect(roled?.confirmedAt).toEqual(CLOCK_AT);
  });

  test("leaves every other page exactly as it was", async () => {
    // A whole-list write from a page loaded before last night's run would revert everything
    // that run added.
    const scope = await bed.member("leaves-others");
    await seedRoles(scope, [KNOWN, "/reports"]);

    await state(scope, { surface: KNOWN, role: "first_value" });

    const other = (await rolesFor(scope))?.bySurface.get("/reports");

    expect(other?.role).toBe("keeps_people");
    expect(other?.confirmedAt).toBeNull();
  });

  test("takes responsibility for a money page only when asked to", async () => {
    // §5's escape hatch. Nothing derived may set this — only this route, on a person's say.
    const scope = await bed.member("changeable");
    await seedRoles(scope, [MONEY]);

    expect((await rolesFor(scope))?.confirmedChangeable.has(MONEY)).toBe(false);

    await state(scope, { surface: MONEY, role: "makes_money", changeable: true });
    expect((await rolesFor(scope))?.confirmedChangeable.has(MONEY)).toBe(true);

    await state(scope, { surface: MONEY, role: "makes_money", changeable: false });
    expect((await rolesFor(scope))?.confirmedChangeable.has(MONEY)).toBe(false);
  });

  test("does not touch another organization's pages", async () => {
    const mine = await bed.member("tenant-mine");
    const theirs = await bed.member("tenant-theirs");

    await seedRoles(theirs, [KNOWN]);

    // Mine has no such page, so its own project is the only one this can reach.
    expect((await state(mine, { surface: KNOWN, role: "first_value" })).status).toBe(404);

    const untouched = (await rolesFor(theirs))?.bySurface.get(KNOWN);
    expect(untouched?.basis).toBe("observed_from_behaviour");
    expect(untouched?.confirmedAt).toBeNull();
  });
});
