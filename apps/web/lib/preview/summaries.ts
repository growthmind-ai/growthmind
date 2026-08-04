import type { CheckState, FixCheck } from "./types";

export type CheckTally = Readonly<Record<CheckState, number>>;

export function tallyChecks(checks: readonly FixCheck[]): CheckTally {
  return {
    confirmed: checks.filter((check) => check.state === "confirmed").length,
    measuring: checks.filter((check) => check.state === "measuring").length,
    missing: checks.filter((check) => check.state === "missing").length,
  };
}

// A fix is only settled once nothing is still being measured and nothing was asked for and
// not shipped. "4 of 5 confirmed" is the line a list can carry; the page carries the rest.
export function checkSummary(tally: CheckTally): string {
  const total = tally.confirmed + tally.measuring + tally.missing;
  if (total === 0) return "No checks yet";

  const parts = [`${tally.confirmed} of ${total} confirmed`];
  if (tally.measuring > 0) parts.push(`${tally.measuring} still measuring`);
  if (tally.missing > 0) parts.push(`${tally.missing} asked for and not shipped`);

  return parts.join(" · ");
}

// The verdict sentence leads with its own call — "Kept. It reached the bar…" — so the list
// lead is read off the sentence rather than stored twice and allowed to disagree with it.
export function outcomeWordOf(verdict: string): string {
  return (
    verdict
      .trim()
      .split(/[.\s]/u)
      .find((word) => word.length > 0)
      ?.toUpperCase() ?? "—"
  );
}
