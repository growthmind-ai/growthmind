import { describe, expect, test } from "bun:test";

import * as messagesModule from "../../src/replay-source/messages";
import {
  ALL_REPLAY_SOURCE_MESSAGES,
  REPLAY_FAILURE_MESSAGES,
} from "../../src/replay-source/messages";
import { replayFailureCodeSchema } from "../../src/replay-source/types";

const LIVE_CLAIM = /\blive\b/i;

function everyMessage(): string[] {
  return [...ALL_REPLAY_SOURCE_MESSAGES];
}

describe("the plain-English audit", () => {
  test("no exported customer-facing message contains 'live' as a freshness claim", () => {
    const offenders = everyMessage().filter((message) => LIVE_CLAIM.test(message));
    expect(offenders).toEqual([]);
  });

  test("no exported customer-facing message contains a forbidden jargon token", () => {
    const jargon = [
      "tenant",
      "adapter",
      "watermark",
      "idempotent",
      "upsert",
      "jsonb",
      "endpoint",
      "null",
      "undefined",
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

  test("no exported customer-facing message contains a bare HTTP status code", () => {
    const BARE_STATUS = /\b[1-5]\d{2}\b/;
    const offenders = everyMessage().filter((message) => BARE_STATUS.test(message));
    expect(offenders).toEqual([]);
  });

  test("the audit list is complete — every fixed constant is reachable through it", () => {
    const derivedFromExports: string[] = [];
    for (const [name, value] of Object.entries(messagesModule)) {
      if (name === "ALL_REPLAY_SOURCE_MESSAGES") continue;

      if (typeof value === "string") {
        derivedFromExports.push(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const entry of Object.values(value)) {
          if (typeof entry === "string") derivedFromExports.push(entry);
        }
      }
    }

    const registered = new Set(ALL_REPLAY_SOURCE_MESSAGES);
    const missing = derivedFromExports.filter((message) => !registered.has(message));
    expect(missing).toEqual([]);
    expect(ALL_REPLAY_SOURCE_MESSAGES.length).toBe(derivedFromExports.length);
  });
});

const PULL_STOPS_NEEDING_A_REASON = ["page_cap", "byte_cap"] as const;

function pullStopMessages(): Record<string, unknown> {
  const exported = (messagesModule as unknown as Record<string, unknown>).REPLAY_PULL_STOP_MESSAGES;

  if (typeof exported !== "object" || exported === null) {
    throw new Error(
      "packages/shared/src/replay-source/messages.ts exports no REPLAY_PULL_STOP_MESSAGES. " +
        "ADD §5.3 requires one plain-English sentence per non-exhausted pull stop, so O-044 can " +
        'say "N recordings withheld" without translating an error code.',
    );
  }

  return exported as Record<string, unknown>;
}

describe("the reason a pull stopped short", () => {
  test("should carry a plain-English reason for every pull stop that is not exhausted", () => {
    const messages = pullStopMessages();

    for (const stop of PULL_STOPS_NEEDING_A_REASON) {
      const message = messages[stop];
      expect(typeof message).toBe("string");

      const sentence = String(message).trim();
      expect(sentence.length).toBeGreaterThan(20);
      expect(sentence.endsWith(".")).toBe(true);

      expect(sentence).not.toMatch(/\b[a-z]+_[a-z]+\b/);
      expect(sentence).not.toMatch(/\b[1-5]\d{2}\b/);
    }
  });
});

describe("failure code coverage", () => {
  test("REPLAY_FAILURE_MESSAGES covers exactly the six replay failure codes", () => {
    const codes = replayFailureCodeSchema.options;
    expect(codes.toSorted()).toEqual(
      (
        [
          "invalid_credentials",
          "missing_read_scope",
          "recording_not_found",
          "unreachable",
          "rate_limited",
          "misconfigured",
        ] as const
      ).toSorted(),
    );

    expect(Object.keys(REPLAY_FAILURE_MESSAGES).toSorted()).toEqual(codes.toSorted());
  });

  test("every replay failure message is a distinct, non-empty plain-English sentence", () => {
    const all = Object.values(REPLAY_FAILURE_MESSAGES);
    expect(new Set(all).size).toBe(all.length);

    for (const message of all) {
      expect(message.trim().length).toBeGreaterThan(20);
      expect(message.trim().endsWith(".")).toBe(true);
    }
  });

  // Updated with the behaviour, not softened: O-050 D-10 removed the app.rrweb.com address this
  // row used to demand. The message named a vendor this installation does not talk to — the
  // shipped source is PostHog — so it now names the action and no address at all.
  test("the missing_read_scope message says the key can only record, names read access, and gives no address", () => {
    const message = REPLAY_FAILURE_MESSAGES.missing_read_scope;

    expect(/\brecord/i.test(message)).toBe(true);
    expect(/\bread\b/i.test(message)).toBe(true);
    expect(message).not.toMatch(/https?:\/\//i);
    expect(message).not.toMatch(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|net|dev|org|ai|app)\b/i);
  });

  // The vendor behind our plumbing is never named: it dates the copy the day a second one
  // arrives, and it carries an id from somewhere we do not own.
  test("no message names a vendor", () => {
    for (const message of Object.values(REPLAY_FAILURE_MESSAGES)) {
      const lowered = message.toLowerCase();
      expect(lowered).not.toContain("rrweb");
      expect(lowered).not.toContain("posthog");
    }
  });
});
