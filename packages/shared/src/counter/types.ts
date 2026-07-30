import { z } from "zod";

import { exclusionReasonSchema } from "../exclusions/types";
import { connectionStateSchema } from "../session-source/types";

/**
 * The freshness statement attached to the onboarding counter. States a
 * MEASUREMENT, never a promise — decision 0001 measured the event leg's p90
 * retrieval at about 25 seconds, and OQ-1 (whether the product still promises
 * 5–20 seconds) is a product decision this sprint deliberately does not make.
 */
export const expectedLagSchema = z.object({
  typicalSeconds: z.number().int().nonnegative(),
  worstCaseSeconds: z.number().int().nonnegative(),
  /** Plain English, from `session-source/messages.ts`. */
  statement: z.string(),
});
export type ExpectedLag = z.infer<typeof expectedLagSchema>;

/**
 * One row of the set-aside breakdown. An array rather than a keyed record so
 * `totalReceived = kept + Σ setAside + droppedUnreadable` is a sum over a
 * list — the identity a test asserts directly (FR-15).
 */
export const setAsideBreakdownSchema = z.object({
  reason: exclusionReasonSchema,
  count: z.number().int().nonnegative(),
  /** From `EXCLUSION_REASON_LABELS`. */
  label: z.string(),
});
export type SetAsideBreakdown = z.infer<typeof setAsideBreakdownSchema>;

/**
 * What onboarding step 2 shows. Every number carries its denominator, and
 * every gap is visible rather than laundered:
 *
 * - `keptIdentityUnverified` counts sessions we KEPT but could not check
 *   (F-8). A session we could not check is not a session we checked and
 *   cleared, and this field is what keeps that difference on screen.
 * - `droppedUnreadable` counts items the boundary parser skipped. Skipped and
 *   COUNTED, never silently discarded (D-13).
 * - `asOf` is the completion time of the most recent SUCCESSFUL poll — not
 *   wall-clock now, and not the newest event's own declared time.
 */
export const eventsSeenCounterSchema = z.object({
  state: connectionStateSchema,
  totalReceived: z.number().int().nonnegative(),
  kept: z.number().int().nonnegative(),
  setAside: z.array(setAsideBreakdownSchema),
  keptIdentityUnverified: z.number().int().nonnegative(),
  droppedUnreadable: z.number().int().nonnegative(),
  asOf: z.date().nullable(),
  /** From `COUNTER_WINDOW_STATEMENT` — the window is named, never implied. */
  windowStatement: z.string(),
  /** From `COUNTER_COMPLETENESS_STATEMENT` — we say what we have seen. */
  completenessStatement: z.string(),
  expectedLag: expectedLagSchema,
});
export type EventsSeenCounter = z.infer<typeof eventsSeenCounterSchema>;
