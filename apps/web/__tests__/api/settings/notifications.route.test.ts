// The two notification-settings routes (ADD §5.2): membership-gated per the ratified E-4
// ruling — a NON-OWNER member succeeds, which is the assertion that catches anyone
// narrowing the gate to owner/admin — strict zero-extra-key inputs naming no org or user
// id, idempotent writes, and the day the card saves being the day the digest reads. RED
// in Wave 0: both handlers answer 501.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { listOrganizationsDueForDigest, schema } from "@growthmind/db";
import {
  PLACEHOLDER_CREDENTIAL_CIPHERTEXT,
  PLACEHOLDER_CREDENTIAL_KEY_ID,
} from "@growthmind/db/testing";

import type { FirstRunRouteDeps } from "../../../lib/first-run/deps";
import {
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

const ROUTES_OWNER = "O-051 task 4.1 (apps/web/app/api/settings/notifications/, ADD §5.2)";

const CLOCK_AT = new Date("2026-08-07T20:00:00.000Z");
const CLOCK = clockAt(CLOCK_AT);

// Fixed instants are safe here: only the weekday matters, and a date's weekday never
// moves. 2026-08-14 is a Friday; 2026-08-10 is a Monday.
const A_FRIDAY = new Date("2026-08-14T09:00:00.000Z");
const A_MONDAY = new Date("2026-08-10T09:00:00.000Z");

const DIGEST: FirstRunRouteDescriptor = {
  id: "settings-notifications-digest",
  path: "/api/settings/notifications/digest",
  method: "POST",
  modulePath: "apps/web/app/api/settings/notifications/digest/route",
  sourcePath: "apps/web/app/api/settings/notifications/digest/route.ts",
  declaredKeys: ["cadence", "day"],
  validBody: { cadence: "weekly", day: "friday" },
  ownedBy: ROUTES_OWNER,
};

const BELL: FirstRunRouteDescriptor = {
  id: "settings-notifications-bell",
  path: "/api/settings/notifications/bell",
  method: "POST",
  modulePath: "apps/web/app/api/settings/notifications/bell/route",
  sourcePath: "apps/web/app/api/settings/notifications/bell/route.ts",
  declaredKeys: ["class", "shown"],
  validBody: { class: "work", shown: false },
  ownedBy: ROUTES_OWNER,
};

let bed: FirstRunTestBed;

const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("settings-notifications");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(scope: SeededMemberScope | null): FirstRunRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK };
}

async function call(
  route: FirstRunRouteDescriptor,
  scope: SeededMemberScope | null,
  body: unknown,
): Promise<Response> {
  const handle = await loadRouteHandler(route);
  return handle(routeRequest(route, body), depsFor(scope));
}

async function settingsRowFor(organizationId: string) {
  const rows = await bed.db.select().from(schema.notificationSettings);
  return rows.filter((row) => row.organizationId === organizationId);
}

async function muteRowsFor(organizationId: string) {
  const rows = await bed.db.select().from(schema.notificationMutes);
  return rows.filter((row) => row.organizationId === organizationId);
}

async function connectSlack(organizationId: string): Promise<void> {
  await bed.db.insert(schema.slackConnections).values({
    id: randomUUID(),
    organizationId,
    channelId: `C0${randomUUID().slice(0, 8).toUpperCase()}`,
    credentialCiphertext: PLACEHOLDER_CREDENTIAL_CIPHERTEXT,
    credentialKeyId: PLACEHOLDER_CREDENTIAL_KEY_ID,
    isActive: true,
    connectedAt: new Date(),
  });
}

describe("both bodies are strict and carry no tenancy, org or user key", () => {
  test("the digest schema accepts its two fields and refuses an extra key", async () => {
    const inputSchema = await loadRouteInputSchema(DIGEST);

    expect(inputSchema.safeParse(DIGEST.validBody).success).toBe(true);
    for (const key of ["organizationId", "projectId", "userId"]) {
      expect(verifyRefusesUnknownKey(inputSchema, DIGEST.validBody, key).ok).toBe(true);
    }
  });

  test("the bell schema accepts a class-and-shown pair and refuses an extra key", async () => {
    const inputSchema = await loadRouteInputSchema(BELL);

    expect(inputSchema.safeParse(BELL.validBody).success).toBe(true);
    for (const key of ["organizationId", "userId"]) {
      expect(verifyRefusesUnknownKey(inputSchema, BELL.validBody, key).ok).toBe(true);
    }
  });

  test("act_now is unrepresentable in the bell schema — the guarantee is structural (FR-10.2)", async () => {
    const inputSchema = await loadRouteInputSchema(BELL);

    expect(inputSchema.safeParse({ class: "act_now", shown: false }).success).toBe(false);
    expect(inputSchema.safeParse({ class: "record", shown: true }).success).toBe(true);
  });
});

