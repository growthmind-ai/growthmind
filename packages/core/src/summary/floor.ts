import {
  FLOOR_CONFIDENCE_TEMPLATES,
  FLOOR_COUNT_TEMPLATES,
  FLOOR_NO_RATE_TEMPLATE,
  FLOOR_OBSERVATION_TEMPLATES,
  FLOOR_TIMEFRAME_TEMPLATE,
  SUMMARY_SOURCE_MESSAGES,
  isNormalisedUrlPath,
  normaliseUrlPath,
} from "@growthmind/shared";

import type { MeasuredCount } from "../counts/measured-count";
import type { CandidateFinding, ConfidenceBasis } from "../findings/candidate";
import { candidateFindingSchema } from "../findings/candidate";
import type { FindingClass } from "../rules/types";
import type { CountRole } from "./count-roles";
import { COUNT_ROLES, resolveCounts } from "./count-roles";
import { substitute } from "./substitute";
import type { FloorSummary, FloorSummarySource } from "./types";
import { floorSummarySourceSchema } from "./types";

const OBSERVATION: Record<FindingClass, string> = FLOOR_OBSERVATION_TEMPLATES;
const CONFIDENCE: Record<ConfidenceBasis, string> = FLOOR_CONFIDENCE_TEMPLATES;
const COUNT_TEXT: Record<CountRole, string> = FLOOR_COUNT_TEMPLATES;

const ISO_DATE_LENGTH = 10;

const SENTENCE_BOUNDARY = ". ";
const FULL_STOP = ".";

function sentencesOf(text: string): readonly string[] {
  const parts = text.split(SENTENCE_BOUNDARY);
  return parts.map((part, index) => (index === parts.length - 1 ? part : `${part}${FULL_STOP}`));
}

function oneSentenceOrRefuse(element: string, position: number): string {
  const trimmed = element.trim();

  if (trimmed.length === 0 || !trimmed.endsWith(FULL_STOP) || trimmed.includes(SENTENCE_BOUNDARY)) {
    throw new Error(`floor_element_not_one_sentence: ${String(position)}`);
  }

  return trimmed;
}

function magnitudeSentence(role: CountRole, count: MeasuredCount, surface: string): string {
  if (count.denominator === 0) {
    return FLOOR_NO_RATE_TEMPLATE;
  }

  return substitute(COUNT_TEXT[role], {
    numerator: String(count.numerator),
    denominator: String(count.denominator),
    unit: count.unit,
    surface,
  });
}

export function renderFloorSummary(input: {
  readonly candidate: CandidateFinding;
  readonly source: FloorSummarySource;
}): FloorSummary {
  const candidate: CandidateFinding = candidateFindingSchema.parse(input.candidate);
  const source: FloorSummarySource = floorSummarySourceSchema.parse(input.source);

  if (!isNormalisedUrlPath(candidate.surface)) {
    const normalised = normaliseUrlPath(candidate.surface, null);
    throw new Error(`surface_not_normalised: ${normalised ?? "none"}`);
  }

  const surface = candidate.surface;

  const resolved = resolveCounts(candidate);
  const roles: readonly CountRole[] = COUNT_ROLES[resolved.detector];
  const countsByRole: Readonly<Record<string, MeasuredCount>> = resolved.counts;

  const observation = substitute(OBSERVATION[candidate.finalClass], { surface });

  const magnitudes: string[] = [];
  for (const role of roles) {
    const count = countsByRole[role];
    if (count === undefined) {
      throw new Error(`floor_unresolved_count_role: ${role}`);
    }

    const sentence = magnitudeSentence(role, count, surface);
    if (!magnitudes.includes(sentence)) {
      magnitudes.push(sentence);
    }
  }

  const timeframe = substitute(FLOOR_TIMEFRAME_TEMPLATE, {
    windowStart: candidate.timeframe.start.toISOString().slice(0, ISO_DATE_LENGTH),
    windowEnd: candidate.timeframe.end.toISOString().slice(0, ISO_DATE_LENGTH),
  });

  const confidence = CONFIDENCE[candidate.ranking.confidenceBasis];

  const provenance = SUMMARY_SOURCE_MESSAGES[source];

  const headline = sentencesOf(observation).map((element, position) =>
    oneSentenceOrRefuse(element, position),
  );
  if (headline.length !== 1) {
    throw new Error(`floor_headline_not_one_sentence: ${candidate.finalClass}`);
  }

  const context = [...magnitudes, timeframe, confidence, provenance]
    .flatMap((element) => sentencesOf(element))
    .map((element, position) => oneSentenceOrRefuse(element, position));

  return { source, headline: headline[0], context };
}
