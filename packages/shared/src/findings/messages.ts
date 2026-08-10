// Export a new string as a `const` AND register it in `ALL_FINDINGS_MESSAGES`: the audit in
// `__tests__/findings/messages.test.ts` derives its expected set from this module's exports,
// so an exported-but-unregistered constant escapes every scan.

import type { FindingGroup } from "./view";

export const OVERVIEW_TITLE = "Everything we've seen in your product";

// Removed the day this page reads a real project.
export const EXAMPLE_CONTENT_NOTICE =
  "Example content. Nothing on this page was measured from your product.";

export const COVERAGE_READ_TEMPLATE =
  "We read {read} sessions and set aside {aside} as your own team, bots and coding agents.";

export const COVERAGE_FOUND_TEMPLATE = "We found {found} things worth describing.";

export const COVERAGE_SPLIT_TEMPLATE =
  "We can explain {explained} of them; {described} we can only describe.";

export const COVERAGE_WITHHELD_TEMPLATE =
  "{withheld} we are not showing you, because we could not mask the replays confidently.";

// Not "…worth telling you about": the copy audit reads a trailing "about" as a hedge.
export const COVERAGE_FOUND_NOTHING = "We found nothing worth telling you.";

export const COVERAGE_NOTHING_READ =
  "We have not read any sessions yet. This fills in as people use your product.";

// "cannot be read yet" rather than "is/are not readable yet": the clause has to agree with
// a count of one and a count of nine without a second template.
export const CALIBRATION_TEMPLATE =
  "We have made {calls} {callword} on your product. {right} played out the way we said, {wrong} did not, and {pending} cannot be read yet.";

export const CALIBRATION_NONE_YET =
  "We have not made a call on your product yet. When we do, we score it here against what actually happened.";

export const GROUP_TITLES: Readonly<Record<FindingGroup, string>> = {
  explained: "What happened, and why",
  described: "What happened — we can't yet say why",
  measurement: "The numbers themselves",
  withheld: "Seen, not shown",
};

export const OVERVIEW_QUIET_LINE =
  "Nothing here needs you today. What's worth acting on arrives in your channel, one at a time.";

export const OVERVIEW_QUIET_WEEK_LINE =
  "That is a normal week. What's worth acting on arrives in your channel, one at a time.";

export const OVERVIEW_NOT_CONNECTED =
  "No analytics account is attached to this project yet, so there is nothing to read.";

export const EVIDENCE_ONE_SESSION_LINE = "One person's session below.";

export const EVIDENCE_COHORT_TEMPLATE =
  "{count} people got through — their path diverged at {when}.";

export const EVIDENCE_CLAIMS_TITLE = "What we think happened";

export const EVIDENCE_CITES_TEMPLATE = "from {when}";

export const EVIDENCE_CLAIM_DROPPED =
  "We had another explanation and nothing in the replay backed it up, so we left it out.";

export const EVIDENCE_NO_CLAIMS =
  "We can show you what people did here. We can't yet tell you why it went wrong.";

export const EVIDENCE_WITHHELD_TITLE = "We are not showing this replay";

export const EVIDENCE_WITHHELD_BODY =
  "We could not mask it confidently, so the detail stays sealed. The counts above were still measured from what happened.";

export const EVIDENCE_SESSION_TEMPLATE = "Session {count}";

export const EVIDENCE_COVERAGE_TITLE = "Coverage and confidence";

export const EVIDENCE_BACK_LABEL = "Back to everything we've seen";

export const EVIDENCE_COPY_FOR_AGENT = "Copy this for your coding agent";

export const EVIDENCE_NOT_FOUND =
  "We don't have anything under that address. It may have been dismissed.";

export const SHIPPED_NOTED_TEMPLATE = "Noted — {change} on {page}.";

// Reach is counted in visits and repeat in people, so the promise names both units rather than
// promising one and answering in the other.
export const SHIPPED_PROMISE_TEMPLATE =
  "On {date} I'll tell you how many of the visits to that page used it, and how many people came back to it.";

export const SHIPPED_UNVERIFIED_LINE =
  "I have not read your code, so I am taking your word that it is live.";

