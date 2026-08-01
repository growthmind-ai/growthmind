// item 26, URL-path normalisation (sec-b, edge taxonomy).
//
// Addendum A sec-b pinned that `$current_url` carries the full url including the query
// string, while `$pathname` is the path alone. Storing the raw `$current_url` would
// mean one utm parameter forks the surface and every finding signature hanging off it.
// A textbook identity churn, paid for by an ordinary campaign link.
import { describe, expect, test } from "bun:test";

import {
  URL_PATH_NORMALISATION_VERSION,
  isNormalisedUrlPath,
  normaliseUrlPath,
} from "../../src/sessions/url-path";

const CAMPAIGN_URL = "https://probe.example.invalid/app/step/11?utm_source=probe&q=11";
const OTHER_CAMPAIGN_URL = "https://probe.example.invalid/app/step/11?utm_source=newsletter";

describe("normaliseUrlPath", () => {
  // Item 26
  test("strips the query string and fragment so a UTM parameter cannot fork the surface", () => {
    // Two visits to the same page from two campaigns are one surface.
    expect(normaliseUrlPath(null, CAMPAIGN_URL)).toBe("/app/step/11");
    expect(normaliseUrlPath(null, OTHER_CAMPAIGN_URL)).toBe("/app/step/11");
    expect(normaliseUrlPath(null, CAMPAIGN_URL)).toBe(normaliseUrlPath(null, OTHER_CAMPAIGN_URL));

    // The fragment is a client-side anchor, never a distinct surface.
    expect(normaliseUrlPath(null, "https://probe.example.invalid/pricing#faq")).toBe("/pricing");
    expect(normaliseUrlPath(null, "https://probe.example.invalid/pricing?ref=x#faq")).toBe(
      "/pricing",
    );

    // And the same page reached with and without a campaign is one value.
    expect(normaliseUrlPath("/app/step/11", CAMPAIGN_URL)).toBe(
      normaliseUrlPath("/app/step/11", null),
    );
  });

  test("prefers $pathname and falls back to the path parsed out of $current_url", () => {
    // Sec-b's stated degradation: $pathname when the SDK sent it, otherwise the path
    // parsed out of the full url.
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
    // The column is nullable; sec-a/sec-b properties are SDK-set and optional, and a
    // server-side integration sends neither.
    expect(normaliseUrlPath(null, null)).toBeNull();
    expect(normaliseUrlPath("", "")).toBeNull();
    expect(normaliseUrlPath("", null)).toBeNull();
    expect(normaliseUrlPath(null, "not-a-url")).toBeNull();
  });

  test("the normalisation rules are versioned", () => {
    // A rule change must be a detectable, migratable event rather than a silent fork of
    // every stored path.
    expect(URL_PATH_NORMALISATION_VERSION).toBe(2);
  });
});

// Security audit, a raw path segment can carry a live reset token or an email
// address straight into `events.url_path` / `sessions.entry_url_path`. Fail direction:
// redact on doubt (documented beside each predicate in ../../src/sessions/url-path.ts).
// Every case here pins one predicate's positive and its near-miss, so the deny-list
// cannot quietly widen into redacting ordinary product paths.
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
    // The exact hazard named in the security audit: a live reset token surviving in a
    // persisted path for the length of its TTL.
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
    // The exact fixture named in the security audit: this is base64url-alphabet-shaped
    // (letters, digits, hyphens, 16+ chars) but has no uppercase letter, so it reads as
    // a slug, not a token.
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

// The "already normalised" predicate, extracted here as the single home of the rule.
// Both cases below are required: the refusal and the near-miss control that proves
// "refuse on doubt" has not degraded into "refuse on everything".
describe("isNormalisedUrlPath", () => {
  test("isNormalisedUrlPath refuses a path carrying a query string, mixed case, a trailing slash, or a raw token segment", () => {
    // One campaign parameter is what forks a surface, so a path still carrying one has
    // not been through the normaliser.
    expect(isNormalisedUrlPath("/app/step/11?utm_source=probe")).toBe(false);
    expect(isNormalisedUrlPath("/pricing#faq")).toBe(false);

    expect(isNormalisedUrlPath("/App/Step")).toBe(false);
    expect(isNormalisedUrlPath("/pricing/")).toBe(false);

    // The hazard this predicate exists to keep out of anything a person reads: a
    // live token or an email address surviving in a raw segment.
    expect(isNormalisedUrlPath("/reset-password/9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c")).toBe(false);
    expect(isNormalisedUrlPath("/u/jane.doe@acme.example.invalid/settings")).toBe(false);
    expect(isNormalisedUrlPath("/orders/550e8400-e29b-41d4-a716-446655440000")).toBe(false);

    // A value that yields no usable path at all is not normalised either. The
    // normaliser answers null, which is never the string that went in.
    expect(isNormalisedUrlPath("")).toBe(false);
  });

  test("isNormalisedUrlPath accepts an already-normalised path", () => {
    // The near-miss control. Each of these is a fixture the normaliser leaves alone
    // above, so a predicate that refused them would be refusing ordinary product paths.
    expect(isNormalisedUrlPath("/pricing")).toBe(true);
    expect(isNormalisedUrlPath("/")).toBe(true);
    expect(isNormalisedUrlPath("/app/step/11")).toBe(true);
    expect(isNormalisedUrlPath("/blog/how-we-scaled-to-1m")).toBe(true);
    expect(isNormalisedUrlPath("/orders/42")).toBe(true);
    expect(isNormalisedUrlPath("/blog/2024/my-post")).toBe(true);

    // The output of a redaction is itself normalised. A redacted path must be
    // renderable, or every surface carrying an id becomes unspeakable.
    expect(isNormalisedUrlPath("/reset-password/:id")).toBe(true);
  });
});
