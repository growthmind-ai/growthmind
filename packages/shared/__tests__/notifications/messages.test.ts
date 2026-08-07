import { describe, expect, test } from "bun:test";

import * as messagesModule from "../../src/notifications/messages";
import {
  ALL_NOTIFICATION_MESSAGES,
  NOTIFICATION_FAILURE_SENTENCES,
  NOTIFICATION_QUIET_SENTENCES,
  QUIET_NO_CHANNEL_CHIP_LABEL,
  QUIET_UNKNOWN_REASON_CHIP_LABEL,
  quietChipLabel,
} from "../../src/notifications/messages";
import {
  notificationQuietReasonSchema,
  notificationSendFailureReasonSchema,
} from "../../src/notifications/types";

// The summary/messages.test.ts audit shape, applied to the bell's copy: jargon scan,
// bare-status scan, and the completeness inversion that catches a string added to the
// module but never enrolled in the registry.

function everyMessage(): string[] {
  return [...ALL_NOTIFICATION_MESSAGES];
}

describe("the plain-English audit", () => {
  test("no registered notification message contains a forbidden jargon token", () => {
    const jargon = [
      "tenant",
      "adapter",
      "endpoint",
      "null",
      "undefined",
      "schema",
      "enum",
      "payload",
      "idempotent",
    ];

    const offenders: string[] = [];
    for (const message of everyMessage()) {
      for (const token of jargon) {
        if (new RegExp(`\\b${token}\\b`, "i").test(message)) {
          offenders.push(`${token} in: ${message}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no registered notification message contains a bare HTTP status code", () => {
    const BARE_STATUS = /\b[1-5]\d{2}\b/;
    const offenders = everyMessage().filter((message) => BARE_STATUS.test(message));
    expect(offenders).toEqual([]);
  });

  test("the audit list is complete — every fixed constant is reachable through it", () => {
    const derivedFromExports: string[] = [];
    for (const [name, value] of Object.entries(messagesModule)) {
      if (name === "ALL_NOTIFICATION_MESSAGES") continue;
      if (typeof value === "string") {
        derivedFromExports.push(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const entry of Object.values(value)) {
          if (typeof entry === "string") derivedFromExports.push(entry);
        }
      }
    }

    // The registry dedupes on purpose — every failure code renders the same sentence — so
    // the check is set equality in both directions rather than a length match.
    const registered = new Set(ALL_NOTIFICATION_MESSAGES);
    const derived = new Set(derivedFromExports);

    expect(derivedFromExports.filter((message) => !registered.has(message))).toEqual([]);
    expect([...registered].filter((message) => !derived.has(message))).toEqual([]);
    expect(new Set(ALL_NOTIFICATION_MESSAGES).size).toBe(ALL_NOTIFICATION_MESSAGES.length);
  });
});

describe("receipt sentence maps — union totality", () => {
  test("every failure CODE has exactly one registered sentence and no schema admits null", () => {
    expect(Object.keys(NOTIFICATION_FAILURE_SENTENCES).toSorted()).toEqual(
      [...notificationSendFailureReasonSchema.options].toSorted(),
    );
    expect(Object.keys(NOTIFICATION_QUIET_SENTENCES).toSorted()).toEqual(
      [...notificationQuietReasonSchema.options].toSorted(),
    );

    expect(notificationSendFailureReasonSchema.safeParse(null).success).toBe(false);
    expect(notificationQuietReasonSchema.safeParse(undefined).success).toBe(false);
  });

  test("a quiet reason minted after this build degrades to the plain chip, never a code", () => {
    expect(quietChipLabel("no_channel")).toBe(QUIET_NO_CHANNEL_CHIP_LABEL);
    expect(quietChipLabel("muted_by_settings")).toBe(QUIET_UNKNOWN_REASON_CHIP_LABEL);
    expect(quietChipLabel("muted_by_settings")).not.toContain("muted_by_settings");
  });
});
