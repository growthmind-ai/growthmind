import { describe, expect, test } from "bun:test";

import type { NotificationPayload } from "../../src/notifications/payload";
import { parseNotificationPayload } from "../../src/notifications/payload";
import { NOTIFICATION_TYPES, type NotificationType } from "../../src/notifications/types";

// D5: a stored jsonb column carries every shape ever written, not the shape declared
// today. The parser is tolerant by contract — an unknown version or shape yields the
// generic-render result and the bell row degrades, never the shell.

// One valid v1 payload per type, total over the enum, so a type minted without an arm is
// a compile error here rather than a row nothing can render.
const V1_PAYLOADS = {
  finding_delivered: { type: "finding_delivered", v: 1 },
  keys_revoked: { type: "keys_revoked", v: 1 },
  agent_first_contact: { type: "agent_first_contact", v: 1 },
  key_created: { type: "key_created", v: 1 },
  backfill_complete: { type: "backfill_complete", v: 1, sessionsTouched: 4, eventsPersisted: 91 },
  slack_disconnected: { type: "slack_disconnected", v: 1 },
  analysis_failing: { type: "analysis_failing", v: 1 },
  digest: { type: "digest", v: 1, notificationIds: ["n-1", "n-2"], totalCount: 7 },
} satisfies Record<NotificationType, NotificationPayload>;

describe("every v1 arm parses", () => {
  for (const type of NOTIFICATION_TYPES) {
    test(`the ${type} arm parses to itself`, () => {
      const payload = V1_PAYLOADS[type];

      expect(parseNotificationPayload(payload)).toEqual({ ok: true, payload });
    });
  }
});

describe("an unknown version or shape yields the generic-render result, never a throw", () => {
  test("a future version is refused without throwing", () => {
    expect(parseNotificationPayload({ type: "finding_delivered", v: 99 })).toEqual({ ok: false });
  });

  test("a type this build has never heard of is refused without throwing", () => {
    expect(parseNotificationPayload({ type: "events_stopped", v: 1 })).toEqual({ ok: false });
  });

  // A data-bearing arm is strict about its own fields too: a row written before those
  // fields existed renders the generic sentence rather than a half-built one.
  test("a data-bearing arm missing its data is refused without throwing", () => {
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

  // Every arm is strict (OQ-3): that is what makes "no personal data in payloads"
  // structural — a name cannot ride where no field is declared for it.
  test("an undeclared field is refused, so nothing stale or personal can be stored", () => {
    expect(
      parseNotificationPayload({ type: "keys_revoked", v: 1, revokedByName: "Priya" }),
    ).toEqual({ ok: false });
  });
});
