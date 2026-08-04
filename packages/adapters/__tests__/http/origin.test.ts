import { describe, expect, test } from "bun:test";

import { isSameOriginAsHost } from "../../src/http/origin";

const REAL_HOST = "https://eu.posthog.com";

describe("isSameOriginAsHost bounds where a credential-bearing request may go", () => {
  test("allows the next page on the configured origin", () => {
    expect(isSameOriginAsHost(`${REAL_HOST}/api/projects/1/events?after=x`, REAL_HOST)).toBe(true);
  });

  test("refuses an absolute cursor pointing at another origin", () => {
    expect(isSameOriginAsHost("https://attacker.tld/x", REAL_HOST)).toBe(false);
  });

  test("refuses a cursor that downgrades the scheme on the same hostname", () => {
    expect(isSameOriginAsHost("http://eu.posthog.com/api/x", REAL_HOST)).toBe(false);
  });

  test("refuses a cursor on a different port of the same hostname", () => {
    expect(isSameOriginAsHost("https://eu.posthog.com:8443/api/x", REAL_HOST)).toBe(false);
  });

  test("refuses a cursor carrying embedded credentials", () => {
    expect(isSameOriginAsHost("https://u:p@eu.posthog.com/api/x", REAL_HOST)).toBe(false);
  });

  test("refuses everything when the configured host is itself invalid", () => {
    expect(isSameOriginAsHost("https://169.254.169.254/x", "https://169.254.169.254")).toBe(false);
  });
});
