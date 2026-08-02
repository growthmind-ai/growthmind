import { describe, expect, test } from "bun:test";
import { generateObject } from "ai";
import type { FlexibleSchema } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

const PROBE_SCHEMA = z.object({
  headline: z.string(),
  context: z.string(),
});

const _flexibleSchemaAssignability: FlexibleSchema<unknown> = PROBE_SCHEMA;
void _flexibleSchemaAssignability;

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
    expect(PROBE_SCHEMA.parse({ headline: "h", context: "c" })).toEqual({
      headline: "h",
      context: "c",
    });
  });
});
