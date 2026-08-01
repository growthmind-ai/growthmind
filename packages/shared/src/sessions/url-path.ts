// URL-path normalisation (sec-b, security audit).
//
// Surfaces stay thin this sprint (no `surface_id` is computed) but the path we store is
// already the input a surface id will one day be derived from, so it is normalised and
// versioned now. Storing raw `$current_url` would mean one utm parameter forks the
// surface and every finding signature hanging off it: a textbook identity churn, paid
// for by an ordinary campaign link.
//
// : the query string and fragment are not the only place PII and secrets hide. A
// path segment can carry one too, `/reset-password/<token>` puts a live
// account-takeover primitive straight into `events.url_path` and
// `sessions.entry_url_path` for the length of its TTL, and `/u/<email>/…` puts an
// address there permanently. `packages/db/src/schema/events.ts` documents "urls bearing
// tokens" as the reason there is no `properties` jsonb column at all. That same hazard
// is unmitigated on the one url-shaped column this table does ship, so it is redacted
// here, at the one function every persisted path already funnels through.
//
// Implemented in Wave 1 against the scaffold's final signature. Segment redaction added
// post-launch (security audit).

/** Bump when the normalisation rules change, so an old value's provenance stays
 * readable instead of silently forking. Bumped to 2 for the segment-redaction pass:
 * a stored v1 path may still carry a live token or an email address, so a value's
 * version is what tells a later migration which rows still need it. */
export const URL_PATH_NORMALISATION_VERSION = 2;

/** What an identifier-shaped segment becomes. Chosen to read like an ordinary
 * route-param placeholder rather than an opaque marker, so a redacted path is still
 * legible as "this was a detail page" without naming what the detail was. */
const REDACTED_SEGMENT = ":id";

/** A path segment containing "@" is treated as email-shaped outright. No ordinary path
 * segment legitimately contains one, so there is no over-block cost to weigh against
 * the under-block cost of a stricter pattern. */
function isEmailShapedSegment(segment: string): boolean {
  return segment.includes("@");
}

/** Any casing, any rfc 4122 version. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidShapedSegment(segment: string): boolean {
  return UUID_PATTERN.test(segment);
}

/** A run of 16+ hex characters and nothing else. The shape of a raw hex token
 * (`crypto.randomBytes.toString("hex")`, a sha256 digest truncated or whole). 16
 * chars is 8 bytes of entropy, well past anything an ordinary slug word would produce. */
const HEX_RUN_PATTERN = /^[0-9a-f]{16,}$/i;

function isHexRunSegment(segment: string): boolean {
  return HEX_RUN_PATTERN.test(segment);
}

/**
 * A run of 16+ base64url characters that also carries at least one
 * uppercase letter.
 *
 * Fail direction: redact on doubt, but bounded, or every long kebab-case slug in the
 * product would be swallowed too (`/blog/how-we-scaled-to-1m` is 20 base64url-alphabet
 * characters). The uppercase requirement is the bound: base64url draws from a 64-symbol
 * alphabet that is ~41% uppercase, so a genuine 16+ char token carries an uppercase
 * letter with better than 99.999% probability (1 −^16), while an ordinary web
 * slug is lowercase kebab-case by convention and carries none. Checked before the path
 * is lowercased (`normalisePath` lowercases only the final, already-redacted result).
 * The case signal this predicate depends on would otherwise already be destroyed by the
 * time it runs.
 *
 * Known limit: an all-lowercase base64url token (no uppercase by chance, or a generator
 * that only emits `[a-z0-9]`) slips past this one predicate. That residual risk is
 * accepted in exchange for not redacting every long slug in the product; the hex-run
 * and UUID predicates above still catch a token shaped like either of those.
 */
const BASE64URL_RUN_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

function isBase64UrlTokenSegment(segment: string): boolean {
  return BASE64URL_RUN_PATTERN.test(segment) && /[A-Z]/.test(segment);
}

/**
 * A run of 6+ digits and nothing else. Long enough to catch a numeric
 * order/invoice/reset-code id (a 6-digit otp is the shortest realistic case) while
 * leaving a 4-digit year (`/blog/2024/…`) or a short numeric id (`/orders/42`) alone.
 * Fail direction: redact on doubt, bounded at 6 so the near-miss fixtures below
 * (`/orders/42`, a bare year) stay legible.
 */
const LONG_DIGIT_RUN_PATTERN = /^\d{6,}$/;

function isLongDigitRunSegment(segment: string): boolean {
  return LONG_DIGIT_RUN_PATTERN.test(segment);
}

