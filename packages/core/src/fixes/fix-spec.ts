import {
  FLOOR_CONFIDENCE_TEMPLATES,
  FLOOR_COUNT_TEMPLATES,
  FLOOR_NO_RATE_TEMPLATE,
  FLOOR_OBSERVATION_TEMPLATES,
  FLOOR_TIMEFRAME_TEMPLATE,
  isNormalisedUrlPath,
  normaliseUrlPath,
} from "@growthmind/shared";
import { z } from "zod";

import type { MeasuredCount } from "../counts/measured-count";
import { rateOf } from "../counts/measured-count";
import { describesPeople } from "../delivery/slack-message";
import type { DetectorCoverage } from "../detect/types";
import type { EvidenceSignal, EvidenceSignalKind } from "../evidence/signals";
import { evidenceSignalSchema } from "../evidence/signals";
import type { CandidateFinding, ConfidenceBasis } from "../findings/candidate";
import { candidateFindingSchema } from "../findings/candidate";
import type { FindingClass } from "../rules/types";
import type { CountRole } from "../summary/count-roles";
import { COUNT_ROLES, resolveCounts } from "../summary/count-roles";
import type { FloorToken } from "../summary/substitute";
import { placeholdersIn, substitute } from "../summary/substitute";

const SYMPTOM: Record<FindingClass, string> = FLOOR_OBSERVATION_TEMPLATES;
const CONFIDENCE: Record<ConfidenceBasis, string> = FLOOR_CONFIDENCE_TEMPLATES;
const COUNT_TEXT: Record<CountRole, string> = FLOOR_COUNT_TEMPLATES;

export const FIX_SPEC_EVIDENCE_TEMPLATES: Record<EvidenceSignalKind, string> = {
  failure_correlated: "An error is being thrown on {surface} straight after an action taken there.",

  failure_uncorrelated:
    "Errors are being thrown on {surface}, and nothing ties them to an action taken there.",

  struggle: "{surface} is being returned to repeatedly inside a single visit.",

  clean_exit: "{surface} is being left with nothing going wrong on it.",

  instrumentation_rate_drop:
    "One kind of activity we normally see on {surface} has almost stopped arriving.",
};

export const FIX_SPEC_NO_EVIDENCE_TEMPLATE: string =
  "No individual observations were recorded alongside this, so what follows rests on the counts.";

export const FIX_SPEC_BOUNDARY_TEMPLATES: readonly string[] = [
  "This describes what was measured on one page, not how that page is built.",
  "No source file was read to produce this, and nothing here points at a line in one.",
  "Deciding what to do about this is not something these numbers settle.",
];

export const FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE: string =
  "Each observation above says what kind of thing was seen on this page, not how much of it.";

export const FIX_SPEC_COVERAGE_TEMPLATES = {
  truncated:
    "Only part of the activity in this window was looked at, so every number above is a floor rather than a total.",
  eventsWithoutUrlPath:
    "Some activity in this window arrived with no page address on it and was left out of this picture.",
} as const;

export const FIX_SPEC_ALL_TEMPLATES: readonly string[] = [
  ...Object.values(FIX_SPEC_EVIDENCE_TEMPLATES),
  FIX_SPEC_NO_EVIDENCE_TEMPLATE,
  ...FIX_SPEC_BOUNDARY_TEMPLATES,
  FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE,
  ...Object.values(FIX_SPEC_COVERAGE_TEMPLATES),
];

export type CodeShapedMarker = {
  readonly name: string;
  readonly pattern: RegExp;
};

