import { describe, expect, test } from "bun:test";

import { parseNotificationPayload } from "../../src/notifications/payload";
import { NOTIFICATION_TYPES } from "../../src/notifications/types";

// D5: a stored jsonb column carries every shape ever written, not the shape declared
// today. The parser is tolerant by contract — an unknown version or shape yields the
// generic-render result and the bell row degrades, never the shell.

describe("every v1 arm parses", () => {
  for (const type of NOTIFICATION_TYPES) {
    test(`{ type: "${type}", v: 1 } parses to itself`, () => {
      const result = parseNotificationPayload({ type, v: 1 });

      expect(result).toEqual({ ok: true, payload: { type, v: 1 } });
    });
  }
});

describe("an unknown version or shape yields the generic-render result, never a throw", () => {
  test("a future version is refused without throwing", () => {
    expect(parseNotificationPayload({ type: "finding_delivered", v: 99 })).toEqual({ ok: false });
  });

  test("a type this build has never heard of is refused without throwing", () => {
    expect(parseNotificationPayload({ type: "backfill_complete", v: 1 })).toEqual({ ok: false });
  });

  test("a version-less arm is refused without throwing", () => {
    expect(parseNotificationPayload({ type: "keys_revoked" })).toEqual({ ok: false });
  });

  test("garbage in every shape production holds is refused without throwing", () => {
    const garbage: readonly unknown[] = [
      null,
      undefined,
      "",
      "keys_revoked",
      7,
      [],
      {},
      { v: 1 },
      { type: 1, v: 1 },
    ];

    for (const value of garbage) {
      expect(parseNotificationPayload(value)).toEqual({ ok: false });
    }
  });

  // v1 arms carry nothing beyond discriminant and version (OQ-3): the strict shape is what
  // makes "no personal data in payloads" structural — a name cannot ride where no field is.
  test("a data-bearing v1 arm is refused, so nothing stale or personal can be stored", () => {
    expect(
      parseNotificationPayload({ type: "keys_revoked", v: 1, revokedByName: "Priya" }),
    ).toEqual({ ok: false });
  });
});
