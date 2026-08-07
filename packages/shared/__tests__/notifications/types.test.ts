import { describe, expect, test } from "bun:test";

import { postFailureCodeSchema } from "../../src/delivery/poster";
import {
  ACTIONABLE_CLASSES,
  NOTIFICATION_CLASS_BY_TYPE,
  NOTIFICATION_QUIET_REASONS,
  NOTIFICATION_SEND_FAILURE_REASONS,
  NOTIFICATION_TYPES,
} from "../../src/notifications/types";

// ADD §3: the vocabulary is the contract. These lock membership so a later job growing a
// member without its emitter — the O-026 D11 dead wire — fails here by name.

describe("the notification type enum is exactly the emitters that exist", () => {
  test("the three job-1 members and no others", () => {
    expect([...NOTIFICATION_TYPES].toSorted()).toEqual([
      "agent_first_contact",
      "finding_delivered",
      "keys_revoked",
    ]);
  });

  test("every type has a class — the map is total over the enum", () => {
    expect(Object.keys(NOTIFICATION_CLASS_BY_TYPE).toSorted()).toEqual(
      [...NOTIFICATION_TYPES].toSorted(),
    );
  });

  test("the classes are the ratified ones: work, act_now, work", () => {
    expect(NOTIFICATION_CLASS_BY_TYPE.finding_delivered).toBe("work");
    expect(NOTIFICATION_CLASS_BY_TYPE.keys_revoked).toBe("act_now");
    expect(NOTIFICATION_CLASS_BY_TYPE.agent_first_contact).toBe("work");
  });

  test("the actionable classes are act_now and work — the send-invariant's premise", () => {
    expect([...ACTIONABLE_CLASSES].toSorted()).toEqual(["act_now", "work"]);
  });
});

describe("the send receipt unions carry only what job 1 can produce", () => {
  test("quiet reasons are exactly no_channel (OQ-4)", () => {
    expect([...NOTIFICATION_QUIET_REASONS]).toEqual(["no_channel"]);
  });

  test("failure reasons are the poster's codes plus queue_unavailable and nothing else", () => {
    const registered: readonly string[] = NOTIFICATION_SEND_FAILURE_REASONS;
    const posterCodes: readonly string[] = postFailureCodeSchema.options;

    expect([...registered].toSorted()).toEqual([...posterCodes, "queue_unavailable"].toSorted());
  });
});
