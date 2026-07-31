// A1–A5 — the `SessionSummariser` port's public contract (ADD §7.1, §10).
// Wave 0: `packages/adapters/src/anthropic/summariser.ts` does not exist yet,
// so every test below fails on the missing module. That is the intended state.
//
// Mocking follows `probe.test.ts` exactly — `MockLanguageModelV3` from
// `ai/test`, no network, no real key — because that probe is the paid-for
// evidence of the installed SDK's surface. The assertions here address ONLY
// the port: `render(input)` in, `SummaryRenderResult` out. No internal helper,
// no prompt text, no SDK call-shape is asserted; those are the adapter's own
// business and locking them down would defeat Wave 0.
import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import { MODEL_REQUEST_TIMEOUT_MS } from "../../src/anthropic/constants";
import { createAnthropicSessionSummariser } from "../../src/anthropic/summariser";
import type { SummariseInput } from "../../src/anthropic/summariser";

// The schema is INJECTED (AD-16): `packages/adapters` may never import
// `packages/core`, so the shape core will declare is restated here as the test's
// own dependency — exactly as the worker composition root will pass core's.
const OUTPUT_SCHEMA = z
  .object({
    headline: z.string().min(1),
    context: z.string().min(1),
  })
  .strict();

// A5's fake configuration value. Deliberately NOT a real Anthropic model id:
// if the adapter hardcodes an id at the call site instead of carrying the
// injected one, this string cannot appear on the result and A5 fails.
const CONFIGURED_MODEL_ID = "test-configured-model-id-not-a-real-anthropic-id";

const INPUT: SummariseInput = {
  finalClass: "form_abandonment",
  surface: "checkout/payment",
  counts: [{ numerator: 41, denominator: 118, unit: "sessions" }],
  timeframe: {
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-07-08T00:00:00.000Z"),
  },
  confidenceBasis: "118 sessions over 7 days",
};

type StubUsageOverrides = {
  inputTotal?: number | undefined;
  outputTotal?: number | undefined;
};

/** `LanguageModelV3Usage`, shaped as probe.test.ts:38-56 proves the SDK wants. */
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

function summariserWith(model: MockLanguageModelV3) {
  return createAnthropicSessionSummariser({
    model,
    resolvedModelId: CONFIGURED_MODEL_ID,
    outputSchema: OUTPUT_SCHEMA,
  });
}

describe("A1 — the ok arm", () => {
  test("a schema-valid model response returns ok true with headline, context, resolvedModelId and usage", async () => {
    const summariser = summariserWith(
      new MockLanguageModelV3({
        doGenerate: stubGenerateResult(
          JSON.stringify({
            headline: "People stall on the payment step",
            context: "Most sessions that reach payment leave without finishing.",
          }),
          stubUsage({ inputTotal: 40, outputTotal: 17 }),
        ),
      }),
    );

    const result = await summariser.render(INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headline).toBe("People stall on the payment step");
    expect(result.context).toBe(
      "Most sessions that reach payment leave without finishing.",
    );
    expect(result.resolvedModelId).toBe(CONFIGURED_MODEL_ID);
    expect(result.usage.inputTokens).toBe(40);
    expect(result.usage.outputTokens).toBe(17);
  });
});

