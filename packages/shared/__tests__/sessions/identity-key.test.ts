// O-003 CR-5 — deterministic, project-salted identity-key hashing.
//
// PostHog's `identify()` is routinely called with a user's email address as
// the `distinct_id`, so the raw value can carry PII. Only a hash of it may
// ever be persisted or cross a port boundary (product-decisions §5, FR-16).
import { describe, expect, test } from "bun:test";

import { hashIdentityKey } from "../../src/sessions/identity-key";

const PROJECT_A = "s0-project-424242";
const PROJECT_B = "s0-project-999999";
const DISTINCT_ID = "s0-distinct-0001";

describe("hashIdentityKey", () => {
  test("is deterministic: the same project and distinct id always produce the same, byte-identical digest", () => {
    const first = hashIdentityKey(PROJECT_A, DISTINCT_ID);
    const second = hashIdentityKey(PROJECT_A, DISTINCT_ID);
    expect(second).toBe(first);
    // A hex sha256 digest, so a later real identity stitcher can rely on the
    // shape as well as the value (D12).
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is project-salted: the same distinct id under a different project forks the digest", () => {
    const underA = hashIdentityKey(PROJECT_A, DISTINCT_ID);
    const underB = hashIdentityKey(PROJECT_B, DISTINCT_ID);
    expect(underB).not.toBe(underA);
  });

  test("never returns the raw input, even when the distinct id is email-shaped", () => {
    const emailShaped = "someone@s0-acme.invalid";
    const digest = hashIdentityKey(PROJECT_A, emailShaped);
    expect(digest).not.toContain(emailShaped);
    expect(digest).not.toContain("@");
    expect(digest).not.toContain(PROJECT_A);
  });

  test("a different distinct id under the same project forks the digest", () => {
    const first = hashIdentityKey(PROJECT_A, "s0-distinct-a");
    const second = hashIdentityKey(PROJECT_A, "s0-distinct-b");
    expect(second).not.toBe(first);
  });
});
