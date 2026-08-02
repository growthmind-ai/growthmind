export const FLOOR_TOKENS = [
  "surface",
  "numerator",
  "denominator",
  "unit",
  "windowStart",
  "windowEnd",
] as const;

export type FloorToken = (typeof FLOOR_TOKENS)[number];

const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;

function isFloorToken(value: string): value is FloorToken {
  return (FLOOR_TOKENS as readonly string[]).includes(value);
}

export function placeholdersIn(template: string): readonly string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
}

export function substitute(template: string, values: Partial<Record<FloorToken, string>>): string {
  const unresolved = placeholdersIn(template).filter(
    (token) => !isFloorToken(token) || values[token] === undefined,
  );

  if (unresolved.length > 0) {
    throw new Error(`unresolved_floor_token: ${[...new Set(unresolved)].join(",")}`);
  }

  return template.replaceAll(PLACEHOLDER_PATTERN, (whole: string, token: string): string => {
    const value = isFloorToken(token) ? values[token] : undefined;

    return value ?? whole;
  });
}
