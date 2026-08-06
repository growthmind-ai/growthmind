import { describe, expect, test } from "bun:test";

import * as messagesModule from "../../src/companies/messages";
import { ALL_COMPANIES_MESSAGES } from "../../src/companies/messages";

const LIVE_CLAIM = /\blive\b/i;

function everyMessage(): string[] {
  return [...ALL_COMPANIES_MESSAGES];
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
      if (name === "ALL_COMPANIES_MESSAGES") continue;

      if (typeof value === "string") {
        derivedFromExports.push(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const entry of Object.values(value)) {
          if (typeof entry === "string") derivedFromExports.push(entry);
        }
      }
    }

    const registered = new Set(ALL_COMPANIES_MESSAGES);
    const missing = derivedFromExports.filter((message) => !registered.has(message));
    expect(missing).toEqual([]);
    expect(ALL_COMPANIES_MESSAGES.length).toBe(derivedFromExports.length);
  });

  test("no message leaks the raw identityEmailDomain column name", () => {
    const offenders = everyMessage().filter((message) => message.includes("identityEmailDomain"));
    expect(offenders).toEqual([]);
  });
});
