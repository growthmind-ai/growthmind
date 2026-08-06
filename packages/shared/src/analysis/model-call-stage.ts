import { z } from "zod";

export const modelCallStageSchema = z.enum(["render", "cause"]);
export type ModelCallStage = z.infer<typeof modelCallStageSchema>;

export const MODEL_CALL_STAGE = {
  RENDER: "render",
  CAUSE: "cause",
} as const satisfies Record<string, ModelCallStage>;
