// item 49, the named strengthening.
//
// The spike's `scrubKeys` redacts only exact whole-string occurrences of the values the
// process holds, so a key echoed back URL-encoded, JSON-escaped, or truncated survives
// it untouched. The production scrubber runs both passes: the exact values (and their
// encoded variants) first, then a pattern pass over PostHog's own `ph?_…` key shapes.
import { describe, expect, test } from "bun:test";

import {
  REASON_MAX_LENGTH,
  REDACTED_PLACEHOLDER,
  scrubSecrets,
  truncateForReason,
} from "../../src/posthog/scrub";
import { AD_FAKE_ENCODABLE_KEY, AD_FAKE_PERSONAL_KEY, AD_HOST } from "../helpers/fakes";

describe("scrubSecrets", () => {
  // Item 49.
  test("redacts a URL-encoded key and a truncated key that exact-value scrubbing would miss", () => {
    //  url-encoded. `AD_FAKE_ENCODABLE_KEY` is deliberately chosen so its
    // pattern-matchable run is shorter than POSTHOG_KEY_PATTERN's 16-char minimum. Only
    // the exact-value pass and its encoded variants can catch it, which is precisely
    // the case exact whole-string scrubbing misses.
    const encoded = encodeURIComponent(AD_FAKE_ENCODABLE_KEY);
    const encodedText = `Request failed: ${AD_HOST}/api/projects/424242/events?token=${encoded}`;

    const scrubbedEncoded = scrubSecrets(encodedText, [AD_FAKE_ENCODABLE_KEY]);
    expect(scrubbedEncoded).not.toContain(AD_FAKE_ENCODABLE_KEY);
    expect(scrubbedEncoded).not.toContain(encoded);
    expect(scrubbedEncoded).not.toContain("ad-fake%2Bencoded");
    expect(scrubbedEncoded).toContain(REDACTED_PLACEHOLDER);

    //  truncated / unknown. This value was never handed to the scrubber as a secret,
    // so only the pattern pass can catch it.
    const strayKey = "phx_ad-fake-truncated-tail-000000";
    const strayText = `Upstream echoed a credential: ${strayKey} — do not log this.`;

    const scrubbedStray = scrubSecrets(strayText, []);
    expect(scrubbedStray).not.toContain(strayKey);
    expect(scrubbedStray).toContain(REDACTED_PLACEHOLDER);

    //  The exact-value pass still works, and ordinary prose is untouched.
    // Over-redaction costs nothing, but a scrubber that eats every message is useless
    // for debugging.
    const plainText = `Could not reach ${AD_HOST} with key ${AD_FAKE_PERSONAL_KEY}.`;
    const scrubbedPlain = scrubSecrets(plainText, [AD_FAKE_PERSONAL_KEY]);
    expect(scrubbedPlain).not.toContain(AD_FAKE_PERSONAL_KEY);
    expect(scrubbedPlain).toContain("Could not reach");

    expect(scrubSecrets("Nothing secret here.", [AD_FAKE_PERSONAL_KEY])).toBe(
      "Nothing secret here.",
    );
  });
});

describe("truncateForReason", () => {
  // Supports item 49: a scrubbed reason still has to fit the stored column, and
  // truncation must never re-expose a value by cutting mid-escape.
  test("trims to a storable length and leaves a short reason unchanged", () => {
    const short = "We could not reach that address.";
    expect(truncateForReason(short)).toBe(short);

    const long = "x".repeat(REASON_MAX_LENGTH * 3);
    expect(truncateForReason(long).length).toBeLessThanOrEqual(REASON_MAX_LENGTH);
    expect(truncateForReason(long, 20).length).toBeLessThanOrEqual(20);
  });
});
