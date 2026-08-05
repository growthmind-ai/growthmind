import type { PostHogSourceDeps } from "@growthmind/adapters";
import type { CredentialKey } from "@growthmind/shared";
import { deriveIdentityHmacKey } from "@growthmind/shared";

// Shared by every PostHog-backed adapter this app composes (session source,
// project discovery, replay source) — AD-8's fetch seam plus the identity
// hmac derived from the resolved credential key.
export const CONNECT_BACKOFF_CEILING_MS = 5_000;

export function createPostHogAdapterDeps(
  key: CredentialKey,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): PostHogSourceDeps {
  return {
    fetch: fetchImpl,
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    random: () => Math.random(),
    identityHmacKey: deriveIdentityHmacKey(key),
    deadlineExceededAfter: (ms) => ms > CONNECT_BACKOFF_CEILING_MS,
  };
}
