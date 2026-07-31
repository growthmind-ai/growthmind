// The `SessionSummariser` port's Anthropic implementation (ADD §7.1, AD-3,
// AD-16, FR-M1/FR-M9/FR-M15). The first code in this repository that calls a
// model.
//
// ── THE MODEL IS A RENDERER, NOT A JUDGE ────────────────────────────────────
// It produces framing prose and nothing else. Every number a customer reads is
// substituted from gate-proven state elsewhere; no numeric confidence exists in
// this product. The output schema is INJECTED (`./deps.ts`), so the shape that
// structurally forbids a score or a confidence field has exactly one home, in
// `packages/core`, which this package may not import.
//
// ── IT NEVER THROWS ─────────────────────────────────────────────────────────
// `render` degrades BY RETURN VALUE. A throw here would reach the worker as an
// unhandled rejection instead of a fallback to the deterministic floor, which
// is the difference between a finding delivered with numbers only and a
// finding not delivered at all. Transport, auth, rate limit and timeout all
// land on the `ok:false` / `call_failed` arm; a shape failure lands on
// `output_invalid`. `./errors.ts` owns that mapping and owns the sentences.
//
// ── BOTH ARMS CARRY `resolvedModelId` AND `usage` ───────────────────────────
// A failed call still addressed a model and still consumed the cap. Usage
// fields the SDK did not report stay `undefined` and are NEVER coerced to `0`:
// a candidate the model touched but did not meter must not look identical to
// one that cost nothing (FR-M9).
//
// ── EVERY CALL CARRIES A DEADLINE AND A RETRY COUNT ─────────────────────────
// Both are stated at the call site rather than inherited. Unset, the deadline
// is the runtime's (effectively none) and one hung socket holds this project's
// `analysis_runs` row open forever; unset, `maxRetries` is the SDK's 2, and one
// cap claim buys three billable requests. `./constants.ts` holds both numbers
// and the reasoning for each.
import { generateObject } from "ai";

import { summaryUsageSchema } from "@growthmind/shared";
import type { SummaryRenderResult, SummaryUsage } from "@growthmind/shared";

import { MODEL_CALL_MAX_RETRIES, MODEL_REQUEST_TIMEOUT_MS } from "./constants";
import { mapSummaryError, summaryFailure } from "./errors";
import type { AnthropicSummariserDeps } from "./deps";

/**
 * One gate-proven candidate, restated for the renderer.
 *
 * Every field is a FACT THE GATE ALREADY ESTABLISHED. Nothing here is a
 * judgement, and the model is asked to add none: `confidenceBasis` is the
 * evidence the confidence rests on, expressed in the caller's own words — the
 * model must not invent a confidence, a score, or a certainty word from it.
 */
export interface SummariseInput {
  /** The symptom class the deterministic lane settled on. */
  readonly finalClass: string;
  /** Where in the product it happens. */
  readonly surface: string;
  /** Counts always carry their denominator — a bare numerator is not a fact a
   * customer can act on. */
  readonly counts: readonly {
    readonly numerator: number;
    readonly denominator: number;
    readonly unit: string;
  }[];
  readonly timeframe: { readonly start: Date; readonly end: Date };
  /** What the confidence RESTS ON, never a confidence value. */
  readonly confidenceBasis: string;
}

export interface SessionSummariser {
  /** Never throws. Degradation is by return value. */
  render(input: SummariseInput): Promise<SummaryRenderResult>;
}

/**
 * The instruction. Written here rather than in `packages/shared` because it is
 * not a customer-facing string — no byte of it is ever shown to anyone — it is
 * this adapter's own call shape.
 *
 * Note what it forbids. The injected schema already makes a numeric field
 * unrepresentable; this repeats the constraint in prose so the model does not
 * smuggle a number or a certainty word INTO a string field, which is the one
 * leak the schema cannot close.
 */
const SYSTEM_PROMPT = [
  "You write two short lines of plain English about a problem that has already been found and verified by other software.",
  "You are a renderer, not a judge. You do not decide whether the problem is real, how severe it is, or how confident anyone should be.",
  "Never write a number, a percentage, a count, a date, or a time span. The numbers are added afterwards from verified data; any you write would be wrong.",
  "Never write a confidence, certainty, likelihood, probability, or severity word.",
  "Never invent a cause, a fix, or anything the input does not state.",
  "Write for a busy non-technical person: short sentences, no jargon, no marketing tone.",
].join("\n");

