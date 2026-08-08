import { z } from "zod";

import type { NotificationClass } from "./types";

export const DIGEST_CADENCES = ["weekly", "off"] as const;
export type DigestCadence = (typeof DIGEST_CADENCES)[number];
export const digestCadenceSchema = z.enum(DIGEST_CADENCES);

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const weekdaySchema = z.enum(WEEKDAYS);

// No settings row means these, applied by the caller — the table holds a row only once a
// person has changed something, so a workspace nobody has configured is still correct.
export const DIGEST_CADENCE_DEFAULT: DigestCadence = "weekly";
export const DIGEST_DAY_DEFAULT: Weekday = "monday";

// `act_now` is absent by construction, which is the whole of the "health and security are
// always sent" guarantee: there is no row shape that could hide one.
export const MUTABLE_NOTIFICATION_CLASSES = [
  "work",
  "record",
] as const satisfies readonly NotificationClass[];
export type MutableNotificationClass = (typeof MUTABLE_NOTIFICATION_CLASSES)[number];
export const mutableNotificationClassSchema = z.enum(MUTABLE_NOTIFICATION_CLASSES);

// Both fields every time: cadence and day are one setting with two dimensions, and a
// partial would let a day be stored for a cadence that never existed.
export const settingsNotificationDigestInputSchema = z.strictObject({
  cadence: digestCadenceSchema,
  day: weekdaySchema,
});
export type SettingsNotificationDigestInput = z.infer<typeof settingsNotificationDigestInputSchema>;

// `shown` rather than `muted`: the stored row is the exception, so the client sends the
// state of the control a person is looking at.
export const settingsNotificationBellInputSchema = z.strictObject({
  class: mutableNotificationClassSchema,
  shown: z.boolean(),
});
export type SettingsNotificationBellInput = z.infer<typeof settingsNotificationBellInputSchema>;
