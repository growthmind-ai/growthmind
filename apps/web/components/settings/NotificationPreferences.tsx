"use client";

import type { DigestCadence, MutableNotificationClass, Weekday } from "@growthmind/shared";

export interface NotificationPreferencesProps {
  readonly cadence: DigestCadence;
  readonly day: Weekday;
  readonly shown: readonly MutableNotificationClass[];
  readonly channelLabel: string | null;
}

export function NotificationPreferences(_props: NotificationPreferencesProps) {
  return null;
}
