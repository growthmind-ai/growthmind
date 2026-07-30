// URL-path normalisation (O-003 D-9, SEC-B).
//
// Surfaces stay thin this sprint — no `surface_id` is computed — but the path
// we store is already the input a surface id will one day be derived from, so
// it is normalised and VERSIONED now. Storing raw `$current_url` would mean
// one UTM parameter forks the surface and every finding signature hanging off
// it: a textbook D12 identity churn, paid for by an ordinary campaign link.
//
// Implemented in Wave 1 against the scaffold's final signature.

/** Bump when the normalisation rules change, so an old value's provenance
 * stays readable instead of silently forking (D12). */
export const URL_PATH_NORMALISATION_VERSION = 1;

/**
 * Prefers `$pathname`; falls back to the path parsed out of `$current_url`
 * when only the latter is present (SEC-B's stated degradation).
 *
 * Rules: the query string and the fragment are stripped, the result is
 * lowercased, and a trailing slash is removed except on the root path, which
 * stays `"/"`. Returns `null` when neither input yields a usable path — the
 * column is nullable and an absent path is not an error.
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
 * The path component of a full url, or `null` when the value is not a url we
 * can read. FAIL DIRECTION: toward `null`. The column is nullable and an
 * absent path is not an error — inventing one would fabricate a surface.
 */
function pathOfUrl(currentUrl: string | null): string | null {
  if (currentUrl === null) return null;
  const trimmed = currentUrl.trim();
  if (trimmed.length === 0) return null;

  try {
    // Parsing rather than string-splitting is what drops the origin, the
    // query, and the fragment in one step: one page reached from two campaigns
    // is ONE surface, and the same page on staging and on production is too.
    return new URL(trimmed).pathname;
  } catch {
    return null;
  }
}

function normalisePath(raw: string | null): string | null {
  if (raw === null) return null;

  // A `$pathname` is a path, but nothing stops an SDK from sending one with a
  // query or a fragment attached, so both are stripped here as well as in the
  // url branch. One UTM parameter forking every surface is the whole hazard.
  const withoutFragment = raw.split("#")[0] ?? "";
  const withoutQuery = withoutFragment.split("?")[0] ?? "";
  const trimmed = withoutQuery.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  const rooted = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (rooted === "/") return "/";
  return rooted.endsWith("/") ? rooted.slice(0, -1) : rooted;
}
