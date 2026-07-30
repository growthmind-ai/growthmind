// Public-repo redaction for spike output (Security L-1).
//
// Spike output gets pasted into issues, PR bodies, and decision docs in a
// PUBLIC repo, so every printed byte passes through here first. Redaction is
// PATTERN-based as well as exact-value based: an exact-string scrub only
// removes the credentials this process happens to hold, and a response body
// can echo a key shape we never configured.
//
// Fail direction: over-redact. A mangled timestamp in a report is recoverable;
// a leaked key is not.

/** What every redacted span collapses to. */
export const REDACTED = "[redacted]";

/** The credential material a redaction pass knows about by value. */
export interface RedactionSecrets {
  /** Personal API key (phx_…). */
  readonly personalApiKey: string;
  /** Project API key (phc_…). */
  readonly projectApiKey: string;
  /** Numeric project id — not a key, but deliberately kept out of the repo. */
  readonly projectId: string;
}

/**
 * Any PostHog-shaped key token, including ones this process does not hold.
 * `phc_` (project), `phx_` (personal), `phs_` (secret) and any future
 * `ph?_`-prefixed token of credible length.
 */
const POSTHOG_KEY_PATTERN = /\bph[a-z]_[A-Za-z0-9_-]{16,}/g;

/**
 * Scrubs text bound for stdout, a fixture, or a doc.
 *
 * Order matters: exact key values first (longest, most specific), then the
 * key-shape pattern, then the project id — first in URL-path position (precise),
 * and only if an occurrence survives, everywhere (blunt, over-redacting).
 */
export function redactSecrets(text: string, secrets: RedactionSecrets): string {
  let out = text;

  for (const key of [secrets.personalApiKey, secrets.projectApiKey]) {
    if (key !== "") out = out.replaceAll(key, REDACTED);
  }

  out = out.replace(POSTHOG_KEY_PATTERN, `ph?_${REDACTED}`);

  const { projectId } = secrets;
  if (projectId !== "") {
    out = out.replaceAll(`/projects/${projectId}`, `/projects/${REDACTED}`);
    // Belt and braces: a bare occurrence anywhere else (a body field, an
    // encoded query param) is scrubbed even at the cost of collateral matches.
    if (out.includes(projectId)) out = out.replaceAll(projectId, REDACTED);
  }

  return out;
}

/**
 * Property keys stripped from any printed event sample. These carry the
 * operator's approximate physical location and PostHog-internal ids — neither
 * is evidence about an API shape, and both are account-identifying.
 */
const NOISE_KEY_PATTERN = /^(\$geoip_|\$initial_geoip_|\$transformations_|\$creator_event_uuid$)/;

/**
 * Recursively drops account-identifying noise from an event `properties`
 * object so a sample can be printed as shape evidence. Nested objects
 * (`$set`, `$set_once`) are filtered too.
 */
export function stripNoiseProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNoiseProperties);
  if (typeof value !== "object" || value === null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (NOISE_KEY_PATTERN.test(key)) continue;
    out[key] = stripNoiseProperties(nested);
  }
  return out;
}
