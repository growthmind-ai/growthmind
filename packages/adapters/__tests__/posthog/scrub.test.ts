import { describe, expect, test } from "bun:test";

import {
  REASON_MAX_LENGTH,
  REDACTED_PLACEHOLDER,
  scrubSecrets,
  truncateForReason,
} from "../../src/posthog/scrub";
import { AD_FAKE_ENCODABLE_KEY, AD_FAKE_PERSONAL_KEY, AD_HOST } from "../helpers/fakes";

describe("scrubSecrets", () => {
  test("redacts a URL-encoded key and a truncated key that exact-value scrubbing would miss", () => {
    const encoded = encodeURIComponent(AD_FAKE_ENCODABLE_KEY);
    const encodedText = `Request failed: ${AD_HOST}/api/projects/424242/events?token=${encoded}`;

    const scrubbedEncoded = scrubSecrets(encodedText, [AD_FAKE_ENCODABLE_KEY]);
    expect(scrubbedEncoded).not.toContain(AD_FAKE_ENCODABLE_KEY);
    expect(scrubbedEncoded).not.toContain(encoded);
    expect(scrubbedEncoded).not.toContain("ad-fake%2Bencoded");
    expect(scrubbedEncoded).toContain(REDACTED_PLACEHOLDER);

    const strayKey = "phx_ad-fake-truncated-tail-000000";
    const strayText = `Upstream echoed a credential: ${strayKey} — do not log this.`;

    const scrubbedStray = scrubSecrets(strayText, []);
    expect(scrubbedStray).not.toContain(strayKey);
    expect(scrubbedStray).toContain(REDACTED_PLACEHOLDER);

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
  test("trims to a storable length and leaves a short reason unchanged", () => {
    const short = "We could not reach that address.";
    expect(truncateForReason(short)).toBe(short);

    const long = "x".repeat(REASON_MAX_LENGTH * 3);
    expect(truncateForReason(long).length).toBeLessThanOrEqual(REASON_MAX_LENGTH);
    expect(truncateForReason(long, 20).length).toBeLessThanOrEqual(20);
  });
});
