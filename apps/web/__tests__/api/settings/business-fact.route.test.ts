// POST /api/settings/business/fact — a person adding, correcting or removing what this
// business says of itself. `statement: null` is the removal, and the Remove button in
// FactRow is its only caller.
import { createGrowthContextRepo, ensureProject } from "@growthmind/db";
import type { BusinessFact, BusinessFactKind } from "@growthmind/shared";
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

const CLOCK_AT = new Date("2026-08-05T09:00:00.000Z");
const CLOCK = clockAt(CLOCK_AT);

const KIND: BusinessFactKind = "regime";
const OTHER_KIND: BusinessFactKind = "conversion";

const GOING = "Usage beyond the included credits stays off until someone turns it on.";
const KEPT = "Every proposed change waits for a person to approve it.";
const ELSEWHERE = "A trial counts when a second teammate is invited.";

const FACT: FirstRunRouteDescriptor = {
  id: "settings-business-fact",
  path: "/api/settings/business/fact",
  method: "POST",
  modulePath: "apps/web/app/api/settings/business/fact/route",
  sourcePath: "apps/web/app/api/settings/business/fact/route.ts",
  declaredKeys: ["kind", "was", "statement"],
  validBody: { kind: KIND, was: null, statement: GOING },
  ownedBy: "the post-setup control surface",
};

let bed: FirstRunTestBed;

const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("settings-business-fact");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(scope: SeededMemberScope | null): FirstRunRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK };
}

function read(kind: BusinessFactKind, statement: string): BusinessFact {
  return {
    kind,
    statement,
    provenance: {
      source: "site",
      at: CLOCK_AT,
      citation: "https://example.com/terms",
      seen: null,
      statedBy: null,
    },
    correctedFrom: null,
    audience: null,
    confirmation: null,
  };
}

async function projectFor(scope: SeededMemberScope): Promise<string> {
  const { projectId } = await ensureProject(bed.db, scope.ctx);
  return projectId;
}

async function seedFacts(scope: SeededMemberScope, facts: readonly BusinessFact[]): Promise<void> {
  const repo = createGrowthContextRepo(bed.db, scope.ctx);
  const projectId = await projectFor(scope);

  await repo.save({ projectId, surfaces: [], confirmedChangeable: [] });
  await repo.recordResearch({ projectId, facts, researchedAt: CLOCK_AT });
}

async function statementsFor(scope: SeededMemberScope): Promise<readonly string[]> {
  const row = await createGrowthContextRepo(bed.db, scope.ctx).readBusinessResearch(
    await projectFor(scope),
  );

  return (row?.businessContext.facts ?? []).map((fact) => fact.statement);
}

async function state(
  scope: SeededMemberScope | null,
  body: Record<string, unknown>,
): Promise<Response> {
  const handle = await loadRouteHandler(FACT);
  return handle(routeRequest(FACT, body), depsFor(scope));
}

