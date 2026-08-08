import { NOTIFICATION_WINDOW_DAYS, type Weekday } from "@growthmind/shared";

// Hourly is the coarsest cadence that can still resolve a day in the zone it is evaluated
// in, and orgs pick different days so the task must wake on every one. Bound to the
// crontab by the digest's drift test.
export const NOTIFICATION_DIGEST_TICK_INTERVAL_MS = 60 * 60 * 1_000;

// Every date this product renders is already UTC, and no table holds a per-org timezone —
// a digest evaluated in any other zone would name a weekday the rest of the product
// disagrees with, in the bell row describing that digest.
export const DIGEST_EVALUATION_TIME_ZONE = "UTC";

const WEEKDAY_BY_UTC_DAY: readonly Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const DAY_MS = 24 * 60 * 60 * 1_000;

// The only weekday derivation in the product.
export function digestDayMatches(day: Weekday, at: Date): boolean {
  return WEEKDAY_BY_UTC_DAY[at.getUTCDay()] === day;
}

// Since the last summary, floored at the bell's own window: a fixed seven-day lookback
// double-reports the overlap when an org moves its day, and no floor lets a worker that
// was down for a quarter emit a quarter-long summary.
export function digestWindowStart(lastDigestAt: Date | null, at: Date): Date {
  const floor = at.getTime() - NOTIFICATION_WINDOW_DAYS * DAY_MS;

  return new Date(lastDigestAt === null ? floor : Math.max(lastDigestAt.getTime(), floor));
}
