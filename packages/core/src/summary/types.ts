// The floor summary's own shapes.
//
// This directory is called in production as of. The analysis tick calls
// `renderFloorSummary`, persists what it returns, and reaches the model lane only above
// that floor, so `source` below is a value a real caller decides and a real row
// records, not a parameter nobody passes. The run table exists
// (`packages/db/src/schema/analysis-runs.ts`), the per-project cap is enforced, and a
// model call happens when a key is configured.
//
// What is still TRUE of these types: they describe what a model-free render produces.
// `model_rendered` remains unconstructible here, and the floor remains the destination
// of every degradation above it.
//
// Pure: no clock, no randomness, no I/O, no node builtin. The package-wide property
// `__tests__/detect/purity.test.ts` asserts over all of `src/`.
import { summarySourceSchema } from "@growthmind/shared";
import type { z } from "zod";

/**
 * Why a finding carries no written explanation. Narrowed to the causes a model-free
 * render can honestly claim.
 *
 * `model_rendered` is excluded at the type level, which is the whole point of declaring
 * this schema instead of reusing `summarySourceSchema` directly: a floor summary
 * claiming a model wrote its text is not merely wrong, it is unconstructible.
 * `.exclude` keeps the union closed rather than widening it to a string, so the five
 * remaining members are still exhaustive and still index `SUMMARY_SOURCE_MESSAGES`
 * without a fallback.
 *
 * Fail direction: refuse. `.parse` on a value outside the five throws; it does not fall
 * back to a default member. Defaulting would be the worse direction by some distance. A
 * rate-limited call reported as an installation with no key configured is a wrong
 * answer to the one question this field exists to answer, and it is a wrong answer
 * nobody can see is wrong.
 *
 * The narrowing lives here rather than beside `summarySourceSchema` in `shared` because
 * `shared` has no second consumer for it: the exclusion is a property of the floor
 * renderer, not of the union.
 */
export const floorSummarySourceSchema = summarySourceSchema.exclude(["model_rendered"]);
export type FloorSummarySource = z.infer<typeof floorSummarySourceSchema>;

/**
 * What a model-free render produces.
 *
 * The strings are pre-split into sentences, and that is load-bearing rather than tidy.
 * The rule forbidding a summary from implying the sessions counted as leaving are the
 * sessions counted as returning is judged per sentence
 * (`packages/shared/src/summary/messages.ts:23-65`), so a checker handed one blob would
 * have to re-split prose to judge it, and splitting prose is the step that stops being
 * reliable the moment a model writes it. Handing the checker sentences it did not have
 * to derive is what makes that judgement exact today and reusable against generated
 * text later.
 *
 * Invariant, asserted by `renderFloorSummary` and by `__tests__/summary/floor.test.ts`:
 * every element of `[headline,...context]` ends in exactly one full stop and carries
 * no sentence boundary inside it.
 *
 * `context` is `readonly string[]`, while the model port's already-shipped result arm
 * (`packages/shared/src/summary/types.ts:183-195`) declares `context: string`. The two
 * are one join apart and NO function performs that join in this package. A joining
 * function would be a production surface with no production caller, which is the shape
 * this directory exists not to add to. It lands with whoever first needs it.
 */
export type FloorSummary = {
  /** Why there is no written explanation. Supplied by the caller; never derived here.
   * The renderer has no env access, no model and no cap, so every value it could infer
   * would be a guess. */
  readonly source: FloorSummarySource;
  /** The observation. One sentence, naming the class the gate concluded and the surface
   * the claim is about. */
  readonly headline: string;
  /** Magnitude, timeframe, confidence, and the statement of how this was produced. In
   * that order. Each element is exactly one sentence. */
  readonly context: readonly string[];
};
