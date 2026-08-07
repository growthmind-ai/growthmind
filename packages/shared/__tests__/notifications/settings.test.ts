import { describe, expect, test } from "bun:test";

import {
  DIGEST_CADENCES,
  DIGEST_CADENCE_DEFAULT,
  DIGEST_DAY_DEFAULT,
  MUTABLE_NOTIFICATION_CLASSES,
  WEEKDAYS,
  mutableNotificationClassSchema,
  settingsNotificationBellInputSchema,
  settingsNotificationDigestInputSchema,
} from "../../src/notifications/settings";
import {
  NOTIFICATION_CLASSES,
  NOTIFICATION_CLASS_BY_TYPE,
  NOTIFICATION_TYPES,
  type NotificationClass,
} from "../../src/notifications/types";

// Ruling 2: "health and security are always sent" is enforced by what the mute vocabulary
// cannot say, not by a sentence on the card.

describe("act_now has no representable mute", () => {
  test("the mutable classes are exactly work and record, and act_now is a class they exclude", () => {
    // Compile-level half: adding act_now to the mutable list is a type error here.
    void (MUTABLE_NOTIFICATION_CLASSES satisfies readonly Exclude<NotificationClass, "act_now">[]);

    expect([...MUTABLE_NOTIFICATION_CLASSES]).toEqual(["work", "record"]);
    expect(NOTIFICATION_CLASSES).toContain("act_now");
  });

  test("expanding every mutable class through the type map reaches no act_now type", () => {
    const mutable: readonly string[] = MUTABLE_NOTIFICATION_CLASSES;
    const hideable = NOTIFICATION_TYPES.filter((type) =>
      mutable.includes(NOTIFICATION_CLASS_BY_TYPE[type]),
    );

    // The D-5b premise: hiddenTypes is built by this exact expansion, so no mute row shape
    // can ever hide a health or security notification.
    for (const type of hideable) {
      expect(NOTIFICATION_CLASS_BY_TYPE[type]).not.toBe("act_now");
    }

    const actNowTypes = NOTIFICATION_TYPES.filter(
      (type) => NOTIFICATION_CLASS_BY_TYPE[type] === "act_now",
    );
    expect(actNowTypes.toSorted()).toEqual([
      "analysis_failing",
      "key_created",
      "keys_revoked",
      "slack_disconnected",
    ]);
    for (const type of actNowTypes) {
      expect(hideable).not.toContain(type);
    }
  });

  test("the wire refuses act_now before any handler runs", () => {
    expect(mutableNotificationClassSchema.safeParse("act_now").success).toBe(false);

    expect(
      settingsNotificationBellInputSchema.safeParse({ class: "act_now", shown: false }).success,
    ).toBe(false);
    expect(
      settingsNotificationBellInputSchema.safeParse({ class: "work", shown: false }).success,
    ).toBe(true);
  });
});

describe("the two route inputs name no ids and admit no extra keys", () => {
  test("a body smuggling an organization or user id is refused", () => {
    expect(
      settingsNotificationBellInputSchema.safeParse({
        class: "work",
        shown: true,
        organizationId: "someone-elses-org",
      }).success,
    ).toBe(false);

    expect(
      settingsNotificationDigestInputSchema.safeParse({
        cadence: "weekly",
        day: "friday",
        userId: "someone-else",
      }).success,
    ).toBe(false);

    expect(
      settingsNotificationDigestInputSchema.safeParse({ cadence: "weekly", day: "friday" }).success,
    ).toBe(true);
  });

  test("the digest input takes both dimensions every time — a day cannot exist without its cadence", () => {
    expect(settingsNotificationDigestInputSchema.safeParse({ cadence: "weekly" }).success).toBe(
      false,
    );
    expect(settingsNotificationDigestInputSchema.safeParse({ day: "friday" }).success).toBe(false);
  });
});

describe("absence is the default (D-6)", () => {
  test("the documented default is weekly on Monday, and the enums hold the ratified members", () => {
    expect(DIGEST_CADENCE_DEFAULT).toBe("weekly");
    expect(DIGEST_DAY_DEFAULT).toBe("monday");

    expect([...DIGEST_CADENCES]).toEqual(["weekly", "off"]);
    expect(WEEKDAYS).toHaveLength(7);
    expect(WEEKDAYS[0]).toBe("monday");
  });
});