/**
 * True for a path segment shaped like a live identifier rather than an ordinary route
 * word: an email address, a UUID, a long hex run, a long base64url run carrying an
 * uppercase letter, or a long digit run.
 *
 * Fail direction: redact on doubt. The hazard is a reset token or an email
 * address surviving in `events.url_path` / `sessions.entry_url_path` for as long as the
 * row exists. Costing far more than an over-eager placeholder on an ordinary segment
 * ever could. Asserted directly in
 * `packages/shared/__tests__/sessions/url-path.test.ts`, including the near-miss
 * fixtures (`/pricing`, `/blog/how-we-scaled-to-1m`, `/orders/42`) that prove this does
 * not over-redact ordinary slugs.
 */
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

/**
 * Prefers `$pathname`; falls back to the path parsed out of `$current_url` when only
 * the latter is present (sec-b's stated degradation).
 *
 * Rules: the query string and the fragment are stripped, the result is lowercased, and
 * a trailing slash is removed except on the root path, which stays `"/"`. Returns
 * `null` when neither input yields a usable path. The column is nullable and an absent
 * path is not an error.
 */
export function normaliseUrlPath(
  pathname: string | null,
  currentUrl: string | null,
): string | null {
  const fromPathname = normalisePath(pathname);
  if (fromPathname !== null) return fromPathname;

  return normalisePath(pathOfUrl(currentUrl));
}

/**
 * The path component of a full url, or `null` when the value is not a url we can read.
 * Fail direction: toward `null`. The column is nullable and an absent path is not an
 * error. Inventing one would fabricate a surface.
 */
function pathOfUrl(currentUrl: string | null): string | null {
  if (currentUrl === null) return null;
  const trimmed = currentUrl.trim();
  if (trimmed.length === 0) return null;

  try {
    // Parsing rather than string-splitting is what drops the origin, the query, and the
    // fragment in one step: one page reached from two campaigns is one surface, and the
    // same page on staging and on production is too.
    return new URL(trimmed).pathname;
  } catch {
    return null;
  }
}

/**
 * True when `surface` is already in its normalised form under the current rules. I.e.
 * putting it through `normaliseUrlPath` changes nothing.
 *
 * This is the single home of the "already normalised" predicate. It is defined beside
 * `normaliseUrlPath` on purpose: the predicate is only ever "the normaliser is a no-op
 * on this value", so it inherits every rule that function has and every rule it later
 * gains, instead of a second copy of them somewhere else that would drift and then
 * disagree about what a surface is.
 *
 * `packages/core/src/findings/evidence-shape.ts:104` currently repeats this privately
 * as `assertNormalisedSurface`, and that file is not editable in this change. It should
 * adopt this function when it is next edited. Until it does, the rule has two
 * implementations and this one is the home the other is expected to collapse into, not
 * two rules, one rule written twice.
 *
 * A value that does not normalise to a path at all (an empty string, a value with no
 * usable path in it) is not normalised: `normaliseUrlPath` returns `null` for it, which
 * is never equal to the string that went in.
 *
 * Fail direction: this answers `false` on any doubt, because every caller uses it to
 * refuse. The bound on that is the identity case. An already-normalised path is a no-op
 * through the normaliser, so "refuse on doubt" cannot degrade into "refuse on
 * everything". The near-miss control in
 * `packages/shared/__tests__/sessions/url-path.test.ts` pins it.
 */
export function isNormalisedUrlPath(surface: string): boolean {
  return normaliseUrlPath(surface, null) === surface;
}

function normalisePath(raw: string | null): string | null {
  if (raw === null) return null;

  // A `$pathname` is a path, but nothing stops an SDK from sending one with a query or
  // a fragment attached, so both are stripped here as well as in the url branch. One
  // utm parameter forking every surface is the whole hazard.
  const withoutFragment = raw.split("#")[0] ?? "";
  const withoutQuery = withoutFragment.split("?")[0] ?? "";
  // Not lowercased yet: `isBase64UrlTokenSegment`'s uppercase check needs the
  // segment's original casing, and lowercasing happens once, below, after redaction has
  // already replaced anything identifier-shaped.
  const trimmed = withoutQuery.trim();
  if (trimmed.length === 0) return null;

  const rooted = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (rooted === "/") return "/";
  const withoutTrailingSlash = rooted.endsWith("/") ? rooted.slice(0, -1) : rooted;

  // : redact identifier-shaped segments (a reset token, an email address) before
  // lowercasing. A segment split on "/" so a token embedded beside an ordinary word
  // (`/reset-password/<token>`) redacts only itself, and the empty segments a leading
  // "/" or a doubled "//" produce are left alone (they carry nothing to redact and
  // rejoin to the same empty string).
  const redacted = withoutTrailingSlash
    .split("/")
    .map((segment) => (segment.length === 0 ? segment : redactSegment(segment)))
    .join("/");

  return redacted.toLowerCase();
}
