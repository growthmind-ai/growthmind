import { createHash } from "node:crypto";

export const WRITE_KEY_PREFIX = "gmwk_";

const WRITE_KEY_FORMAT = new RegExp(`^${WRITE_KEY_PREFIX}[A-Za-z0-9_-]{43}$`);

export function isWriteKeyFormat(value: string): boolean {
  return WRITE_KEY_FORMAT.test(value);
}

export function hashWriteKeyMaterial(material: string): string {
  return createHash("sha256").update(material).digest("hex");
}
