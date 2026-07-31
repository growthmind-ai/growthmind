// Wave 0C (RED) — signature-ledger (O-006), ADD §7 "Unit tests —
// packages/db/__tests__/signatures/hex.test.ts" (FR-L).
//
// `packages/db/src/signatures/hex.ts` is a Wave 0B stub: every exported
// function throws "not implemented" UNCONDITIONALLY, regardless of its
// input. A bare `expect(() => signatureHex(BAD)).toThrow()` would therefore
// PASS today for the wrong reason — the stub always throws, refusal or not.
// Every refusal assertion below instead inspects the THROWN MESSAGE for
// content the ADD requires ("the message names the expected format", D-1) —
// content the stub's literal "not implemented" string cannot satisfy — so
// these tests are genuinely RED until the real validating constructor
// lands, and genuinely GREEN once it does.
//
// A wrong-format signature is a SILENT NO-MATCH — the worst failure shape in
// this sprint (a dismissal that silently stops suppressing because the
// stored signature was never actually valid) — so every refusal here checks
// a real, falsifiable claim, not a convention.
import { describe, expect, it } from "bun:test";

import {
  isSignatureHex,
  sha256Hex,
  signatureDisplayPrefix,
  signatureHex,
  SIGNATURE_DISPLAY_PREFIX_LENGTH,
  SIGNATURE_HEX_LENGTH,
} from "../../src/signatures/hex";

/** A well-formed 64-char lowercase hex literal. Not a real sha256 output —
 * `signatureHex`'s contract is about SHAPE, not provenance, so any string
 * matching `/^[0-9a-f]{64}$/` is a valid fixture for it. */
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

    // The stub's literal "not implemented" cannot satisfy this — the real
    // refusal has to name the expected format.
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
    // Deliberately NOT hex-shaped — the kind of stray value (a token, an
    // email) `evidence-shape.ts:99-102`'s rule exists to keep out of a log
    // line.
    const distinctiveBadInput = "sk-obviously-fake-token-should-never-be-logged";

    const error = catchError(() => signatureHex(distinctiveBadInput));

    expect(error.message).not.toContain(distinctiveBadInput);
    // The message must still explain what WAS expected — omitting the input
    // value while ALSO omitting the expected format is not "never echoes
    // the value", it's just silent, which fails the constructor's other
    // half of the contract just as surely.
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
    // The whole point of a display-only prefix: it must never itself pass as
    // a SignatureHex, or a caller could accidentally use it as a lookup key
    // instead of a label.
    expect(isSignatureHex(prefix)).toBe(false);
    expect(() => signatureHex(prefix)).toThrow();
  });
});
