import { describe, expect, test } from "bun:test";
import { generateObject, NoObjectGeneratedError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import {
  summaryFailureCodeSchema,
  summaryRenderResultSchema,
  type SummaryFailureCode,
} from "@growthmind/shared";

import { mapSummaryError, summaryFailure, SUMMARY_FAILURE_MESSAGES } from "../../src/model/errors";

const RESOLVED_MODEL_ID = "gemini-fixture-model-3";

const FIXTURE_USAGE = { inputTokens: 12, outputTokens: 8 } as const;

const OUTPUT_SHAPE = z.object({ headline: z.string(), context: z.string() });

const PLANTED_FRAGMENTS: readonly string[] = [
  "req_01PLANTEDREQUESTID9999",
  "projects/01PLANTEDPROJECT4242",
  "AIzaSyPLANTEDKEYTAIL0000000000000000000",
  "https://generativelanguage.googleapis.com/v1beta/models",
];

const PLANTED_VENDOR_MESSAGE =
  `AI_APICallError: request req_01PLANTEDREQUESTID9999 to ` +
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent ` +
  `failed for projects/01PLANTEDPROJECT4242 ` +
  `using key AIzaSyPLANTEDKEYTAIL0000000000000000000 (429 RESOURCE_EXHAUSTED)`;

function plantedFragmentsFoundIn(text: string): readonly string[] {
  return PLANTED_FRAGMENTS.filter((fragment) => text.includes(fragment));
}

function plantedVendorError(): Error {
  const error = new Error(PLANTED_VENDOR_MESSAGE);
  error.name = "AI_APICallError";
  return error;
}

async function realNoObjectGeneratedError(): Promise<unknown> {
  const model = new MockLanguageModelV3({
    doGenerate: {
      content: [],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 8, text: 8, reasoning: undefined },
      },
      warnings: [],
    },
  });

  try {
    await generateObject({ model, schema: OUTPUT_SHAPE, prompt: "fixture" });
  } catch (error) {
    return error;
  }
  throw new Error("fixture did not throw — generateObject unexpectedly succeeded");
}

async function realSchemaViolationError(): Promise<unknown> {
  const model = new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: "text" as const, text: JSON.stringify({ headline: 123, context: null }) }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 8, text: 8, reasoning: undefined },
      },
      warnings: [],
    },
  });

  try {
    await generateObject({ model, schema: OUTPUT_SHAPE, prompt: "fixture" });
  } catch (error) {
    return error;
  }
  throw new Error("fixture did not throw — generateObject unexpectedly succeeded");
}

async function realTransportError(vendorMessage: string): Promise<unknown> {
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      throw plantedVendorErrorWith(vendorMessage);
    },
  });

  try {
    await generateObject({ model, schema: OUTPUT_SHAPE, prompt: "fixture" });
  } catch (error) {
    return error;
  }
  throw new Error("fixture did not throw — generateObject unexpectedly succeeded");
}

function plantedVendorErrorWith(message: string): Error {
  const error = new Error(message);
  error.name = "AI_APICallError";
  return error;
}

function failureArmFor(error: unknown) {
  const code = mapSummaryError(error);
  const result = summaryFailure({
    code,
    resolvedModelId: RESOLVED_MODEL_ID,
    usage: { ...FIXTURE_USAGE },
  });

  const parsed = summaryRenderResultSchema.parse(result);
  if (parsed.ok !== false) {
    throw new Error("summaryFailure returned the ok:true arm");
  }
  return parsed;
}

describe("the planted offender", () => {
  test("a planted vendor error containing request-identifying text never reaches the result message", async () => {
    expect(plantedFragmentsFoundIn(PLANTED_VENDOR_MESSAGE)).toEqual([...PLANTED_FRAGMENTS]);

    const leakyMessage = `We could not generate a written explanation. ${PLANTED_VENDOR_MESSAGE}`;
    expect(plantedFragmentsFoundIn(leakyMessage).length).toBe(PLANTED_FRAGMENTS.length);

    const vendorError = plantedVendorError();
    const failure = failureArmFor(vendorError);

    expect(plantedFragmentsFoundIn(failure.message)).toEqual([]);

    expect(failure.message.includes(PLANTED_VENDOR_MESSAGE)).toBe(false);
    expect(failure.message.includes("AI_APICallError")).toBe(false);

    expect(plantedFragmentsFoundIn(JSON.stringify(failure))).toEqual([]);

    expect(failure.message.length).toBeGreaterThan(0);

    expect(Object.values(SUMMARY_FAILURE_MESSAGES)).toContain(failure.message);

    expect(failure.code).toBe("call_failed");
  });

  test("a planted vendor error surfaced through the real SDK path still never reaches the message", async () => {
    const error = await realTransportError(PLANTED_VENDOR_MESSAGE);

    expect(plantedFragmentsFoundIn(String((error as Error)?.message ?? ""))).not.toEqual([]);

    const failure = failureArmFor(error);
    expect(plantedFragmentsFoundIn(JSON.stringify(failure))).toEqual([]);
    expect(failure.code).toBe("call_failed");
  });

  test("a planted vendor error on the validation class is scrubbed too, and maps to output_invalid", async () => {
    const error = await realNoObjectGeneratedError();
    expect(NoObjectGeneratedError.isInstance(error)).toBe(true);

    const failure = failureArmFor(error);
    expect(failure.code).toBe("output_invalid");
    expect(failure.message).toBe(SUMMARY_FAILURE_MESSAGES.output_invalid);
    expect(plantedFragmentsFoundIn(JSON.stringify(failure))).toEqual([]);
  });
});

describe("the whole error map", () => {
  test("every mapped failure message is plain English from this package and never vendor text", async () => {
    const allCodes = summaryFailureCodeSchema.options as readonly SummaryFailureCode[];
    expect(allCodes.length).toBeGreaterThan(0);
    for (const code of allCodes) {
      const sentence = SUMMARY_FAILURE_MESSAGES[code];
      expect(typeof sentence).toBe("string");
      expect(sentence.length).toBeGreaterThan(0);
    }
    expect(Object.keys(SUMMARY_FAILURE_MESSAGES).toSorted()).toEqual([...allCodes].toSorted());

    const cases: readonly { readonly label: string; readonly error: unknown }[] = [
      { label: "no object generated (real SDK)", error: await realNoObjectGeneratedError() },
      { label: "schema violation (real SDK)", error: await realSchemaViolationError() },
      {
        label: "transport rejection (real SDK)",
        error: await realTransportError(PLANTED_VENDOR_MESSAGE),
      },
      { label: "bare vendor Error", error: plantedVendorError() },
      {
        label: "auth failure",
        error: plantedVendorErrorWith(
          "403 PERMISSION_DENIED: API key not valid AIzaSyPLANTEDKEYTAIL0000000000000000000",
        ),
      },
      {
        label: "rate limit",
        error: plantedVendorErrorWith(
          "429 RESOURCE_EXHAUSTED (request req_01PLANTEDREQUESTID9999)",
        ),
      },
      {
        label: "timeout",
        error: plantedVendorErrorWith(
          "Request timed out after 60000ms: https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
        ),
      },
      { label: "a thrown string, not an Error", error: PLANTED_VENDOR_MESSAGE },
      { label: "a thrown plain object", error: { message: PLANTED_VENDOR_MESSAGE } },
      { label: "undefined", error: undefined },
      { label: "null", error: null },
    ];

    const sentences = new Set<string>(Object.values(SUMMARY_FAILURE_MESSAGES));
    const seenCodes = new Set<SummaryFailureCode>();

    for (const { label, error } of cases) {
      const failure = failureArmFor(error);
      seenCodes.add(failure.code);

      expect(summaryFailureCodeSchema.safeParse(failure.code).success).toBe(true);

      expect({ label, message: failure.message }).toEqual({
        label,
        message: SUMMARY_FAILURE_MESSAGES[failure.code],
      });
      expect(sentences.has(failure.message)).toBe(true);

      expect({ label, leaked: plantedFragmentsFoundIn(JSON.stringify(failure)) }).toEqual({
        label,
        leaked: [],
      });
      expect(failure.message.includes("AI_APICallError")).toBe(false);
      expect(failure.message.includes("googleapis")).toBe(false);
    }

    expect([...seenCodes].toSorted()).toEqual([...allCodes].toSorted());
  });

  test("the mapper reads only the error's class — a benign error with vendor-looking text still maps by mechanism", async () => {
    const first = mapSummaryError(plantedVendorErrorWith("429 rate_limit_error"));
    const second = mapSummaryError(
      plantedVendorErrorWith("503 overloaded_error: upstream unavailable"),
    );
    expect(first).toBe(second);
    expect(first).toBe("call_failed");

    expect(mapSummaryError(await realSchemaViolationError())).toBe("output_invalid");
    expect(mapSummaryError(await realSchemaViolationError())).not.toBe(first);
  });
});
