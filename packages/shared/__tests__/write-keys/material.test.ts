import { describe, expect, test } from "bun:test";

import {
  WRITE_KEY_PREFIX,
  hashWriteKeyMaterial,
  isWriteKeyFormat,
} from "../../src/write-keys/material";

describe("hashWriteKeyMaterial", () => {
  test("hashWriteKeyMaterial is a deterministic sha256 hex of the material", () => {
    // Known vector, computed independently with node:crypto:
    // sha256("gmwk_test-material-fixture-000000000000000") in hex
    const material = "gmwk_test-material-fixture-000000000000000";
    const expected = "cbade985c690498bb203644a3f4add9e2e68acd30e5dfb0040cc439f815ef746";

    expect(hashWriteKeyMaterial(material)).toBe(expected);

    // Determinism across repeated calls with the same input.
    expect(hashWriteKeyMaterial(material)).toBe(hashWriteKeyMaterial(material));
  });
});

describe("isWriteKeyFormat", () => {
  test("isWriteKeyFormat rejects empty, malformed, wrong-prefix, and truncated keys", () => {
    // 43 base64url chars, the exact length a real 256-bit key encodes to.
    const validSuffix = "LbCBse67SgBdnrd4ac7ViyA8vPrrV6rDtp2_Kwre920";
    const validKey = `${WRITE_KEY_PREFIX}${validSuffix}`;

    expect(isWriteKeyFormat("")).toBe(false);
    expect(isWriteKeyFormat(`wrongprefix_${validSuffix}`)).toBe(false);
    expect(isWriteKeyFormat(validKey.slice(0, -1))).toBe(false); // truncated by one char
    expect(isWriteKeyFormat(`${WRITE_KEY_PREFIX}${"!".repeat(43)}`)).toBe(false); // malformed charset
    expect(isWriteKeyFormat(validKey)).toBe(true); // control: a well-formed key is accepted
  });
});
