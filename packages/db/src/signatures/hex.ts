import { createHash } from "node:crypto";

export const SIGNATURE_HEX_LENGTH = 64;

export const SIGNATURE_HEX_FORMAT = /^[0-9a-f]{64}$/;

export const SIGNATURE_DISPLAY_PREFIX_LENGTH = 4;

declare const signatureHexBrand: unique symbol;

export type SignatureHex = string & { readonly [signatureHexBrand]: true };

export function isSignatureHex(value: string): value is SignatureHex {
  return SIGNATURE_HEX_FORMAT.test(value);
}

export function signatureHex(value: string): SignatureHex {
  if (!isSignatureHex(value)) {
    throw new Error(
      `invalid signature: expected exactly ${String(SIGNATURE_HEX_LENGTH)} lowercase hex characters (0-9a-f)`,
    );
  }

  return value;
}

export function sha256Hex(material: string): SignatureHex {
  const digest = createHash("sha256").update(material).digest("hex");

  return digest as SignatureHex;
}

export function signatureDisplayPrefix(signature: SignatureHex): string {
  return signature.slice(0, SIGNATURE_DISPLAY_PREFIX_LENGTH);
}
