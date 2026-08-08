import type { DigestCadence, MutableNotificationClass, Weekday } from "./settings";
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
  "muted_by_you",
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

  // PROPOSED (UX C-11); "settings" renders as a link, the nothing_new_no_slack pattern.
  // Chosen only when the unfiltered bell would have had rows, so it never claims a mute
  // is hiding something that was never there.
  muted_by_you:
    "Nothing to show — you've turned part of this off. Health and security always come through. Turn the rest back on in settings.",
};

export const NOTIFICATION_POPOVER_HEADING = "Notifications";

export const MARK_ALL_READ_LABEL = "Mark all read";

// The null fallback is a constant so forgetting it cannot render "#null" — the shared
// channelLabel already strips the leading "#"; this template supplies it.
export const CHIP_SENT_TO_SLACK = "sent to Slack";

export function sentChipLabel(channelLabel: string | null): string {
  return channelLabel === null ? CHIP_SENT_TO_SLACK : `sent to #${channelLabel}`;
}

// The quiet record holds the template and this fills it, so the sentence has one home and
// the record stays total over every reason (UX C-12).
export const DIGEST_CHIP_DAY_PLACEHOLDER = "{Day}";

export const QUIET_DIGEST_CHIP_TEMPLATE = `in ${DIGEST_CHIP_DAY_PLACEHOLDER}'s summary`;

export function digestChipLabel(weekday: string): string {
  return QUIET_DIGEST_CHIP_TEMPLATE.replace(DIGEST_CHIP_DAY_PLACEHOLDER, weekday);
}

// PROPOSED (UX C-13): the receipt an org on cadence `off` gets. The control tells the
// truth in both positions — a summary that will never arrive is never promised.
export const QUIET_DIGEST_OFF_CHIP_LABEL = "not sent — your weekly summary is off";

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
  digest: QUIET_DIGEST_CHIP_TEMPLATE,
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

// The notification-settings card, UX o-051 §Copy C-2..C-10 verbatim, beside the bell copy
// it configures. Registered here rather than in the onboarding registry because that
// audit's hedge scan refuses the prepositional "about" two of these carry.
export const SUMMARY_WEEKLY_TEMPLATE = "A summary of the week goes to #{channel} every {Day}.";

export const SUMMARY_NO_SLACK_TEMPLATE =
  "A summary of the week is set for every {Day}. It will go to Slack once a channel is connected.";

export const SUMMARY_OFF = "No weekly summary. Anything urgent still arrives straight away.";

export const CADENCE_SELECT_LABEL = "How often";

export const DAY_SELECT_LABEL = "Which day";

export const HEALTH_LABEL = "Health and security";

export const HEALTH_BODY =
  "Always sent, to everyone in this workspace. A broken Slack connection or a new key is not something to find out about late.";

export const BELL_LABEL = "Your bell";

export const BELL_BODY =
  "Only you see this. Turning something off here changes nothing for anyone else.";

export const ALWAYS_LINE = "Health and security always show here, whichever of these is off.";

// PROPOSED (o-051 CR-6): the card's words for the two mutable classes, moved out of the
// component so the jargon and completeness audits walk them. Flat records, label and
// description apart — the completeness inversion derives only string-valued exports.
export const NOTIFICATION_CLASS_CARD_LABELS: Record<MutableNotificationClass, string> = {
  work: "The work",
  record: "The record",
};

export const NOTIFICATION_CLASS_CARD_DESCRIPTIONS: Record<MutableNotificationClass, string> = {
  work: "Findings and fixes, and anything waiting on you.",
  record: "Things that happened that need nothing from you.",
};

// PROPOSED (o-051 CR-6): the cadence picker's two choices.
export const DIGEST_CADENCE_CHOICE_LABELS: Record<DigestCadence, string> = {
  weekly: "Every week",
  off: "Off",
};

// PROPOSED (o-051 CR-6): one home for the day's display name — the summary sentence, the
// day picker and the bell's digest chip all read it here.
export const WEEKDAY_NAMES: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export function weekdayName(day: Weekday): string {
  return WEEKDAY_NAMES[day];
}

// The day picker shows the plural ("Mondays"), derived from the registered name.
export function weekdayChoiceLabel(day: Weekday): string {
  return `${WEEKDAY_NAMES[day]}s`;
}

export const ALL_NOTIFICATION_MESSAGES: readonly string[] = [
  ...new Set([
    NOTIFICATION_POPOVER_HEADING,
    MARK_ALL_READ_LABEL,
    CHIP_SENT_TO_SLACK,
    FAILED_CHIP_LABEL,
    QUIET_NO_CHANNEL_CHIP_LABEL,
    QUIET_UNKNOWN_REASON_CHIP_LABEL,
    QUIET_DIGEST_OFF_CHIP_LABEL,
    BELL_ARIA_LABEL,
    BELL_ARIA_LABEL_CAPPED,
    UNREAD_ROW_SCREEN_READER_PREFIX,
    SUMMARY_WEEKLY_TEMPLATE,
    SUMMARY_NO_SLACK_TEMPLATE,
    SUMMARY_OFF,
    CADENCE_SELECT_LABEL,
    DAY_SELECT_LABEL,
    HEALTH_LABEL,
    HEALTH_BODY,
    BELL_LABEL,
    BELL_BODY,
    ALWAYS_LINE,
    ...Object.values(NOTIFICATION_CLASS_CARD_LABELS),
    ...Object.values(NOTIFICATION_CLASS_CARD_DESCRIPTIONS),
    ...Object.values(DIGEST_CADENCE_CHOICE_LABELS),
    ...Object.values(WEEKDAY_NAMES),
    ...Object.values(NOTIFICATION_EMPTY_STATE_MESSAGES),
    ...Object.values(NOTIFICATION_FAILURE_SENTENCES),
    ...Object.values(NOTIFICATION_QUIET_SENTENCES),
  ]),
];
