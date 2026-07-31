// The ONE seam where a value is written into a fixed template (O-005 D-4,
// FR-F6a).
//
// NOTHING IN THIS DIRECTORY IS CALLED IN PRODUCTION. There is no worker task,
// no persistence, no model call, no per-project cap and no delivery path
// anywhere in this repository.
//
// WHY THIS MODULE EXISTS AT ALL. The floor's vocabulary is fixed strings
// carrying `{token}` placeholders (`packages/shared/src/summary/messages.ts`),
// which buys the plain-English audit a single-file home and costs one thing: a
// placeholder is a stringly-typed key, so a renamed token is a silent no-op
// that puts a raw `{denominator}` in front of somebody reading about their own
// product. Funnelling every write through one function is what turns that
// silent no-op into a refusal, and keeping the token vocabulary a closed union
// is what lets a checker prove no template names a token nothing supplies.
//
// NOT BARREL-EXPORTED, on purpose. `__tests__/coverage.test.ts:164` requires
// every barrel-exported function to carry a mirroring test file and a call by
// name; this helper has exactly one caller inside the package, and exporting it
// would add a public surface nothing outside uses. Its behaviour is asserted
// through `__tests__/summary/floor.test.ts`.
//
// PURE: no clock, no randomness, no I/O, no node builtin.

/**
 * Every placeholder a floor template may carry, as DATA.
 *
 * The array is the source and the union below is derived from it, rather than
 * the two being written side by side — the same idiom `__tests__/coverage.test.ts:408-423`
 * uses, so a token added here is available to a runtime checker and to the
 * compiler at once and the two can never disagree about the vocabulary.
 */
export const FLOOR_TOKENS = [
  "surface",
  "numerator",
  "denominator",
  "unit",
  "windowStart",
  "windowEnd",
] as const;

/** The closed placeholder vocabulary. Nothing else is a legal token. */
export type FloorToken = (typeof FLOOR_TOKENS)[number];

/**
 * A `{…}` run. Deliberately matches ANY brace pair, not only the known tokens:
 * the point is to catch a placeholder nobody declared, and a pattern that only
 * saw declared tokens would step straight over the one case worth catching.
 */
const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;

function isFloorToken(value: string): value is FloorToken {
  return (FLOOR_TOKENS as readonly string[]).includes(value);
}

/**
 * Every placeholder name a template carries, in order, including ones outside
 * the declared vocabulary.
 *
 * Exported so a checker over the template tables reads the SAME pattern this
 * function substitutes with, instead of re-authoring a second regular
 * expression that could disagree with this one about what a placeholder is.
 */
export function placeholdersIn(template: string): readonly string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
}

/**
 * Writes values into a template. THE ONLY function in this package that does.
 *
 * FAIL DIRECTION: REFUSE. Every placeholder the template carries is checked
 * BEFORE anything is written, and a placeholder that is not a declared token —
 * or that the caller supplied no value for — throws, naming the unresolved
 * token and nothing else.
 *
 * Refusing is the safe direction because the alternative is not a missing
 * sentence, it is a sentence with a raw brace expression sitting where a
 * number or a page path belongs. A summary that never appears is a gap the
 * caller can handle and a reader never sees; a half-filled sentence is
 * something a reader DOES see, cannot interpret, and reasonably reads as the
 * product being broken. Same direction, and the same reasoning, as the
 * refusals in `../counts/measured-count.ts:192-214`.
 *
 * THE MESSAGE NAMES THE TOKEN AND NOTHING ELSE — no template text, no
 * substituted value. A token name is a fact about this codebase and is safe in
 * a log line; a numerator, a denominator or a page path is a fact about
 * somebody else's product, and no such fact belongs in one.
 *
 * The check runs over the template rather than over the finished string on
 * purpose: a value that itself contained braces would otherwise be reported as
 * an unresolved token it is not, sending a reader of the failure to the wrong
 * file.
 */
export function substitute(
  template: string,
  values: Partial<Record<FloorToken, string>>,
): string {
  const unresolved = placeholdersIn(template).filter(
    (token) => !isFloorToken(token) || values[token] === undefined,
  );

  if (unresolved.length > 0) {
    throw new Error(`unresolved_floor_token: ${[...new Set(unresolved)].join(",")}`);
  }

  return template.replaceAll(PLACEHOLDER_PATTERN, (whole: string, token: string): string => {
    const value = isFloorToken(token) ? values[token] : undefined;
    // `whole` is unreachable — the filter above already refused every token
    // with no value. It is here because the callback's return type must be a
    // string on every path, not because a path exists.
    return value ?? whole;
  });
}
