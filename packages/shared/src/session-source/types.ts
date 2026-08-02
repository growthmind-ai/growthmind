import { z } from "zod";

export const sessionSourceKindSchema = z.enum(["posthog"]);
export type SessionSourceKind = z.infer<typeof sessionSourceKindSchema>;

export const sourceFailureCodeSchema = z.enum([
  "invalid_credentials",
  "project_not_found",
  "unreachable",
  "rate_limited",
  "misconfigured",
]);
export type SourceFailureCode = z.infer<typeof sourceFailureCodeSchema>;

export const sourceFailureSchema = z.object({
  code: sourceFailureCodeSchema,

  message: z.string(),
});
export type SourceFailure = z.infer<typeof sourceFailureSchema>;

export const connectionHealthSchema = z.enum(["validating", "healthy", "failing", "disconnected"]);
export type ConnectionHealth = z.infer<typeof connectionHealthSchema>;

export const internalDomainProvenanceSchema = z.enum(["org_creator_email"]);
export type InternalDomainProvenance = z.infer<typeof internalDomainProvenanceSchema>;

export const identityResolutionSchema = z.enum(["resolved", "absent", "unresolved"]);
export type IdentityResolution = z.infer<typeof identityResolutionSchema>;

export const sessionSourceValidationSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), checkedAt: z.date() }),
  z.object({ ok: z.literal(false), checkedAt: z.date(), failure: sourceFailureSchema }),
]);
export type SessionSourceValidation = z.infer<typeof sessionSourceValidationSchema>;

export const sessionSourcePullRequestSchema = z.object({
  watermarkAt: z.date().nullable(),

  backfillBefore: z.string().nullable(),

  maxPages: z.number().int().positive(),
});
export type SessionSourcePullRequest = z.infer<typeof sessionSourcePullRequestSchema>;

export const sourceSessionSchema = z.object({
  sessionKey: z.string(),

  identityKey: z.string().nullable(),
  identityEmailDomain: z.string().nullable(),
  identityResolution: identityResolutionSchema,
  userAgent: z.string().nullable(),
  entryUrlPath: z.string().nullable(),
  startedAt: z.date(),
  lastEventAt: z.date(),
});
export type SourceSession = z.infer<typeof sourceSessionSchema>;

export const sourceEventSchema = z.object({
  sourceEventId: z.string(),

  sessionKey: z.string(),

  name: z.string(),

  occurredAt: z.date(),
  urlPath: z.string().nullable(),
});
export type SourceEvent = z.infer<typeof sourceEventSchema>;

const pullTelemetry = {
  pagesFetched: z.number().int().nonnegative(),

  droppedMalformed: z.number().int().nonnegative(),
  identityLookupsUsed: z.number().int().nonnegative(),
  eventsReceived: z.number().int().nonnegative(),
};

export const sessionSourcePullResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    sessions: z.array(sourceSessionSchema),
    events: z.array(sourceEventSchema),

    newestObservedAt: z.date().nullable(),

    contiguous: z.boolean(),

    resumeBefore: z.string().nullable(),
    ...pullTelemetry,
  }),
  z.object({
    ok: z.literal(false),
    failure: sourceFailureSchema,

    partialSessions: z.array(sourceSessionSchema),
    partialEvents: z.array(sourceEventSchema),
    ...pullTelemetry,
  }),
]);
export type SessionSourcePullResult = z.infer<typeof sessionSourcePullResultSchema>;

export const connectionSummarySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  sourceKind: sessionSourceKindSchema,
  host: z.string(),
  sourceProjectId: z.string(),
  isActive: z.boolean(),
  health: connectionHealthSchema,
  healthReasonCode: sourceFailureCodeSchema.nullable(),
  healthReasonMessage: z.string().nullable(),
  healthCheckedAt: z.coerce.date().nullable(),

  watermarkAt: z.coerce.date().nullable(),
  backfillBefore: z.string().nullable(),
  pollIntervalSeconds: z.number().int().positive(),
  connectedAt: z.coerce.date(),
  inferredInternalDomain: z.string().nullable(),
  internalDomainProvenance: internalDomainProvenanceSchema.nullable(),
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

export const connectionStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_connected") }),

  z.object({ status: z.literal("validating"), connection: connectionSummarySchema }),

  z.object({ status: z.literal("connected_never_polled"), connection: connectionSummarySchema }),

  z.object({ status: z.literal("connected_no_events_yet"), connection: connectionSummarySchema }),

  z.object({ status: z.literal("connected_receiving"), connection: connectionSummarySchema }),

  z.object({ status: z.literal("failing"), connection: connectionSummarySchema }),

  z.object({ status: z.literal("disconnected"), connection: connectionSummarySchema }),
]);
export type ConnectionState = z.infer<typeof connectionStateSchema>;
export type ConnectionStateStatus = ConnectionState["status"];

export const connectInputSchema = z.object({
  projectId: z.string().min(1),
  sourceKind: sessionSourceKindSchema,
  host: z.string().min(1),
  sourceProjectId: z.string().min(1),
  personalApiKey: z.string().min(1),
});
export type ConnectInput = z.infer<typeof connectInputSchema>;

export const connectRefusalCodeSchema = z.enum([
  "second_source",
  "invalid_credentials",
  "project_not_found",
  "unreachable",
  "rate_limited",
  "misconfigured",
]);
export type ConnectRefusalCode = z.infer<typeof connectRefusalCodeSchema>;

export const connectRefusalSchema = z.object({
  code: connectRefusalCodeSchema,

  message: z.string(),
});
export type ConnectRefusal = z.infer<typeof connectRefusalSchema>;

export const connectResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    connection: connectionSummarySchema,

    firstPullEventsSeen: z.number().int().nonnegative(),
  }),
  z.object({ ok: z.literal(false), refusal: connectRefusalSchema }),
]);
export type ConnectResult = z.infer<typeof connectResultSchema>;

export const pollRunStatusSchema = z.enum(["running", "completed", "failed"]);
export type PollRunStatus = z.infer<typeof pollRunStatusSchema>;

export const pollRunOutcomeSchema = z.enum(["with_events", "no_new_events"]);
export type PollRunOutcome = z.infer<typeof pollRunOutcomeSchema>;
