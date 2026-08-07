// The three bell-state routes (ADD §6): session-tenant-gated, strict zero-extra-key
// input, idempotent and monotonic per D-5, per-person state only. RED in Wave 0: the
// route files are 501 stubs exporting no `handle`/`inputSchema`, so every load below
// reports NOT IMPLEMENTED — the right red — and behavior cases fail on the contract.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { seedNotification } from "@growthmind/db/testing";

import {
  clockAt,
  createFirstRunTestBed,
  loadRouteHandler,
  loadRouteInputSchema,
  routeRequest,
  tenantOf,
  verifyRefusesUnknownKey,
  type FirstRunRouteDeps,
  type FirstRunRouteDescriptor,
  type FirstRunTestBed,
  type SeededMemberScope,
} from "../first-run/helpers/first-run-route-contract";

const OWNER =
  "O-051 task 3.1 (apps/web/app/api/notifications/bell/{opened,read,read-all}/route.ts, ADD §6)";

// The same uniform deps-taking `handle` + `inputSchema` contract every route surface here
// ships; the descriptors reuse the first-run loaders rather than re-declaring them.
const OPENED: FirstRunRouteDescriptor = {
  id: "bell-opened",
  path: "/api/notifications/bell/opened",
  method: "POST",
  modulePath: "apps/web/app/api/notifications/bell/opened/route",
  sourcePath: "apps/web/app/api/notifications/bell/opened/route.ts",
  declaredKeys: [],
  validBody: {},
  ownedBy: OWNER,
};

const READ: FirstRunRouteDescriptor = {
  id: "bell-read",
  path: "/api/notifications/bell/read",
  method: "POST",
  modulePath: "apps/web/app/api/notifications/bell/read/route",
  sourcePath: "apps/web/app/api/notifications/bell/read/route.ts",
  // `{ notificationId }` only — no org id, no user id, nowhere to put the wrong value.
  declaredKeys: ["notificationId"],
  validBody: { notificationId: "bell-fixture-notification-id" },
  ownedBy: OWNER,
};

const READ_ALL: FirstRunRouteDescriptor = {
  id: "bell-read-all",
  path: "/api/notifications/bell/read-all",
  method: "POST",
  modulePath: "apps/web/app/api/notifications/bell/read-all/route",
  sourcePath: "apps/web/app/api/notifications/bell/read-all/route.ts",
  declaredKeys: [],
  validBody: {},
  ownedBy: OWNER,
};

const BELL_ROUTES = [OPENED, READ, READ_ALL] as const;

const CLOCK = clockAt(new Date("2026-08-07T10:00:00.000Z"));

// 60s: a cold PGlite boot blows bun's 5s default; same figure as status.route.test.ts.
const COLD_BOOT_BUDGET_MS = 60_000;

let bed: FirstRunTestBed;

beforeAll(async () => {
  bed = await createFirstRunTestBed("bellroutes");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(scope: SeededMemberScope | null): FirstRunRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK };
}

