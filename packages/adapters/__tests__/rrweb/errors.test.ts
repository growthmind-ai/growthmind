import type { ReplayFailure } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { mapRrwebFailure } from "../../src/rrweb/errors";

type ReplayFailureContext = "validate" | "events";

function map(
  status: number,
  body: unknown,
  context: ReplayFailureContext,
  secrets?: readonly string[],
): ReplayFailure {
  return mapRrwebFailure(status, body, context, secrets) as ReplayFailure;
}

const AD_PLANTED_READ_KEY = "rrweb_read_key_PLANTED123";

// The live probe (2026-08-04) returned this as a plain-text body, not JSON.
const AD_MISSING_SCOPE_TEXT_BODY: unknown =
  "Upstream authentication error: missing scope read:recordingMetadata";

const AD_MISSING_SCOPE_JSON_BODY: unknown = {
  detail: "Upstream authentication error: missing scope read:recordingMetadata",
};

const AD_GENERIC_401_BODY: unknown = { detail: "Invalid API key." };

describe("mapRrwebFailure", () => {
  test("a 401 whose plain-text body names a missing scope maps to missing_read_scope", () => {
    expect(map(401, AD_MISSING_SCOPE_TEXT_BODY, "events").code).toBe("missing_read_scope");
  });

  test("a 401 whose {detail} JSON body names a missing scope maps to missing_read_scope", () => {
    expect(map(401, AD_MISSING_SCOPE_JSON_BODY, "events").code).toBe("missing_read_scope");
  });

  test("a 401 with no scope wording maps to invalid_credentials, not missing_read_scope", () => {
    expect(map(401, AD_GENERIC_401_BODY, "events").code).toBe("invalid_credentials");
  });

  test("403 maps to invalid_credentials", () => {
    expect(map(403, { detail: "Forbidden" }, "events").code).toBe("invalid_credentials");
  });

  test("404 maps to recording_not_found when reading one recording's events", () => {
    expect(map(404, {}, "events").code).toBe("recording_not_found");
  });

  test("404 maps to misconfigured when validating the connection, since the base path itself is unverified", () => {
    expect(map(404, {}, "validate").code).toBe("misconfigured");
  });

  test("429 maps to rate_limited", () => {
    expect(map(429, { detail: "Throttled" }, "events").code).toBe("rate_limited");
  });

  test("a network-level failure with no HTTP status maps to unreachable", () => {
    expect(map(0, undefined, "events").code).toBe("unreachable");
  });

  test("500 maps to unreachable", () => {
    expect(map(500, { detail: "Internal Server Error" }, "events").code).toBe("unreachable");
  });

  test("the missing_read_scope message names app.rrweb.com/api-keys and never the vendor's own wording", () => {
    const failure = map(401, AD_MISSING_SCOPE_TEXT_BODY, "events");
    expect(failure.message).toContain("app.rrweb.com/api-keys");
    expect(failure.message).not.toBe(AD_MISSING_SCOPE_TEXT_BODY);
    expect(failure.message).not.toContain("missing scope read:recordingMetadata");
  });

  test("vendor detail text is never surfaced verbatim in any mapped message", () => {
    const cases: readonly [number, unknown, ReplayFailureContext][] = [
      [401, AD_GENERIC_401_BODY, "events"],
      [429, { detail: "Throttled" }, "events"],
      [500, { detail: "Internal Server Error" }, "events"],
    ];

    for (const [status, body, context] of cases) {
      const failure = map(status, body, context);
      const detail = (body as { detail: string }).detail;

      expect(failure.message).not.toBe(detail);
      expect(failure.message).not.toContain(detail);
    }
  });

  test("a planted read key never appears in the message, even when the vendor body echoes it back", () => {
    const echoingBody = {
      detail: `Upstream authentication error: missing scope read:recordingMetadata for key ${AD_PLANTED_READ_KEY}`,
    };

    const failure = map(401, echoingBody, "events", [AD_PLANTED_READ_KEY]);

    expect(failure.code).toBe("missing_read_scope");
    expect(failure.message).not.toContain(AD_PLANTED_READ_KEY);
  });

  test("every mapped code carries a non-empty message, and the six codes stay distinct", () => {
    const failures = [
      map(401, AD_MISSING_SCOPE_TEXT_BODY, "events"),
      map(401, AD_GENERIC_401_BODY, "events"),
      map(404, {}, "events"),
      map(404, {}, "validate"),
      map(429, {}, "events"),
      map(500, {}, "events"),
    ];

    for (const failure of failures) {
      expect(failure.message.length).toBeGreaterThan(0);
    }

    const codes = failures.map((failure) => failure.code);
    expect(new Set(codes).size).toBe(6);
  });
});
