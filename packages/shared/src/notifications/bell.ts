// The window and the two caps, in one home. Every surface that quantifies over the bell's
// population reads these, so the badge and the list cannot come to mean different things.

export const NOTIFICATION_WINDOW_DAYS = 30;

export const NOTIFICATION_LIST_LIMIT = 20;

// Counting past this is waste — the badge displays "9+" — and it must stay at or below the
// list limit, or a badge could count a row the popover will never show.
export const NOTIFICATION_BADGE_COUNT_CAP = 10;
