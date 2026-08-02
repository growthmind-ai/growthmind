import { z } from "zod";

import { PROOF_PREDICATES } from "../evidence/predicates";
import type { CandidateFinding } from "../findings/candidate";
import { confidenceBasisSchema } from "../findings/candidate";
import { detectorNameSchema, findingClassSchema } from "../rules/types";

export const modelSummaryOutputSchema = z.strictObject({
  headline: z.string().min(1),

  context: z.string().min(1),
});
export type ModelSummaryOutput = z.infer<typeof modelSummaryOutputSchema>;

const SPACE = " ";

const TERMINATORS = [".", "!", "?"] as const;

function isTerminator(character: string | undefined): boolean {
  return character !== undefined && TERMINATORS.some((mark) => mark === character);
}

function isUpperCase(character: string | undefined): boolean {
  return (
    character !== undefined && character !== character.toLowerCase() && /^[A-Za-z]$/.test(character)
  );
}

export function splitSentences(text: string): readonly string[] | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (!isTerminator(trimmed[trimmed.length - 1])) return null;

  const sentences: string[] = [];
  let start = 0;

  for (let index = 0; index < trimmed.length; index += 1) {
    if (!isTerminator(trimmed[index])) continue;

    const atEnd = index === trimmed.length - 1;
    if (atEnd) {
      sentences.push(trimmed.slice(start, index + 1).trim());
      break;
    }

    if (isTerminator(trimmed[index + 1])) continue;

    const next = trimmed[index + 1];
    if (next !== SPACE && next !== "\n" && next !== "\t") return null;

    let scan = index + 1;
    while (scan < trimmed.length && trimmed[scan] === SPACE) scan += 1;
    if (!isUpperCase(trimmed[scan])) return null;

    sentences.push(trimmed.slice(start, index + 1).trim());
    start = scan;
  }

  if (sentences.length === 0) return null;
  if (sentences.some((sentence) => sentence.length === 0)) return null;
  return sentences;
}

export function joinSentences(sentences: readonly string[]): string {
  return sentences.join(SPACE);
}

export type GuardedSacId =
  "SAC-2" | "SAC-3" | "SAC-4" | "SAC-5" | "SAC-7" | "SAC-8" | "SAC-11" | "SAC-12";

export type SacOffence = {
  readonly sac: string;
  readonly element: number;
};

export type GuardRefusal = "candidate_invalid" | "not_segmentable" | "sac_offences";

export type GuardVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly refusal: GuardRefusal;
      readonly offences: readonly SacOffence[];
    };

function bareDigitOffenders(text: string, allowed: ReadonlySet<string>): readonly string[] {
  return (text.match(/\d+/g) ?? []).filter((run) => !allowed.has(run));
}

function isDenominatorless(
  sentence: string,
  counts: readonly { readonly numerator: number; readonly denominator: number }[],
): boolean {
  const runs = new Set(sentence.match(/\d+/g) ?? []);
  return counts.some(
    (count) => runs.has(String(count.numerator)) && !runs.has(String(count.denominator)),
  );
}

const STRUGGLE_TOKENS = ["coming back", "over and over", "repeatedly", "again", "revisit"] as const;

const DROP_TOKENS = ["left", "dropped", "without going anywhere", "gave up"] as const;

function isCohortConflation(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return (
    STRUGGLE_TOKENS.some((token) => lower.includes(token)) &&
    DROP_TOKENS.some((token) => lower.includes(token))
  );
}

const MACHINE_IDENTIFIERS: readonly string[] = [
  ...findingClassSchema.options,
  ...confidenceBasisSchema.options,
  ...detectorNameSchema.options,
  ...Object.values(PROOF_PREDICATES).map((predicate) => predicate.name),
  "evidence_shape",
];

