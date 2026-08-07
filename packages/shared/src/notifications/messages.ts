import type { NotificationQuietReason, NotificationSendFailureReason } from "./types";

// Copy is UX §Copy #1–#14 verbatim. CONTRACT strings are fixed by the ratified spec or
// mock; the rows marked PROPOSED await Tom's batch sign-off — build against them, a
// swap is cheap.

// Which empty sentence the popover shows, decided by setup state at render. When the
// setup signal is unavailable the safe default is "nothing_new" — it never overpromises.
export const NOTIFICATION_EMPTY_VARIANTS = [
  "pre_setup",
  "nothing_new",
  "nothing_new_no_slack",
] as const;
export type NotificationEmptyVariant = (typeof NOTIFICATION_EMPTY_VARIANTS)[number];

export const NOTIFICATION_EMPTY_STATE_MESSAGES: Record<NotificationEmptyVariant, string> = {
  pre_setup:
    "When Growthmind finds something, it lands here and in your Slack. Nothing yet — your first analysis hasn't run.",

  // PROPOSED (#2).
  nothing_new:
    "When Growthmind finds something, it lands here and in your Slack. Nothing new in the last 30 days.",

  // PROPOSED (#3); "Connect Slack" renders as a link to settings.
  nothing_new_no_slack:
    "When Growthmind finds something, it lands here. Nothing new in the last 30 days. Connect Slack and findings land there too.",
};

export const NOTIFICATION_POPOVER_HEADING = "Notifications";

export const MARK_ALL_READ_LABEL = "Mark all read";

// The null fallback is a constant so forgetting it cannot render "#null" — the shared
// channelLabel already strips the leading "#"; this template supplies it.
export const CHIP_SENT_TO_SLACK = "sent to Slack";

export function sentChipLabel(channelLabel: string | null): string {
  return channelLabel === null ? CHIP_SENT_TO_SLACK : `sent to #${channelLabel}`;
}

// Job 1 never produces a digest send; specified so the chip union is closed now (#7).
export function digestChipLabel(weekday: string): string {
  return `in ${weekday}'s summary`;
}

// The net case (#8): the one surface that can say Slack is down, because Slack cannot.
export const FAILED_CHIP_LABEL = "Slack couldn't be reached — check the connection";

// Every failure CODE renders the same customer fact — the crossing failed and the repair
// is the connection. Total over the union so a new code is a type error here, and the
// stored code itself never reaches a screen.
export const NOTIFICATION_FAILURE_SENTENCES: Record<NotificationSendFailureReason, string> = {
  call_failed: FAILED_CHIP_LABEL,
  rejected: FAILED_CHIP_LABEL,
  not_authorised: FAILED_CHIP_LABEL,
  channel_unavailable: FAILED_CHIP_LABEL,
  queue_unavailable: FAILED_CHIP_LABEL,
};

// PROPOSED (#9): a receipt, not an alarm — self-hosted installs live here legitimately.
export const QUIET_NO_CHANNEL_CHIP_LABEL = "not sent — Slack isn't connected";

// PROPOSED (#10): the degrade for a future quiet reason whose copy has not landed yet.
export const QUIET_UNKNOWN_REASON_CHIP_LABEL = "not sent";

export const NOTIFICATION_QUIET_SENTENCES: Record<NotificationQuietReason, string> = {
  no_channel: QUIET_NO_CHANNEL_CHIP_LABEL,
};

// A row can carry a quiet reason minted after this build; the chip degrades to "not
// sent" rather than showing an internal code.
export function quietChipLabel(reason: string): string {
  const known = (NOTIFICATION_QUIET_SENTENCES as Record<string, string | undefined>)[reason];
  return known ?? QUIET_UNKNOWN_REASON_CHIP_LABEL;
}

// PROPOSED (#11–#13). The badge shows "9+"; the label never misstates the number as 9.
export const BELL_ARIA_LABEL = "Notifications";

export const BELL_ARIA_LABEL_CAPPED = "Notifications — more than 9 new";

export function bellAriaLabel(newCount: number): string {
  if (newCount <= 0) {
    return BELL_ARIA_LABEL;
  }
  return newCount > 9 ? BELL_ARIA_LABEL_CAPPED : `Notifications — ${newCount} new`;
}

// PROPOSED (#14): visually-hidden prefix inside the row link.
export const UNREAD_ROW_SCREEN_READER_PREFIX = "Unread — ";

export const ALL_NOTIFICATION_MESSAGES: readonly string[] = [
  ...new Set([
    NOTIFICATION_POPOVER_HEADING,
    MARK_ALL_READ_LABEL,
    CHIP_SENT_TO_SLACK,
    FAILED_CHIP_LABEL,
    QUIET_NO_CHANNEL_CHIP_LABEL,
    QUIET_UNKNOWN_REASON_CHIP_LABEL,
    BELL_ARIA_LABEL,
    BELL_ARIA_LABEL_CAPPED,
    UNREAD_ROW_SCREEN_READER_PREFIX,
    ...Object.values(NOTIFICATION_EMPTY_STATE_MESSAGES),
    ...Object.values(NOTIFICATION_FAILURE_SENTENCES),
    ...Object.values(NOTIFICATION_QUIET_SENTENCES),
  ]),
];
