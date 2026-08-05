import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export interface ColdstartModelConfig {
  readonly apiKey: string;

  readonly resolvedModelId: string;
}

export function createColdstartModel(config: ColdstartModelConfig): LanguageModel {
  const provider = createGoogle({ apiKey: config.apiKey });
  return provider(config.resolvedModelId);
}
