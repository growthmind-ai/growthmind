import type { DivergenceGrade, DivergenceResult } from "./types";

export function gradeOf(result: DivergenceResult): DivergenceGrade {
  return result.kind === "diverged" ? "explained" : "described";
}
