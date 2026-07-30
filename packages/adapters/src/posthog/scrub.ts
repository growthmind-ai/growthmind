// Credential scrubbing for anything that could become a stored reason, a log
// line, or a customer-facing message (O-003 D-13, FR-7).
//
// The spike's `scrubKeys` redacts only exact whole-string occurrences of the
// values the process holds — so a key echoed back URL-encoded, JSON-escaped,
// or truncated survives it. This scrubber runs BOTH passes: exact values
// first, then a pattern pass over PostHog's own key shapes.

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
 * Every written form one secret can take on its way into a message. The
 * exact-value pass alone is what the spike does, and it misses all but the
 * first of these — a key that came back through a URL, through
 * `JSON.stringify`, or through a logger that escaped it is still the whole
 * key, still usable, and still leaked.
 */
function encodedVariantsOf(secret: string): string[] {
  const urlEncoded = encodeURIComponent(secret);
  const variants = new Set<string>([
    secret,
    urlEncoded,
    // Some encoders emit lowercase hex (`%2b` rather than `%2B`); the value is
    // identical and just as leaked.
    urlEncoded.replace(/%[0-9A-F]{2}/g, (match) => match.toLowerCase()),
    encodeURI(secret),
    // `JSON.stringify` wraps in quotes and escapes; we want the body only.
    JSON.stringify(secret).slice(1, -1),
  ]);
  // Longest first, so a variant that CONTAINS a shorter one is redacted whole
  // rather than being left as a recognisable fragment around a placeholder.
  return [...variants].toSorted((a, b) => b.length - a.length);
}

/**
 * Exact-value pass over `secrets` (each also matched URL-encoded and
 * JSON-escaped), then the `POSTHOG_KEY_PATTERN` pass.
 */
export function scrubSecrets(value: string, secrets: readonly string[]): string {
  let scrubbed = value;

  for (const secret of secrets) {
    // A short or empty secret would match everywhere and turn every message
    // into placeholders — useless for debugging and not safer.
    if (secret.length < 8) {
      continue;
    }
    for (const variant of encodedVariantsOf(secret)) {
      scrubbed = scrubbed.split(variant).join(REDACTED_PLACEHOLDER);
    }
  }

  // The pattern pass catches what the exact pass structurally cannot: a key
  // this process never held, echoed back by the upstream. Over-redacting a
  // reason costs nothing; leaking a customer's personal key costs them their
  // analytics account.
  scrubbed = scrubbed.replace(
    new RegExp(POSTHOG_KEY_PATTERN.source, POSTHOG_KEY_PATTERN.flags),
    REDACTED_PLACEHOLDER,
  );

  return scrubbed;
}

/** Trims a reason to a storable length without cutting mid-escape. */
export function truncateForReason(value: string, maxLength: number = REASON_MAX_LENGTH): string {
  if (maxLength <= 0) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }

  let cut = value.slice(0, maxLength - 1);

  // Never leave a dangling percent-escape: `…%2` reads as noise, and half of a
  // percent-encoded secret is still half a secret on screen.
  cut = cut.replace(/%[0-9A-Fa-f]?$/, "");
  // Never leave a dangling backslash escape from a JSON-escaped fragment: an
  // odd number of trailing backslashes means the last one is opening an escape
  // whose payload got cut off.
  const trailingBackslashes = /\\+$/.exec(cut)?.[0].length ?? 0;
  if (trailingBackslashes % 2 === 1) {
    cut = cut.slice(0, -1);
  }
  // Never split a surrogate pair into a lone half.
  const lastCode = cut.charCodeAt(cut.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    cut = cut.slice(0, -1);
  }

  return `${cut}…`;
}
