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
import { APICallError, generateObject, NoObjectGeneratedError } from "ai";
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

// ── A-6 / A-7 ───────────────────────────────────────────────────────────────
// Added after a post-sprint security audit (H-2, M-4). Both fixes rest on
// `generateObject` options nothing in this repository had ever exercised, and
// the SDK's documentation is not admissible here — this file is the paid-for
// evidence of what the INSTALLED version actually does. `ai/dist/index.d.ts`
// types `generateObject`'s options as `... & Omit<RequestOptions, 'timeout'>`
// (:640-659, :7168), so `abortSignal` and `maxRetries` are in and `timeout` is
// deliberately out — which is why the adapter builds its own signal rather than
// passing a `timeout` the type would reject.

describe("A-6 — abortSignal is a live generateObject option and reaches the model call", () => {
  test("the abortSignal passed to generateObject is handed down to the model's doGenerate", async () => {
    let seen: AbortSignal | undefined;
    const controller = new AbortController();
    const model = new MockLanguageModelV3({
      doGenerate: async ({ abortSignal }) => {
        seen = abortSignal;
        return stubGenerateResult(JSON.stringify({ headline: "h", context: "c" }));
      },
    });

    await generateObject({
      model,
      schema: PROBE_SCHEMA,
      prompt: "probe",
      abortSignal: controller.signal,
    });

    // The wire, proven rather than assumed (D11): an option the SDK accepted
    // but dropped on the floor would type-check identically and enforce nothing.
    expect(seen).toBe(controller.signal);
    expect(seen?.aborted).toBe(false);
  });

  // RECORDED BECAUSE IT IS SURPRISING, AND BECAUSE IT SETS THE LIMIT OF WHAT
  // THE DEADLINE BUYS: `generateObject` does NOT pre-check the signal itself.
  // An already-aborted signal handed to a model that ignores it produces a
  // perfectly successful result. Enforcement is entirely the PROVIDER's — the
  // real Anthropic provider forwards the signal into `fetch`, which is what
  // rejects. So the property the adapter can actually rely on is the one A-6's
  // first test pins (the signal reaches the model), plus this one (a provider
  // that honours it produces a non-validation rejection).
  test("the SDK itself does not pre-check the signal: enforcement belongs to the provider", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: stubGenerateResult(JSON.stringify({ headline: "h", context: "c" })),
    });

    const result = await generateObject({
      model,
      schema: PROBE_SCHEMA,
      prompt: "probe",
      abortSignal: AbortSignal.abort(),
      maxRetries: 0,
    });

    expect(result.object).toEqual({ headline: "h", context: "c" });
  });

  test("a model that honours the signal rejects, and the rejection is not the object-validation class", async () => {
    // What a real HTTP provider does: the signal goes into `fetch`, and an
    // aborted `fetch` rejects with the signal's own reason — a `DOMException`
    // named `AbortError` for a manual abort, `TimeoutError` for the
    // `AbortSignal.timeout` the adapter builds.
    const model = new MockLanguageModelV3({
      doGenerate: async ({ abortSignal }) => {
        if (abortSignal?.aborted === true) {
          throw abortSignal.reason as unknown;
        }
        return stubGenerateResult(JSON.stringify({ headline: "h", context: "c" }));
      },
    });

    let caught: unknown;
    try {
      await generateObject({
        model,
        schema: PROBE_SCHEMA,
        prompt: "probe",
        abortSignal: AbortSignal.abort(),
        maxRetries: 0,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    // The load-bearing half for D-13's mapping: an abort must NOT arrive as
    // `NoObjectGeneratedError`, or `./errors.ts` would call a call that never
    // completed an unreadable OUTPUT. It falls to `call_failed` instead, which
    // claims only that the attempt did not go through.
    expect(NoObjectGeneratedError.isInstance(caught)).toBe(false);
  });
});

/** A retryable transport failure — the class the SDK's retry wrapper acts on.
 * A plain `Error` is NOT retryable, which is why A-3's stub never loops. */
function retryableFailure(): APICallError {
  return new APICallError({
    message: "service unavailable",
    url: "https://api.example.invalid/v1/messages",
    requestBodyValues: {},
    statusCode: 503,
    isRetryable: true,
  });
}

function countingModel(counter: { attempts: number }): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      counter.attempts += 1;
      throw retryableFailure();
    },
  });
}

describe("A-7 — maxRetries controls how many upstream requests one call issues", () => {
  // M-4's FIX. One claim, one request — what the cap has to mean for
  // "hard per-project cost cap" to be a true sentence.
  test("with maxRetries 0, one retryable failure costs exactly one upstream request", async () => {
    const counter = { attempts: 0 };
    await expect(
      generateObject({
        model: countingModel(counter),
        schema: PROBE_SCHEMA,
        prompt: "probe",
        maxRetries: 0,
      }),
    ).rejects.toBeDefined();

    expect(counter.attempts).toBe(1);
  });

  // The other direction, so `maxRetries` is proven to be a live knob rather
  // than an option the SDK accepts and ignores — one retry is genuinely one
  // extra upstream request. Unset, the SDK's declared default is 2
  // (`ai/dist/index.d.ts:7128`), which is M-4 in one line: three requests per
  // cap claim. It is not pinned here because the retry wrapper waits out its
  // real exponential backoff (~6s for the default) and because the assertion
  // that actually protects the cap lives on the adapter, in
  // `summariser.test.ts` A6 — that one holds whatever the SDK's default becomes.
  test("with maxRetries 1, the same failure costs exactly two upstream requests", async () => {
    const counter = { attempts: 0 };
    await expect(
      generateObject({
        model: countingModel(counter),
        schema: PROBE_SCHEMA,
        prompt: "probe",
        maxRetries: 1,
      }),
    ).rejects.toBeDefined();

    expect(counter.attempts).toBe(2);
  });

  test("a retry-exhausted failure is not the object-validation class either", async () => {
    const counter = { attempts: 0 };
    let caught: unknown;
    try {
      await generateObject({
        model: countingModel(counter),
        schema: PROBE_SCHEMA,
        prompt: "probe",
        maxRetries: 0,
      });
    } catch (error) {
      caught = error;
    }

    // Same reason as A-6: a transport failure must land on `call_failed`, never
    // on `output_invalid`.
    expect(NoObjectGeneratedError.isInstance(caught)).toBe(false);
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
