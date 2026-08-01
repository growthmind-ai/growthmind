// Wave 0 (red), `mcp-read-credential`, "Unit tests (pure functions)", all 8 rows.
//
// Subject: `packages/shared/src/api-keys/material.ts` and
// `packages/shared/src/api-keys/types.ts`. Neither exists yet, so this suite is red at
// module resolution until Wave 1 fills them in. That IS the stated reason, not an
// accident of path.
//
// The cross-lane loop this file owns one half of: `packages/shared` may not import
// `packages/db`, so nothing here can call the real `mint`. This file therefore
// constructs material the way `mint` will (`API_KEY_PREFIX +
// randomBytes.toString("base64url")`, mirroring `generateRawKeyMaterial` at
// write-keys.repo.ts:45-47) and asserts the format accepts exactly that;
// `packages/db/__tests__/repositories/api-keys.repo.test.ts` asserts
// `isApiKeyFormat(minted.raw)` on a genuinely minted key. Neither half alone proves the
// round trip.
//
// /: `gmak_` and `gmwk_` differ at index 2 only. Both confusion directions are named
// rows below, and every one of them carries a non-vacuity control. A fixture that is
// genuinely well-formed for its own family, so a row can never pass because the sample
// was junk.
//
// No clock, no network, no database in this file.
import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  API_KEY_DISPLAY_PREFIX_LENGTH,
  API_KEY_PREFIX,
  hashApiKeyMaterial,
  isApiKeyFormat,
} from "../../src/api-keys/material";
import { apiKeyMetadataSchema } from "../../src/api-keys/types";
import {
  hashWriteKeyMaterial,
  isWriteKeyFormat,
  WRITE_KEY_PREFIX,
} from "../../src/write-keys/material";
import { writeKeyKindSchema } from "../../src/write-keys/types";

/** Exactly what `mint` will generate, the same expression `generateRawKeyMaterial`
 * uses, with this family's prefix. */
function mintShapedMaterial(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** The conflation neighbour, generated to its family's real shape. */
function writeKeyShapedMaterial(): string {
  return `${WRITE_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

describe("isApiKeyFormat", () => {
  test("should accept exactly the material mint produces", () => {
    const samples = Array.from({ length: 100 }, mintShapedMaterial);

    // Not vacuous: 100 distinct samples were really generated.
    expect(new Set(samples).size).toBe(100);
    expect(samples.every((sample) => isApiKeyFormat(sample))).toBe(true);
  });

  test("should refuse empty, whitespace, 42-char, 44-char, wrong-charset and 10 000-char input without throwing", () => {
    const refused = [
      "",
      "   ",
      `${API_KEY_PREFIX}${"a".repeat(42)}`,
      `${API_KEY_PREFIX}${"a".repeat(44)}`,
      `${API_KEY_PREFIX}${"!".repeat(43)}`,
      `${API_KEY_PREFIX}${"a".repeat(10_000)}`,
    ];

    for (const value of refused) {
      // Fail-closed and never by exception. A credential gate that throws on hostile
      // input is a 500, not a refusal.
      expect(() => isApiKeyFormat(value)).not.toThrow();
      expect(isApiKeyFormat(value)).toBe(false);
    }

    // Control: the same generator at the correct length IS accepted, so the rejections
    // above are about the input, not a permanently-false gate.
    expect(isApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(43)}`)).toBe(true);
  });

  test("should refuse a leading space, because the presenter does not trim", () => {
    // `presentedCredential` (apps/web/lib/mcp/credentials.ts:184-192) does not
    // trim, deliberately, `Bearer gmak_…` presents a leading space. This row exists so
    // nobody "fixes" that by widening the format.
    const wellFormed = mintShapedMaterial();

    expect(isApiKeyFormat(` ${wellFormed}`)).toBe(false);
    expect(isApiKeyFormat(`${wellFormed} `)).toBe(false);
    // Non-vacuity: the same material without the space is accepted.
    expect(isApiKeyFormat(wellFormed)).toBe(true);
  });

  test("should refuse every well-formed write key", () => {
    const kinds = writeKeyKindSchema.options;
    // Not vacuous: the union really has members to iterate.
    expect(kinds.length).toBeGreaterThan(0);

    for (const kind of kinds) {
      const ingestMaterial = writeKeyShapedMaterial();

      // Non-vacuity: this really is a well-formed key of its own family, for this kind,
      // so the refusal below is about the family, not junk input.
      expect(isWriteKeyFormat(ingestMaterial)).toBe(true);
      expect(writeKeyKindSchema.parse(kind)).toBe(kind);

      expect(isApiKeyFormat(ingestMaterial)).toBe(false);
    }
  });
});

describe("isWriteKeyFormat", () => {
  test("should never satisfy the ingest format", () => {
    const readMaterial = mintShapedMaterial();

    // Non-vacuity: well-formed for the read family…
    expect(isApiKeyFormat(readMaterial)).toBe(true);
    // …and refused by the ingest family's gate, before any database access.
    expect(isWriteKeyFormat(readMaterial)).toBe(false);
  });
});

describe("hashApiKeyMaterial", () => {
  test("should hash identically to the write-key hash, so the duplication is not a divergence", () => {
    const materials = [
      "",
      "gmak_test-material-fixture-000000000000000",
      mintShapedMaterial(),
      writeKeyShapedMaterial(),
    ];

    for (const material of materials) {
      const digest = hashApiKeyMaterial(material);

      // The two families sit at different trust levels and own separate functions, but
      // there is no behaviour to diverge today, only intent. A future salt/pepper/kdf
      // on either side must be a deliberate, visible change that fails this row.
      expect(digest).toBe(hashWriteKeyMaterial(material));
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(digest).toBe(digest.toLowerCase());
    }

    // A golden vector, computed independently with node:crypto. Plain sha256 hex of the
    // material, no salt anywhere in it.
    expect(hashApiKeyMaterial("gmak_test-material-fixture-000000000000000")).toBe(
      "c83c9748aa6d6dbc37c1ff5f8f9f97e02aa29f42a21eb0c648a140ded76d7d2e",
    );
  });
});

describe("API_KEY_DISPLAY_PREFIX_LENGTH", () => {
  test("should define the display prefix as the scheme plus exactly six characters", () => {
    // 11, not `write_keys`' 12: this material is a secret, so half the exposure in
    // scrollback, and the stored value still carries the scheme, so `gmak_x7Kq2p` is
    // self-describing.
    expect(API_KEY_DISPLAY_PREFIX_LENGTH).toBe(API_KEY_PREFIX.length + 6);

    const raw = mintShapedMaterial();
    const displayPrefix = raw.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);

    expect(displayPrefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(displayPrefix).toHaveLength(API_KEY_PREFIX.length + 6);
    // The tail (the part that makes the key usable) is not in the prefix.
    expect(raw.slice(API_KEY_DISPLAY_PREFIX_LENGTH)).not.toBe("");
    expect(displayPrefix).not.toBe(raw);
  });
});

describe("apiKeyMetadataSchema", () => {
  test("should describe metadata with no secret field", () => {
    const keys = Object.keys(apiKeyMetadataSchema.shape).toSorted();

    expect(keys).toEqual(["createdAt", "id", "keyPrefix", "name", "organizationId", "revokedAt"]);
    // Stated separately from the exact list because it is the invariant that must
    // survive any future column: the DTO carries no digest and no material. There is
    // deliberately no `projectId` either.
    expect(keys).not.toContain("keyHash");
    expect(keys).not.toContain("projectId");
  });
});
