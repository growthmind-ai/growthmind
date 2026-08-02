import { createHmac, hkdfSync } from "node:crypto";

import type { CredentialKey } from "../crypto/secret-box";

const HKDF_INFO = "growthmind:session-source:identity-key:v1";

const IDENTITY_HMAC_KEY_BYTE_LENGTH = 32;

export interface IdentityHmacKey {
  readonly bytes: Uint8Array;
}

export function deriveIdentityHmacKey(encryptionKey: CredentialKey): IdentityHmacKey {
  const derived = hkdfSync(
    "sha256",
    encryptionKey.bytes,

    new Uint8Array(0),
    HKDF_INFO,
    IDENTITY_HMAC_KEY_BYTE_LENGTH,
  );
  return { bytes: new Uint8Array(derived) };
}

export function hashIdentityKey(
  key: IdentityHmacKey,
  sourceProjectId: string,
  distinctId: string,
): string {
  return createHmac("sha256", key.bytes).update(`${sourceProjectId}:${distinctId}`).digest("hex");
}
