export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export type CanonicalObject = { readonly [key: string]: CanonicalValue };

export function canonicalJson(value: CanonicalValue): string {
  return serialiseValue(value);
}

type CanonicalPrimitive = string | number | boolean | null;

function compareByCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isPrimitive(value: CanonicalValue): value is CanonicalPrimitive {
  return value === null || typeof value !== "object";
}

function isPlainObject(value: object): value is { readonly [key: string]: CanonicalValue } {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

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
