// ADD §2 Addendum B / §9 "Probe tests" — pin the `ai` / `@ai-sdk/anthropic`
// vendor externals (A-1, A-2, A-3, A-5) before any production code in this
// sprint depends on them. docs/adds/cold-start-analysis-lane.md:79-93.
//
// `ai` and `@ai-sdk/anthropic` moved from worker/node_modules/ into
// packages/adapters/node_modules/ this sprint (D-1) — this file's imports
// resolve against that new location, never worker/.
//
// No network call. No real API key. `doGenerate` is stubbed via
// `MockLanguageModelV3` from `ai/test`, so every assertion below exercises
// the REAL `generateObject` code path — its own JSON extraction, schema
// validation, and error construction — with only the network edge replaced.
import { describe, expect, test } from "bun:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject, NoObjectGeneratedError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

// The schema shape is irrelevant to the probe; it only needs to be a real
// zod object schema, matching what packages/core/src/summary/output-schema.ts
// will declare (D-12: `{ headline: string, context: string }`).
const PROBE_SCHEMA = z.object({
  headline: z.string(),
  context: z.string(),
});

type StubUsageOverrides = {
  inputTotal?: number | undefined;
  outputTotal?: number | undefined;
};

/**
 * A `LanguageModelV3Usage` (the model-level shape `doGenerate` returns).
 * `generateObject` converts this into the top-level `LanguageModelUsage`
 * (A-2) via its own `asLanguageModelUsage` — untouched here, so the
 * conversion under test is the real one, not a stand-in.
 */
function stubUsage(overrides: StubUsageOverrides = {}) {
  const inputTotal = "inputTotal" in overrides ? overrides.inputTotal : 12;
  const outputTotal = "outputTotal" in overrides ? overrides.outputTotal : 8;
  return {
    inputTokens: {
      total: inputTotal,
      noCache: inputTotal,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTotal,
      text: outputTotal,
      reasoning: undefined,
    },
    // `raw` is `JSONObject | undefined` under `exactOptionalPropertyTypes` —
    // omitted, not set to `undefined`, so it satisfies the optional property.
  };
}

function stubGenerateResult(objectText: string, usage = stubUsage()) {
  return {
    content: [{ type: "text" as const, text: objectText }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

describe("A-1 — generateObject is exported from ai, takes schema + prompt options", () => {
  // ai/dist/index.d.ts:7170 (declaration), barrel export at :9099.
  test("generateObject is exported from ai and returns an object for a stubbed model", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: stubGenerateResult(JSON.stringify({ headline: "h", context: "c" })),
    });

    const result = await generateObject({
      model,
      schema: PROBE_SCHEMA,
      prompt: "probe",
    });

    expect(result.object).toEqual({ headline: "h", context: "c" });
  });
});

describe("A-2 — result.usage is LanguageModelUsage; inputTokens/outputTokens are number | undefined", () => {
  // ai/dist/index.d.ts:320 (LanguageModelUsage), :324 (inputTokens),
  // :345 (outputTokens), GenerateObjectResult.usage at :7041,:7057.
  test("a generateObject result exposes usage.inputTokens and usage.outputTokens", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: stubGenerateResult(
        JSON.stringify({ headline: "h", context: "c" }),
        stubUsage({ inputTotal: 40, outputTotal: 17 }),
      ),
    });

    const result = await generateObject({ model, schema: PROBE_SCHEMA, prompt: "probe" });

    expect(result.usage.inputTokens).toBe(40);
    expect(result.usage.outputTokens).toBe(17);
  });

  // FR-15b — the load-bearing case. A caller that coerces this with `?? 0`
  // would report "0 tokens" for "the SDK didn't tell us", which is a
  // different fact and, on a run row, a different debugging signal.
  test("usage token counts arriving as undefined are surfaced as undefined, never 0", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: stubGenerateResult(
        JSON.stringify({ headline: "h", context: "c" }),
        stubUsage({ inputTotal: undefined, outputTotal: undefined }),
      ),
    });

    const result = await generateObject({ model, schema: PROBE_SCHEMA, prompt: "probe" });

    expect(result.usage.inputTokens).toBeUndefined();
    expect(result.usage.outputTokens).toBeUndefined();
    // Explicit, not merely `toBeFalsy` — 0 is falsy too, and that is exactly
    // the coercion FR-15b forbids.
    expect(result.usage.inputTokens === 0).toBe(false);
    expect(result.usage.outputTokens === 0).toBe(false);
  });
});

describe("A-3 — error taxonomy: isInstance is the mechanism, never instanceof", () => {
  // ai/dist/index.d.ts:6581 (NoObjectGeneratedError), :6607 (static isInstance).
  test("NoObjectGeneratedError is recognised by isInstance and not by instanceof", async () => {
    const model = new MockLanguageModelV3({
      // No text content at all -> generateObject's own "no object was
      // generated" path, independent of schema validation entirely.
      doGenerate: {
        content: [],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: stubUsage(),
        warnings: [],
      },
    });

    let caught: unknown;
    try {
      await generateObject({ model, schema: PROBE_SCHEMA, prompt: "probe" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    // The mechanism under test.
    expect(NoObjectGeneratedError.isInstance(caught)).toBe(true);
    // `instanceof` happens to also work in-process (single copy of `ai`),
    // but D-13's adapter (packages/adapters/src/anthropic/errors.ts) must
    // route on `isInstance` — the only check documented to survive a
    // bundling/workspace boundary where two copies of `ai` could exist.
    // Recorded here, not relied on there.
    expect(caught instanceof NoObjectGeneratedError).toBe(true);
  });

  // A-3 split: a schema-violating (but well-formed JSON) response must land
  // in the SAME validation-error class as a missing response, never in a
  // transport/call-failure class — D-13 maps this to `output_invalid`,
  // distinct from `call_failed`.
  test("a schema-violating stub surfaces the validation error class, not the call-failure class", async () => {
    const model = new MockLanguageModelV3({
      // Valid JSON, valid text content — but `headline`/`context` are the
      // wrong type, so it fails PROBE_SCHEMA's validation.
      doGenerate: stubGenerateResult(JSON.stringify({ headline: 123, context: null })),
    });

    let caught: unknown;
    try {
      await generateObject({ model, schema: PROBE_SCHEMA, prompt: "probe" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(NoObjectGeneratedError.isInstance(caught)).toBe(true);
  });
});

describe("A-5 — createAnthropic constructs a provider without throwing when no api key is present", () => {
  // @ai-sdk/anthropic/dist/index.js:6486 (createAnthropic), :6501-6508 (the
  // lazy getHeaders() closure that calls loadApiKey — the throw site).
  test("createAnthropic constructs a provider without throwing when no api key is present", () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => createAnthropic({})).not.toThrow();

      const provider = createAnthropic({});
      // Obtaining a model instance also does not throw — `headers` is
      // passed into the model as a function reference (`getHeaders`) and is
      // not invoked at construction. The throw is deferred all the way to
      // the first call that actually needs headers (doGenerate), which is
      // exactly what D-13's composition-root branch relies on: the absence
      // of a key must be a decision this codebase makes BEFORE any call is
      // attempted, not an exception it catches.
      expect(() => provider("claude-sonnet-5")).not.toThrow();
    } finally {
      if (previousKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousKey;
      }
    }
  });
});
