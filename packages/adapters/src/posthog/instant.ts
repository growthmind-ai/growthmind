export const POSTHOG_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/;

export function formatPostHogInstant(value: Date): string {
  const epochMs = value.getTime();
  if (!Number.isFinite(epochMs)) {
    throw new RangeError("formatPostHogInstant received an unusable instant");
  }

  const formatted = `${value.toISOString().slice(0, -1)}+00:00`;

  assertPostHogInstant(formatted);
  return formatted;
}

export function assertPostHogInstant(value: string): void {
  if (!POSTHOG_INSTANT_PATTERN.test(value)) {
    throw new RangeError("A time value did not match the shape the analytics API accepts");
  }
}

export function parsePostHogInstant(value: string): Date | null {
  if (value.trim() === "") {
    return null;
  }
  const epochMs = Date.parse(value);
  if (Number.isNaN(epochMs)) {
    return null;
  }
  return new Date(epochMs);
}
