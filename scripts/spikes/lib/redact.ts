export const REDACTED = "[redacted]";

export interface RedactionSecrets {
  readonly personalApiKey: string;

  readonly projectApiKey: string;

  readonly projectId: string;
}

const POSTHOG_KEY_PATTERN = /\bph[a-z]_[A-Za-z0-9_-]{16,}/g;

export function redactSecrets(text: string, secrets: RedactionSecrets): string {
  let out = text;

  for (const key of [secrets.personalApiKey, secrets.projectApiKey]) {
    if (key !== "") out = out.replaceAll(key, REDACTED);
  }

  out = out.replace(POSTHOG_KEY_PATTERN, `ph?_${REDACTED}`);

  const { projectId } = secrets;
  if (projectId !== "") {
    out = out.replaceAll(`/projects/${projectId}`, `/projects/${REDACTED}`);

    if (out.includes(projectId)) out = out.replaceAll(projectId, REDACTED);
  }

  return out;
}

const NOISE_KEY_PATTERN = /^(\$geoip_|\$initial_geoip_|\$transformations_|\$creator_event_uuid$)/;

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
