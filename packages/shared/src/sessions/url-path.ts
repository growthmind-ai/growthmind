export const URL_PATH_NORMALISATION_VERSION = 3;

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

const BASE64URL_RUN_PATTERN = /^[A-Za-z0-9_+=-]{16,}$/;

// A JWT is base64url runs joined by dots, and padded base64 carries `+` and `=`. Both are one
// path segment, so the dots are measured out of the run rather than treated as a boundary —
// otherwise `/verify/eyJhbGci….eyJzdWI….SflKxw` fails the whole-segment match and the live
// credential survives, stamped as normalised and therefore unfindable by remediation (B-013).
function isBase64UrlTokenSegment(segment: string): boolean {
  const run = segment.replaceAll(".", "");

  return BASE64URL_RUN_PATTERN.test(run) && /[A-Z]/.test(run);
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

  // Repeated slashes collapse before the trailing one is stripped, or a single strip leaves
  // `/app/` from `/app//` and the output normalises again to something else on a second pass.
  // `assertNormalisedSurface` throws on exactly that, aborting an analysis run over a doubled
  // slash the customer's own link carried (B-013).
  const collapsed = rooted.replaceAll(/\/{2,}/g, "/");
  if (collapsed === "/") return "/";
  const withoutTrailingSlash = collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;

  const redacted = withoutTrailingSlash
    .split("/")
    .map((segment) => (segment.length === 0 ? segment : redactSegment(segment)))
    .join("/");

  return redacted.toLowerCase();
}