async function rawRows(query: string): Promise<Record<string, unknown>[]> {
  const result = (await bed.db.execute(query)) as unknown as
    { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

function asInstant(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  throw new Error("bell-routes: a timestamp came back in a shape this test cannot read");
}

async function bellStateOf(
  organizationId: string,
  userId: string,
): Promise<{ openedAt: Date | null; readBefore: Date | null } | null> {
  const rows = await rawRows(
    `select opened_at, read_before from notification_bell_state where organization_id = '${organizationId}' and user_id = '${userId}'`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    openedAt: asInstant(row.opened_at),
    readBefore: asInstant(row.read_before),
  };
}

async function readsRowsFor(notificationId: string): Promise<Record<string, unknown>[]> {
  return rawRows(
    `select user_id from notification_reads where notification_id = '${notificationId}'`,
  );
}

async function seedRowFor(scope: SeededMemberScope): Promise<string> {
  const seeded = await seedNotification(bed.db, {
    organizationId: scope.organizationId,
    createdAt: new Date("2026-08-06T10:00:00.000Z"),
  });
  return seeded.id;
}

describe("every bell route refuses what must not arrive", () => {
  test("the input schemas are strict — a body carrying an org or user id is a 4xx-shaped refusal, not a silent strip", async () => {
    for (const route of BELL_ROUTES) {
      const schemaUnderTest = await loadRouteInputSchema(route);

      for (const key of ["organizationId", "userId"]) {
        const verdict = verifyRefusesUnknownKey(schemaUnderTest, route.validBody, key);
        if (!verdict.ok) {
          throw new Error(
            `${route.path} does not refuse a client-supplied "${key}": ${verdict.why}`,
          );
        }
      }
    }
  });

  test("opened and read-all accept no notification id — the watermark stamps are about the viewer, never a row", async () => {
    for (const route of [OPENED, READ_ALL]) {
      const schemaUnderTest = await loadRouteInputSchema(route);
      const verdict = verifyRefusesUnknownKey(schemaUnderTest, route.validBody, "notificationId");
      if (!verdict.ok) {
        throw new Error(`${route.path} does not refuse "notificationId": ${verdict.why}`);
      }
    }
  });

  test("an unauthenticated call is refused on all three routes — a machine principal never reaches them", async () => {
    for (const route of BELL_ROUTES) {
      const handle = await loadRouteHandler(route);
      const response = await handle(routeRequest(route, route.validBody), depsFor(null));
      expect(`${route.id}: ${String(response.status)}`).toBe(`${route.id}: 401`);
    }
  });
});

describe("POST /api/notifications/bell/opened — the badge watermark (UX rows 4/7)", () => {
  test("stamps the caller and only the caller", async () => {
    const handle = await loadRouteHandler(OPENED);
    const caller = await bed.member("opened-caller");
    const teammate = await bed.member("opened-teammate", caller.organizationId);

    const response = await handle(routeRequest(OPENED, {}), depsFor(caller));
    expect(response.ok).toBe(true);

    const stamped = await bellStateOf(caller.organizationId, caller.userId);
    expect(stamped?.openedAt).toBeInstanceOf(Date);

    // Per-person state: the teammate's badge is untouched by someone else's glance.
    expect(await bellStateOf(teammate.organizationId, teammate.userId)).toBeNull();
  });

  test("the open+close double-fire is idempotent and only ever moves the watermark forward", async () => {
    const handle = await loadRouteHandler(OPENED);
    const caller = await bed.member("opened-twice");

    const first = await handle(routeRequest(OPENED, {}), depsFor(caller));
    expect(first.ok).toBe(true);
    const afterOpen = await bellStateOf(caller.organizationId, caller.userId);
    const openedAt = afterOpen?.openedAt;
    if (!(openedAt instanceof Date)) throw new Error("the open never stamped opened_at");

    const second = await handle(routeRequest(OPENED, {}), depsFor(caller));
    expect(second.ok).toBe(true);

    const afterClose = await bellStateOf(caller.organizationId, caller.userId);
    expect(afterClose?.openedAt?.getTime()).toBeGreaterThanOrEqual(openedAt.getTime());
  });
});

describe("POST /api/notifications/bell/read — one idempotent read (UX row 6, AC-7)", () => {
  test("records one read for the caller's own row, and once only across a double click", async () => {
    const handle = await loadRouteHandler(READ);
    const caller = await bed.member("read-own");
    const notificationId = await seedRowFor(caller);

    const first = await handle(routeRequest(READ, { notificationId }), depsFor(caller));
    expect(first.ok).toBe(true);
    expect(await readsRowsFor(notificationId)).toHaveLength(1);

    const second = await handle(routeRequest(READ, { notificationId }), depsFor(caller));
    expect(second.ok).toBe(true);
    expect(await readsRowsFor(notificationId)).toHaveLength(1);
  });

  test("another org's notification id writes zero rows and does not read as success (D7)", async () => {
    const handle = await loadRouteHandler(READ);
    const caller = await bed.member("read-cross-a");
    const other = await bed.member("read-cross-b");
    const foreignId = await seedRowFor(other);

    const response = await handle(
      routeRequest(READ, { notificationId: foreignId }),
      depsFor(caller),
    );

    expect(response.ok).toBe(false);
    expect(await readsRowsFor(foreignId)).toHaveLength(0);
  });
});

describe("POST /api/notifications/bell/read-all — the read watermark and nothing else (UX row 8)", () => {
  test("advances read_before monotonically and leaves opened_at untouched", async () => {
    const openedHandle = await loadRouteHandler(OPENED);
    const readAllHandle = await loadRouteHandler(READ_ALL);
    const caller = await bed.member("read-all");

    await openedHandle(routeRequest(OPENED, {}), depsFor(caller));
    const beforeMark = await bellStateOf(caller.organizationId, caller.userId);
    const openedAt = beforeMark?.openedAt;
    if (!(openedAt instanceof Date)) throw new Error("the open never stamped opened_at");

    const first = await readAllHandle(routeRequest(READ_ALL, {}), depsFor(caller));
    expect(first.ok).toBe(true);

    const afterFirst = await bellStateOf(caller.organizationId, caller.userId);
    const readBefore = afterFirst?.readBefore;
    if (!(readBefore instanceof Date)) throw new Error("read-all never stamped read_before");

    // The two facts never conflate: mark-all-read moves the dot fact only.
    expect(afterFirst?.openedAt?.getTime()).toBe(openedAt.getTime());

    const second = await readAllHandle(routeRequest(READ_ALL, {}), depsFor(caller));
    expect(second.ok).toBe(true);
    const afterSecond = await bellStateOf(caller.organizationId, caller.userId);
    expect(afterSecond?.readBefore?.getTime()).toBeGreaterThanOrEqual(readBefore.getTime());
    expect(afterSecond?.openedAt?.getTime()).toBe(openedAt.getTime());
  });
});
