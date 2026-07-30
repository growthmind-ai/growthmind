// URL-path normalisation (O-003 D-9, SEC-B).
//
// Surfaces stay thin this sprint — no `surface_id` is computed — but the path
// we store is already the input a surface id will one day be derived from, so
// it is normalised and VERSIONED now. Storing raw `$current_url` would mean
// one UTM parameter forks the surface and every finding signature hanging off
// it: a textbook D12 identity churn, paid for by an ordinary campaign link.
//
// TYPED STUB (O-003 scaffold): the constant is real; the body throws.

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
  _pathname: string | null,
  _currentUrl: string | null,
): string | null {
  throw new Error("TYPED STUB (O-003 scaffold): normaliseUrlPath");
}
