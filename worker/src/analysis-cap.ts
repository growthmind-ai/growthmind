/**
 * The two limits on written explanations, per project and per organisation. Both are
 * enforced by the one atomic claim statement (`createAnalysisRunsRepo.claimModelCall`)
 * as lifetime counts over never-pruned claim rows, and both refusals degrade to the
 * floor sentence, never to silence.
 * Design rationale: docs/decisions/0004-analysis-cap.md
 */

/**
 * The per-project ceiling on written explanations: a lifetime count of claim rows, so
 * the window is the project's first check. On exhaustion, candidates still persist
 * under `floor_cap_exhausted` and the run records `stop_reason = cap_exhausted`.
 * Rationale, including why twelve: docs/decisions/0004-analysis-cap.md
 */
export const COLDSTART_MODEL_CALL_CAP = 12;

/**
 * The per-organisation ceiling, every project summed, same lifetime window and same
 * refusal as the cap above: candidates persist under `floor_cap_exhausted`, never
 * dropped. Re-derived from the per-project cap (ten projects' worth) if that moves.
 * Rationale: docs/decisions/0004-analysis-cap.md
 */
export const ORG_MODEL_CALL_CAP = 120;
