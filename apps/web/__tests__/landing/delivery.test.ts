import type { ScopedDb } from "@growthmind/db";
import {
  LANDING_SETTLED_LINE,
  LANDING_SETTLED_NO_DELIVERY_LINE,
  type TenantContext,
} from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { landingSettledLine, readLandingDeliveryTarget } from "../../lib/landing/delivery";

import { blankComments, readExisting } from "../first-run/helpers/first-run-source";

const LANDING = "apps/web/app/page.tsx";

const CTX = {
  organizationId: "s0-org",
  organizationName: "s0 workspace",
  userId: "s0-user",
} as unknown as TenantContext;

// `getActiveForOrg` is the only read this makes, so the chain it walks is the whole fake.
function dbReturning(rows: readonly unknown[]): ScopedDb {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };

  return { select: () => chain } as unknown as ScopedDb;
}

const activeRow = (channelId: string | null) => ({
  id: "s0-slack",
  organizationId: CTX.organizationId,
  channelId,
  workspaceName: "Acme",
  isActive: true,
  connectedByUserId: CTX.userId,
  connectedAt: new Date("2026-08-01T09:00:00.000Z"),
});

describe("readLandingDeliveryTarget", () => {
  test("a workspace with a channel has somewhere for findings to arrive", async () => {
    expect(
      await readLandingDeliveryTarget({ db: dbReturning([activeRow("C01AB2CD3EF")]), ctx: CTX }),
    ).toBe(true);
  });

  test("no connection, and a workspace with no channel, both have nowhere", async () => {
    expect(await readLandingDeliveryTarget({ db: dbReturning([]), ctx: CTX })).toBe(false);

    for (const channelId of [null, "", " ", "null", "undefined"]) {
      expect(
        await readLandingDeliveryTarget({ db: dbReturning([activeRow(channelId)]), ctx: CTX }),
      ).toBe(false);
    }
  });

  test("an unreadable connection is not evidence for either sentence", async () => {
    const broken = {
      select: () => {
        throw new Error("s0-slack-unreadable");
      },
    } as unknown as ScopedDb;

    expect(await readLandingDeliveryTarget({ db: broken, ctx: CTX })).toBeNull();
  });
});

describe("landingSettledLine", () => {
  test("the Slack claim is made only when there is a channel to make it about", () => {
    expect(landingSettledLine(true)).toBe(LANDING_SETTLED_LINE);
    expect(LANDING_SETTLED_LINE).toContain("Slack");

    expect(landingSettledLine(false)).toBe(LANDING_SETTLED_NO_DELIVERY_LINE);
    expect(landingSettledLine(false)).not.toBe(LANDING_SETTLED_LINE);
  });

  test("the no-delivery line names what is missing and what to do, in one sentence each", () => {
    expect(LANDING_SETTLED_NO_DELIVERY_LINE).toContain("Slack");
    expect(LANDING_SETTLED_NO_DELIVERY_LINE).toContain("Connect");
    expect(LANDING_SETTLED_NO_DELIVERY_LINE.split(/(?<=\.)\s+/).length).toBeGreaterThan(1);
  });

  test("an unreadable answer claims nothing at all", () => {
    expect(landingSettledLine(null)).toBeNull();
  });
});

describe("the wire into the landing page (D11)", () => {
  test("the page renders the chosen sentence, never the Slack claim unconditionally", () => {
    const code = blankComments(readExisting(LANDING).source);

    expect(code).toContain("landingSettledLine");
    expect(code).toContain("readLandingDeliveryTarget");

    expect(code).not.toContain("LANDING_SETTLED_LINE");
    expect(code).not.toContain("LANDING_SETTLED_NO_DELIVERY_LINE");
  });
});
