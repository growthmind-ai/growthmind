import { z } from "zod";

export const replaySourceKindSchema = z.enum(["rrweb"]);
export type ReplaySourceKind = z.infer<typeof replaySourceKindSchema>;

export const replayFailureCodeSchema = z.enum([
  "invalid_credentials",
  "missing_read_scope",
  "recording_not_found",
  "unreachable",
  "rate_limited",
  "misconfigured",
]);
export type ReplayFailureCode = z.infer<typeof replayFailureCodeSchema>;

export const replayFailureSchema = z.object({
  code: replayFailureCodeSchema,

  message: z.string(),
});
export type ReplayFailure = z.infer<typeof replayFailureSchema>;

export const rrwebEventSchema = z.object({
  type: z.number().int().nonnegative(),
  timestamp: z.number().positive().finite(),
  data: z.unknown(),
});
export type RrwebEvent = z.infer<typeof rrwebEventSchema>;

export const replayRecordingSummarySchema = z.object({
  recordingId: z.string().min(1),

  startedAt: z.date().nullable(),
  lastActivityAt: z.date().nullable(),
  meta: z.record(z.string(), z.unknown()),
});
export type ReplayRecordingSummary = z.infer<typeof replayRecordingSummarySchema>;

export const replayListRequestSchema = z.object({
  sinceAt: z.date().nullable(),

  maxPages: z.number().int().positive(),
});
export type ReplayListRequest = z.infer<typeof replayListRequestSchema>;

export const replayListStopSchema = z.enum(["watermark", "page_cap", "exhausted"]);
export type ReplayListStop = z.infer<typeof replayListStopSchema>;

const replayTelemetry = {
  pagesFetched: z.number().int().nonnegative(),

  droppedMalformed: z.number().int().nonnegative(),
  eventsReceived: z.number().int().nonnegative(),
};

export const replayListResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    recordings: z.array(replayRecordingSummarySchema),

    stop: replayListStopSchema,
    resumeCursor: z.string().nullable(),
    ...replayTelemetry,
  }),
  z.object({
    ok: z.literal(false),
    failure: replayFailureSchema,

    partialRecordings: z.array(replayRecordingSummarySchema),
    ...replayTelemetry,
  }),
]);
export type ReplayListResult = z.infer<typeof replayListResultSchema>;

export const replayEventsResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    events: z.array(rrwebEventSchema),
    ...replayTelemetry,
  }),
  z.object({
    ok: z.literal(false),
    failure: replayFailureSchema,

    partialEvents: z.array(rrwebEventSchema),
    ...replayTelemetry,
  }),
]);
export type ReplayEventsResult = z.infer<typeof replayEventsResultSchema>;

export const replaySourceValidationSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), checkedAt: z.date() }),
  z.object({ ok: z.literal(false), checkedAt: z.date(), failure: replayFailureSchema }),
]);
export type ReplaySourceValidation = z.infer<typeof replaySourceValidationSchema>;
