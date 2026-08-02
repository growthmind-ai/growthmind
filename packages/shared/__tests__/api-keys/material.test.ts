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

function mintShapedMaterial(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

function writeKeyShapedMaterial(): string {
  return `${WRITE_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

describe("isApiKeyFormat", () => {
  test("should accept exactly the material mint produces", () => {
    const samples = Array.from({ length: 100 }, mintShapedMaterial);

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
      expect(() => isApiKeyFormat(value)).not.toThrow();
      expect(isApiKeyFormat(value)).toBe(false);
    }

    expect(isApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(43)}`)).toBe(true);
  });

  test("should refuse a leading space, because the presenter does not trim", () => {
    const wellFormed = mintShapedMaterial();

    expect(isApiKeyFormat(` ${wellFormed}`)).toBe(false);
    expect(isApiKeyFormat(`${wellFormed} `)).toBe(false);

    expect(isApiKeyFormat(wellFormed)).toBe(true);
  });

  test("should refuse every well-formed write key", () => {
    const kinds = writeKeyKindSchema.options;

    expect(kinds.length).toBeGreaterThan(0);

    for (const kind of kinds) {
      const ingestMaterial = writeKeyShapedMaterial();

      expect(isWriteKeyFormat(ingestMaterial)).toBe(true);
      expect(writeKeyKindSchema.parse(kind)).toBe(kind);

      expect(isApiKeyFormat(ingestMaterial)).toBe(false);
    }
  });
});

describe("isWriteKeyFormat", () => {
  test("should never satisfy the ingest format", () => {
    const readMaterial = mintShapedMaterial();

    expect(isApiKeyFormat(readMaterial)).toBe(true);

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

      expect(digest).toBe(hashWriteKeyMaterial(material));
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(digest).toBe(digest.toLowerCase());
    }

    expect(hashApiKeyMaterial("gmak_test-material-fixture-000000000000000")).toBe(
      "c83c9748aa6d6dbc37c1ff5f8f9f97e02aa29f42a21eb0c648a140ded76d7d2e",
    );
  });
});

describe("API_KEY_DISPLAY_PREFIX_LENGTH", () => {
  test("should define the display prefix as the scheme plus exactly six characters", () => {
    expect(API_KEY_DISPLAY_PREFIX_LENGTH).toBe(API_KEY_PREFIX.length + 6);

    const raw = mintShapedMaterial();
    const displayPrefix = raw.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);

    expect(displayPrefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(displayPrefix).toHaveLength(API_KEY_PREFIX.length + 6);

    expect(raw.slice(API_KEY_DISPLAY_PREFIX_LENGTH)).not.toBe("");
    expect(displayPrefix).not.toBe(raw);
  });
});

describe("apiKeyMetadataSchema", () => {
  test("should describe metadata with no secret field", () => {
    const keys = Object.keys(apiKeyMetadataSchema.shape).toSorted();

    expect(keys).toEqual(["createdAt", "id", "keyPrefix", "name", "organizationId", "revokedAt"]);

    expect(keys).not.toContain("keyHash");
    expect(keys).not.toContain("projectId");
  });
});
