import { timingSafeEqual } from "node:crypto";

// Shared by the OAuth state check and the request-signature check — both compare a
// value an attacker controls against a secret-derived one, so `===` would leak the
// secret's prefix through timing. It reads as a harmless simplification and is not one.
export function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");

  if (leftBytes.length !== rightBytes.length) return false;

  return timingSafeEqual(leftBytes, rightBytes);
}
