// REAL ZOD, FOR THE ROWS THAT CANNOT BE WRITTEN WITHOUT IT (AD-16a).
//
// ###########################################################################
// # WHY THIS FILE IS IN `packages/shared/__tests__` AND NOT IN `apps/web`.
// #
// # `apps/web/package.json` declares no `zod`, and bun's isolated store means
// # `apps/web/node_modules/zod` does not exist — `import { z } from "zod"`
// # inside that package resolves at neither runtime nor typecheck. But the
// # Wave 0f route rows need REAL zod for two things a hand-written fake could
// # never prove:
// #
// #   1. THE PLANTED OFFENDER. AD-16a's whole claim is that a plain
// #      `z.object()` accepts a client-supplied `projectId`, strips it, and
// #      answers 200 — while `Object.keys(shape)` reports the same key set as
// #      a `z.strictObject()`. A strictness detector that has never been run
// #      against a REAL plain `z.object()` is a detector nobody has proven.
// #      A fake that "behaves like a non-strict schema" proves only that the
// #      fake was written to fail.
// #
// #   2. THE THREE MEASURED SHAPE TRAPS the refusal-to-sentence mapping must
// #      cover (probe-notes.md §"The exact refusal shape route tests must
// #      assert against"): `issue.path` is `[]` and the names are on
// #      `issue.keys`; N unknown keys collapse into ONE issue; and a
// #      null/undefined/array/string/number body refuses as `invalid_type`,
// #      not `unrecognized_keys`. Those are facts about zod 4.4.3, and only
// #      zod 4.4.3 can state them.
// #
// # `module-under-construction.ts` in the directory above established that a
// # file in this tree is importable from `worker/` and `apps/web/` alike —
// # module resolution walks up from the CONTAINING file, so `zod` resolves
// # here regardless of who imports it. Same mechanism, second use.
// #
// # THIS FILE IS NOT A TEST. `bun test` collects `*.test.ts`; this is a `.ts`
// # helper, deliberately, so it never reports a green row of its own. The
// # assertions that use it live in `apps/web/__tests__/api/first-run/`, beside
// # the §9 rows they protect. Task 0a.2's nominated
// # `probes/strict-parse.probe.test.ts` is deliberately still unwritten and
// # still available.
// ###########################################################################
import { z } from "zod";

// ---------------------------------------------------------------------------
// The structural view of a parsing schema — what `apps/web` can name
// ---------------------------------------------------------------------------

/**
 * One parse issue, as much of it as any row here reads.
 *
 * `keys` is optional because it exists ONLY on the `unrecognized_keys`
 * variant — which is measured trap 1 restated as a type: a helper that reads
 * the offending names off `path` finds `[]` on every refusal it exists to
 * describe.
 */
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

/**
 * The one method every row calls on a route's `inputSchema`.
 *
 * STRUCTURAL, NEVER `instanceof z.ZodType`. `apps/web` and `packages/shared`
 * resolve `zod` through bun's isolated store, and an `instanceof` across two
 * resolutions of one package is exactly the false red
 * `module-under-construction.ts` was written to abolish.
 */
export interface SafeParsingSchema {
  safeParse(value: unknown): SafeParseOutcome;
}

/** Narrows an unknown export to something a row can parse through. */
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

// ---------------------------------------------------------------------------
// The two controls — R-SCAN's planted offender and clean fixture, for a
// PREDICATE rather than for a source scan
// ---------------------------------------------------------------------------

/**
 * The exact shape Wave 0a probed, so the controls and the ADD agree
 * character for character (probe-notes.md lines 243-251).
 */
const CONTROL_SHAPE = { stepId: z.string() };

/** The BASELINE body: valid, and carrying no tenancy key. */
export const CONTROL_VALID_BODY = Object.freeze({ stepId: "connect-slack" });

/**
 * THE PLANTED OFFENDER. A plain `z.object()` — what every input schema in this
 * repo is today (`packages/shared/src/mcp/types.ts:305,319,325`), and what an
 * execution agent pattern-matching on its neighbours will write.
 *
 * Measured: `+ projectId` → `success=true`, `data={"stepId":"…"}`. The
 * client-supplied tenancy id is SILENTLY STRIPPED and the route answers 200.
 */
export function plainObjectControl(): SafeParsingSchema {
  return z.object(CONTROL_SHAPE) as unknown as SafeParsingSchema;
}

/** THE CLEAN FIXTURE. `z.strictObject()` — AD-16a's required constructor. */
export function strictObjectControl(): SafeParsingSchema {
  return z.strictObject(CONTROL_SHAPE) as unknown as SafeParsingSchema;
}

/**
 * The second clean fixture. `.strict()` — measured IDENTICAL to
 * `z.strictObject()` in zod 4.4.3, and NOT removed in v4 despite the
 * deprecation notices circulating for it. AD-16a permits either; a row that
 * accepted only one constructor would fail a correct route.
 */
export function dotStrictControl(): SafeParsingSchema {
  return z.object(CONTROL_SHAPE).strict() as unknown as SafeParsingSchema;
}

/**
 * `Object.keys(schema.shape)` — THE MECHANISM AD-16 ORIGINALLY LEANED ON, kept
 * here so a row can demonstrate that it is identical for all three controls and
 * therefore cannot enforce anything.
 *
 * Returns `null` for a schema with no `shape`, which is itself a finding: a
 * route whose `inputSchema` is not an object schema cannot declare keys at all.
 */
export function enumerateShapeKeys(schema: unknown): readonly string[] | null {
  const shape = (schema as { shape?: unknown }).shape;
  if (typeof shape !== "object" || shape === null) return null;
  return Object.keys(shape);
}

// ---------------------------------------------------------------------------
// Real `ZodError`s for the refusal-to-sentence mapping rows
// ---------------------------------------------------------------------------

/**
 * A REAL parse failure from a REAL strict schema — the input
 * `describeBodyRefusal` must turn into a sentence from our table.
 *
 * Throws if the body parses. That is deliberate: a fixture that silently
 * returned "no error" would make the mapping rows vacuously green, which is
 * the same class of failure as the enumeration hole itself.
 */
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

/**
 * MEASURED TRAP 1, from the other direction. `z.flattenError` puts an
 * `unrecognized_keys` message in `formErrors` and leaves `fieldErrors` EMPTY —
 * so a 400-body helper that reads `fieldErrors` produces `{}` and a test
 * expecting the offending field there fails.
 */
export function flattenOf(error: ParseErrorLike): {
  readonly formErrors: readonly string[];
  readonly fieldErrors: Readonly<Record<string, readonly string[] | undefined>>;
} {
  return z.flattenError(error as unknown as z.ZodError<Record<string, unknown>>);
}

/**
 * The six body shapes AD-16a says the mapping must survive, with the code each
 * one actually produces (measured, probe-notes.md lines 292-299).
 *
 * `null`, `undefined`, `[]`, `"str"` and `42` are the ORDINARY case, not an
 * exotic one: `request.json()` yields exactly these when a client posts an
 * empty or non-object body, and a mapping that keys only off
 * `unrecognized_keys` THROWS on the very input it exists to refuse.
 */
export const NON_OBJECT_BODIES: readonly { readonly label: string; readonly body: unknown }[] =
  Object.freeze([
    { label: "null", body: null },
    { label: "undefined", body: undefined },
    { label: "an array", body: [] },
    { label: "a string", body: "str" },
    { label: "a number", body: 42 },
  ]);