// The two buttons underneath are the whole mechanism: nothing reads a typed reply, so an offer
// to "say so" was an invitation into silence.
export const SHIPPED_LEAD_OFFER_LINE =
  "If you would rather I led with how many came back than with how many used it, press the button on this message that says so — a typed reply will not reach me.";

export const SHIPPED_CLOCK_UNCHANGED_TEMPLATE =
  "{change} on {page} again — the date I answer on has not moved: {date}.";

// Composing this from the clock-unchanged and too-late sentences read as a contradiction: the
// first promises a date that, on an answered change, is already in the past.
export const SHIPPED_ALREADY_ANSWERED_TEMPLATE =
  "{change} on {page} again — I already answered on that one on {date}, so I am not starting a second clock on it.";

// A change we stopped watching was never answered, whichever reason we stopped for, so this
// carries no date: there is neither an answer to point back at nor a clock to promise.
export const SHIPPED_STOPPED_WATCHING_TEMPLATE =
  "{change} on {page} again — I stopped watching that one and never got you an answer, so there is nothing on the clock for it.";

// A readout that could not measure anything answered nothing, so the clock restarts rather than
// the report being turned away.
export const SHIPPED_WATCHING_AGAIN_TEMPLATE =
  "{change} on {page} again — last time there was not enough for me to measure, so I am watching that page again and I'll tell you how it went on {date}.";

// Reach counts visits and not people, and it names its own denominator rather than leaving the
// repeat sentence to point back at it: the two denominators are different sizes and different
// units, so one pronoun across both was two wrong numbers in one breath.
export const SHIPPED_REACH_TEMPLATE =
  "{change} — I could watch {denominator} visits to {page}, and {numerator} of them used it.";

export const SHIPPED_NOBODY_TEMPLATE =
  "{change} — I could watch {denominator} visits to {page}, and none of them used it.";

// A whole page's reach would render as N of N, so the count stands on its own and repeat
// carries the fraction against its own denominator.
export const SHIPPED_PAGE_REACH_TEMPLATE =
  "{change} — there were {denominator} visits to {page} while I was watching.";

export const SHIPPED_REPEAT_TEMPLATE =
  "{numerator} of the {denominator} people I could tell apart came back to it.";

// Leading on repeat puts this sentence first, where "it" has nothing behind it, so the lead form
// names the change and the page and the two sentences below drop the heading they would repeat.
export const SHIPPED_REPEAT_LEAD_TEMPLATE =
  "{change} on {page} — {numerator} of the {denominator} people I could tell apart came back to it.";

export const SHIPPED_REACH_AFTER_LEAD_TEMPLATE =
  "I could watch {denominator} visits to that page, and {numerator} of them used it.";

export const SHIPPED_PAGE_REACH_AFTER_LEAD_TEMPLATE =
  "There were {denominator} visits to that page while I was watching.";

// Without it the two denominators read as one set and its subset — "3 of the 12 could be told
// apart" — when they are the same visits grouped two ways.
export const SHIPPED_SAME_VISITS_LINE =
  "Both counts come off the same visits: one counts the visits themselves, the other groups them into the people who made them.";

export const SHIPPED_NO_IDENTITY_LINE =
  "Nobody could be told apart between visits, so I cannot say who came back.";

// Restating the reach denominator rather than pointing back at it: this sentence renders on
// either side of the repeat one, so a pronoun here lands on whichever count happens to precede it.
export const SHIPPED_UNIDENTIFIED_TEMPLATE =
  "{count} of the {denominator} visits could not be tied to a person, and are counted on their own.";

export const SHIPPED_RECORDED_CORPUS_LINE =
  "I counted that off the visits that were recorded, not off everyone who was there.";

export const SHIPPED_SPINE_CORPUS_LINE =
  "I counted that off every visit to the page, not only the ones that were recorded.";

export const SHIPPED_TRUNCATED_LINE =
  "I hit my limit on how many visits I read, so that is not the whole total.";

export const SHIPPED_TOO_FEW_TEMPLATE =
  "{change} — there were only {denominator} visits to {page} in that time. Not enough to tell you anything, so I'm not going to pretend otherwise.";

