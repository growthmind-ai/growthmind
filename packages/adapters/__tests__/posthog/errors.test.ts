import { describe, expect, test } from "bun:test";

import { mapFailure } from "../../src/posthog/errors";
import { REDACTED_PLACEHOLDER } from "../../src/posthog/scrub";
import { AD_FAKE_PERSONAL_KEY } from "../helpers/fakes";

const AD_INVALID_KEY_BODY = {
  type: "authentication_error",
  code: "authentication_failed",
  detail: "Personal API key found in request Authorization header is invalid.",
  attr: null,
};

const AD_NO_HEADER_BODY = {
  type: "authentication_error",
  code: "not_authenticated",
  detail: "Authentication credentials were not provided.",
  attr: null,
};

const AD_THROTTLED_BODY = {
  type: "throttled_error",
  code: "throttled",
  detail: "Request was throttled. Expected available in 59 seconds.",
  attr: null,
};

describe("mapFailure", () => {
  test("a 401 maps to invalid_credentials by envelope code, and no key material appears in the message", () => {
    const failure = mapFailure(401, AD_INVALID_KEY_BODY);
    expect(failure.code).toBe("invalid_credentials");

    expect(mapFailure(401, AD_NO_HEADER_BODY).code).toBe("invalid_credentials");

    const messages = [failure.message, mapFailure(401, AD_NO_HEADER_BODY).message];
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(AD_FAKE_PERSONAL_KEY);
      expect(message).not.toContain("phx_");
      expect(message).not.toContain("Authorization");
    }
  });

  test("an authenticated read against a wrong project maps to project_not_found, distinctly from invalid_credentials and unreachable", () => {
    const notFound = mapFailure(404, {
      type: "invalid_request",
      code: "not_found",
      detail: "Project not found.",
      attr: null,
    });
    const invalidCredentials = mapFailure(401, AD_INVALID_KEY_BODY);
    const unreachable = mapFailure(503, {});

    expect(notFound.code).toBe("project_not_found");
    expect(invalidCredentials.code).toBe("invalid_credentials");
    expect(unreachable.code).toBe("unreachable");

    const codes = [notFound.code, invalidCredentials.code, unreachable.code];
    expect(new Set(codes).size).toBe(3);
    const texts = [notFound.message, invalidCredentials.message, unreachable.message];
    expect(new Set(texts).size).toBe(3);
  });

  test('PostHog "detail" text is never surfaced verbatim in a customer-facing message', () => {
    const cases: readonly [number, Record<string, unknown>][] = [
      [401, AD_INVALID_KEY_BODY],
      [401, AD_NO_HEADER_BODY],
      [429, AD_THROTTLED_BODY],
    ];

    for (const [status, body] of cases) {
      const failure = mapFailure(status, body);
      const detail = String(body.detail);

      expect(failure.message).not.toBe(detail);
      expect(failure.message).not.toContain(detail);

      expect(failure.message).not.toContain("Personal API key");
      expect(failure.message).not.toContain("Request was throttled");
      expect(failure.message).not.toContain("Authentication credentials");

      expect(failure.message).not.toMatch(/\b\d{3}\b/);
    }

    expect(mapFailure(429, AD_THROTTLED_BODY).code).toBe("rate_limited");
  });

  test("mapFailure scrubs every secret it is handed out of the returned message", () => {
    const clean = mapFailure(503, {});
    const fragment = "reach that address";
    expect(clean.message).toContain(fragment);

    const scrubbed = mapFailure(503, {}, [fragment]);
    expect(scrubbed.code).toBe("unreachable");
    expect(scrubbed.message).not.toContain(fragment);
    expect(scrubbed.message).toContain(REDACTED_PLACEHOLDER);

    expect(mapFailure(401, AD_INVALID_KEY_BODY, [AD_FAKE_PERSONAL_KEY]).message).not.toContain(
      AD_FAKE_PERSONAL_KEY,
    );
  });
});
