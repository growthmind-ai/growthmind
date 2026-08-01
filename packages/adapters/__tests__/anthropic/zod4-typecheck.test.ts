// Addendum B "Probe tests": a zod v4 schema is assignable to `generateObject`'s
// `schema` parameter with NO cast, NO `as any`, and NO `satisfies` escape hatch.
// docs/adds/cold-start-analysis-lane.md:84.
//
// This is a typecheck test, not a runtime test.
//
// `bun test` cannot see a broken type contract. It only executes JavaScript, and a
// `.test.ts` file with a type error still runs if `bun test` doesn't typecheck first.
// The claim this file pins is checked only by `bun run typecheck`
// (packages/adapters/package.json's `typecheck` script, `tsc --noEmit`, which includes
// `__tests__/**/*.ts` per packages/adapters/tsconfig.json). If ever breaks. E.g. a
// zod major bump, or `ai` narrowing `FlexibleSchema`'s constraint. The module-level
// declarations below fail `tsc`, and `bun run typecheck` is red. `bun test` alone
// proves nothing here; do not trust a green `bun test` on this file as evidence
// holds.
import { describe, expect, test } from "bun:test";
import { generateObject } from "ai";
import type { FlexibleSchema } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

// The exact schema shape production code will declare
// (packages/core/src/summary/output-schema.ts, `{ headline, context }`). Constructed
// with the repo's own `import { z } from "zod"` convention
// (packages/core/src/detect/types.ts:7). The installed `zod` package is 4.4.3, whose
// default entry point IS the v4 API `ai` itself imports via the `zod/v4` subpath
// (ai/dist/index.d.ts:11). Same runtime classes, two import paths. This is the
// assignability actually needs.
const PROBE_SCHEMA = z.object({
  headline: z.string(),
  context: z.string(),
});

// Type-level assertion #1: the schema satisfies the sdk's own exported. contract for
// what a schema parameter may be. `ai/dist/index.d.ts:7170` types `generateObject`'s
// `schema` option as `SCHEMA extends FlexibleSchema<unknown>`. If PROBE_SCHEMA is not
// assignable to `FlexibleSchema<unknown>`, this line is a compile error.
const _flexibleSchemaAssignability: FlexibleSchema<unknown> = PROBE_SCHEMA;
void _flexibleSchemaAssignability;

// Type-level assertion #2: the real call shape. Declared, never invoked., this function
// exists purely so `tsc` type-checks a `generateObject` call with `schema:
// PROBE_SCHEMA` exactly as the adapter will write it
// (packages/adapters/src/anthropic/summary-renderer.ts: `generateObject({ model:
// anthropic(resolvedId), schema, system, prompt, providerOptions })`). `model` is a
// real `MockLanguageModelV3` instance (a genuine `LanguageModelV3` implementer, not `as
// any`) so this checks the whole call site's assignability, not schema in isolation.
function _typecheckOnly_generateObjectAcceptsZod4Schema() {
  const model = new MockLanguageModelV3();
  return generateObject({
    model,
    schema: PROBE_SCHEMA,
    prompt: "unused — this function is never called at runtime",
  });
}
void _typecheckOnly_generateObjectAcceptsZod4Schema;

describe("a zod v4 object schema is assignable to generateObject's schema parameter", () => {
  test("a zod v4 object schema is assignable to generateObject's schema parameter", () => {
    // The load-bearing check already happened above, at compile time, and only `bun run
    // typecheck` proves it. This runtime assertion is a deliberately weak formality. It
    // exists so the claim has a named, executing location per (a test that never runs
    // is not a test), not because it can detect an regression itself. It cannot: a
    // schema-shape check at runtime says nothing about whether the type was assignable
    // without a cast.
    expect(PROBE_SCHEMA.parse({ headline: "h", context: "c" })).toEqual({
      headline: "h",
      context: "c",
    });
  });
});
