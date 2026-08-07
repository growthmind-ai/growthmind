import { z } from "zod";

import { isRetryablePostFailure, type PostFailureCode } from "../delivery/poster";

// Exactly the emitters that exist. A member with no emitter is a dead wire (O-026 D11);
// later jobs add members alongside their emitters.
export const NOTIFICATION_TYPES = [
  "finding_delivered",
  "keys_revoked",
  "agent_first_contact",
  "key_created",
  "backfill_complete",
  "slack_disconnected",
  "analysis_failing",
  "digest",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

// Derived from type in code, never stored.
export const NOTIFICATION_CLASSES = ["act_now", "work", "record"] as const;
export type NotificationClass = (typeof NOTIFICATION_CLASSES)[number];

// Written out member-by-member so a new type without a class is a type error. The health
// types are act_now because the card's "Health and security: always sent" line is enforced
// by this map rather than by the sentence that promises it.
export const NOTIFICATION_CLASS_BY_TYPE: Record<NotificationType, NotificationClass> = {
  finding_delivered: "work",
  keys_revoked: "act_now",
  agent_first_contact: "work",
  key_created: "act_now",
  backfill_complete: "record",
  slack_disconnected: "act_now",
  analysis_failing: "act_now",
  digest: "record",
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

export const NOTIFICATION_SUBJECT_KINDS = [
  "finding",
  "agent_key",
  "slack_connection",
  "source_connection",
  "project",
  "organization",
] as const;
export type NotificationSubjectKind = (typeof NOTIFICATION_SUBJECT_KINDS)[number];

// Job 1 only ever writes "slack"; "email" is deliberately absent, never built per the spec.
export const NOTIFICATION_CHANNELS = ["slack", "web_push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

// "pending" is in flight, and only the dispatch worker ever writes it: it means the claim
// is held and the outcome is still owed, which is why the bell renders it as no chip.
export const NOTIFICATION_SEND_STATUSES = ["pending", "sent", "failed", "quiet"] as const;
export type NotificationSendStatus = (typeof NOTIFICATION_SEND_STATUSES)[number];
export const notificationSendStatusSchema = z.enum(NOTIFICATION_SEND_STATUSES);

export const NOTIFICATION_QUIET_REASONS = ["no_channel", "digest"] as const;
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

// Delegated, never restated: everything but the queue's own failure narrows to
// PostFailureCode, so a reason added to the union that the poster does not know is a
// compile error here rather than an unclassified retry.
export function isRetryableSendFailure(reason: NotificationSendFailureReason): boolean {
  return reason === "queue_unavailable" ? true : isRetryablePostFailure(reason);
}

// What a receipt says, independent of who is reading it: the pure precedence rule and the
// repository row are both this shape, so neither can drift from the other.
export interface SlackReceiptFacts {
  readonly channel: NotificationChannel;
  readonly target: string;
  readonly status: NotificationSendStatus;
  readonly quietReason: string | null;
  readonly failureReason: string | null;
  readonly messageRef: string | null;

  // Written beside `target` at send time, so a repoint or a disconnect cannot relabel a
  // receipt that has already happened.
  readonly channelLabel: string | null;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
}

// The worker names the task; the emit queues it. One constant so a typo is a compile
// error rather than a job nothing is registered to run (D9).
export const NOTIFICATION_DISPATCH_TASK = "notification:dispatch";

export const NOTIFICATION_RESCUE_TASK = "notification:rescue";

export const NOTIFICATION_RESCUE_TICK_TASK = "notification:rescue-tick";

export const NOTIFICATION_DIGEST_TASK = "notification:digest";

export const notificationDispatchPayloadSchema = z.object({
  organizationId: z.string().min(1),
  notificationId: z.string().min(1),
});
export type NotificationDispatchPayload = z.infer<typeof notificationDispatchPayloadSchema>;

// One org per job, so the tick's fan-out and a connection write queue the same shape and
// collapse on the same job key.
export const notificationRescuePayloadSchema = z.object({
  organizationId: z.string().min(1),
});
export type NotificationRescuePayload = z.infer<typeof notificationRescuePayloadSchema>;

// `notification_sends.target` when no channel existed to send to.
export const NOTIFICATION_SEND_NO_TARGET = "none";

// The bell-state writes name no ids: which person and which organization comes from the
// session, so there is nowhere for a caller to put someone else's (D7).
export const bellOpenedInputSchema = z.strictObject({});

export const bellReadAllInputSchema = z.strictObject({});

export const bellReadInputSchema = z.strictObject({ notificationId: z.string().min(1).max(128) });

export type BellReadInput = z.infer<typeof bellReadInputSchema>;
