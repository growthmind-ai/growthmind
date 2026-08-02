import { timingSafeEqual } from "node:crypto";

import { DEV_ENCRYPTION_KEY } from "../env";
import type { ServerEnv } from "../env";
import { CREDENTIAL_KEY_BYTE_LENGTH } from "./secret-box";
import type { CredentialKey } from "./secret-box";

export type CredentialKeyFailureReason = "insecure_default_key" | "malformed_key";

export type CredentialKeyResolution =
  | { readonly ok: true; readonly key: CredentialKey }
  | { readonly ok: false; readonly reason: CredentialKeyFailureReason };

export function resolveCredentialKey(env: ServerEnv): CredentialKeyResolution {
  const configured = env.GROWTHMIND_ENCRYPTION_KEY.trim();

  if (env.NODE_ENV === "production" && configured === DEV_ENCRYPTION_KEY.trim()) {
    return { ok: false, reason: "insecure_default_key" };
  }

  const material = decodeBase64Strict(configured);
  if (!material || material.length < CREDENTIAL_KEY_BYTE_LENGTH) {
    return { ok: false, reason: "malformed_key" };
  }

  const keyBytes = new Uint8Array(material.subarray(0, CREDENTIAL_KEY_BYTE_LENGTH));

  if (env.NODE_ENV === "production" && isPublishedDevKeyBytes(keyBytes)) {
    return { ok: false, reason: "insecure_default_key" };
  }

  return { ok: true, key: { bytes: keyBytes } };
}

function isPublishedDevKeyBytes(keyBytes: Uint8Array): boolean {
  const devBytes = decodeBase64Strict(DEV_ENCRYPTION_KEY.trim());
  if (!devBytes || devBytes.length !== CREDENTIAL_KEY_BYTE_LENGTH) return false;
  if (keyBytes.length !== devBytes.length) return false;
  return timingSafeEqual(keyBytes, devBytes);
}

function decodeBase64Strict(value: string): Buffer | null {
  if (value.length === 0) return null;
  const normalised = value.replaceAll("-", "+").replaceAll("_", "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalised)) return null;
  const decoded = Buffer.from(normalised, "base64");
  return decoded.length === 0 ? null : decoded;
}
