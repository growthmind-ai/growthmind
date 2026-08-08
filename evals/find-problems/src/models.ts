import { createColdstartModel } from "@growthmind/adapters";
import type { LanguageModel } from "ai";

import type { EvalEnv } from "./env";

export interface EvalModels {
  readonly persona: LanguageModel;
  readonly analyser: LanguageModel;
  readonly judge: LanguageModel;
  readonly ids: { readonly persona: string; readonly analyser: string; readonly judge: string };
}

export function createEvalModels(env: EvalEnv): EvalModels {
  const of = (resolvedModelId: string): LanguageModel =>
    createColdstartModel({ apiKey: env.apiKey, region: env.region, resolvedModelId });

  return {
    persona: of(env.personaModelId),
    analyser: of(env.analyserModelId),
    judge: of(env.judgeModelId),
    ids: {
      persona: env.personaModelId,
      analyser: env.analyserModelId,
      judge: env.judgeModelId,
    },
  };
}
