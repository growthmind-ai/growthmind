// ADD §9 items 46–48 — failure mapping at the PostHog boundary.
//
// Addendum A SEC-D: BOTH observed auth failures are 401, NEVER 403, and they
// share the `{type, code, detail, attr}` envelope with the 429. So one parser
// serves both and branching is on `code`, not on the status alone. No 403
// branch is coded, because a 403 was never observed.
//
// `detail` is never surfaced verbatim: "Personal API key found in request
// Authorization header is invalid." is exactly the jargon the plain-English
// bar forbids.
import { describe, expect, test } from "bun:test";

import { mapFailure } from "../../src/posthog/errors";
import { REDACTED_PLACEHOLDER } from "../../src/posthog/scrub";
import { AD_FAKE_PERSONAL_KEY } from "../helpers/fakes";

/** The three envelopes pinned against the live API (SEC-D + ROW 5). */
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
  // Item 46 — FR-9 / FR-7.
  test("a 401 maps to invalid_credentials by envelope code, and no key material appears in the message", () => {
    const failure = mapFailure(401, AD_INVALID_KEY_BODY);
    expect(failure.code).toBe("invalid_credentials");

    // A missing Authorization header is the same 401 with a different `code`.
    // Branching on the status alone could not tell these apart.
    expect(mapFailure(401, AD_NO_HEADER_BODY).code).toBe("invalid_credentials");

    // FR-7: nothing that could carry the customer's key ever reaches a
    // customer-facing or stored string.
    const messages = [failure.message, mapFailure(401, AD_NO_HEADER_BODY).message];
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(AD_FAKE_PERSONAL_KEY);
      expect(message).not.toContain("phx_");
      expect(message).not.toContain("Authorization");
    }
  });

  // Item 47 — FR-9: three different things to fix, told apart.
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

    // Pairwise distinct in BOTH the code and the message — a screen must never
    // present two different fixes the same way.
    const codes = [notFound.code, invalidCredentials.code, unreachable.code];
    expect(new Set(codes).size).toBe(3);
    const texts = [notFound.message, invalidCredentials.message, unreachable.message];
    expect(new Set(texts).size).toBe(3);
  });

  // Item 48 — SEC-D / the plain-English bar.
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
      // The specific jargon fragments the bar exists to keep out.
      expect(failure.message).not.toContain("Personal API key");
      expect(failure.message).not.toContain("Request was throttled");
      expect(failure.message).not.toContain("Authentication credentials");
      // A bare 3-digit status is jargon too.
      expect(failure.message).not.toMatch(/\b\d{3}\b/);
    }

    // The throttled envelope is the same shape and maps by `code`.
    expect(mapFailure(429, AD_THROTTLED_BODY).code).toBe("rate_limited");
  });

  // CR-6 — the wiring itself. Nothing in `SOURCE_FAILURE_MESSAGES` is
  // expected to ever contain a secret (the messages are a fixed,
  // hand-written set), so this proves `mapFailure` actually CALLS
  // `scrubSecrets` on the message it builds, rather than merely accepting an
  // unused `secrets` parameter — a substring lifted straight out of the
  // `unreachable` sentence stands in for "a value the caller told
  // `mapFailure` to treat as a secret".
  test("mapFailure scrubs every secret it is handed out of the returned message", () => {
    const clean = mapFailure(503, {});
    const fragment = "reach that address";
    expect(clean.message).toContain(fragment);

    const scrubbed = mapFailure(503, {}, [fragment]);
    expect(scrubbed.code).toBe("unreachable");
    expect(scrubbed.message).not.toContain(fragment);
    expect(scrubbed.message).toContain(REDACTED_PLACEHOLDER);

    // The credential shape `client.ts` actually threads through
    // (`config.personalApiKey`) is scrubbed the same way, even though it
    // structurally never appears in a message today.
    expect(mapFailure(401, AD_INVALID_KEY_BODY, [AD_FAKE_PERSONAL_KEY]).message).not.toContain(
      AD_FAKE_PERSONAL_KEY,
    );
  });
});
