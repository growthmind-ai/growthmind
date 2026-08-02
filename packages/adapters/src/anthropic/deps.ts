import type { FlexibleSchema, LanguageModel } from "ai";

export interface SummaryOutput {
  readonly headline: string;
  readonly context: string;
}

export interface AnthropicSummariserDeps {
  readonly model: LanguageModel;

  readonly resolvedModelId: string;

  readonly outputSchema: FlexibleSchema<SummaryOutput>;
}
