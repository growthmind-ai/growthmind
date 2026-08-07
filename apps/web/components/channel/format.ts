const DAY_MONTH: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const HOUR_MINUTE: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
const TO_THE_SECOND: Intl.DateTimeFormatOptions = { ...HOUR_MINUTE, second: "2-digit" };

const LOCALE = "en-GB";

export function dayMonth(at: Date): string {
  return at.toLocaleDateString(LOCALE, DAY_MONTH);
}

/** The glance. A strip printing seconds asks to be read closely, which is not what it is for. */
export function dayMonthTime(at: Date): string {
  return `${dayMonth(at)}, ${at.toLocaleTimeString(LOCALE, HOUR_MINUTE)}`;
}

/** The proof. Claim and post are seconds apart, and a receipt printing one instant twice
 *  reads as a rounding error rather than a sequence. */
export function dayMonthSecond(at: Date): string {
  return `${dayMonth(at)}, ${at.toLocaleTimeString(LOCALE, TO_THE_SECOND)}`;
}

export function spanOfDays(from: Date, to: Date): string {
  const start = dayMonth(from);
  const end = dayMonth(to);
  return start === end ? start : `${start} – ${end}`;
}

export function counted(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}
