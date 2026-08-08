import { z } from "zod";

// v1 arms carry nothing beyond their discriminant and version (OQ-3): everything a
// renderer needs is resolved at render from the subject row, so no name, count or
// sentence can go stale — or carry personal data — inside a stored row. The two arms that
// do carry data carry counts and minted ids only, frozen because a count resolved at
// render would describe a different moment than the one the sentence names.
export const notificationPayloadSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("finding_delivered"), v: z.literal(1) }),
  z.strictObject({ type: z.literal("keys_revoked"), v: z.literal(1) }),
  z.strictObject({ type: z.literal("agent_first_contact"), v: z.literal(1) }),
  z.strictObject({ type: z.literal("key_created"), v: z.literal(1) }),
  z.strictObject({
    type: z.literal("backfill_complete"),
    v: z.literal(1),
    sessionsTouched: z.number().int().nonnegative(),
    eventsPersisted: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal("slack_disconnected"), v: z.literal(1) }),
  z.strictObject({ type: z.literal("analysis_failing"), v: z.literal(1) }),
  z.strictObject({
    type: z.literal("digest"),
    v: z.literal(1),
    notificationIds: z.array(z.string().min(1)),
    totalCount: z.number().int().nonnegative(),
  }),
]);
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

export type ParsedNotificationPayload =
  { readonly ok: true; readonly payload: NotificationPayload } | { readonly ok: false };

// Tolerant on purpose (D5): a stored row can carry any shape ever written, and an unknown
// version or shape renders the generic sentence + subject link rather than throwing.
export function parseNotificationPayload(value: unknown): ParsedNotificationPayload {
  const parsed = notificationPayloadSchema.safeParse(value);
  return parsed.success ? { ok: true, payload: parsed.data } : { ok: false };
}
