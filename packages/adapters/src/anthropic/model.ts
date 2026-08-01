// The one place a model provider is constructed.
//
// Why this file exists at all `./deps.ts` takes a `LanguageModel`, not a key and not a
// provider, so the no-key decision belongs to the composition root and never to the
// summariser. But the composition root is `worker/src/index.ts`, and NO file under
// `worker/` may import the AI SDK, `ai` and `@ai-sdk/anthropic` are declared in
// `packages/adapters/package.json` alone. Building a `LanguageModel` needs
// `createAnthropic`. Without this file the decision and the construction sit in two
// packages that are forbidden to meet.
//
// So the construction lands here, beside the summariser it feeds, and the key travels
// exactly one function call out of the composition root instead of the SDK travelling
// into `worker/`'s dependencies.
//
// Do not "simplify" this away by passing the model ID string `LanguageModel` is
// `GlobalProviderModelId | LanguageModelV4 | LanguageModelV3
// | LanguageModelV2` (`ai/dist/index.d.ts:112`). Handing `generateObject` the
// bare id string typechecks and then resolves through the Vercel AI Gateway rather than
// Anthropic. Every call on a keyed installation would fail, and the failure would look
// like a broken model call rather than a broken wire. This factory returns a model
// object bound to an Anthropic provider carrying the installation's own key;
// `__tests__/anthropic/model.test.ts` pins that the returned value is not a string and
// that its provider is Anthropic's.
//
// The key goes in and nothing comes back out Nothing here logs, persists, echoes, or
// returns the key. It is handed to `createAnthropic` and is thereafter reachable only
// through the provider's own lazy header closure. The model object this returns
// serialises without it. A named test asserts that, so a run row, a log line, or a
// crash dump built from this value cannot carry a credential.
//
// No construction-time validation, and that is the point
// `__tests__/anthropic/probe.test.ts:181-203` is the paid-for evidence:
// `createAnthropic` does not throw without a key, and neither does obtaining a
// model from it. The throw is deferred to the network edge. So this factory cannot be a
// place where "is a key configured?" gets answered, and it does not pretend to be one.
// That question is answered once, at the composition root, before this function is
// called at all: no key means no provider is constructed and no port is passed, so the
// count of model calls attempted on an unconfigured installation is structurally zero.
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export interface AnthropicModelConfig {
  /**
   * The installation's Anthropic API key, read once by the composition root from
   * `ANTHROPIC_API_KEY` and handed straight here.
   *
   * Required, and deliberately not optional. An optional key would let the provider
   * silently fall back to the ambient `ANTHROPIC_API_KEY` environment variable the SDK
   * reads by default, which would make the no-key branch a lie on any machine that
   * happens to have one exported, and would move the "is this configured?" decision out
   * of the one place that owns it.
   */
  readonly apiKey: string;

  /**
   * The model id the composition root resolved from configuration
   * (`GROWTHMIND_COLDSTART_MODEL`, falling back to `DEFAULT_COLDSTART_MODEL`).
   *
   * Carried, never chosen, nothing may hardcode a model id at a call site
   * (`./constants.ts`). The same resolved id is handed to
   * `createAnthropicSessionSummariser` so it can land on both arms of the port's
   * result.
   */
  readonly resolvedModelId: string;
}

/**
 * A `LanguageModel` bound to Anthropic and to this installation's key.
 *
 * No `deps` parameter, unlike `../slack/poster.ts` and `../posthog/session-source.ts`:
 * those adapters own a request and so must have their `fetch` injected to be drivable
 * without a network. This function makes no call and performs no I/O. It constructs a
 * value. Everything a test needs to replace lives on the other side of it, where
 * `MockLanguageModelV3` already stands in for the whole network edge.
 */
export function createAnthropicModel(config: AnthropicModelConfig): LanguageModel {
  // `apiKey` is passed explicitly rather than left to the sdk's env default, so the
  // credential this model carries is the one the composition root decided on and never
  // one the process happened to be started with.
  const provider = createAnthropic({ apiKey: config.apiKey });
  return provider(config.resolvedModelId);
}
