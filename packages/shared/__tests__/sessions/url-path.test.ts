import { describe, expect, test } from "bun:test";

import {
  URL_PATH_NORMALISATION_VERSION,
  isNormalisedUrlPath,
  normaliseUrlPath,
} from "../../src/sessions/url-path";

const CAMPAIGN_URL = "https://probe.example.invalid/app/step/11?utm_source=probe&q=11";
const OTHER_CAMPAIGN_URL = "https://probe.example.invalid/app/step/11?utm_source=newsletter";

describe("normaliseUrlPath", () => {
  test("strips the query string and fragment so a UTM parameter cannot fork the surface", () => {
    expect(normaliseUrlPath(null, CAMPAIGN_URL)).toBe("/app/step/11");
    expect(normaliseUrlPath(null, OTHER_CAMPAIGN_URL)).toBe("/app/step/11");
    expect(normaliseUrlPath(null, CAMPAIGN_URL)).toBe(normaliseUrlPath(null, OTHER_CAMPAIGN_URL));

    expect(normaliseUrlPath(null, "https://probe.example.invalid/pricing#faq")).toBe("/pricing");
    expect(normaliseUrlPath(null, "https://probe.example.invalid/pricing?ref=x#faq")).toBe(
      "/pricing",
    );

    expect(normaliseUrlPath("/app/step/11", CAMPAIGN_URL)).toBe(
      normaliseUrlPath("/app/step/11", null),
    );
  });

  test("prefers $pathname and falls back to the path parsed out of $current_url", () => {
    expect(normaliseUrlPath("/app/step/11", CAMPAIGN_URL)).toBe("/app/step/11");
    expect(normaliseUrlPath(null, CAMPAIGN_URL)).toBe("/app/step/11");
    expect(normaliseUrlPath("/checkout", null)).toBe("/checkout");
  });

  test("the host is not part of the value, so one path is one surface across environments", () => {
    expect(normaliseUrlPath(null, "https://probe.example.invalid/pricing")).toBe("/pricing");
    expect(normaliseUrlPath(null, "https://other.example.invalid/pricing")).toBe("/pricing");
  });

  test("lowercases and removes a trailing slash, except on the root path", () => {
    expect(normaliseUrlPath("/App/Step", null)).toBe("/app/step");
    expect(normaliseUrlPath("/pricing/", null)).toBe("/pricing");
    expect(normaliseUrlPath("/", null)).toBe("/");
    expect(normaliseUrlPath(null, "https://probe.example.invalid/")).toBe("/");
    expect(normaliseUrlPath(null, "https://probe.example.invalid")).toBe("/");
  });

  test("returns null when neither input yields a usable path — an absent path is not an error", () => {
    expect(normaliseUrlPath(null, null)).toBeNull();
    expect(normaliseUrlPath("", "")).toBeNull();
    expect(normaliseUrlPath("", null)).toBeNull();
    expect(normaliseUrlPath(null, "not-a-url")).toBeNull();
  });

  test("the normalisation rules are versioned", () => {
    expect(URL_PATH_NORMALISATION_VERSION).toBe(3);
  });
});

describe("normaliseUrlPath is idempotent (B-013)", () => {
  // The invariant `assertNormalisedSurface` is built on: normalised exactly when re-normalising
  // is a no-op. A doubled slash broke it, and the throw landed in the findings path.
  const PATHS = [
    "/app//step",
    "/app//",
    "//",
    "///",
    "//app",
    "/app///step//11/",
    "/",
    "/pricing",
    "/verify/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpM",
  ];

  test("re-normalising its own output changes nothing, for every shape", () => {
    for (const path of PATHS) {
      const once = normaliseUrlPath(path, null);
      expect(once).not.toBeNull();
      expect(normaliseUrlPath(once, null)).toBe(once);
      expect(isNormalisedUrlPath(once!)).toBe(true);
    }
  });

  test("collapses repeated slashes rather than leaving one behind", () => {
    expect(normaliseUrlPath("/app//step", null)).toBe("/app/step");
    expect(normaliseUrlPath("/app//", null)).toBe("/app");
    expect(normaliseUrlPath("//", null)).toBe("/");
    expect(normaliseUrlPath("/app///step//11/", null)).toBe("/app/step/11");

    // The path a browser reports for a doubled-slash link, which is what intake persists.
    expect(normaliseUrlPath(null, "https://app.example.invalid/app//step")).toBe("/app/step");
  });
});

