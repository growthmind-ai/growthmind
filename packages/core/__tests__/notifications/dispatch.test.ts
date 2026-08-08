import { describe, expect, test } from "bun:test";

import {
  NOTIFICATION_DISPATCH_CLAIM_TTL_MS,
  NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
  NOTIFICATION_RESCUE_TICK_INTERVAL_MS,
  dispatchClaimsExpireBefore,
} from "../../src/notifications/dispatch";

describe("dispatch claims expire five minutes back and the cap is five", () => {
  test("dispatchClaimsExpireBefore is now minus the ratified five-minute TTL", () => {
    expect(NOTIFICATION_DISPATCH_CLAIM_TTL_MS).toBe(5 * 60 * 1_000);

    const now = new Date("2026-08-07T12:00:00.000Z");
    expect(dispatchClaimsExpireBefore(now).getTime()).toBe(
      now.getTime() - NOTIFICATION_DISPATCH_CLAIM_TTL_MS,
    );
  });

  test("the attempt cap is the ratified five", () => {
    expect(NOTIFICATION_DISPATCH_MAX_ATTEMPTS).toBe(5);
  });
});

describe("the rescue sweep's period is the claim TTL, by derivation and not by coincidence", () => {
  test("editing one without the other fails here — one answer to how long unattended work may sit", () => {
    expect(NOTIFICATION_RESCUE_TICK_INTERVAL_MS).toBe(NOTIFICATION_DISPATCH_CLAIM_TTL_MS);
  });
});
