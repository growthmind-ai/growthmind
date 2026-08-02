import { createHash } from "node:crypto";

export const API_KEY_PREFIX = "gmak_";

export const API_KEY_DISPLAY_PREFIX_LENGTH = 11;

const API_KEY_FORMAT = new RegExp(`^${API_KEY_PREFIX}[A-Za-z0-9_-]{43}$`);

export function isApiKeyFormat(value: string): boolean {
  return API_KEY_FORMAT.test(value);
}

export function hashApiKeyMaterial(material: string): string {
  return createHash("sha256").update(material).digest("hex");
}
