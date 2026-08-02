import { z } from "zod";

import { exclusionReasonSchema } from "../exclusions/types";
import { connectionStateSchema } from "../session-source/types";

export const expectedLagSchema = z.object({
  typicalSeconds: z.number().int().nonnegative(),
  worstCaseSeconds: z.number().int().nonnegative(),

  statement: z.string(),
});
export type ExpectedLag = z.infer<typeof expectedLagSchema>;

export const setAsideBreakdownSchema = z.object({
  reason: exclusionReasonSchema,
  count: z.number().int().nonnegative(),

  label: z.string(),
});
export type SetAsideBreakdown = z.infer<typeof setAsideBreakdownSchema>;

export const eventsSeenCounterSchema = z.object({
  state: connectionStateSchema,
  totalReceived: z.number().int().nonnegative(),
  kept: z.number().int().nonnegative(),
  setAside: z.array(setAsideBreakdownSchema),
  keptIdentityUnverified: z.number().int().nonnegative(),
  droppedUnreadable: z.number().int().nonnegative(),
  asOf: z.date().nullable(),

  windowStatement: z.string(),

  completenessStatement: z.string(),
  expectedLag: expectedLagSchema,
});
export type EventsSeenCounter = z.infer<typeof eventsSeenCounterSchema>;
