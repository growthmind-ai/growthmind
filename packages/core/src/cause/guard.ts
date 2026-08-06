// Whole-response §6 prohibition gate for the cause stage (ADD Decision 6, gate 1).
// Diverges from packages/core/src/summary/output-schema.ts's guardModelText on
// purpose: that gate's SAC-7 refuses causal connectives, and this stage exists
// to permit them. Every other prohibition here is new to this stage — a number,
// a date, a time span, or a confidence/severity word is never allowed in a
// causal claim, because the model was told the numbers are added afterwards
// from verified data.
//
// A single offending claim refuses the whole response — never trimmed to the
// clean claims — per FR-4's own language ("the response is refused", not "the
// claim is refused").

const CAUSE_TEMPORAL_WORDS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "today",
  "yesterday",
  "tomorrow",
  "recently",
  "this week",
  "last week",
  "currently",
  "right now",
  "these days",
] as const;

const CAUSE_DURATION_WORDS = [
  "second",
  "seconds",
  "minute",
  "minutes",
  "hour",
  "hours",
  "day",
  "days",
  "week",
  "weeks",
] as const;

const CAUSE_CONFIDENCE_WORDS = [
  "confident",
  "confidently",
  "certain",
  "certainly",
  "likely",
  "unlikely",
  "probably",
  "possibly",
  "definitely",
  "severe",
  "severity",
  "critical",
  "maybe",
  "might",
  "perhaps",
] as const;

const BARE_DIGIT = /\d/;

function containsAny(statement: string, words: readonly string[]): boolean {
  const lower = statement.toLowerCase();
  return words.some((word) => lower.includes(word));
}

export type CauseGuardVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly offences: readonly string[] };

export function guardCauseText(
  claims: readonly { readonly statement: string }[],
): CauseGuardVerdict {
  const offences: string[] = [];

  claims.forEach((claim, index) => {
    const { statement } = claim;

    if (BARE_DIGIT.test(statement)) offences.push(`number:${String(index)}`);
    if (containsAny(statement, CAUSE_TEMPORAL_WORDS)) offences.push(`date:${String(index)}`);
    if (containsAny(statement, CAUSE_DURATION_WORDS)) offences.push(`duration:${String(index)}`);
    if (containsAny(statement, CAUSE_CONFIDENCE_WORDS)) {
      offences.push(`confidence:${String(index)}`);
    }
  });

  if (offences.length > 0) return { ok: false, offences };
  return { ok: true };
}
