// GET /api/agent/connection — the read the page after setup polls, because first contact is
// stamped by a call arriving from outside the browser and nothing else notices it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createApiKeysRepo, eq, schema, type ScopedDb } from "@growthmind/db";
import {
  createTestDb,
  makeTenantContext,
  seedMember,
  seedOrgWithOwner,
  seedUser,
  type TestDbHandle,
} from "@growthmind/db/testing";
import type { TenantContext } from "@growthmind/shared";

import {
  loadModuleUnderConstruction,
  underConstructionSpecifier,
} from "../../../../../packages/shared/__tests__/onboarding/module-under-construction";

const ROUTE = underConstructionSpecifier("apps/web/app/api/agent/connection/route.ts");
const OWNED_BY = "the surface that carries the agent panel after setup";

const COLD_BOOT_BUDGET_MS = 60_000;

type Handler = (request: Request, deps: unknown) => Promise<Response>;

let handle: Handler;
let db: ScopedDb;
let close: () => Promise<void>;

let owner: TenantContext;
let teammate: TenantContext;
let stranger: TenantContext;

async function loadHandler(): Promise<Handler> {
  const namespace = await loadModuleUnderConstruction({
    modulePath: ROUTE,
    ownedBy: OWNED_BY,
  });

  return namespace.handle as Handler;
}

function depsFor(ctx: TenantContext | null): unknown {
  return { db, tenant: async () => ctx, now: () => new Date("2026-08-04T12:00:00.000Z") };
}

async function connectionFor(ctx: TenantContext | null): Promise<{
  readonly status: number;
  readonly body: Record<string, unknown>;
}> {
  const response = await handle(
    new Request("https://app.example.com/api/agent/connection"),
    depsFor(ctx),
  );

  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function markUsed(ctx: TenantContext): Promise<void> {
  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date("2026-08-04T11:00:00.000Z") })
    .where(eq(schema.apiKeys.organizationId, ctx.organizationId));
}

beforeAll(async () => {
  handle = await loadHandler();

  const handleDb: TestDbHandle = await createTestDb();
  db = handleDb.db;
  close = handleDb.close;

  const seeded = await seedOrgWithOwner(db, {
    orgName: "agent-connection-org",
    userName: "agent-connection-owner",
    email: "agent-connection-owner@example.com",
  });
  owner = seeded.ctx;

  // The person O-026 could not serve: they joined after setup and have never seen
  // `/first-run`, which is deliberately not linkable back to.
  const joiner = await seedUser(db, {
    name: "agent-connection-teammate",
    email: "agent-connection-teammate@example.com",
  });
  await seedMember(db, {
    organizationId: seeded.organizationId,
    userId: joiner.id,
    role: "member",
  });
  teammate = makeTenantContext({
    userId: joiner.id,
    organizationId: seeded.organizationId,
    organizationName: seeded.organizationName,
    role: "member",
  });

  const other = await seedOrgWithOwner(db, {
    orgName: "agent-connection-other-org",
    userName: "agent-connection-stranger",
    email: "agent-connection-stranger@example.com",
  });
  stranger = other.ctx;
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await close?.();
});

describe("GET /api/agent/connection — who may read it (D7)", () => {
  test("a signed-out caller is refused and told so, not answered with a connection", async () => {
    const answered = await connectionFor(null);

    expect(answered.status).toBe(401);
    expect(answered.body.connection).toBeUndefined();
  });

  test("an org with no keys reads none", async () => {
    expect((await connectionFor(owner)).body.connection).toEqual({ kind: "none" });
  });
});

describe("the org's key, not the minter's (D1, D2)", () => {
  test("a teammate who never saw setup reads the same connection as the owner", async () => {
    await createApiKeysRepo(db, owner).mint({ name: "claude code" });

    expect((await connectionFor(owner)).body.connection).toEqual({ kind: "waiting" });
    expect((await connectionFor(teammate)).body.connection).toEqual({ kind: "waiting" });

    await markUsed(owner);

    expect((await connectionFor(owner)).body.connection).toEqual({ kind: "connected" });
    expect((await connectionFor(teammate)).body.connection).toEqual({ kind: "connected" });
  });

  test("another org's key is not visible, and its own state is its own", async () => {
    expect((await connectionFor(stranger)).body.connection).toEqual({ kind: "none" });

    await createApiKeysRepo(db, stranger).mint({ name: "cursor" });

    expect((await connectionFor(stranger)).body.connection).toEqual({ kind: "waiting" });
    expect((await connectionFor(owner)).body.connection).toEqual({ kind: "connected" });
  });

  test("revoking every live key drops the org back to none", async () => {
    await createApiKeysRepo(db, stranger).revokeEveryLive();

    expect((await connectionFor(stranger)).body.connection).toEqual({ kind: "none" });
  });
});

describe("the declared fail direction when the row cannot be read (D8)", () => {
  test("an unreadable read refuses; it never answers none, which would ask for a second key", async () => {
    const exploding = {
      db: {
        select: () => {
          throw new Error("connection terminated unexpectedly");
        },
      },
      tenant: async () => owner,
      now: () => new Date("2026-08-04T12:00:00.000Z"),
    };

    const response = await handle(
      new Request("https://app.example.com/api/agent/connection"),
      exploding,
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.connection).toBeUndefined();
  });
});
