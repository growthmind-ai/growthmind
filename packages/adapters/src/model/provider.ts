import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { LanguageModel } from "ai";

export interface ColdstartModelConfig {
  readonly apiKey: string;

  // Bedrock API keys are scoped to one region, and the provider has no fallback
  // beyond AWS_REGION — a model id from the wrong region group fails at call time.
  readonly region: string;

  readonly resolvedModelId: string;
}

export function createColdstartModel(config: ColdstartModelConfig): LanguageModel {
  const provider = createAmazonBedrock({ apiKey: config.apiKey, region: config.region });
  return provider(config.resolvedModelId);
}
