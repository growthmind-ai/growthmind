// One canonical JSON serialiser, shared by `evidence_shape` and the rule-set
// content-hash test.
//
// It is a string producer, never a hash. Architecture defines `signature =
// sha256(project_id, surface_id, symptom_class, evidence_shape)`, so `evidence_shape`
// is an input hashes. the test hashes this output with `node:crypto`'s `createHash`
// inside the test file, which is what keeps `packages/core` free of every node builtin,
// and therefore keeps the "no clock, no randomness" auditable by construction rather
// than by review.
//
// Implemented in Wave 3 against this scaffold's final signature.

/**
 * What this serialiser will accept. Deliberately narrower than JSON:
 *
 * **no floating-point numbers.** `canonicalJson` refuses one rather than formatting it
 *  (fail direction: refuse). Number formatting is a whole class of cross-runtime
 *  drift, and the cheapest way to not have it is to have no floats, which is why every
 *  rate in `ThresholdRuleSet` and every field in an evidence shape is an integer or a
 *  string.
 * **no `undefined`, no `Date`, no `Map`, no `Set`, no class instance.** An instant
 *  would fork an identity every analysis window, and a `ReadonlySet` would not survive
 *  `JSON.stringify` at all.
 */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/** A plain object of canonical values. What a serialiser hands in. */
export type CanonicalObject = { readonly [key: string]: CanonicalValue };

/**
 * Deterministic JSON for a restricted value type.
 *
 * Rules, all asserted by named tests:
 * 1. object keys are emitted in declared order. Lexicographic by code unit,
 *  never `JSON.stringify`'s insertion order, so two structurally equal
 *  inputs built in different orders serialise byte-identically;
 * 2. arrays of primitives are treated as sets: sorted and de-duplicated;
 * 3. a non-integer number is refused with a throw, never rounded, never
 *  formatted, never silently accepted;
 * 4. strings are emitted verbatim.
 *
 * Fail direction: refuse. A serialiser that guesses produces an identity that forks on
 * the guess, and every guarantee hanging off that identity, never deliver twice,
 * dismissed forever, never re-propose. Fails open silently.
 */
export function canonicalJson(value: CanonicalValue): string {
  return serialiseValue(value);
}

/** A leaf. Everything else is a container, and containers are the only things with an
 * ordering question. */
type CanonicalPrimitive = string | number | boolean | null;

/**
 * Ordering, stated once for the whole file: **by UTF-16 code unit**, which is what
 * JavaScript's `<` on strings already does.
 *
 * Not `localeCompare`, locale collation is configurable, icu-version dependent, and
 * case-insensitive-ish (`"a"` before `"B"`), so an identity built on it would fork when
 * the runtime's icu data changed. Code units are a property of the string, so `"B"`
 * sorts before `"a"` everywhere, forever.
 */
function compareByCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isPrimitive(value: CanonicalValue): value is CanonicalPrimitive {
  return value === null || typeof value !== "object";
}

/**
 * A `Date`, a `Map`, a `Set`, or a class instance is not a canonical value. See the
 * `CanonicalValue` doc for why each is excluded. The type already says so; this is the
 * runtime half, because an identity function is exactly the place a silent `{}` or
 * `"1970-01-01T…"` must not be allowed to happen.
 */
function isPlainObject(value: object): value is { readonly [key: string]: CanonicalValue } {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Integers only, and a refusal rather than a format for anything else. The fail
 * direction chose. `Number.isInteger` also rejects `NaN` and both infinities, which
 * `JSON.stringify` would silently emit as `null`.
 *
 * The message names the reason (integer vs float) so the throw is debuggable and is
 * distinguishable from any other throw on this path.
 */
function serialiseNumber(value: number): string {
  if (!Number.isInteger(value)) {
    throw new Error(
      `canonicalJson refuses the non-integer number ${String(value)}: only integer values are ` +
        `serialisable. A float would have to be formatted by guess, and every identity derived ` +
        `from this output would fork on the guess.`,
    );
  }
  return String(value);
}

/**
 * All primitive arrays are sets: serialised, sorted by their serialised bytes,
 * de-duplicated. Two sessions contributing the same signal kind, and the order a
 * detector happened to append them in, must not change the identity.
 *
 * Sorting the *serialised* elements rather than the raw values gives one total order
 * over a mixed primitive array without inventing a cross-type comparison; the only
 * producer in this sprint is a `string[]` of signal kinds, where the two coincide.
 * De-duplication is by the same bytes, so `1` and `"1"` stay distinct.
 *
 * An array holding a container is not a set. Its order is meaningful and is preserved,
 * and its elements are canonicalised recursively.
 */
function serialiseArray(values: readonly CanonicalValue[]): string {
  const parts = values.map((element) => serialiseValue(element));
  if (!values.every(isPrimitive)) return `[${parts.join(",")}]`;

  const sorted = parts.toSorted(compareByCodeUnit);
  const deduplicated = sorted.filter((part, index) => index === 0 || part !== sorted[index - 1]);
  return `[${deduplicated.join(",")}]`;
}

function serialiseObject(value: { readonly [key: string]: CanonicalValue }): string {
  const keys = Object.keys(value).toSorted(compareByCodeUnit);
  const parts = keys.map((key) => `${JSON.stringify(key)}:${serialiseValue(value[key])}`);
  return `{${parts.join(",")}}`;
}

function serialiseValue(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return serialiseNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return serialiseArray(value);
  if (typeof value === "object" && isPlainObject(value)) return serialiseObject(value);

  throw new Error(
    `canonicalJson refuses a value of type ${typeof value}: only strings, integers, booleans, ` +
      `null, arrays, and plain objects are canonical (no Date, Map, Set, or class instance).`,
  );
}
