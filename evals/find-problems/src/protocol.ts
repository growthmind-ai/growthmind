import { z } from "zod";

export const visibleElementSchema = z.object({
  index: z.number().int(),
  tag: z.string(),
  inputType: z.string().nullable(),
  role: z.string().nullable(),
  name: z.string(),
  placeholder: z.string().nullable(),
  href: z.string().nullable(),
  hasValue: z.boolean(),
  disabled: z.boolean(),
});

export const observationSchema = z.object({
  type: z.literal("observation"),
  step: z.number().int(),
  url: z.string(),
  title: z.string(),
  headings: z.array(z.string()),
  visibleText: z.string(),
  elements: z.array(visibleElementSchema),
  screenshotPath: z.string(),
  consoleErrorCount: z.number().int(),
});

export const actedSchema = z.object({
  type: z.literal("acted"),
  step: z.number().int(),
  action: z.string(),
  elementIndex: z.number().int().nullable(),
  text: z.string().nullable(),
  ok: z.boolean(),
  error: z.string().nullable(),
});

export const consoleErrorSchema = z.object({ message: z.string(), url: z.string() });

export const finalSchema = z.object({
  type: z.literal("final"),
  sessionPath: z.string(),
  finalUrl: z.string(),
  recordError: z.string().nullable(),
  eventCount: z.number().int(),
  consoleErrors: z.array(consoleErrorSchema),
});

export const driverErrorSchema = z.object({ type: z.literal("error"), message: z.string() });

export const driverMessageSchema = z.discriminatedUnion("type", [
  observationSchema,
  actedSchema,
  finalSchema,
  driverErrorSchema,
]);

export type ConsoleErrorRecord = z.infer<typeof consoleErrorSchema>;
export type VisibleElement = z.infer<typeof visibleElementSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type ActedReport = z.infer<typeof actedSchema>;
export type DriverFinal = z.infer<typeof finalSchema>;
export type DriverMessage = z.infer<typeof driverMessageSchema>;

export const DRIVER_ACTIONS = ["click", "type", "press_enter", "scroll", "back", "wait"] as const;

export type DriverAction = (typeof DRIVER_ACTIONS)[number];

export interface ActCommand {
  readonly type: "act";
  readonly action: DriverAction;
  readonly elementIndex: number | null;
  readonly text: string | null;
  readonly scrollBy?: number;
}
