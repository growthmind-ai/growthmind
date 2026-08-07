import type { ExpectedValue, MeasuredCount } from "@growthmind/core";
import { SURFACE_ROLE_NOTES } from "@growthmind/shared";

// UTC and a fixed locale so the date a server component paints is the date every reader
// sees, whatever their machine says. A promised date is a claim, not a local convenience.
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const ORDINALS: readonly string[] = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
  "Tenth",
];

export const ORDERING_LEAD = "Most worth fixing first.";

export const ORDERING_SENTENCE =
  "How many sessions ran into it, weighted by what the page is for. Not by date.";

export const NOTHING_OPENED_HEADING = "Nothing is waiting to be fixed";

export const NOTHING_OPENED_BODY =
  "Fixes start in Slack. When we find something we post it to your channel with a button that says get it fixed. Press it and the fix appears here, and your coding assistant can read it straight away.";

export const NOTHING_OPENED_ACTION = "See what we have found";

export const NOTHING_MEASURED_HEADING = "Nothing has been measured yet";

export const NOTHING_MEASURED_BODY =
  "This fills in from what people do in your product, so there is nothing here until your analytics is connected. That is the first thing to do.";

export const NOTHING_MEASURED_ACTION = "Connect your analytics";

export const NOTHING_OPENED_UNCHECKED_HEADING = "Nothing is waiting to be fixed";

export const NOTHING_OPENED_UNCHECKED_BODY =
  "That much we can see. What we could not check just now is whether anything is being measured yet — so we cannot tell you whether this is a quiet week or a setup that never finished. Your settings page says which.";

export const NOTHING_OPENED_UNCHECKED_ACTION = "See what is connected";

export const LIST_UNAVAILABLE_HEADING = "We could not read your open fixes just now";

export const LIST_UNAVAILABLE_BODY =
  "This is our end, not yours. Nothing has been closed and nothing has been lost — we could not fetch the list. Reloading in a minute usually brings it back. If it keeps saying this, tell us.";

export const DETAIL_UNAVAILABLE_HEADING = "We could not read this fix just now";

export const DETAIL_UNAVAILABLE_BODY =
  "This is our end, not yours. Nothing about the fix has changed — we could not fetch it. Reloading in a minute usually brings it back. If it keeps saying this, tell us.";

export const HELD_HEADING = "We cannot read this one back";

export const HELD_BODY =
  "We are holding a fix here and cannot put it into words right now. Nothing you did caused this and nothing is lost — the evidence behind it is still here, and your assistant is not being given anything wrong in the meantime.";

export const EVIDENCE_ACTION = "The evidence behind it";

export const SAME_DOCUMENT_NOTE =
  "Your coding assistant reads this same page over the connection you set up — the words above are the words it is given. There is no second version of this.";

export const UNROLED_ACTION = "Say what this page is for and it moves up.";

export function onDate(when: Date): string {
  return DATE.format(when);
}

export function sessions(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

export function countOf(impact: MeasuredCount): string {
  return `${impact.numerator} of ${impact.denominator} ${impact.unit}`;
}

function ordinal(position: number): string {
  return ORDINALS[position - 1] ?? `Number ${position}`;
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0].toLowerCase() + text.slice(1);
}

export interface PromiseView {
  readonly late: boolean;
  readonly lead: string;
  readonly aside: string;
}

export function isLate(resultsBy: Date, now: Date): boolean {
  return resultsBy.getTime() < now.getTime();
}

// A promise we made and have not kept is stated as one. Never a countdown, never softened,
// and never hidden — the commitment it belongs to is "it predicts, then marks its own
// homework", and its unfinished half is the honest thing to render.
export function promiseOf(openedAt: Date, resultsBy: Date, now: Date): PromiseView {
  if (isLate(resultsBy, now)) {
    return {
      late: true,
      lead: `We said we would have an answer by ${onDate(resultsBy)}. We do not have one.`,
      aside: `The date was set when this was opened on ${onDate(openedAt)} and has not been moved.`,
    };
  }

  return {
    late: false,
    lead: `We said we would have an answer by ${onDate(resultsBy)}.`,
    aside: `Opened ${onDate(openedAt)}.`,
  };
}

export interface DueView {
  readonly late: boolean;
  readonly value: string;
  readonly label: string;
}

