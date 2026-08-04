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
  "{withheld} we are not showing you, because we could not mask the recordings confidently.";

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
  "We had another explanation and nothing in the recording backed it up, so we left it out.";

export const EVIDENCE_NO_CLAIMS =
  "We can show you what people did here. We can't yet tell you why it went wrong.";

export const EVIDENCE_WITHHELD_TITLE = "We are not showing this recording";

export const EVIDENCE_WITHHELD_BODY =
  "We could not mask it confidently, so the detail stays sealed. The counts above were still measured from what happened.";

export const EVIDENCE_SESSION_TEMPLATE = "Session {count}";

export const EVIDENCE_COVERAGE_TITLE = "Coverage and confidence";

export const EVIDENCE_BACK_LABEL = "Back to everything we've seen";

export const EVIDENCE_COPY_FOR_AGENT = "Copy this for your coding agent";

export const EVIDENCE_NOT_FOUND =
  "We don't have anything under that address. It may have been dismissed.";

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
