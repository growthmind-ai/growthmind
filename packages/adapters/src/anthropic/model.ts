import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export interface AnthropicModelConfig {
  readonly apiKey: string;

  readonly resolvedModelId: string;
}

export function createAnthropicModel(config: AnthropicModelConfig): LanguageModel {
  const provider = createAnthropic({ apiKey: config.apiKey });
  return provider(config.resolvedModelId);
}