export const CODE_SHAPED_MARKERS: readonly CodeShapedMarker[] = [
  { name: "fenced_code", pattern: /```|~~~/ },
  { name: "inline_code", pattern: /`/ },
  { name: "diff_hunk_header", pattern: /@@/ },
  { name: "diff_file_header", pattern: /^\s*(?:\+\+\+|---)/m },
  { name: "markup_bracket", pattern: /[<>]/ },
  { name: "index_bracket", pattern: /[[\]]/ },
  { name: "call_parenthesis", pattern: /[()]/ },
  { name: "operator", pattern: /=>|===|!==|&&|\|\||\+=|::/ },
  { name: "path_with_line_number", pattern: /:\d+/ },
  { name: "line_reference", pattern: /\bline\s+\d+/i },
  {
    name: "source_file_extension",
    pattern:
      /\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|sql|py|rb|go|rs|java|php|yml|yaml|toml|sh|md)\b/i,
  },
  { name: "shell_invocation", pattern: /\b(?:npm|bun|bunx|npx|yarn|pnpm|git|curl|sudo|cd)\s/i },
  { name: "version_control_verb", pattern: /\b(?:diff|patch|commit|rebase|stash|merge)\b/i },
  {
    name: "language_keyword",
    pattern:
      /\b(?:const|let|var|function|return|import|export|await|async|typeof|instanceof|class|interface|enum|null|undefined)\b/,
  },
  {
    name: "edit_instruction",
    pattern:
      /\b(?:change|replace|set|update|rename|move|delete|remove|add|wrap|swap)\s+(?:[^\s,.]+\s+){1,4}(?:to|with|into|from|in)\b/i,
  },
  {
    name: "imperative_opener",
    pattern:
      /^\s*(?:apply|run|edit|patch|open|create|install|copy|paste|write|implement|refactor)\b/i,
  },
];

export function isCodeShaped(text: string): boolean {
  return codeMarkerIn(text) !== null;
}

function codeMarkerIn(text: string): string | null {
  for (const marker of CODE_SHAPED_MARKERS) {
    if (marker.pattern.test(text)) return marker.name;
  }
  return null;
}

export type FixSpec = {
  readonly surface: string;

  readonly symptom: string;

  readonly evidence: readonly string[];

  readonly measurement: readonly string[];

  readonly boundary: readonly string[];

  readonly sentences: readonly string[];
};

export const fixSpecSchema = z.object({
  surface: z.string().min(1),
  symptom: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  measurement: z.array(z.string().min(1)).min(1),
  boundary: z.array(z.string().min(1)).min(1),
  sentences: z.array(z.string().min(1)).min(1),
});

export type FixSpecInput = {
  readonly candidate: CandidateFinding;
  readonly signals: readonly EvidenceSignal[];
};

export const fixSpecInputSchema = z.object({
  candidate: candidateFindingSchema,
  signals: z.array(evidenceSignalSchema),
});

const ISO_DATE_LENGTH = 10;

const SENTENCE_BOUNDARY = ". ";
const FULL_STOP = ".";

const COUNT_TOKENS: readonly FloorToken[] = ["numerator", "denominator", "unit"];

function carriesACount(template: string): boolean {
  const placeholders: readonly string[] = placeholdersIn(template);
  return COUNT_TOKENS.some((token) => placeholders.includes(token));
}

function templateOrRefuse(template: string, slot: string): string {
  const trimmed = template.trim();

  if (trimmed.length === 0 || !trimmed.endsWith(FULL_STOP) || trimmed.includes(SENTENCE_BOUNDARY)) {
    throw new Error(`fix_spec_not_one_sentence: ${slot}`);
  }

  const marker = codeMarkerIn(trimmed);
  if (marker !== null) {
    throw new Error(`fix_spec_code_shaped: ${slot}: ${marker}`);
  }

  if (carriesACount(trimmed) && describesPeople(trimmed)) {
    throw new Error(`fix_spec_count_describes_people: ${slot}`);
  }

  return trimmed;
}

function write(
  template: string,
  slot: string,
  values: Partial<Record<FloorToken, string>>,
): string {
  return substitute(templateOrRefuse(template, slot), values);
}

