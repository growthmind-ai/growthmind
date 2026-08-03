import type { ScopedDb } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { readLandingLiveness } from "../../lib/landing/liveness";

const NOW_MS = new Date("2026-08-03T12:00:00.000Z").getTime();

const CTX = {
  organizationId: "s0-org",
  organizationName: "s0 workspace",
  userId: "s0-user",
} as unknown as TenantContext;

// `findFirstProjectForOrg` is the only read this reaches before the counter, so
// the chain it walks is the whole fake.
function dbReturning(rows: readonly unknown[]): ScopedDb {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };

  return { select: () => chain } as unknown as ScopedDb;
}

describe("readLandingLiveness", () => {
  test("an organization with no project yet yields no sentence rather than throwing", async () => {
    const line = await readLandingLiveness({ db: dbReturning([]), ctx: CTX, nowMs: NOW_MS });

    expect(line).toBeNull();
  });

  test("an unreadable counter degrades to no sentence, never a thrown page", async () => {
    const broken = {
      select: () => {
        throw new Error("s0-counter-unreadable");
      },
    } as unknown as ScopedDb;

    const line = await readLandingLiveness({ db: broken, ctx: CTX, nowMs: NOW_MS });

    expect(line).toBeNull();
  });

  test("a rejected counter read is caught, not left to reject the page", async () => {
    const rejecting = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => Promise.reject(new Error("s0-read-failed")) }),
          }),
        }),
      }),
    } as unknown as ScopedDb;

    const line = await readLandingLiveness({ db: rejecting, ctx: CTX, nowMs: NOW_MS });

    expect(line).toBeNull();
  });
});
