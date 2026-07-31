// ADD §10 "Adapter — errors.test.ts" (A6, A7) / AD-17 / PRD FR-M2.
//
// WHAT THIS FILE DISCHARGES. `packages/shared/src/summary/types.ts:146-151` and
// `:199-201` ship an INHERITED OBLIGATION in prose — flagged independently by
// two audits (ESC-9) — that the vendor's own error text must never surface
// verbatim on `summaryRenderResultSchema`'s failure arm. An Anthropic SDK error
// message can carry request-identifying detail, and `message: z.string()`
// accepts every byte of it silently. The schema cannot enforce this. The
// adapter must, and this file is the test that pins it.
//
// A6 LANDS FIRST, AND THAT ORDER IS THE POINT. It is a PLANTED-OFFENDER test,
// following `packages/core/__tests__/detect/purity.test.ts`: a scan that reports
// zero offenders proves nothing until it has been shown finding one. So A6
// plants a vendor error whose message carries request-identifying text, proves
// the detector in this file DOES fire on that text when it is present, and only
// then asserts the mapped result is clean. Without the control, "the planted
// string is absent" and "the detector is blind" are the same green.
//
// ROUTING IS `isInstance`, NEVER `instanceof` (AD-17, recorded at
// `probe.test.ts:146-152`): `isInstance` is the only check documented to
// survive a workspace/bundling boundary where two copies of `ai` could exist.
// This file therefore constructs its SDK errors the way production will meet
// them — by driving the REAL `generateObject` against `MockLanguageModelV3`,
// so the error objects under test are the SDK's own, not hand-rolled look-alikes.
//
// HOUSE RULES: `bun test` only. No network, no real API key. No `Date.now()`.
import { describe, expect, test } from "bun:test";
import { generateObject, NoObjectGeneratedError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import {
  summaryFailureCodeSchema,
  summaryRenderResultSchema,
  type SummaryFailureCode,
} from "@growthmind/shared";

// The module under test. It does not exist yet — Wave 0 lands this file RED,
// and "cannot resolve ../../src/anthropic/errors" is the correct failure.
import {
  mapSummaryError,
  summaryFailure,
  SUMMARY_FAILURE_MESSAGES,
} from "../../src/anthropic/errors";

// ---------------------------------------------------------------------------
// Fixtures. Frozen; nothing here descends from a clock.
// ---------------------------------------------------------------------------

const RESOLVED_MODEL_ID = "claude-fixture-model-5";

const FIXTURE_USAGE = { inputTokens: 12, outputTokens: 8 } as const;

const OUTPUT_SHAPE = z.object({ headline: z.string(), context: z.string() });

/**
 * THE PLANTED OFFENDER. Every fragment below is the kind of detail a real
 * Anthropic SDK error message carries and that must never reach a customer: a
 * request id, an org id, an api-key tail, and a raw url. They are distinctive
 * strings so a leak cannot be confused with ordinary prose.
 */
const PLANTED_FRAGMENTS: readonly string[] = [
  "req_01PLANTEDREQUESTID9999",
  "org-01PLANTEDORGID4242",
  "sk-ant-api03-PLANTEDKEYTAIL",
  "https://api.anthropic.com/v1/messages",
];

const PLANTED_VENDOR_MESSAGE =
  `AI_APICallError: request req_01PLANTEDREQUESTID9999 to ` +
  `https://api.anthropic.com/v1/messages failed for org-01PLANTEDORGID4242 ` +
  `using key sk-ant-api03-PLANTEDKEYTAIL (429 rate_limit_error)`;

/**
 * The detector A6 must prove before it trusts. Returns the fragments it found,
 * so a failure names WHICH one leaked rather than reporting a bare boolean.
 */
function plantedFragmentsFoundIn(text: string): readonly string[] {
  return PLANTED_FRAGMENTS.filter((fragment) => text.includes(fragment));
}

/** An error carrying the planted message, of the transport/`call_failed` class. */
function plantedVendorError(): Error {
  const error = new Error(PLANTED_VENDOR_MESSAGE);
  error.name = "AI_APICallError";
  return error;
}

/**
 * A REAL `NoObjectGeneratedError`, produced by the real `generateObject` code
 * path with only the network edge replaced — never hand-constructed. `content`
 * omitted entirely drives the SDK's own "no object was generated" branch
 * (`probe.test.ts:125-153`).
 */
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

/**
 * A REAL schema-violation error: well-formed JSON of the wrong shape. The SDK
 * lands this in the SAME validation class as a missing object
 * (`probe.test.ts:159-175`), which is why both must map to `output_invalid`.
 */
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

/** A real transport-class rejection surfaced through `generateObject`. */
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
  // The arm the port actually returns must satisfy the shared contract, not
  // merely look like it — a message assertion against an off-contract object
  // would be testing a shape production never returns.
  const parsed = summaryRenderResultSchema.parse(result);
  if (parsed.ok !== false) {
    throw new Error("summaryFailure returned the ok:true arm");
  }
  return parsed;
}

