import {
  FLOOR_CONFIDENCE_TEMPLATES,
  FLOOR_COUNT_TEMPLATES,
  FLOOR_NO_RATE_TEMPLATE,
  FLOOR_OBSERVATION_TEMPLATES,
  SUMMARY_SOURCE_MESSAGES,
} from "../summary/messages";
import { FINDING_CLASS_UNKNOWN_TEMPLATE, FINDING_CONFIDENCE_UNKNOWN } from "./messages";
import type { OnboardingCount, OnboardingFinding } from "./types";

export type FindingCountLine = {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: "sessions";
  readonly surface: string;

  readonly sentence: string;
};

export type FindingView = {
  readonly classSentence: string;
  readonly headline: string;

  readonly contextLines: readonly string[];
  readonly counts: readonly FindingCountLine[];

  readonly confidenceSentence: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;

  readonly sourceSentence: string;
};

const OBSERVATION_BY_CLASS: Readonly<Record<string, string | undefined>> =
  FLOOR_OBSERVATION_TEMPLATES;
const CONFIDENCE_BY_BASIS: Readonly<Record<string, string | undefined>> =
  FLOOR_CONFIDENCE_TEMPLATES;

const COUNT_TEMPLATE = FLOOR_COUNT_TEMPLATES.affected_sessions;

function substitute(template: string, tokens: Readonly<Record<string, string>>): string {
  let rendered = template;
  for (const [token, value] of Object.entries(tokens)) {
    rendered = rendered.replaceAll(`{${token}}`, value);
  }
  return rendered;
}

function classSentenceFor(finalClass: string, surface: string): string {
  const shipped = OBSERVATION_BY_CLASS[finalClass];
  return shipped === undefined
    ? substitute(FINDING_CLASS_UNKNOWN_TEMPLATE, { page: surface })
    : substitute(shipped, { surface });
}

function confidenceSentenceFor(confidenceBasis: string): string {
  return CONFIDENCE_BY_BASIS[confidenceBasis] ?? FINDING_CONFIDENCE_UNKNOWN;
}

function toCountLine(count: OnboardingCount, surface: string): FindingCountLine {
  const sentence =
    count.denominator === 0
      ? FLOOR_NO_RATE_TEMPLATE
      : substitute(COUNT_TEMPLATE, {
          numerator: String(count.numerator),
          denominator: String(count.denominator),
          unit: count.unit,
          surface,
        });

  return {
    numerator: count.numerator,
    denominator: count.denominator,
    unit: count.unit,
    surface,
    sentence,
  };
}

export function toFindingView(finding: OnboardingFinding): FindingView {
  return {
    classSentence: classSentenceFor(finding.finalClass, finding.surface),
    headline: finding.headline,

    contextLines: [...finding.context],
    counts: finding.counts.map((count) => toCountLine(count, finding.surface)),
    confidenceSentence: confidenceSentenceFor(finding.confidenceBasis),
    windowStart: finding.windowStart,
    windowEnd: finding.windowEnd,
    sourceSentence: SUMMARY_SOURCE_MESSAGES[finding.summarySource],
  };
}
