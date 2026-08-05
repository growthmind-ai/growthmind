import { describe, expect, test } from "bun:test";

import * as messagesModule from "../../src/session-source/messages";
import {
  ALL_CUSTOMER_FACING_MESSAGES,
  CONNECTION_STATE_MESSAGES,
  CONNECT_REFUSAL_MESSAGES,
  COUNTER_COMPLETENESS_STATEMENT,
  COUNTER_WINDOW_STATEMENT,
  EXCLUSION_REASON_LABELS,
  SOURCE_ABSENT_NOTICE,
  SOURCE_DEGRADED_NOTICE,
  expectedLagStatement,
  secondSourceRefusalMessage,
} from "../../src/session-source/messages";
import { connectRefusalCodeSchema, connectionStateSchema } from "../../src/session-source/types";

const LIVE_CLAIM = /\blive\b/i;

const EXISTING_CONNECTION = {
  host: "analytics.example.invalid",
  sourceProjectId: "s0-source-project",
};

function everyMessage(): string[] {
  return [
    ...ALL_CUSTOMER_FACING_MESSAGES,
    secondSourceRefusalMessage(EXISTING_CONNECTION),
    expectedLagStatement({ typicalSeconds: 85, worstCaseSeconds: 280 }),
  ];
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
    const maskedMessages = everyMessage().map((message) =>
      message.split(EXISTING_CONNECTION.sourceProjectId).join("s0-masked-project-id"),
    );

    const offenders = maskedMessages.filter((message) => BARE_STATUS.test(message));
    expect(offenders).toEqual([]);

    const statusLikeProjectId = "404";
    const rawWithStatusLikeId = secondSourceRefusalMessage({
      host: EXISTING_CONNECTION.host,
      sourceProjectId: statusLikeProjectId,
    });
    expect(BARE_STATUS.test(rawWithStatusLikeId)).toBe(true);
    expect(
      BARE_STATUS.test(rawWithStatusLikeId.split(statusLikeProjectId).join("s0-masked-project-id")),
    ).toBe(false);
  });

  test("the vendor's name never appears in a customer-facing message", () => {
    const offenders = everyMessage().filter((message) => /posthog/i.test(message));
    expect(offenders).toEqual([]);
  });

  test("the audit list is complete — every fixed constant is reachable through it", () => {
    const derivedFromExports: string[] = [];
    for (const [name, value] of Object.entries(messagesModule)) {
      if (name === "ALL_CUSTOMER_FACING_MESSAGES") continue;

      if (typeof value === "string") {
        derivedFromExports.push(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const entry of Object.values(value)) {
          if (typeof entry === "string") derivedFromExports.push(entry);
        }
      }
      // Functions (secondSourceRefusalMessage, expectedLagStatement) are parameterised,
      // not fixed constants. They are audited explicitly via `everyMessage` above
      // instead of enumerated here.
    }

    const registered = new Set(ALL_CUSTOMER_FACING_MESSAGES);
    const missing = derivedFromExports.filter((message) => !registered.has(message));
    expect(missing).toEqual([]);
    expect(ALL_CUSTOMER_FACING_MESSAGES.length).toBe(derivedFromExports.length);
  });
});

describe("state and refusal coverage", () => {
  test("every connection state and every connect refusal has a distinct plain-English message", () => {
    const statuses = connectionStateSchema.options.map((option) => option.shape.status.value);
    expect(statuses).toHaveLength(7);

    expect(Object.keys(CONNECTION_STATE_MESSAGES).toSorted()).toEqual(statuses.toSorted());
    expect(Object.keys(CONNECT_REFUSAL_MESSAGES).toSorted()).toEqual(
      connectRefusalCodeSchema.options.toSorted(),
    );

    const all = [
      ...Object.values(CONNECTION_STATE_MESSAGES),
      ...Object.values(CONNECT_REFUSAL_MESSAGES),
    ];
    expect(new Set(all).size).toBe(all.length);

    for (const message of all) {
      expect(message.trim().length).toBeGreaterThan(20);
      expect(message.trim().endsWith(".")).toBe(true);
    }
  });

  test("the set-aside labels cover every exclusion reason and read distinctly", () => {
    const labels = Object.values(EXCLUSION_REASON_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toHaveLength(6);
  });

  test("the second-source refusal names the existing attachment and the cutover path", () => {
    const message = secondSourceRefusalMessage(EXISTING_CONNECTION);

    expect(message).toContain(EXISTING_CONNECTION.host);
    expect(message).toContain(EXISTING_CONNECTION.sourceProjectId);
    expect(message).toContain("Detach");

    expect(message).not.toBe(CONNECT_REFUSAL_MESSAGES.second_source);
  });

  test("the absent, degraded, window, and completeness notices are pairwise distinct", () => {
    const notices = [
      SOURCE_ABSENT_NOTICE,
      SOURCE_DEGRADED_NOTICE,
      COUNTER_WINDOW_STATEMENT,
      COUNTER_COMPLETENESS_STATEMENT,
      CONNECTION_STATE_MESSAGES.connected_no_events_yet,
      CONNECTION_STATE_MESSAGES.not_connected,
    ];
    expect(new Set(notices).size).toBe(notices.length);
  });
});