describe("POST /api/settings/business/fact", () => {
  test("the body schema is strict and names no tenancy key", async () => {
    const inputSchema = await loadRouteInputSchema(FACT);

    expect(inputSchema.safeParse(FACT.validBody).success).toBe(true);
    expect(inputSchema.safeParse({ ...FACT.validBody, organizationId: "org-x" }).success).toBe(
      false,
    );
  });

  test("refuses a body carrying a tenancy key it does not declare", async () => {
    const inputSchema = await loadRouteInputSchema(FACT);

    for (const key of ["projectId", "organizationId"]) {
      expect(verifyRefusesUnknownKey(inputSchema, FACT.validBody, key).ok).toBe(true);
    }
  });

  test("refuses a caller who is not signed in", async () => {
    expect((await state(null, { kind: KIND, was: GOING, statement: null })).status).toBe(401);
  });

  test("removes the fact named, and only that one", async () => {
    const scope = await bed.member("removes-one");
    await seedFacts(scope, [read(KIND, GOING), read(KIND, KEPT), read(OTHER_KIND, ELSEWHERE)]);

    const response = await state(scope, { kind: KIND, was: GOING, statement: null });

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toMatchObject({ saved: true, removed: true });

    const left = await statementsFor(scope);

    expect(left).not.toContain(GOING);
    expect(left).toContain(KEPT);
    expect(left).toContain(ELSEWHERE);
  });

  test("a removal survives the next read of the site", async () => {
    // Removal drops the row rather than marking it, so nothing suppresses it — a re-read of
    // the same page would hand a person back the sentence they just deleted.
    const scope = await bed.member("removal-sticks");
    await seedFacts(scope, [read(KIND, GOING)]);

    await state(scope, { kind: KIND, was: GOING, statement: null });

    await createGrowthContextRepo(bed.db, scope.ctx).recordResearch({
      projectId: await projectFor(scope),
      facts: [read(KIND, GOING)],
      researchedAt: CLOCK_AT,
    });

    expect(await statementsFor(scope)).not.toContain(GOING);
  });

  test("typing a removed sentence back in lifts the removal", async () => {
    const scope = await bed.member("changed-their-mind");
    await seedFacts(scope, [read(KIND, GOING)]);

    await state(scope, { kind: KIND, was: GOING, statement: null });
    expect((await state(scope, { kind: KIND, was: null, statement: GOING })).status).toBe(200);

    await createGrowthContextRepo(bed.db, scope.ctx).recordResearch({
      projectId: await projectFor(scope),
      facts: [read(KIND, GOING)],
      researchedAt: CLOCK_AT,
    });

    // Once, not twice: the stated copy stands and the read is still suppressed against it.
    expect((await statementsFor(scope)).filter((line) => line === GOING)).toHaveLength(1);
  });

  test("refuses a removal of a fact that is no longer there", async () => {
    const scope = await bed.member("already-gone");
    await seedFacts(scope, [read(KIND, KEPT)]);

    expect((await state(scope, { kind: KIND, was: GOING, statement: null })).status).toBe(409);
    expect(await statementsFor(scope)).toContain(KEPT);
  });

  test("refuses a removal that names nothing to remove", async () => {
    const scope = await bed.member("removes-nothing");
    await seedFacts(scope, [read(KIND, KEPT)]);

    expect((await state(scope, { kind: KIND, was: null, statement: null })).status).toBe(400);
    expect(await statementsFor(scope)).toContain(KEPT);
  });

  test("does not remove another organization's fact", async () => {
    const mine = await bed.member("tenant-mine");
    const theirs = await bed.member("tenant-theirs");

    await seedFacts(mine, [read(KIND, KEPT)]);
    await seedFacts(theirs, [read(KIND, GOING)]);

    expect((await state(mine, { kind: KIND, was: GOING, statement: null })).status).toBe(409);
    expect(await statementsFor(theirs)).toContain(GOING);
  });
});

// O-036 (AD-4, FR-8): the audience page reuses this route for Correct and Drop, which adds
// two contracts — the O-021 admission seam refuses a person's own PII before any persist,
// and a stated fact carries who typed it.
describe("POST /api/settings/business/fact — audience-page contracts (O-036)", () => {
  const PII = "Our champion is — Jane Smith, reachable at jane.smith@example.com for approvals.";

  test("refuses PII-bearing correction text before any persist", async () => {
    const scope = await bed.member("pii-refused");
    await seedFacts(scope, [read(KIND, KEPT)]);

    const response = await state(scope, { kind: KIND, was: KEPT, statement: PII });

    expect(response.status).toBe(400);

    const body = await bodyOf(response);
    const error = (body.error ?? {}) as Record<string, unknown>;
    const message = typeof error.message === "string" ? error.message : "";

    // Plain English naming what to change — and never echoing the person it refused to keep.
    expect(message).toMatch(/group of people|segment/i);
    expect(message).not.toContain("jane.smith@example.com");
    expect(message).not.toContain("Jane Smith");

    const left = await statementsFor(scope);
    expect(left).toContain(KEPT);
    expect(left).not.toContain(PII);
  });

  test("threads the session user id into the stated fact's provenance as statedBy", async () => {
    const scope = await bed.member("stated-by");
    await seedFacts(scope, [read(KIND, KEPT)]);

    const stated = "Agencies with under ten seats decide inside a week.";

    expect((await state(scope, { kind: KIND, was: null, statement: stated })).status).toBe(200);

    const row = await createGrowthContextRepo(bed.db, scope.ctx).readBusinessResearch(
      await projectFor(scope),
    );
    const fact = (row?.businessContext.facts ?? []).find((each) => each.statement === stated);

    if (fact === undefined) {
      throw new Error("the stated fact did not persist at all, so statedBy has nothing to sit on");
    }

    // `statedBy` is this sprint's addition to factProvenanceSchema (AD-4), so it is read
    // unknown-shaped: red today because the field does not exist, green when the route
    // passes gate.ctx.userId through StateFactInput and the repo persists it.
    const provenance = fact.provenance as unknown as Record<string, unknown>;
    expect(provenance.statedBy).toBe(scope.userId);
  });
});
