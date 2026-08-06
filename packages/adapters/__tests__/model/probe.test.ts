import { describe, expect, test } from "bun:test";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { APICallError, generateObject, NoObjectGeneratedError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import { DEFAULT_COLDSTART_MODEL } from "../../src/model/constants";

const PROBE_SCHEMA = z.object({
  headline: z.string(),
  context: z.string(),
});

type StubUsageOverrides = {
  inputTotal?: number | undefined;
  outputTotal?: number | undefined;
};

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
    // `raw` is `JSONObject | undefined` under `exactOptionalPropertyTypes`. Omitted,
    // not set to `undefined`, so it satisfies the optional property.
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

describe("generateObject is exported from ai, takes schema + prompt options", () => {
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

describe("result.usage is LanguageModelUsage; inputTokens/outputTokens are number | undefined", () => {
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

    expect(result.usage.inputTokens === 0).toBe(false);
    expect(result.usage.outputTokens === 0).toBe(false);
  });
});

describe("error taxonomy: isInstance is the mechanism, never instanceof", () => {
  test("NoObjectGeneratedError is recognised by isInstance and not by instanceof", async () => {
    const model = new MockLanguageModelV3({
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

    expect(NoObjectGeneratedError.isInstance(caught)).toBe(true);

    expect(caught instanceof NoObjectGeneratedError).toBe(true);
  });

  test("a schema-violating stub surfaces the validation error class, not the call-failure class", async () => {
    const model = new MockLanguageModelV3({
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

describe("abortSignal is a live generateObject option and reaches the model call", () => {
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

    expect(seen).toBe(controller.signal);
    expect(seen?.aborted).toBe(false);
  });

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

    expect(NoObjectGeneratedError.isInstance(caught)).toBe(false);
  });
});

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

describe("maxRetries controls how many upstream requests one call issues", () => {
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

    expect(NoObjectGeneratedError.isInstance(caught)).toBe(false);
  });
});

describe("createAmazonBedrock constructs a provider without throwing when no api key is present", () => {
  test("createAmazonBedrock constructs a provider without throwing when no api key is present", () => {
    const previousKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    try {
      expect(() => createAmazonBedrock({ region: "eu-west-2" })).not.toThrow();

      const provider = createAmazonBedrock({ region: "eu-west-2" });

      expect(() => provider(DEFAULT_COLDSTART_MODEL)).not.toThrow();
    } finally {
      if (previousKey === undefined) {
        delete process.env.AWS_BEARER_TOKEN_BEDROCK;
      } else {
        process.env.AWS_BEARER_TOKEN_BEDROCK = previousKey;
      }
    }
  });
});
