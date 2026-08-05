export const POSTHOG_KEY_PATTERN = /\bph[a-z]_[A-Za-z0-9_-]{16,}/g;

export const REDACTED_PLACEHOLDER = "[redacted]";

export const REASON_MAX_LENGTH = 240;

function encodedVariantsOf(secret: string): string[] {
  const urlEncoded = encodeURIComponent(secret);
  const variants = new Set<string>([
    secret,
    urlEncoded,

    urlEncoded.replace(/%[0-9A-F]{2}/g, (match) => match.toLowerCase()),
    encodeURI(secret),

    JSON.stringify(secret).slice(1, -1),
  ]);

  return [...variants].toSorted((a, b) => b.length - a.length);
}

export function scrubSecrets(value: string, secrets: readonly string[]): string {
  let scrubbed = value;

  for (const secret of secrets) {
    if (secret.length < 8) {
      continue;
    }
    for (const variant of encodedVariantsOf(secret)) {
      scrubbed = scrubbed.split(variant).join(REDACTED_PLACEHOLDER);
    }
  }

  scrubbed = scrubbed.replace(
    new RegExp(POSTHOG_KEY_PATTERN.source, POSTHOG_KEY_PATTERN.flags),
    REDACTED_PLACEHOLDER,
  );

  return scrubbed;
}

export function truncateForReason(value: string, maxLength: number = REASON_MAX_LENGTH): string {
  if (maxLength <= 0) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }

  let cut = value.slice(0, maxLength - 1);

  cut = cut.replace(/%[0-9A-Fa-f]?$/, "");

  const trailingBackslashes = /\\+$/.exec(cut)?.[0].length ?? 0;
  if (trailingBackslashes % 2 === 1) {
    cut = cut.slice(0, -1);
  }

  const lastCode = cut.charCodeAt(cut.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    cut = cut.slice(0, -1);
  }

  return `${cut}…`;
}
