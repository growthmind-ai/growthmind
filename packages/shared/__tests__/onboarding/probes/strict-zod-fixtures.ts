import { z } from "zod";

export interface ParseIssueLike {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly keys?: readonly string[];
}

export interface ParseErrorLike {
  readonly issues: readonly ParseIssueLike[];
}

export type SafeParseOutcome =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly error: ParseErrorLike };

export interface SafeParsingSchema {
  safeParse(value: unknown): SafeParseOutcome;
}

export function asSafeParsingSchema(value: unknown): SafeParsingSchema | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  ) {
    return value as SafeParsingSchema;
  }
  return null;
}

const CONTROL_SHAPE = { stepId: z.string() };

export const CONTROL_VALID_BODY = Object.freeze({ stepId: "connect-slack" });

export function plainObjectControl(): SafeParsingSchema {
  return z.object(CONTROL_SHAPE) as unknown as SafeParsingSchema;
}

export function strictObjectControl(): SafeParsingSchema {
  return z.strictObject(CONTROL_SHAPE) as unknown as SafeParsingSchema;
}

export function dotStrictControl(): SafeParsingSchema {
  return z.object(CONTROL_SHAPE).strict() as unknown as SafeParsingSchema;
}

export function enumerateShapeKeys(schema: unknown): readonly string[] | null {
  const shape = (schema as { shape?: unknown }).shape;
  if (typeof shape !== "object" || shape === null) return null;
  return Object.keys(shape);
}

export function refusalFor(body: unknown): ParseErrorLike {
  const result = z.strictObject(CONTROL_SHAPE).safeParse(body);
  if (result.success) {
    throw new Error(
      `strict-zod-fixtures: expected ${JSON.stringify(body)} to be REFUSED by a strict schema, ` +
        `but it parsed. The fixture, not the assertion, is wrong.`,
    );
  }
  return result.error as unknown as ParseErrorLike;
}

export function flattenOf(error: ParseErrorLike): {
  readonly formErrors: readonly string[];
  readonly fieldErrors: Readonly<Record<string, readonly string[] | undefined>>;
} {
  return z.flattenError(error as unknown as z.ZodError<Record<string, unknown>>);
}

export const NON_OBJECT_BODIES: readonly { readonly label: string; readonly body: unknown }[] =
  Object.freeze([
    { label: "null", body: null },
    { label: "undefined", body: undefined },
    { label: "an array", body: [] },
    { label: "a string", body: "str" },
    { label: "a number", body: 42 },
  ]);
