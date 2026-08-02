import { describe, expect, it } from "bun:test";

import {
  isSignatureHex,
  sha256Hex,
  signatureDisplayPrefix,
  signatureHex,
  SIGNATURE_DISPLAY_PREFIX_LENGTH,
  SIGNATURE_HEX_LENGTH,
} from "../../src/signatures/hex";

const VALID_HEX = "3f".repeat(32);

function catchError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(`expected an Error to be thrown, got: ${String(error)}`, { cause: error });
  }
  throw new Error("expected a throw, but the function returned normally");
}

describe("sha256Hex", () => {
  it("returns a 64-char lowercase hex digest for an opaque material string", () => {
    const digest = sha256Hex("project:acme.example|surface:/checkout|class:broken");

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toHaveLength(SIGNATURE_HEX_LENGTH);
  });

  it("returns the same digest for the same material and a different digest for different material", () => {
    const material = "surface:/checkout|class:broken";

    const first = sha256Hex(material);
    const second = sha256Hex(material);
    const third = sha256Hex("surface:/pay|class:broken");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });
});

describe("signatureHex", () => {
  it("refuses uppercase hex", () => {
    const uppercase = VALID_HEX.toUpperCase();

    const error = catchError(() => signatureHex(uppercase));

    expect(error.message.toLowerCase()).toContain("hex");
  });

  it("refuses a hex string of the wrong length", () => {
    const tooShort = VALID_HEX.slice(0, SIGNATURE_HEX_LENGTH - 1);

    const error = catchError(() => signatureHex(tooShort));

    expect(error.message.toLowerCase()).toContain("hex");
  });

  it("refuses a non-hex character", () => {
    const withBadChar = `${VALID_HEX.slice(0, SIGNATURE_HEX_LENGTH - 1)}g`;

    const error = catchError(() => signatureHex(withBadChar));

    expect(error.message.toLowerCase()).toContain("hex");
  });

  it("refuses the empty string", () => {
    const error = catchError(() => signatureHex(""));

    expect(error.message.toLowerCase()).toContain("hex");
  });

  it("never echoes the offending value in its refusal message", () => {
    const distinctiveBadInput = "sk-obviously-fake-token-should-never-be-logged";

    const error = catchError(() => signatureHex(distinctiveBadInput));

    expect(error.message).not.toContain(distinctiveBadInput);

    expect(error.message.toLowerCase()).toContain("hex");
  });

  it("accepts a well-formed digest and narrows it to SignatureHex", () => {
    const accepted = signatureHex(VALID_HEX);

    expect(String(accepted)).toBe(VALID_HEX);
    expect(isSignatureHex(accepted)).toBe(true);
  });
});

describe("isSignatureHex", () => {
  it("returns true for a well-formed 64-char lowercase hex string", () => {
    expect(isSignatureHex(VALID_HEX)).toBe(true);
  });

  it("returns false for a malformed value without throwing", () => {
    expect(isSignatureHex("not-a-signature")).toBe(false);
  });
});

describe("signatureDisplayPrefix", () => {
  it("(P1) is display-only and is never accepted as a lookup input", () => {
    const signature = signatureHex(VALID_HEX);

    const prefix = signatureDisplayPrefix(signature);

    expect(prefix).toHaveLength(SIGNATURE_DISPLAY_PREFIX_LENGTH);

    expect(isSignatureHex(prefix)).toBe(false);
    expect(() => signatureHex(prefix)).toThrow();
  });
});