export const SHIPPED_SPELLING_CHANGED_TEMPLATE =
  "{change} — the way page addresses are written down changed part-way through, so I cannot put an honest number on {page}.";

export const SHIPPED_UNREADABLE_TEMPLATE =
  "{change} — I could not read enough of what happened on {page} to tell you anything.";

// The record surfaces show one line per fact, so the answer itself lives in the message that
// was pushed and this names what is waiting on the founder.
export const SHIPPED_READ_OUT_TEMPLATE =
  "I've answered how {change} on {page} went, and I'm waiting on your verdict.";

export const SHIPPED_VERDICT_QUESTION = "Keep it, kill it, or leave it?";

export const SHIPPED_VERDICT_RECORDED = "Noted — that is what the next brief reads.";

export const SHIPPED_VERDICT_ALREADY_RECORDED =
  "You have already answered that one, so nothing changed.";

export const SHIPPED_VERDICT_TOO_EARLY_REFUSAL =
  "I have not read that one out yet, so there is nothing to answer.";

export const SHIPPED_VERDICT_TOO_LATE_REFUSAL = "That one is already closed.";

export const SHIPPED_LEAD_CHANGED_TEMPLATE = "I'll lead with {lead} when I answer on that one.";

export const SHIPPED_LEAD_TOO_LATE_REFUSAL =
  "I have already given you the answer on that one, so what it is judged on cannot move now.";

export const FINDINGS_MESSAGES = {
  overviewTitle: OVERVIEW_TITLE,
  exampleNotice: EXAMPLE_CONTENT_NOTICE,
  quiet: OVERVIEW_QUIET_LINE,
  quietWeek: OVERVIEW_QUIET_WEEK_LINE,
  notConnected: OVERVIEW_NOT_CONNECTED,
  oneSession: EVIDENCE_ONE_SESSION_LINE,
  claimsTitle: EVIDENCE_CLAIMS_TITLE,
  claimDropped: EVIDENCE_CLAIM_DROPPED,
  noClaims: EVIDENCE_NO_CLAIMS,
  withheldTitle: EVIDENCE_WITHHELD_TITLE,
  withheldBody: EVIDENCE_WITHHELD_BODY,
  coverageTitle: EVIDENCE_COVERAGE_TITLE,
  back: EVIDENCE_BACK_LABEL,
  notFound: EVIDENCE_NOT_FOUND,
} as const;

