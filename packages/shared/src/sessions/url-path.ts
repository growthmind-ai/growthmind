export const URL_PATH_NORMALISATION_VERSION = 2;

const REDACTED_SEGMENT = ":id";

function isEmailShapedSegment(segment: string): boolean {
  return segment.includes("@");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidShapedSegment(segment: string): boolean {
  return UUID_PATTERN.test(segment);
}

const HEX_RUN_PATTERN = /^[0-9a-f]{16,}$/i;

function isHexRunSegment(segment: string): boolean {
  return HEX_RUN_PATTERN.test(segment);
}

const BASE64URL_RUN_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

function isBase64UrlTokenSegment(segment: string): boolean {
  return BASE64URL_RUN_PATTERN.test(segment) && /[A-Z]/.test(segment);
}

const LONG_DIGIT_RUN_PATTERN = /^\d{6,}$/;

function isLongDigitRunSegment(segment: string): boolean {
  return LONG_DIGIT_RUN_PATTERN.test(segment);
}

function isIdentifierShapedSegment(segment: string): boolean {
  return (
    isEmailShapedSegment(segment) ||
    isUuidShapedSegment(segment) ||
    isHexRunSegment(segment) ||
    isBase64UrlTokenSegment(segment) ||
    isLongDigitRunSegment(segment)
  );
}

function redactSegment(segment: string): string {
  return isIdentifierShapedSegment(segment) ? REDACTED_SEGMENT : segment;
}

export function normaliseUrlPath(
  pathname: string | null,
  currentUrl: string | null,
): string | null {
  const fromPathname = normalisePath(pathname);
  if (fromPathname !== null) return fromPathname;

  return normalisePath(pathOfUrl(currentUrl));
}

function pathOfUrl(currentUrl: string | null): string | null {
  if (currentUrl === null) return null;
  const trimmed = currentUrl.trim();
  if (trimmed.length === 0) return null;

  try {
    return new URL(trimmed).pathname;
  } catch {
    return null;
  }
}

export function isNormalisedUrlPath(surface: string): boolean {
  return normaliseUrlPath(surface, null) === surface;
}

function normalisePath(raw: string | null): string | null {
  if (raw === null) return null;

  const withoutFragment = raw.split("#")[0] ?? "";
  const withoutQuery = withoutFragment.split("?")[0] ?? "";

  const trimmed = withoutQuery.trim();
  if (trimmed.length === 0) return null;

  const rooted = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (rooted === "/") return "/";
  const withoutTrailingSlash = rooted.endsWith("/") ? rooted.slice(0, -1) : rooted;

  const redacted = withoutTrailingSlash
    .split("/")
    .map((segment) => (segment.length === 0 ? segment : redactSegment(segment)))
    .join("/");

  return redacted.toLowerCase();
}
