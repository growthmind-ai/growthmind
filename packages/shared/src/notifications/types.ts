import { z } from "zod";

import type { PostFailureCode } from "../delivery/poster";

// Exactly the emitters that exist. A member with no emitter is a dead wire (O-026 D11);
// later jobs add members alongside their emitters.
export const NOTIFICATION_TYPES = [
  "finding_delivered",
  "keys_revoked",
  "agent_first_contact",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

// Derived from type in code, never stored.
export const NOTIFICATION_CLASSES = ["act_now", "work", "record"] as const;
export type NotificationClass = (typeof NOTIFICATION_CLASSES)[number];

// Written out member-by-member so a new type without a class is a type error.
export const NOTIFICATION_CLASS_BY_TYPE: Record<NotificationType, NotificationClass> = {
  finding_delivered: "work",
  keys_revoked: "act_now",
  agent_first_contact: "work",
};

// Every actionable notification carries a Slack send row — sent, failed, or quiet with a
// stated reason. A bell-only actionable notification is a bug, testable by this list.
export const ACTIONABLE_CLASSES = [
  "act_now",
  "work",
] as const satisfies readonly NotificationClass[];

// D1 as a column; v1 always writes "org".
export const NOTIFICATION_AUDIENCES = ["org", "owner"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_SUBJECT_KINDS = ["finding", "agent_key"] as const;
export type NotificationSubjectKind = (typeof NOTIFICATION_SUBJECT_KINDS)[number];

// Job 1 only ever writes "slack"; "email" is deliberately absent, never built per the spec.
export const NOTIFICATION_CHANNELS = ["slack", "web_push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

export const NOTIFICATION_SEND_STATUSES = ["sent", "failed", "quiet"] as const;
export type NotificationSendStatus = (typeof NOTIFICATION_SEND_STATUSES)[number];
export const notificationSendStatusSchema = z.enum(NOTIFICATION_SEND_STATUSES);

// Only the members job 1 can produce (OQ-4); later jobs grow this with their producers.
export const NOTIFICATION_QUIET_REASONS = ["no_channel"] as const;
export type NotificationQuietReason = (typeof NOTIFICATION_QUIET_REASONS)[number];
export const notificationQuietReasonSchema = z.enum(NOTIFICATION_QUIET_REASONS);

// The CODE is stored, the sentence is rendered at read through the messages map — vendor
// text cannot enter a column whose union rejects it, and a copy reword never strands
// historical rows (the reason-code.ts lesson).
export const NOTIFICATION_SEND_FAILURE_REASONS = [
  "call_failed",
  "rejected",
  "not_authorised",
  "channel_unavailable",
  "queue_unavailable",
] as const satisfies readonly (PostFailureCode | "queue_unavailable")[];
export type NotificationSendFailureReason = (typeof NOTIFICATION_SEND_FAILURE_REASONS)[number];
export const notificationSendFailureReasonSchema = z.enum(NOTIFICATION_SEND_FAILURE_REASONS);

// The worker names the task; the emit queues it. One constant so a typo is a compile
// error rather than a job nothing is registered to run (D9).
export const NOTIFICATION_DISPATCH_TASK = "notification:dispatch";

export const notificationDispatchPayloadSchema = z.object({
  organizationId: z.string().min(1),
  notificationId: z.string().min(1),
});
export type NotificationDispatchPayload = z.infer<typeof notificationDispatchPayloadSchema>;

// `notification_sends.target` when no channel existed to send to.
export const NOTIFICATION_SEND_NO_TARGET = "none";

// The bell-state writes name no ids: which person and which organization comes from the
// session, so there is nowhere for a caller to put someone else's (D7).
export const bellOpenedInputSchema = z.strictObject({});

export const bellReadAllInputSchema = z.strictObject({});

export const bellReadInputSchema = z.strictObject({ notificationId: z.string().min(1).max(128) });

export type BellReadInput = z.infer<typeof bellReadInputSchema>;