// ===========================================================================
// A6 — FIRST IN THE FILE BY DESIGN. Plant the offender, prove the detector
// fires on it, then assert the mapped result is clean.
// ===========================================================================

describe("A6 — the planted offender (FR-M2 / ESC-9)", () => {
  test("a planted vendor error containing request-identifying text never reaches the result message", async () => {
    // ---- Step 1: NON-VACUITY. Prove this test CAN fail. -------------------
    // The detector must find every planted fragment in the vendor's own text.
    // If this control passes trivially, the zero-offender assertion below is
    // meaningless (the `purity.test.ts` discipline).
    expect(plantedFragmentsFoundIn(PLANTED_VENDOR_MESSAGE)).toEqual([...PLANTED_FRAGMENTS]);

    // And it must fire on a message that merely EMBEDS the vendor text — the
    // exact leak shape a templated or concatenated message would produce.
    const leakyMessage = `We could not generate a written explanation. ${PLANTED_VENDOR_MESSAGE}`;
    expect(plantedFragmentsFoundIn(leakyMessage).length).toBe(PLANTED_FRAGMENTS.length);

    // ---- Step 2: the assertion the obligation is actually about. ----------
    const vendorError = plantedVendorError();
    const failure = failureArmFor(vendorError);

    expect(plantedFragmentsFoundIn(failure.message)).toEqual([]);
    // Not just the fragments — no substring of the vendor's message at all,
    // and not the vendor's class name either.
    expect(failure.message.includes(PLANTED_VENDOR_MESSAGE)).toBe(false);
    expect(failure.message.includes("AI_APICallError")).toBe(false);
    // Nowhere on the result, not merely nowhere in `message`: a leak parked on
    // `resolvedModelId` would be the same disclosure.
    expect(plantedFragmentsFoundIn(JSON.stringify(failure))).toEqual([]);

    // The message is not empty — a scrubber that returns "" would pass every
    // absence assertion above while telling a customer nothing.
    expect(failure.message.length).toBeGreaterThan(0);
    // It is one of this package's own sentences, verbatim.
    expect(Object.values(SUMMARY_FAILURE_MESSAGES)).toContain(failure.message);
    // A transport failure is a mechanism failure, not a shape failure.
    expect(failure.code).toBe("call_failed");
  });

  test("a planted vendor error surfaced through the real SDK path still never reaches the message", async () => {
    const error = await realTransportError(PLANTED_VENDOR_MESSAGE);

    // The planted text really is reachable on the object the mapper receives —
    // otherwise the assertion that follows is testing nothing.
    expect(plantedFragmentsFoundIn(String((error as Error)?.message ?? ""))).not.toEqual([]);

    const failure = failureArmFor(error);
    expect(plantedFragmentsFoundIn(JSON.stringify(failure))).toEqual([]);
    expect(failure.code).toBe("call_failed");
  });

  test("a planted vendor error on the validation class is scrubbed too, and maps to output_invalid", async () => {
    // `NoObjectGeneratedError` carries the offending text on the error itself
    // (`.text` / `.cause`), so the shape-failure arm has its own leak surface.
    const error = await realNoObjectGeneratedError();
    expect(NoObjectGeneratedError.isInstance(error)).toBe(true);

    const failure = failureArmFor(error);
    expect(failure.code).toBe("output_invalid");
    expect(failure.message).toBe(SUMMARY_FAILURE_MESSAGES.output_invalid);
    expect(plantedFragmentsFoundIn(JSON.stringify(failure))).toEqual([]);
  });
});

