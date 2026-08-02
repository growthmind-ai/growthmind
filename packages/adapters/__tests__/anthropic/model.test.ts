import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import { createAnthropicModel } from "../../src/anthropic/model";
import { DEFAULT_COLDSTART_MODEL } from "../../src/anthropic/constants";
import { createAnthropicSessionSummariser } from "../../src/anthropic/summariser";

const FAKE_API_KEY = "sk-ant-api03-not-a-real-key-0000000000000000";

const CONFIGURED_MODEL_ID = "test-configured-model-id-not-a-real-anthropic-id";

type ModelShape = { readonly modelId: string; readonly provider: string };

function withoutAmbientKey(body: () => void): void {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    body();
  } finally {
    if (previousKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }
}

describe("createAnthropicModel — it returns a model object, never a model id", () => {
  test("the returned value is a model object, not the id string", () => {
    withoutAmbientKey(() => {
      const model = createAnthropicModel({
        apiKey: FAKE_API_KEY,
        resolvedModelId: CONFIGURED_MODEL_ID,
      });

      expect(typeof model).not.toBe("string");
      expect(typeof model).toBe("object");
    });
  });

  test("the model is bound to the Anthropic provider", () => {
    withoutAmbientKey(() => {
      const model = createAnthropicModel({
        apiKey: FAKE_API_KEY,
        resolvedModelId: CONFIGURED_MODEL_ID,
      }) as ModelShape;

      expect(model.provider).toContain("anthropic");
    });
  });
});

describe("createAnthropicModel — the id it selects is the id it was handed", () => {
  test("a configured model id reaches the model unchanged", () => {
    withoutAmbientKey(() => {
      const model = createAnthropicModel({
        apiKey: FAKE_API_KEY,
        resolvedModelId: CONFIGURED_MODEL_ID,
      }) as ModelShape;

      expect(model.modelId).toBe(CONFIGURED_MODEL_ID);
    });
  });

  test("the default model id, when the caller resolved to it, arrives unchanged too", () => {
    withoutAmbientKey(() => {
      const model = createAnthropicModel({
        apiKey: FAKE_API_KEY,
        resolvedModelId: DEFAULT_COLDSTART_MODEL,
      }) as ModelShape;

      expect(model.modelId).toBe(DEFAULT_COLDSTART_MODEL);
    });
  });
});

describe("createAnthropicModel — construction, and what it does not do", () => {
  test("constructing with a syntactically valid key does not throw and makes no call", () => {
    withoutAmbientKey(() => {
      expect(() =>
        createAnthropicModel({ apiKey: FAKE_API_KEY, resolvedModelId: CONFIGURED_MODEL_ID }),
      ).not.toThrow();
    });
  });

  test("the returned model does not serialise the api key", () => {
    withoutAmbientKey(() => {
      const model = createAnthropicModel({
        apiKey: FAKE_API_KEY,
        resolvedModelId: CONFIGURED_MODEL_ID,
      });

      expect(JSON.stringify(model)).not.toContain(FAKE_API_KEY);
    });
  });
});

describe("createAnthropicModel — the model it returns satisfies the summariser port", () => {
  const OUTPUT_SCHEMA = z
    .object({ headline: z.string().min(1), context: z.string().min(1) })
    .strict();

  test("the factory's output is accepted as the summariser's model", () => {
    withoutAmbientKey(() => {
      const summariser = createAnthropicSessionSummariser({
        model: createAnthropicModel({
          apiKey: FAKE_API_KEY,
          resolvedModelId: CONFIGURED_MODEL_ID,
        }),
        resolvedModelId: CONFIGURED_MODEL_ID,
        outputSchema: OUTPUT_SCHEMA,
      });

      expect(typeof summariser.render).toBe("function");
    });
  });

  test("the port renders through the model it was given, with no network", async () => {
    const summariser = createAnthropicSessionSummariser({
      model: new MockLanguageModelV3({
        doGenerate: {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ headline: "People stall here", context: "They leave." }),
            },
          ],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 8, text: 8, reasoning: undefined },
          },
          warnings: [],
        },
      }),
      resolvedModelId: CONFIGURED_MODEL_ID,
      outputSchema: OUTPUT_SCHEMA,
    });

    const result = await summariser.render({
      finalClass: "form_abandonment",
      surface: "checkout/payment",
      counts: [{ numerator: 41, denominator: 118, unit: "sessions" }],
      timeframe: {
        start: new Date("2026-07-01T00:00:00.000Z"),
        end: new Date("2026-07-08T00:00:00.000Z"),
      },
      confidenceBasis: "118 sessions over 7 days",
    });

    expect(result.ok).toBe(true);
    expect(result.resolvedModelId).toBe(CONFIGURED_MODEL_ID);
  });
});