describe("POST /api/settings/notifications/digest", () => {
  test("refuses a caller who is not signed in", async () => {
    expect((await call(DIGEST, null, DIGEST.validBody)).status).toBe(401);
  });

  test("a non-owner member's save succeeds and persists — the ratified E-4 ruling, not owner/admin", async () => {
    const owner = await bed.member("digest-owner");
    const teammate = await bed.member("digest-teammate", owner.organizationId);

    const response = await call(DIGEST, teammate, { cadence: "weekly", day: "friday" });
    expect(response.status).toBe(200);

    const rows = await settingsRowFor(owner.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.digestCadence).toBe("weekly");
    expect(rows[0]?.digestDay).toBe("friday");
  });

  test("a second save updates the same single row", async () => {
    const scope = await bed.member("digest-upsert");

    expect((await call(DIGEST, scope, { cadence: "weekly", day: "friday" })).status).toBe(200);
    expect((await call(DIGEST, scope, { cadence: "off", day: "friday" })).status).toBe(200);

    const rows = await settingsRowFor(scope.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.digestCadence).toBe("off");

    // The stored day survives the off round trip, so weekly gets Friday back (UX §5).
    expect(rows[0]?.digestDay).toBe("friday");
  });

  test("an invalid weekday and an unknown key both refuse with a 4xx and write nothing", async () => {
    const scope = await bed.member("digest-refuse");

    const badDay = await call(DIGEST, scope, { cadence: "weekly", day: "moonday" });
    expect(badDay.status).toBeGreaterThanOrEqual(400);
    expect(badDay.status).toBeLessThan(500);

    const extraKey = await call(DIGEST, scope, {
      cadence: "weekly",
      day: "friday",
      organizationId: "org-someone-else",
    });
    expect(extraKey.status).toBeGreaterThanOrEqual(400);
    expect(extraKey.status).toBeLessThan(500);

    expect(await settingsRowFor(scope.organizationId)).toEqual([]);
  });

  test("a write for org A leaves org B's settings untouched", async () => {
    const alice = await bed.member("digest-tenant-a");
    const bianca = await bed.member("digest-tenant-b");

    expect((await call(DIGEST, bianca, { cadence: "weekly", day: "friday" })).status).toBe(200);
    expect((await call(DIGEST, alice, { cadence: "weekly", day: "tuesday" })).status).toBe(200);

    const theirs = await settingsRowFor(bianca.organizationId);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]?.digestDay).toBe("friday");

    const mine = await settingsRowFor(alice.organizationId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.digestDay).toBe("tuesday");
  });

  test("the day the card saves is the day the digest reads (the control is not lying)", async () => {
    const scope = await bed.member("digest-read-back");
    await connectSlack(scope.organizationId);

    expect((await call(DIGEST, scope, { cadence: "weekly", day: "friday" })).status).toBe(200);

    // Across the route and the reader, deliberately — a stored value nothing reads is the
    // lie amendment 1 was raised to stop (ADD §2.3).
    const dueFriday = await listOrganizationsDueForDigest(bed.db, A_FRIDAY);
    expect(dueFriday.map((row) => row.organizationId)).toContain(scope.organizationId);

    const dueMonday = await listOrganizationsDueForDigest(bed.db, A_MONDAY);
    expect(dueMonday.map((row) => row.organizationId)).not.toContain(scope.organizationId);
  });
});

describe("POST /api/settings/notifications/bell", () => {
  test("refuses a caller who is not signed in", async () => {
    expect((await call(BELL, null, BELL.validBody)).status).toBe(401);
  });

  test("shown:false inserts one mute for the caller only, and a repeat is idempotent", async () => {
    const owner = await bed.member("bell-owner");
    const teammate = await bed.member("bell-teammate", owner.organizationId);

    expect((await call(BELL, teammate, { class: "work", shown: false })).status).toBe(200);
    expect((await call(BELL, teammate, { class: "work", shown: false })).status).toBe(200);

    const mutes = await muteRowsFor(owner.organizationId);
    expect(mutes).toHaveLength(1);
    expect(mutes[0]?.class).toBe("work");

    // One person's bell: the row names the caller, and nobody else gains one (AC-19).
    expect(mutes[0]?.userId).toBe(teammate.userId);
    expect(mutes.filter((row) => row.userId === owner.userId)).toEqual([]);
  });

  test("shown:true deletes the mute and a repeat stays clean", async () => {
    const scope = await bed.member("bell-restore");

    expect((await call(BELL, scope, { class: "record", shown: false })).status).toBe(200);
    expect(await muteRowsFor(scope.organizationId)).toHaveLength(1);

    expect((await call(BELL, scope, { class: "record", shown: true })).status).toBe(200);
    expect(await muteRowsFor(scope.organizationId)).toEqual([]);

    expect((await call(BELL, scope, { class: "record", shown: true })).status).toBe(200);
    expect(await muteRowsFor(scope.organizationId)).toEqual([]);
  });

  test("a class the schema refuses reaches no write — act_now cannot be muted over the wire", async () => {
    const scope = await bed.member("bell-act-now");

    const refused = await call(BELL, scope, { class: "act_now", shown: false });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);

    expect(await muteRowsFor(scope.organizationId)).toEqual([]);
  });

  test("a mute written in org A never appears in org B", async () => {
    const alice = await bed.member("bell-tenant-a");
    const bianca = await bed.member("bell-tenant-b");

    expect((await call(BELL, alice, { class: "work", shown: false })).status).toBe(200);

    expect(await muteRowsFor(bianca.organizationId)).toEqual([]);
    const mine = await muteRowsFor(alice.organizationId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.userId).toBe(alice.userId);
  });
});