// ===========================================================================
// A7 — the sweep. Every error class the map handles, and the claim that no
// vendor string is reachable from ANY of them.
// ===========================================================================

describe("A7 — the whole error map (AD-17)", () => {
  test("every mapped failure message is plain English from this package and never vendor text", async () => {
    // The sentence table is total over the closed union — a code with no
    // sentence would surface as `undefined` on a customer-facing field.
    const allCodes = summaryFailureCodeSchema.options as readonly SummaryFailureCode[];
    expect(allCodes.length).toBeGreaterThan(0);
    for (const code of allCodes) {
      const sentence = SUMMARY_FAILURE_MESSAGES[code];
      expect(typeof sentence).toBe("string");
      expect(sentence.length).toBeGreaterThan(0);
    }
    expect(Object.keys(SUMMARY_FAILURE_MESSAGES).toSorted()).toEqual([...allCodes].toSorted());

    // Every error class the map handles, each carrying DISTINCT planted vendor
    // text so a leak from any one of them is individually attributable.
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
          "401 authentication_error: invalid x-api-key sk-ant-api03-PLANTEDKEYTAIL",
        ),
      },
      {
        label: "rate limit",
        error: plantedVendorErrorWith("429 rate_limit_error (request req_01PLANTEDREQUESTID9999)"),
      },
      {
        label: "timeout",
        error: plantedVendorErrorWith(
          "Request timed out after 60000ms: https://api.anthropic.com/v1/messages",
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

      // The code is a member of the closed union — never a passed-through
      // vendor class name.
      expect(summaryFailureCodeSchema.safeParse(failure.code).success).toBe(true);
      // The message is drawn from this package's OWN table, verbatim. Not
      // "contains", not "starts with" — identity. A templated message that
      // appended a single byte of vendor text would fail here.
      expect({ label, message: failure.message }).toEqual({
        label,
        message: SUMMARY_FAILURE_MESSAGES[failure.code],
      });
      expect(sentences.has(failure.message)).toBe(true);
      // No vendor string is reachable anywhere on the arm.
      expect({ label, leaked: plantedFragmentsFoundIn(JSON.stringify(failure)) }).toEqual({
        label,
        leaked: [],
      });
      expect(failure.message.includes("AI_APICallError")).toBe(false);
      expect(failure.message.includes("anthropic")).toBe(false);
    }

    // NON-VACUITY on the sweep itself: the cases above must exercise BOTH
    // members of the union. A sweep that only ever produced `call_failed`
    // would report a clean map while leaving `output_invalid` untested.
    expect([...seenCodes].toSorted()).toEqual([...allCodes].toSorted());
  });

  test("the mapper reads only the error's class — a benign error with vendor-looking text still maps by mechanism", async () => {
    // Two errors of the SAME class with DIFFERENT messages must map to the
    // same code. If the mapper were reading the vendor's text to decide, these
    // would diverge — and a mapper that reads the text is one refactor away
    // from returning it.
    const first = mapSummaryError(plantedVendorErrorWith("429 rate_limit_error"));
    const second = mapSummaryError(
      plantedVendorErrorWith("503 overloaded_error: upstream unavailable"),
    );
    expect(first).toBe(second);
    expect(first).toBe("call_failed");

    // And the validation class stays distinct from it — collapsing the two
    // would erase the debugging signal `summaryFailureCodeSchema` exists to
    // preserve.
    expect(mapSummaryError(await realSchemaViolationError())).toBe("output_invalid");
    expect(mapSummaryError(await realSchemaViolationError())).not.toBe(first);
  });
});