function describeCounts(input: SummariseInput): string {
  if (input.counts.length === 0) {
    return "(no counts recorded)";
  }
  return input.counts
    .map((count) => `${count.numerator} of ${count.denominator} ${count.unit}`)
    .join("; ");
}

function buildPrompt(input: SummariseInput): string {
  return [
    `Symptom: ${input.finalClass}`,
    `Where: ${input.surface}`,
    `Observed: ${describeCounts(input)}`,
    `Period: ${input.timeframe.start.toISOString()} to ${input.timeframe.end.toISOString()}`,
    `Evidence this rests on: ${input.confidenceBasis}`,
    "",
    "Write a headline naming what people are running into, and one or two sentences of context. No numbers, no dates, no confidence words.",
  ].join("\n");
}

/**
 * Reads the SDK's usage into the port's shape.
 *
 * `undefined` in, `undefined` out — the property is OMITTED rather than set,
 * so `exactOptionalPropertyTypes` and `JSON.stringify` both agree with the
 * schema, and "we were not told" is never recorded as "this cost nothing".
 */
function toSummaryUsage(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}): SummaryUsage {
  const candidate: Record<string, number> = {};
  if (typeof usage.inputTokens === "number") {
    candidate.inputTokens = usage.inputTokens;
  }
  if (typeof usage.outputTokens === "number") {
    candidate.outputTokens = usage.outputTokens;
  }
  // The SDK's usage is external data (D5): a negative or fractional count is
  // not a shape this port promises, and a whole render must not fail over a
  // token count. An unparseable usage degrades to "not reported".
  const parsed = summaryUsageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : {};
}

/**
 * Usage on the failure arm.
 *
 * A validation-class error carries the usage of the call that produced the bad
 * output, so the cap can still be charged accurately. This reads only numeric
 * fields off the error object — never its text — and returns `{}` for anything
 * it cannot read, because a transport failure genuinely reports no usage.
 */
function usageFromError(error: unknown): SummaryUsage {
  if (typeof error !== "object" || error === null || !("usage" in error)) {
    return {};
  }
  const usage = (error as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) {
    return {};
  }
  const { inputTokens, outputTokens } = usage as {
    inputTokens?: unknown;
    outputTokens?: unknown;
  };
  return toSummaryUsage({
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
  });
}

/**
 * Builds the port. The model, the resolved model id and the output schema are
 * all injected — this factory chooses none of them, which is what keeps model
 * selection in configuration (AD-3) and the anti-invention contract in
 * `packages/core` (AD-16).
 */
export function createAnthropicSessionSummariser(
  deps: AnthropicSummariserDeps,
): SessionSummariser {
  return {
    async render(input: SummariseInput): Promise<SummaryRenderResult> {
      try {
        const result = await generateObject({
          model: deps.model,
          schema: deps.outputSchema,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(input),
          // The deadline. A fresh signal per call — `AbortSignal.timeout`
          // starts counting when it is constructed, so one hoisted out of here
          // would be a shared stopwatch that expires mid-run and fails every
          // later candidate instantly. The rejection it produces is not
          // special-cased: it falls into the catch below like any other
          // transport failure and leaves as `call_failed`.
          abortSignal: AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
          // Stated, never inherited. The cap counts CLAIMS, so the SDK's
          // default of 2 would silently make one claim worth three billable
          // requests.
          maxRetries: MODEL_CALL_MAX_RETRIES,
        });

        return {
          ok: true,
          headline: result.object.headline,
          context: result.object.context,
          resolvedModelId: deps.resolvedModelId,
          usage: toSummaryUsage(result.usage),
        };
      } catch (error) {
        // One exit for every failure mechanism. The error object is handed to
        // `mapSummaryError`, which reads only its class, and to
        // `usageFromError`, which reads only numbers — neither returns text,
        // and `summaryFailure` has no parameter that could carry any.
        return summaryFailure({
          code: mapSummaryError(error),
          resolvedModelId: deps.resolvedModelId,
          usage: usageFromError(error),
        });
      }
    },
  };
}
