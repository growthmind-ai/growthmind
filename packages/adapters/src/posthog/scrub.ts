// Credential scrubbing for anything that could become a stored reason, a log
// line, or a customer-facing message (O-003 D-13, FR-7).
//
// The spike's `scrubKeys` redacts only exact whole-string occurrences of the
// values the process holds — so a key echoed back URL-encoded, JSON-escaped,
// or truncated survives it. This scrubber runs BOTH passes: exact values
// first, then a pattern pass over PostHog's own key shapes.
//
// TYPED STUB (O-003 scaffold): the pattern and constants are real; the bodies
// throw.

/**
 * PostHog key shapes: `phc_…` (project), `phx_…` (personal), `phs_…`.
 * Deliberately broad in the redacting direction — over-redacting a reason
 * string costs nothing, while leaking a customer's personal key costs them
 * their PostHog account.
 */
export const POSTHOG_KEY_PATTERN = /\bph[a-z]_[A-Za-z0-9_-]{16,}/g;

/** What a redacted run leaves behind, so a reader can tell redaction happened
 * rather than wondering where a value went. */
export const REDACTED_PLACEHOLDER = "[redacted]";

/** Default ceiling on a stored failure reason. */
export const REASON_MAX_LENGTH = 240;

/**
 * Exact-value pass over `secrets` (each also matched URL-encoded and
 * JSON-escaped), then the `POSTHOG_KEY_PATTERN` pass.
 */
export function scrubSecrets(_value: string, _secrets: readonly string[]): string {
  throw new Error("TYPED STUB (O-003 scaffold): scrubSecrets");
}

/** Trims a reason to a storable length without cutting mid-escape. */
export function truncateForReason(_value: string, _maxLength?: number): string {
  throw new Error("TYPED STUB (O-003 scaffold): truncateForReason");
}
