import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { isRetryablePostFailure, postFailureCodeSchema } from "../../src/delivery/poster";
import {
  ACTIONABLE_CLASSES,
  NOTIFICATION_CLASS_BY_TYPE,
  NOTIFICATION_QUIET_REASONS,
  NOTIFICATION_SEND_FAILURE_REASONS,
  NOTIFICATION_SEND_STATUSES,
  NOTIFICATION_SUBJECT_KINDS,
  NOTIFICATION_TYPES,
  isRetryableSendFailure,
  type NotificationSendFailureReason,
} from "../../src/notifications/types";

// ADD §3: the vocabulary is the contract. These lock membership so a later job growing a
// member without its emitter — the O-026 D11 dead wire — fails here by name.

describe("the notification type enum is exactly the emitters that exist", () => {
  test("the job-1 three plus the five O-051 job-2 members, and no others", () => {
    expect([...NOTIFICATION_TYPES].toSorted()).toEqual([
      "agent_first_contact",
      "analysis_failing",
      "backfill_complete",
      "digest",
      "finding_delivered",
      "key_created",
      "keys_revoked",
      "slack_disconnected",
    ]);
  });

  test("every type has a class — the map is total over the enum", () => {
    expect(Object.keys(NOTIFICATION_CLASS_BY_TYPE).toSorted()).toEqual(
      [...NOTIFICATION_TYPES].toSorted(),
    );
  });

  test("the classes are the ratified ones — health is act_now, the two summaries are record", () => {
    expect(NOTIFICATION_CLASS_BY_TYPE.finding_delivered).toBe("work");
    expect(NOTIFICATION_CLASS_BY_TYPE.keys_revoked).toBe("act_now");
    expect(NOTIFICATION_CLASS_BY_TYPE.agent_first_contact).toBe("work");

    // Ruling 4: the card's "Health and security: always sent" line is true by this map.
    expect(NOTIFICATION_CLASS_BY_TYPE.key_created).toBe("act_now");
    expect(NOTIFICATION_CLASS_BY_TYPE.slack_disconnected).toBe("act_now");
    expect(NOTIFICATION_CLASS_BY_TYPE.analysis_failing).toBe("act_now");

    expect(NOTIFICATION_CLASS_BY_TYPE.backfill_complete).toBe("record");
    expect(NOTIFICATION_CLASS_BY_TYPE.digest).toBe("record");
  });

  test("the actionable classes are act_now and work — the send-invariant's premise", () => {
    expect([...ACTIONABLE_CLASSES].toSorted()).toEqual(["act_now", "work"]);
  });

  test("the subject kinds are the six the five emitters point at", () => {
    expect([...NOTIFICATION_SUBJECT_KINDS].toSorted()).toEqual([
      "agent_key",
      "finding",
      "organization",
      "project",
      "slack_connection",
      "source_connection",
    ]);
  });
});

describe("the schema's second copy of the type list equals the shared one", () => {
  // The Drizzle column enum is a hand-kept second copy of NOTIFICATION_TYPES
  // (schema/notifications.ts), and shared cannot import db — so the lockstep is read off
  // the schema source, and a half-done edit fails here rather than at runtime.
  test("a type added to either copy without the other fails here", () => {
    const schemaPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "db",
      "src",
      "schema",
      "notifications.ts",
    );
    const source = readFileSync(schemaPath, "utf8");

    const declaration = source.match(/const NOTIFICATION_TYPES = \[([^\]]+)\]/);
    if (!declaration?.[1]) {
      throw new Error("schema/notifications.ts no longer declares NOTIFICATION_TYPES");
    }

    const schemaCopy = [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

    expect(schemaCopy.toSorted()).toEqual([...NOTIFICATION_TYPES].toSorted());
  });
});

describe("the send receipt unions carry exactly what the dispatch spine can produce", () => {
  test("quiet reasons are no_channel and digest (D-7)", () => {
    expect([...NOTIFICATION_QUIET_REASONS].toSorted()).toEqual(["digest", "no_channel"]);
  });

  test("send statuses gain pending, the lease's in-flight arm (D-1)", () => {
    expect([...NOTIFICATION_SEND_STATUSES].toSorted()).toEqual([
      "failed",
      "pending",
      "quiet",
      "sent",
    ]);
  });

  test("failure reasons are the poster's codes plus queue_unavailable and nothing else", () => {
    const registered: readonly string[] = NOTIFICATION_SEND_FAILURE_REASONS;
    const posterCodes: readonly string[] = postFailureCodeSchema.options;

    expect([...registered].toSorted()).toEqual([...posterCodes, "queue_unavailable"].toSorted());
  });
});

describe("isRetryableSendFailure is total and delegates to the poster's predicate", () => {
  // Written as a record so a reason added to the union is a compile error here — an
  // unclassified retry cannot exist (D-2 constraint 2).
  const EXPECTED = {
    call_failed: true,
    rejected: false,
    not_authorised: false,
    channel_unavailable: false,
    queue_unavailable: true,
  } as const satisfies Record<NotificationSendFailureReason, boolean>;

  test("every member of the union is classified, and only the two transient codes retry", () => {
    for (const reason of NOTIFICATION_SEND_FAILURE_REASONS) {
      expect({ reason, retryable: isRetryableSendFailure(reason) }).toEqual({
        reason,
        retryable: EXPECTED[reason],
      });
    }
  });

  test("every poster code answers exactly what the poster's own predicate answers", () => {
    for (const code of postFailureCodeSchema.options) {
      expect(isRetryableSendFailure(code)).toBe(isRetryablePostFailure(code));
    }
  });
});