export function dueOf(resultsBy: Date, now: Date): DueView {
  return isLate(resultsBy, now)
    ? { late: true, value: "no answer", label: `since ${onDate(resultsBy)}` }
    : { late: false, value: onDate(resultsBy), label: "result due" };
}

export interface RankedRow {
  readonly impact: MeasuredCount;
  readonly rankedBy: ExpectedValue;
}

export interface RankingView {
  readonly lead: string;
  readonly roleNote: string;
  readonly arithmetic: string;
  readonly against: string | null;

  // The one case where saying what the page is for would change the order, so it is the
  // one case the panel can offer an action rather than only an explanation.
  readonly unroled: boolean;
}

function tieOrNeighbour(
  row: RankedRow,
  above: RankedRow | undefined,
  below: RankedRow | undefined,
): string | null {
  if (above !== undefined && above.rankedBy.score === row.rankedBy.score) {
    return "This is worth the same as the one above it, so the earlier promised date goes first.";
  }
  if (below !== undefined && below.rankedBy.score === row.rankedBy.score) {
    return "The one below it is worth the same, so the earlier promised date went first.";
  }
  if (above !== undefined) {
    const { affected, weight, score } = above.rankedBy;
    return `Above it: ${sessions(affected)} × ${weight} = ${score}.`;
  }
  return null;
}

// The weight is read off the ExpectedValue the service ranked on, never re-derived here:
// two copies of the weight table is the version skew `weightVersion` exists to prevent.
export function explainRank(
  row: RankedRow,
  index: number,
  rows: readonly RankedRow[],
): RankingView {
  const position = index + 1;
  const { affected, weight, score, role } = row.rankedBy;
  const biggest = rows.every((other) => other.rankedBy.affected <= affected);

  const lead =
    role === "unknown"
      ? `${ordinal(position)}, even though ${sessions(affected)} ran into this${biggest ? " — more than anything else here" : ""}.`
      : `${ordinal(position)} because ${affected} of ${row.impact.denominator} ${row.impact.unit} measured ran into this.`;

  return {
    lead,
    roleNote: SURFACE_ROLE_NOTES[role],
    arithmetic: `${sessions(affected)} × ${weight} = ${score}`,
    against: tieOrNeighbour(
      row,
      index > 0 ? rows[index - 1] : undefined,
      index + 1 < rows.length ? rows[index + 1] : undefined,
    ),
    unroled: role === "unknown",
  };
}

// Every field is a string, a number or a boolean: the row crosses into a client component,
// and a MeasuredCount carries a symbol that cannot cross with it.
export interface FixRowView {
  readonly fixId: string;
  readonly href: string;
  readonly rank: number;
  readonly summary: string;
  readonly count: string;
  readonly due: DueView;
  readonly why: RankingView;
}

// A denominator whose exclusions are invisible is a denominator nobody can argue with.
export function setAsideSentences(impact: MeasuredCount): readonly string[] {
  return impact.basis.setAside
    .filter((entry) => entry.count > 0)
    .map((entry) => {
      const many = entry.count !== 1;
      const noun = many ? "sessions" : "session";
      return `${entry.count} more ${noun} in that window ${many ? "were" : "was"} set aside as ${lowerFirst(entry.label)}, so ${many ? "they are" : "it is"} not in the ${impact.denominator}.`;
    });
}

export function truncationSentence(shown: number, totalOpen: number): string | null {
  if (shown >= totalOpen) return null;

  return `The ${shown} most worth fixing, out of ${totalOpen} open. The rest are ranked below these and appear as these are answered.`;
}

// A date nothing can meet is not a missed deadline, and calling it one describes a slip that
// is not happening. Nothing measures a shipped fix yet — `fixes.status` has only ever been
// written as `open` — so the sentence names the missing half of the loop and what does work,
// which is truer as well as calmer.
export function tailSentence(lateCount: number, shown: number): string {
  if (lateCount === 0) {
    return "Nothing here needs you. When a result is due we say so in the channel you already use.";
  }

  return `${lateCount} of these ${shown} ${lateCount === 1 ? "is" : "are"} past the date we said we would have an answer by. Checking a fix after it ships is not built yet, so nothing writes that answer — no date on this page can be met until it is. The fixes themselves are live, and your coding assistant can read every one of them right now.`;
}