describe("normaliseUrlPath redacts dot-separated and padded token segments (B-013)", () => {
  const JWT =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUifQ." +
    "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  test("redacts a JWT, which survived whole-segment matching because it carries dots", () => {
    expect(normaliseUrlPath(`/verify/${JWT}`, null)).toBe("/verify/:id");
    expect(normaliseUrlPath(`/verify/${JWT}`, null)).not.toContain("eyJ");
    expect(isNormalisedUrlPath(`/verify/${JWT}`)).toBe(false);
  });

  test("redacts a padded base64 token, whose = and + were outside the character class", () => {
    expect(normaliseUrlPath("/download/Kx9mQ2vT8pL4wZ7nR3sB+g==", null)).toBe("/download/:id");
    expect(normaliseUrlPath("/download/YWRtaW46c3VwZXJzZWNyZXQ=", null)).toBe("/download/:id");
  });

  test("near miss: a dotted filename is left alone — the parts are short, not a token", () => {
    expect(normaliseUrlPath("/docs/report.pdf", null)).toBe("/docs/report.pdf");
    expect(normaliseUrlPath("/releases/v1.2.3", null)).toBe("/releases/v1.2.3");
    expect(normaliseUrlPath("/u/jane.doe/settings", null)).toBe("/u/jane.doe/settings");
  });
});

describe("normaliseUrlPath redacts identifier-shaped path segments", () => {
  test("redacts an email-shaped segment and nothing else in the path", () => {
    expect(normaliseUrlPath("/u/jane.doe@acme.example.invalid/settings", null)).toBe(
      "/u/:id/settings",
    );
  });

  test("redacts a UUID segment, any casing", () => {
    expect(normaliseUrlPath("/orders/550e8400-e29b-41d4-a716-446655440000", null)).toBe(
      "/orders/:id",
    );
    expect(normaliseUrlPath("/orders/550E8400-E29B-41D4-A716-446655440000", null)).toBe(
      "/orders/:id",
    );
  });

  test("redacts a long hex run — the shape of a raw reset token", () => {
    expect(normaliseUrlPath("/reset-password/9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c", null)).toBe(
      "/reset-password/:id",
    );
  });

  test("redacts a long base64url run that carries an uppercase letter", () => {
    expect(normaliseUrlPath("/verify/Kx9mQ2vT8pL4wZ7nR3sB", null)).toBe("/verify/:id");
  });

  test("redacts a long digit run — a numeric order/invoice/reset-code id", () => {
    expect(normaliseUrlPath("/invoices/123456789012", null)).toBe("/invoices/:id");
  });

  test("near miss: an ordinary short slug is left alone", () => {
    expect(normaliseUrlPath("/pricing", null)).toBe("/pricing");
  });

  test("near miss: a long kebab-case slug with a digit is left alone", () => {
    expect(normaliseUrlPath("/blog/how-we-scaled-to-1m", null)).toBe("/blog/how-we-scaled-to-1m");
  });

  test("near miss: a short numeric id is left alone", () => {
    expect(normaliseUrlPath("/orders/42", null)).toBe("/orders/42");
  });

  test("near miss: a bare 4-digit year is left alone", () => {
    expect(normaliseUrlPath("/blog/2024/my-post", null)).toBe("/blog/2024/my-post");
  });

  test("near miss: a short hex-shaped word is left alone (below the 16-char floor)", () => {
    expect(normaliseUrlPath("/color/cafe", null)).toBe("/color/cafe");
  });

  test("redacts a token embedded in $current_url the same way as $pathname", () => {
    expect(
      normaliseUrlPath(
        null,
        "https://app.example.invalid/reset-password/9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
      ),
    ).toBe("/reset-password/:id");
  });
});

describe("isNormalisedUrlPath", () => {
  test("isNormalisedUrlPath refuses a path carrying a query string, mixed case, a trailing slash, or a raw token segment", () => {
    expect(isNormalisedUrlPath("/app/step/11?utm_source=probe")).toBe(false);
    expect(isNormalisedUrlPath("/pricing#faq")).toBe(false);

    expect(isNormalisedUrlPath("/App/Step")).toBe(false);
    expect(isNormalisedUrlPath("/pricing/")).toBe(false);

    expect(isNormalisedUrlPath("/reset-password/9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c")).toBe(false);
    expect(isNormalisedUrlPath("/u/jane.doe@acme.example.invalid/settings")).toBe(false);
    expect(isNormalisedUrlPath("/orders/550e8400-e29b-41d4-a716-446655440000")).toBe(false);

    expect(isNormalisedUrlPath("")).toBe(false);
  });

  test("isNormalisedUrlPath accepts an already-normalised path", () => {
    expect(isNormalisedUrlPath("/pricing")).toBe(true);
    expect(isNormalisedUrlPath("/")).toBe(true);
    expect(isNormalisedUrlPath("/app/step/11")).toBe(true);
    expect(isNormalisedUrlPath("/blog/how-we-scaled-to-1m")).toBe(true);
    expect(isNormalisedUrlPath("/orders/42")).toBe(true);
    expect(isNormalisedUrlPath("/blog/2024/my-post")).toBe(true);

    expect(isNormalisedUrlPath("/reset-password/:id")).toBe(true);
  });
});
