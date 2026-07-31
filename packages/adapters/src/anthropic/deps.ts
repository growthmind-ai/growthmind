// Effect injection for the Anthropic summariser (AD-16), following
// `../slack/deps.ts` and `../posthog/deps.ts`: everything impure or
// policy-bearing this adapter can reach is HANDED to it, so every test drives
// the real implementation with zero network and zero API key.
//
// THE OUTPUT SCHEMA IS INJECTED, AND THAT IS THE LOAD-BEARING PART.
// `packages/adapters` depends on `@growthmind/shared` and nothing else in the
// workspace — it may NEVER import `packages/core`, where the anti-invention
// output shape is declared. Restating that shape here would give one contract
// two homes, and the copy that drifts is always the one nobody is testing. So
// the shape arrives as a parameter, the composition root passes core's, and the
// port's tests pass their own.
import type { FlexibleSchema, LanguageModel } from "ai";

/**
 * The prose the model is allowed to produce. Two string fields and nothing
 * else — no number, no score, no confidence word. THE MODEL IS A RENDERER,
 * NOT A JUDGE: every number a customer ever reads is substituted from
 * gate-proven state elsewhere, never generated here.
 */
export interface SummaryOutput {
  readonly headline: string;
  readonly context: string;
}

export interface AnthropicSummariserDeps {
  /**
   * The language model to call. A `LanguageModel`, not a provider and not a
   * key: constructing the provider (and deciding what to do when no key is
   * configured) belongs to the composition root, which must make the no-key
   * call a DECISION taken before any call is attempted rather than an
   * exception this adapter catches (`__tests__/anthropic/probe.test.ts` A-5).
   */
  readonly model: LanguageModel;

  /**
   * The model id the composition root resolved from configuration
   * (`GROWTHMIND_COLDSTART_MODEL`, falling back to `DEFAULT_COLDSTART_MODEL`).
   *
   * Carried, never chosen. It is echoed onto BOTH arms of the result — a call
   * that failed still addressed a model and still consumed the cap.
   */
  readonly resolvedModelId: string;

  /** Injected, per the header. Validates the model's output before it is ever
   * returned as ok. */
  readonly outputSchema: FlexibleSchema<SummaryOutput>;
}