describe("A2 — the shape-failure arm", () => {
  test("an unparseable model response returns ok false with code output_invalid and never throws", async () => {
    // Well-formed JSON, wrong shape — the mechanism the ADD maps onto
    // `output_invalid`, distinct from any transport problem.
    const summariser = summariserWith(
      new MockLanguageModelV3({
        doGenerate: stubGenerateResult(
          JSON.stringify({ headline: 123, context: null }),
        ),
      }),
    );

    let threw: unknown;
    let result: Awaited<ReturnType<typeof summariser.render>> | undefined;
    try {
      result = await summariser.render(INPUT);
    } catch (error) {
      threw = error;
    }

    // Degradation is by RETURN VALUE. A throw here would reach the worker as
    // an unhandled rejection instead of a floor fallback.
    expect(threw).toBeUndefined();
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    if (!result || result.ok) return;
    expect(result.code).toBe("output_invalid");
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("A3 — the call-failure arm", () => {
  test("a failed model call returns ok false with code call_failed and never throws", async () => {
    const summariser = summariserWith(
      new MockLanguageModelV3({
        doGenerate: async () => {
          // A transport-class failure: the call itself never completes.
          throw new Error("connect ECONNREFUSED 10.0.0.1:443");
        },
      }),
    );

    let threw: unknown;
    let result: Awaited<ReturnType<typeof summariser.render>> | undefined;
    try {
      result = await summariser.render(INPUT);
    } catch (error) {
      threw = error;
    }

    expect(threw).toBeUndefined();
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    if (!result || result.ok) return;
    expect(result.code).toBe("call_failed");
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("A4 — unreported usage is undefined, never zero", () => {
  test("usage fields the SDK did not report stay undefined and are never coerced to zero", async () => {
    const summariser = summariserWith(
      new MockLanguageModelV3({
        doGenerate: stubGenerateResult(
          JSON.stringify({ headline: "h", context: "c" }),
          stubUsage({ inputTotal: undefined, outputTotal: undefined }),
        ),
      }),
    );

    const result = await summariser.render(INPUT);

    expect(result.usage.inputTokens).toBeUndefined();
    expect(result.usage.outputTokens).toBeUndefined();
    // Explicit, not `toBeFalsy`: 0 is falsy too, and "we were not told" must
    // never be recorded as "this cost nothing" (FR-M9).
    expect(result.usage.inputTokens === 0).toBe(false);
    expect(result.usage.outputTokens === 0).toBe(false);
  });
});

describe("A5 — the resolved model id is configuration, on both arms", () => {
  test("the resolved model id comes from configuration and appears on both result arms", async () => {
    const okResult = await summariserWith(
      new MockLanguageModelV3({
        doGenerate: stubGenerateResult(
          JSON.stringify({ headline: "h", context: "c" }),
        ),
      }),
    ).render(INPUT);

    const failedResult = await summariserWith(
      new MockLanguageModelV3({
        doGenerate: async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.1:443");
        },
      }),
    ).render(INPUT);

    expect(okResult.ok).toBe(true);
    expect(failedResult.ok).toBe(false);
    // A call that failed still addressed a model — the id is on the failure
    // arm too, so a run row can always say which model was spoken to.
    expect(okResult.resolvedModelId).toBe(CONFIGURED_MODEL_ID);
    expect(failedResult.resolvedModelId).toBe(CONFIGURED_MODEL_ID);
    // And it is the INJECTED value, not something the adapter chose: no real
    // Anthropic id could equal this string.
    expect(okResult.resolvedModelId).not.toContain("claude");
  });
});

// ── A6 / A7 ─────────────────────────────────────────────────────────────────
// Added by the post-sprint security audit (M-4, H-2). Both assert CALL SHAPE,
// which A1–A5 deliberately avoided — and they are the exception for one
// reason: the shape IS the contract here. "One claim costs one upstream
// request" and "no call runs forever" are promises made outside this file (the
// cap in `worker/src/analysis-cap.ts`, the run row the tick holds open), and
// nothing else in the repository can observe whether they hold.

/**
 * A RETRYABLE transport failure — the class the SDK's retry wrapper acts on,
 * and the only class that can expose an unset `maxRetries`. A3's plain `Error`
 * cannot: it is not retryable, so it would pass A6 even with retries left
 * switched on.
 */
function retryableFailure(): APICallError {
  return new APICallError({
    message: "rate limited",
    url: "https://api.example.invalid/v1/messages",
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: true,
  });
}

describe("A6 — one claim, one upstream request", () => {
  test("a retryable failure invokes the model exactly once and returns call_failed", async () => {
    let attempts = 0;
    const summariser = summariserWith(
      new MockLanguageModelV3({
        doGenerate: async () => {
          attempts += 1;
          throw retryableFailure();
        },
      }),
    );

    let threw: unknown;
    let result: Awaited<ReturnType<typeof summariser.render>> | undefined;
    try {
      result = await summariser.render(INPUT);
    } catch (error) {
      threw = error;
    }

    // THE ASSERTION THE CAP RESTS ON. `analysis_model_calls` records one claim
    // per candidate; if the SDK's default `maxRetries` (2) were in force this
    // would be 3, and the "hard per-project cost cap" would be a 3× estimate.
    // Written as a count rather than a read of the constant so it keeps
    // holding whatever a future SDK version makes the default.
    expect(attempts).toBe(1);

    expect(threw).toBeUndefined();
    expect(result?.ok).toBe(false);
    if (!result || result.ok) return;
    expect(result.code).toBe("call_failed");
    // The retry-exhaustion wrapper the SDK throws carries the vendor's own
    // text; the message a customer reads is this package's fixed sentence, and
    // it names no vendor, no status code and no url.
    expect(result.message).not.toContain("rate limited");
    expect(result.message).not.toContain("429");
    expect(result.message).not.toContain("api.example.invalid");
  });

  test("a rate-limited render still carries the resolved model id, and unreported usage stays undefined", async () => {
    const result = await summariserWith(
      new MockLanguageModelV3({
        doGenerate: async () => {
          throw retryableFailure();
        },
      }),
    ).render(INPUT);

    expect(result.ok).toBe(false);
    expect(result.resolvedModelId).toBe(CONFIGURED_MODEL_ID);
    // A transport failure genuinely reports no usage. "Not reported" must not
    // become "cost nothing" on the run row (FR-M9).
    expect(result.usage.inputTokens).toBeUndefined();
    expect(result.usage.outputTokens).toBeUndefined();
  });
});

describe("A7 — every call carries a deadline", () => {
  test("the model call receives a live abort signal, fresh for each render", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const summariser = summariserWith(
      new MockLanguageModelV3({
        doGenerate: async ({ abortSignal }) => {
          seen.push(abortSignal);
          return stubGenerateResult(JSON.stringify({ headline: "h", context: "c" }));
        },
      }),
    );

    await summariser.render(INPUT);
    await summariser.render(INPUT);

    // The wire, proven rather than assumed (D11). Without it a hung upstream
    // holds this project's `analysis_runs` row open indefinitely, and a project
    // with a running row is never picked up again — a permanent per-project jam.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[1]).toBeInstanceOf(AbortSignal);
    // Not already spent when the call starts.
    expect(seen[0]?.aborted).toBe(false);
    expect(seen[1]?.aborted).toBe(false);
    // A DISTINCT signal per call. `AbortSignal.timeout` starts counting when it
    // is constructed, so one hoisted to module or factory scope would be a
    // shared stopwatch: it expires part-way through a run and then fails every
    // remaining candidate instantly, spending cap claims on calls that were
    // never made.
    expect(seen[0]).not.toBe(seen[1]);
  });

  test("the deadline is a positive finite number of milliseconds", () => {
    // A `0`, a `NaN`, or an `Infinity` reaching `AbortSignal.timeout` would
    // each turn the deadline back off — instantly, or never.
    expect(Number.isFinite(MODEL_REQUEST_TIMEOUT_MS)).toBe(true);
    expect(MODEL_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test.each([
    ["TimeoutError", "The operation was aborted due to timeout"],
    ["AbortError", "This operation was aborted"],
  ])(
    "a call ended by the deadline (%s) returns call_failed and never throws",
    async (name, message) => {
      // Exactly what a provider that honours the signal surfaces when the
      // deadline fires mid-request: `fetch` rejects with the signal's reason.
      // `TimeoutError` is the one `AbortSignal.timeout` produces; `AbortError`
      // is covered too so the arm does not depend on which the runtime picks.
      const summariser = summariserWith(
        new MockLanguageModelV3({
          doGenerate: async () => {
            throw new DOMException(message, name);
          },
        }),
      );

      let threw: unknown;
      let result: Awaited<ReturnType<typeof summariser.render>> | undefined;
      try {
        result = await summariser.render(INPUT);
      } catch (error) {
        threw = error;
      }

      // The whole point of the deadline is that it UNJAMS the lane. A deadline
      // that fired as an unhandled rejection would replace a stuck run with a
      // crashed one — the degradation ladder must absorb it like any other
      // transport failure, and no new arm exists for it.
      expect(threw).toBeUndefined();
      expect(result?.ok).toBe(false);
      if (!result || result.ok) return;
      expect(result.code).toBe("call_failed");
      expect(result.resolvedModelId).toBe(CONFIGURED_MODEL_ID);
      // Not `output_invalid`: nothing came back to be unreadable.
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.message).not.toContain(message);
      expect(result.message).not.toContain(name);
    },
  );
});
