// POST /api/settings/business/confirm — one click that marks a belief confirmed by the
// person looking at it (O-036 AD-1/AD-3). Wave 0: the route does not exist yet, so every
// row here reds through the deferred loader until the route wave lands.
import { createGrowthContextRepo, ensureProject } from "@growthmind/db";
import { recordPublishedTopics } from "@growthmind/db/testing";
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

const CLOCK_AT = new Date("2026-08-07T09:00:00.000Z");
const CLOCK = clockAt(CLOCK_AT);

const KIND: BusinessFactKind = "conversion";

const RESEARCHED = "Teams that invite a second seat in week one stay past the trial.";
const BYSTANDER = "Every proposed change waits for a person to approve it.";
const GONE = "A trial counts when a second teammate is invited.";

const CONFIRM: FirstRunRouteDescriptor = {
  id: "settings-business-confirm",
  path: "/api/settings/business/confirm",
  method: "POST",
  modulePath: "apps/web/app/api/settings/business/confirm/route",
  sourcePath: "apps/web/app/api/settings/business/confirm/route.ts",
  declaredKeys: ["kind", "statement"],
  validBody: { kind: KIND, statement: RESEARCHED },
  ownedBy: "ADD o-036-audience-goes-live AD-3 (the confirm sibling of the fact route)",
};

let bed: FirstRunTestBed;

const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("settings-business-confirm");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsWith(db: FirstRunRouteDeps["db"], scope: SeededMemberScope | null): FirstRunRouteDeps {
  return { db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK };
}

function read(kind: BusinessFactKind, statement: string): BusinessFact {
  return {
    kind,
    statement,
    provenance: {
      source: "site",
      at: CLOCK_AT,
      citation: "https://example.com/pricing",
      seen: null,
    },
    correctedFrom: null,
    audience: null,
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

// The `confirmation` field is this sprint's addition to businessFactSchema, so it is read
// unknown-shaped: the assertion is on persisted state, and typecheck stays green while the
// field does not exist yet.
async function factNamed(
  scope: SeededMemberScope,
  statement: string,
): Promise<Record<string, unknown> | null> {
  const row = await createGrowthContextRepo(bed.db, scope.ctx).readBusinessResearch(
    await projectFor(scope),
  );
  const fact = (row?.businessContext.facts ?? []).find((each) => each.statement === statement);

  return fact === undefined ? null : (fact as unknown as Record<string, unknown>);
}

function confirmationOf(fact: Record<string, unknown> | null): Record<string, unknown> | null {
  const value = fact?.confirmation;
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

async function confirm(scope: SeededMemberScope | null, body: unknown): Promise<Response> {
  const handle = await loadRouteHandler(CONFIRM);
  return handle(routeRequest(CONFIRM, body), depsWith(bed.db, scope));
}

function messageOf(body: Record<string, unknown>): string {
  const error = (body.error ?? {}) as Record<string, unknown>;
  return typeof error.message === "string" ? error.message : "";
}

describe("POST /api/settings/business/confirm", () => {
  test("the body schema is strict, requires both fields, and has nowhere to put an actor", async () => {
    const inputSchema = await loadRouteInputSchema(CONFIRM);

    expect(inputSchema.safeParse(CONFIRM.validBody).success).toBe(true);
    expect(inputSchema.safeParse({ kind: KIND }).success).toBe(false);
    expect(inputSchema.safeParse({ kind: KIND, statement: "" }).success).toBe(false);
    expect(inputSchema.safeParse({ statement: RESEARCHED }).success).toBe(false);

    // Who confirmed comes from the session, never the wire (AD-3): a body naming an actor
    // or a tenant is refused outright rather than silently stripped.
    for (const key of ["confirmedBy", "projectId", "organizationId"]) {
      expect(verifyRefusesUnknownKey(inputSchema, CONFIRM.validBody, key).ok).toBe(true);
    }
  });

  test("refuses a caller who is not signed in before reading the body", async () => {
    // The body is unparseable on purpose: a 400 here would mean the parse ran ahead of the
    // tenancy gate. Signed-out has to answer first (D7 route half).
    expect((await confirm(null, "not-json")).status).toBe(401);
  });

  test("persists one confirmation stamped by the session user", async () => {
    const scope = await bed.member("confirms-one");
    await seedFacts(scope, [read(KIND, RESEARCHED), read(KIND, BYSTANDER)]);

    const response = await confirm(scope, { kind: KIND, statement: RESEARCHED });

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toMatchObject({ saved: true });

    const confirmation = confirmationOf(await factNamed(scope, RESEARCHED));

    if (confirmation === null) {
      throw new Error(
        "the confirmed fact carries no confirmation object after a 200 — AD-1 adds " +
          "`confirmation: {at, by}` to businessFactSchema and confirmFact stamps it",
      );
    }

    expect(confirmation.by).toBe(scope.userId);
    expect(confirmation.at).toBeTruthy();

    expect(confirmationOf(await factNamed(scope, BYSTANDER))).toBeNull();
  });

  test("refuses an invalid body with a plain-English 4xx and touches nothing", async () => {
    const scope = await bed.member("bad-body");
    await seedFacts(scope, [read(KIND, RESEARCHED)]);

    const response = await confirm(scope, { kind: KIND });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(messageOf(await bodyOf(response)).length).toBeGreaterThan(0);

    expect(confirmationOf(await factNamed(scope, RESEARCHED))).toBeNull();
  });

  test("answers not_found honestly when the sentence is no longer there", async () => {
    const scope = await bed.member("fact-moved");
    await seedFacts(scope, [read(KIND, RESEARCHED)]);

    const response = await confirm(scope, { kind: KIND, statement: GONE });

    // The row moved under the browser: a re-read is the honest answer, never a fabricated
    // `saved: true` against a sentence that is not in the table.
    expect(response.status).toBe(409);
    expect(messageOf(await bodyOf(response))).toMatch(/reload/i);

    expect(confirmationOf(await factNamed(scope, RESEARCHED))).toBeNull();
  });

  test("a double submit stays one confirmation and one announcement", async () => {
    const scope = await bed.member("double-click");
    await seedFacts(scope, [read(KIND, RESEARCHED)]);

    const recorder = recordPublishedTopics(bed.db);
    const handle = await loadRouteHandler(CONFIRM);

    const send = (): Promise<Response> =>
      handle(
        routeRequest(CONFIRM, { kind: KIND, statement: RESEARCHED }),
        depsWith(recorder.db, scope),
      );

    const announcements = (): number =>
      recorder.published.filter((payload) => payload.topic === "business_context").length;

    const first = await send();
    expect(first.status).toBe(200);
    expect(await bodyOf(first)).toMatchObject({ saved: true });
    expect(announcements()).toBe(1);

    // The second click hits already_confirmed: still saved to the person who clicked, but
    // no second write and no second NOTIFY (D3, D4).
    const second = await send();
    expect(second.status).toBe(200);
    expect(await bodyOf(second)).toMatchObject({ saved: true });
    expect(announcements()).toBe(1);

    const confirmation = confirmationOf(await factNamed(scope, RESEARCHED));
    expect(confirmation?.by).toBe(scope.userId);
  });
});