function hasMachineIdentifier(text: string): boolean {
  const lower = text.toLowerCase();
  if (MACHINE_IDENTIFIERS.some((identifier) => lower.includes(identifier.toLowerCase()))) {
    return true;
  }

  return /\bv\d+\b|\b\d+\.\d+(?:\.\d+)?\b/.test(text);
}

const CAUSAL_CONNECTIVES = [
  "because",
  "caused",
  "due to",
  "so that",
  "which is why",
  "therefore",
] as const;

function hasCausalConnective(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return CAUSAL_CONNECTIVES.some((connective) => lower.includes(connective));
}

const RELATIVE_TIME_PHRASES = [
  "recently",
  "today",
  "yesterday",
  "this week",
  "last week",
  "currently",
  "right now",
  "these days",
] as const;

function hasRelativeTime(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return RELATIVE_TIME_PHRASES.some((phrase) => lower.includes(phrase));
}

const PATH_TOKEN = /\/[^\s,;:!?]*[^\s,;:!?.]/g;

function hasForeignSurface(sentence: string, surface: string): boolean {
  return (sentence.match(PATH_TOKEN) ?? []).some((token) => token !== surface);
}

function hasNumericConfidence(sentence: string): boolean {
  return sentence.toLowerCase().includes("confiden") && /\d/.test(sentence);
}

function allowedDigitRuns(candidate: CandidateFinding): ReadonlySet<string> {
  const allowed = new Set<string>();
  for (const count of candidate.counts) {
    allowed.add(String(count.numerator));
    allowed.add(String(count.denominator));
  }
  return allowed;
}

const ISO_DATE_LENGTH = 10;

function maskCandidateDigits(text: string, candidate: CandidateFinding): string {
  const masked = [
    candidate.surface,
    candidate.timeframe.start.toISOString().slice(0, ISO_DATE_LENGTH),
    candidate.timeframe.end.toISOString().slice(0, ISO_DATE_LENGTH),
  ].reduce((carried, token) => carried.split(token).join(SPACE), text);
  return masked;
}

function offencesInElement(
  element: string,
  index: number,
  candidate: CandidateFinding,
  allowed: ReadonlySet<string>,
): readonly SacOffence[] {
  const offences: SacOffence[] = [];
  const push = (sac: GuardedSacId): void => {
    offences.push({ sac, element: index });
  };

  if (bareDigitOffenders(maskCandidateDigits(element, candidate), allowed).length > 0) {
    push("SAC-2");
  }
  if (isDenominatorless(element, candidate.counts)) push("SAC-3");
  if (hasForeignSurface(element, candidate.surface)) push("SAC-4");
  if (hasRelativeTime(element)) push("SAC-5");
  if (hasCausalConnective(element)) push("SAC-7");
  if (hasMachineIdentifier(element)) push("SAC-8");
  if (isCohortConflation(element)) push("SAC-11");
  if (hasNumericConfidence(element)) push("SAC-12");

  return offences;
}

export function guardModelText(input: {
  readonly candidate: CandidateFinding;
  readonly headline: string;
  readonly context: string;
}): GuardVerdict {
  const { candidate } = input;
  if (candidate.counts.length === 0) {
    return { ok: false, refusal: "candidate_invalid", offences: [] };
  }

  const headline = input.headline.trim();
  if (headline.length === 0) {
    return { ok: false, refusal: "not_segmentable", offences: [] };
  }
  for (let index = 0; index < headline.length - 1; index += 1) {
    if (isTerminator(headline[index])) {
      return { ok: false, refusal: "not_segmentable", offences: [] };
    }
  }

  const sentences = splitSentences(input.context);
  if (sentences === null) {
    return { ok: false, refusal: "not_segmentable", offences: [] };
  }

  const allowed = allowedDigitRuns(candidate);
  const elements = [headline, ...sentences];
  const offences = elements.flatMap((element, index) =>
    offencesInElement(element, index, candidate, allowed),
  );

  if (offences.length > 0) {
    return { ok: false, refusal: "sac_offences", offences };
  }
  return { ok: true };
}