function normalisedSurfaceOrRefuse(surface: string): string {
  if (!isNormalisedUrlPath(surface)) {
    const normalised = normaliseUrlPath(surface, null);
    throw new Error(`fix_spec_surface_not_normalised: ${normalised ?? "none"}`);
  }
  return surface;
}

function surfaceOfSignal(signal: EvidenceSignal, fallback: string): string {
  return signal.kind === "struggle" || signal.kind === "clean_exit" ? signal.surface : fallback;
}

function magnitudeSentence(role: CountRole, count: MeasuredCount, surface: string): string {
  const rate = rateOf(count);

  if (rate.kind === "no_rate") {
    return write(FLOOR_NO_RATE_TEMPLATE, `measurement.${role}.no_rate`, {});
  }

  return write(COUNT_TEXT[role], `measurement.${role}`, {
    numerator: String(count.numerator),
    denominator: String(count.denominator),
    unit: count.unit,
    surface,
  });
}

function coverageSentences(coverage: DetectorCoverage): readonly string[] {
  const sentences: string[] = [];

  if (coverage.truncated) {
    sentences.push(write(FIX_SPEC_COVERAGE_TEMPLATES.truncated, "boundary.truncated", {}));
  }
  if (coverage.eventsWithoutUrlPath > 0) {
    sentences.push(
      write(FIX_SPEC_COVERAGE_TEMPLATES.eventsWithoutUrlPath, "boundary.no_page_address", {}),
    );
  }

  return sentences;
}

export function renderFixSpec(input: FixSpecInput): FixSpec {
  const parsed = fixSpecInputSchema.parse(input);
  const candidate: CandidateFinding = parsed.candidate;
  const signals: readonly EvidenceSignal[] = parsed.signals;

  const surface = normalisedSurfaceOrRefuse(candidate.surface);

  const symptom = write(SYMPTOM[candidate.finalClass], "symptom", { surface });

  const evidence: string[] = [];
  for (const signal of signals) {
    const sentence = write(FIX_SPEC_EVIDENCE_TEMPLATES[signal.kind], `evidence.${signal.kind}`, {
      surface: normalisedSurfaceOrRefuse(surfaceOfSignal(signal, surface)),
    });
    if (!evidence.includes(sentence)) evidence.push(sentence);
  }
  if (evidence.length === 0) {
    evidence.push(write(FIX_SPEC_NO_EVIDENCE_TEMPLATE, "evidence.none", {}));
  }

  const resolved = resolveCounts(candidate);
  const roles: readonly CountRole[] = COUNT_ROLES[resolved.detector];
  const countsByRole: Readonly<Record<string, MeasuredCount>> = resolved.counts;

  const measurement: string[] = [];
  for (const role of roles) {
    const count = countsByRole[role];
    if (count === undefined) {
      throw new Error(`fix_spec_unresolved_count_role: ${role}`);
    }
    const sentence = magnitudeSentence(role, count, surface);
    if (!measurement.includes(sentence)) measurement.push(sentence);
  }

  measurement.push(
    write(FLOOR_TIMEFRAME_TEMPLATE, "measurement.window", {
      windowStart: candidate.timeframe.start.toISOString().slice(0, ISO_DATE_LENGTH),
      windowEnd: candidate.timeframe.end.toISOString().slice(0, ISO_DATE_LENGTH),
    }),
  );

  measurement.push(
    write(CONFIDENCE[candidate.ranking.confidenceBasis], "measurement.confidence", {}),
  );

  const boundary: string[] = FIX_SPEC_BOUNDARY_TEMPLATES.map((template, position) =>
    write(template, `boundary.${String(position)}`, {}),
  );
  if (signals.length > 0) {
    boundary.push(write(FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE, "boundary.evidence_limit", {}));
  }
  boundary.push(...coverageSentences(candidate.coverage));

  return {
    surface,
    symptom,
    evidence,
    measurement,
    boundary,

    sentences: [symptom, ...evidence, ...measurement, ...boundary],
  };
}
