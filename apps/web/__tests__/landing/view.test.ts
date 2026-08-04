// Replaces `delivery.test.ts` and `liveness.test.ts`: deciding whether anything is wrong
// needs the source status and the delivery target from ONE read, or the page reports a
// fault and a healthy summary from two reads that disagree.
import type { ScopedDb } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { readLandingView } from "../../lib/landing/view";
import { blankComments, readExisting } from "../first-run/helpers/first-run-source";

const NOW_MS = new Date("2026-08-03T12:00:00.000Z").getTime();

const LANDING = "apps/web/app/(app)/page.tsx";
const PANEL = "apps/web/components/landing/settled-panel.tsx";
const VIEW = "apps/web/lib/landing/view.ts";

const CTX = {
  organizationId: "s0-org",
  organizationName: "s0 workspace",
  userId: "s0-user",
} as unknown as TenantContext;

function dbReturning(rows: readonly unknown[]): ScopedDb {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };

  return { select: () => chain } as unknown as ScopedDb;
}

const THROWING = {
  select: () => {
    throw new Error("s0-unreadable");
  },
} as unknown as ScopedDb;

const REJECTING = {
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: () => Promise.reject(new Error("s0-read-failed")) }),
      }),
    }),
  }),
} as unknown as ScopedDb;

describe("readLandingView", () => {
  test("an organization with no project yet claims nothing rather than throwing", async () => {
    const view = await readLandingView({ db: dbReturning([]), ctx: CTX, nowMs: NOW_MS });

    expect(view).toEqual({ attention: null, liveness: null, deliveryLine: null });
  });

  test("an unreadable database degrades to silence, never a thrown page", async () => {
    // No error.tsx under app/, and this page is the only door to the repairing controls.
    for (const db of [THROWING, REJECTING]) {
      const view = await readLandingView({ db, ctx: CTX, nowMs: NOW_MS });

      expect(view.liveness).toBeNull();
      expect(view.deliveryLine).toBeNull();
    }
  });

  test("a read that failed reports no fault, because a failed query is not a fault", async () => {
    for (const db of [THROWING, REJECTING]) {
      expect((await readLandingView({ db, ctx: CTX, nowMs: NOW_MS })).attention).toBeNull();
    }
  });
});

describe("the wire into the landing page (D11)", () => {
  test("the page derives its own state and threads no signal it must remember to read", () => {
    const code = blankComments(readExisting(LANDING).source);

    expect(code).toContain("readLandingView");

    // The sentences belong to the view and the panel. A constant named here is a second
    // place the page can claim something the read did not support.
    expect(code).not.toContain("LANDING_SETTLED_LINE");
    expect(code).not.toContain("LANDING_SETTLED_NO_DELIVERY_LINE");
    expect(code).not.toContain("landingAttention");
  });

  test("the delivery target is narrowed by the shared predicate, never by a null check", () => {
    // A sentinel address ("", "null") is a row with a channel column and nowhere to post.
    const view = blankComments(readExisting(VIEW).source);

    expect(view).toContain("isDeliveryTarget");
    expect(view).toContain("landingAttention");
  });

  test("the fault replaces the healthy summary rather than rendering beside it", () => {
    const panel = blankComments(readExisting(PANEL).source);

    // "We could not reach your analytics" under "236 of 236 events counted" is the shape
    // that makes a founder trust neither sentence.
    expect(panel).toMatch(/attention\s*!=\s*null/);
    expect(panel).toMatch(/attention\s*==\s*null[\s\S]{0,80}?liveness\s*!=\s*null/);
  });

  test("the door to the controls renders whatever the reads did", () => {
    const panel = blankComments(readExisting(PANEL).source);

    // It is the way to repair a broken connection, so it must not be gated on a read that
    // the broken connection is what breaks.
    expect(panel).toContain("ROUTES.settings");
    expect(panel).toMatch(/<ButtonLink[\s\S]{0,240}?ROUTES\.settings/);
  });
});