export const ALL_FINDINGS_MESSAGES: readonly string[] = [
  OVERVIEW_TITLE,
  EXAMPLE_CONTENT_NOTICE,
  COVERAGE_READ_TEMPLATE,
  COVERAGE_FOUND_TEMPLATE,
  COVERAGE_SPLIT_TEMPLATE,
  COVERAGE_WITHHELD_TEMPLATE,
  COVERAGE_FOUND_NOTHING,
  COVERAGE_NOTHING_READ,
  CALIBRATION_TEMPLATE,
  CALIBRATION_NONE_YET,
  EVIDENCE_COPY_FOR_AGENT,
  ...Object.values(GROUP_TITLES),
  OVERVIEW_QUIET_LINE,
  OVERVIEW_QUIET_WEEK_LINE,
  OVERVIEW_NOT_CONNECTED,
  EVIDENCE_ONE_SESSION_LINE,
  EVIDENCE_COHORT_TEMPLATE,
  EVIDENCE_CLAIMS_TITLE,
  EVIDENCE_CITES_TEMPLATE,
  EVIDENCE_CLAIM_DROPPED,
  EVIDENCE_NO_CLAIMS,
  EVIDENCE_WITHHELD_TITLE,
  EVIDENCE_WITHHELD_BODY,
  EVIDENCE_SESSION_TEMPLATE,
  EVIDENCE_COVERAGE_TITLE,
  EVIDENCE_BACK_LABEL,
  EVIDENCE_NOT_FOUND,
  SHIPPED_NOTED_TEMPLATE,
  SHIPPED_PROMISE_TEMPLATE,
  SHIPPED_UNVERIFIED_LINE,
  SHIPPED_LEAD_OFFER_LINE,
  SHIPPED_ALREADY_ANSWERED_TEMPLATE,
  SHIPPED_STOPPED_WATCHING_TEMPLATE,
  SHIPPED_WATCHING_AGAIN_TEMPLATE,
  SHIPPED_CLOCK_UNCHANGED_TEMPLATE,
  SHIPPED_REACH_TEMPLATE,
  SHIPPED_NOBODY_TEMPLATE,
  SHIPPED_PAGE_REACH_TEMPLATE,
  SHIPPED_REPEAT_TEMPLATE,
  SHIPPED_REPEAT_LEAD_TEMPLATE,
  SHIPPED_REACH_AFTER_LEAD_TEMPLATE,
  SHIPPED_PAGE_REACH_AFTER_LEAD_TEMPLATE,
  SHIPPED_SAME_VISITS_LINE,
  SHIPPED_NO_IDENTITY_LINE,
  SHIPPED_UNIDENTIFIED_TEMPLATE,
  SHIPPED_RECORDED_CORPUS_LINE,
  SHIPPED_SPINE_CORPUS_LINE,
  SHIPPED_TRUNCATED_LINE,
  SHIPPED_TOO_FEW_TEMPLATE,
  SHIPPED_SPELLING_CHANGED_TEMPLATE,
  SHIPPED_UNREADABLE_TEMPLATE,
  SHIPPED_READ_OUT_TEMPLATE,
  SHIPPED_VERDICT_QUESTION,
  SHIPPED_VERDICT_RECORDED,
  SHIPPED_VERDICT_ALREADY_RECORDED,
  SHIPPED_VERDICT_TOO_EARLY_REFUSAL,
  SHIPPED_VERDICT_TOO_LATE_REFUSAL,
  SHIPPED_LEAD_CHANGED_TEMPLATE,
  SHIPPED_LEAD_TOO_LATE_REFUSAL,
];

function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  let filled = template;
  for (const [token, value] of Object.entries(values)) {
    filled = filled.replaceAll(`{${token}}`, String(value));
  }
  return filled;
}

export interface CoverageSentenceInput {
  readonly sessionsRead: number;
  readonly sessionsSetAside: number;
  readonly found: number;
  readonly explained: number;
  readonly described: number;
  readonly withheld: number;
}

// One sentence per clause, so a zero never renders as "0 we are not showing you".
export function coverageSentences(input: CoverageSentenceInput): readonly string[] {
  const read = fill(COVERAGE_READ_TEMPLATE, {
    read: input.sessionsRead,
    aside: input.sessionsSetAside,
  });

  if (input.found === 0) {
    return [read, COVERAGE_FOUND_NOTHING];
  }

  const sentences = [read, fill(COVERAGE_FOUND_TEMPLATE, { found: input.found })];

  if (input.explained > 0 || input.described > 0) {
    sentences.push(
      fill(COVERAGE_SPLIT_TEMPLATE, {
        explained: input.explained,
        described: input.described,
      }),
    );
  }

  if (input.withheld > 0) {
    sentences.push(fill(COVERAGE_WITHHELD_TEMPLATE, { withheld: input.withheld }));
  }

  return sentences;
}

export interface CalibrationCounts {
  readonly right: number;
  readonly wrong: number;
  readonly pending: number;
}

export function calibrationSentence(counts: CalibrationCounts): string {
  const calls = counts.right + counts.wrong + counts.pending;
  if (calls === 0) return CALIBRATION_NONE_YET;

  return fill(CALIBRATION_TEMPLATE, {
    calls,
    callword: calls === 1 ? "call" : "calls",
    right: counts.right,
    wrong: counts.wrong,
    pending: counts.pending,
  });
}

export function sessionLabel(position: number): string {
  return fill(EVIDENCE_SESSION_TEMPLATE, { count: position });
}

export function cohortLine(input: { count: number; when: string }): string {
  return fill(EVIDENCE_COHORT_TEMPLATE, { count: input.count, when: input.when });
}

export function citesLabel(when: string): string {
  return fill(EVIDENCE_CITES_TEMPLATE, { when });
}
