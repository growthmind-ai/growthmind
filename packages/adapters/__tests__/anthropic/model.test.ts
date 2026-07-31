// `createAnthropicModel` — the one place a model provider is constructed
// (O-011, AD-3, AD-15, ADD §9, `src/anthropic/model.ts`).
//
// NO NETWORK AND NO REAL KEY. Nothing here calls the model: `probe.test.ts`
// already proved that constructing a provider and obtaining a model from it
// perform no I/O, so every assertion below reads a value rather than a response.
// The one test that needs a live model uses `MockLanguageModelV3` from `ai/test`,
// exactly as `probe.test.ts` and `summariser.test.ts` do.
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import { createAnthropicModel } from "../../src/anthropic/model";
import { DEFAULT_COLDSTART_MODEL } from "../../src/anthropic/constants";
import { createAnthropicSessionSummariser } from "../../src/anthropic/summariser";

/** Syntactically shaped like the real thing and worth nothing. Never sent. */
const FAKE_API_KEY = "sk-ant-api03-not-a-real-key-0000000000000000";

/**
 * Deliberately NOT one of `AnthropicModelId`'s known literals. The id is
 * CARRIED, never chosen (AD-3) — if the factory ever substituted a default or a
 * hardcoded id for what it was handed, this string could not come back out.
 */
const CONFIGURED_MODEL_ID = "test-configured-model-id-not-a-real-anthropic-id";

/** The fields the AI SDK's own model objects expose, read for assertions only.
 * `LanguageModel` is a union that includes a bare string, so reading them
 * requires narrowing — which is itself the first assertion below. */
type ModelShape = { readonly modelId: string; readonly provider: string };

/** Runs `body` with `ANTHROPIC_API_KEY` absent from the process, restored after.
 * The factory must depend on the key it was HANDED, never on the ambient one —
 * an env-var fallback would make the composition root's no-key branch a lie on
 * any machine that happens to have one exported. */
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
  // THE LOAD-BEARING TEST. `LanguageModel` is
  // `GlobalProviderModelId | LanguageModelV4 | LanguageModelV3 | LanguageModelV2`,
  // so returning the bare id string would typecheck and then resolve through the
  // Vercel AI Gateway instead of Anthropic — every call on a keyed installation
  // would fail, and would fail looking like a broken model call rather than a
  // broken wire.
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

describe("createAnthropicModel — the id it selects is the id it was handed (AD-3)", () => {
  test("a configured model id reaches the model unchanged", () => {
    withoutAmbientKey(() => {
      const model = createAnthropicModel({
        apiKey: FAKE_API_KEY,
        resolvedModelId: CONFIGURED_MODEL_ID,
      }) as ModelShape;

      expect(model.modelId).toBe(CONFIGURED_MODEL_ID);
    });
  });

  // The default is resolved by the COMPOSITION ROOT and passed in like any
  // other configured value; this factory has no fallback of its own. Pinned so
  // nobody adds one here, where it would become a second home for AD-3.
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
  // `probe.test.ts:181-203` proves the throw is deferred to the network edge, so
  // this factory can never be the place "is a key configured?" is answered. It
  // must therefore not attempt construction-time validation of any kind: the
  // decision belongs to the composition root, BEFORE this is ever called.
  test("constructing with a syntactically valid key does not throw and makes no call", () => {
    withoutAmbientKey(() => {
      expect(() =>
        createAnthropicModel({ apiKey: FAKE_API_KEY, resolvedModelId: CONFIGURED_MODEL_ID }),
      ).not.toThrow();
    });
  });

  // The key goes in and nothing comes back out. The provider holds it inside a
  // lazy header closure, so the value this factory returns carries no credential
  // into a run row, a log line, or a crash dump built by serialising it.
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

  // The wire, end to end at the type level and at the value level: what this
  // factory returns is exactly what `AnthropicSummariserDeps.model` takes. The
  // composition root does these two calls back to back and nothing else.
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

  // …and the port really does drive whatever model it is handed, proven against
  // a stub so no call leaves the process. Without this, the test above would
  // only show that a value was accepted, not that it is the value called.
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
