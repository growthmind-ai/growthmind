// The minimal fix spec: a finding's structured state rendered to plain sentences a
// coding agent reads over MCP. The one guarantee: no output of this module can carry a
// code fence, a diff, a patch, or an instruction phrased as an edit. Nothing composes
// a sentence here; every string is a fixed template that passes a code gate on every
// render, and every gate refuses (throws) rather than degrading. Pure, no clock.
// Design rationale: docs/decisions/0011-fix-spec-contract.md
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

// The reused vocabulary, and the compile pins that hold it.
//
// Four of the five sentence kinds a fix spec renders already exist, already audited, in
// `packages/shared/src/summary/messages.ts`: the symptom keyed by finding class, the
// magnitude keyed by count role, the no-rate sentence, and the window. Re-authoring
// them here would be a second vocabulary for the same facts. The exact drift
// `../counts/measured-count.ts:30` refuses when it reuses `EXCLUSION_REASON_LABELS`
// rather than restating it. So they are imported, and the annotations below are the
// same load-bearing compile pins `../summary/floor.ts:83-85` carries: a fifth finding
// class, a fourth confidence basis, or a fourth count role added in `core` without its
// sentence in `shared` fails these assignments under `bun run typecheck`.

const SYMPTOM: Record<FindingClass, string> = FLOOR_OBSERVATION_TEMPLATES;
const CONFIDENCE: Record<ConfidenceBasis, string> = FLOOR_CONFIDENCE_TEMPLATES;
const COUNT_TEXT: Record<CountRole, string> = FLOOR_COUNT_TEMPLATES;

/**
 * What kind of thing was seen, one sentence per evidence signal kind.
 *
 * `Record<EvidenceSignalKind, string>` is the compile pin: a sixth member added to
 * `EvidenceSignal` without a sentence here fails `bun run typecheck`. The page is the
 * subject of every sentence, no sentence says "people", and no event name is rendered:
 * an event name is un-redacted customer text with no redaction rule yet. The design
 * doc carries both arguments.
 */
export const FIX_SPEC_EVIDENCE_TEMPLATES: Record<EvidenceSignalKind, string> = {
  /** `failure_correlated`: an exception tied to the action that preceded it. */
  failure_correlated: "An error is being thrown on {surface} straight after an action taken there.",

  /**
   * `failure_uncorrelated`: recorded honestly as uncorrelated rather than
   * laundered into a correlated one, so the sentence must not imply the error follows
   * from anything. It is deliberately not admissible as proof of `broken`, and this
   * sentence claims no more than its own absence of a link.
   */
  failure_uncorrelated:
    "Errors are being thrown on {surface}, and nothing ties them to an action taken there.",

  /**
   * `struggle`: repetition is the whole claim. The sentence names no leaving, so it can
   * never be read together with a magnitude sentence about sessions that left as though
   * the two described one group (SAC-11).
   */
  struggle: "{surface} is being returned to repeatedly inside a single visit.",

  /** `clean_exit`: the page is left, and nothing observed went wrong on it. */
  clean_exit: "{surface} is being left with nothing going wrong on it.",

  /**
   * `instrumentation_rate_drop`: the wording the gate already uses for this same
   * predicate (`packages/shared/src/gate/messages.ts:97`). It stops at the observation.
   * Whether the cause is the tracking or the product is a second claim, and nothing
   * measured settles it.
   */
  instrumentation_rate_drop:
    "One kind of activity we normally see on {surface} has almost stopped arriving.",
};

/**
 * What is said when a finding carries no evidence signals at all: an empty `signals`
 * join is legitimate, and a blank section would read as "we did not look", which is a
 * different and false claim.
 */
export const FIX_SPEC_NO_EVIDENCE_TEMPLATE: string =
  "No individual observations were recorded alongside this, so what follows rests on the counts.";

/**
 * What this spec is not: the "no code" product decision, stated in the output itself,
 * on every spec, unconditionally. A reader who has to infer that we did not look at
 * their source may reasonably assume we did. No next step is stated: nothing shipped
 * can act on a finding.
 */
export const FIX_SPEC_BOUNDARY_TEMPLATES: readonly string[] = [
  "This describes what was measured on one page, not how that page is built.",
  "No source file was read to produce this, and nothing here points at a line in one.",
  "Deciding what to do about this is not something these numbers settle.",
];

/**
 * The limitation the evidence section carries, stated only when there is one. Evidence
 * sentences are qualitative by design: a signal's own cohort magnitude is a different
 * population from the candidate's counts, and standing the two next to each other
 * invites reading one group's behaviour onto the other.
 */
export const FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE: string =
  "Each observation above says what kind of thing was seen on this page, not how much of it.";

/**
 * What the run could not see, travelling with what it did: a spec that hid a truncated
 * read would hand an agent a floor while presenting it as a total. Both sentences are
 * qualitative, because rendering a bare number in front of a reader is the one thing
 * `MeasuredCount` exists to prevent.
 */
export const FIX_SPEC_COVERAGE_TEMPLATES = {
  truncated:
    "Only part of the activity in this window was looked at, so every number above is a floor rather than a total.",
  eventsWithoutUrlPath:
    "Some activity in this window arrived with no page address on it and was left out of this picture.",
} as const;

/**
 * Every fixed string this module authors, in one array, derived from the tables above
 * rather than re-listed, so the plain-English audit over it is total and a sentence
 * cannot escape review by being added in one place and not the other. The vocabulary
 * reused from `@growthmind/shared` is covered by that package's own audit.
 */
export const FIX_SPEC_ALL_TEMPLATES: readonly string[] = [
  ...Object.values(FIX_SPEC_EVIDENCE_TEMPLATES),
  FIX_SPEC_NO_EVIDENCE_TEMPLATE,
  ...FIX_SPEC_BOUNDARY_TEMPLATES,
  FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE,
  ...Object.values(FIX_SPEC_COVERAGE_TEMPLATES),
];

// The code gate

/**
 * One way a string can read as code, as data.
 *
 * A table rather than one fused regular expression so a refusal can name the marker it
 * tripped, and so a test can enumerate the real list instead of a copy of it, the same
 * reason `COHORT_NOUNS` is exported from `../delivery/slack-message.ts:142`.
 */
export type CodeShapedMarker = {
  readonly name: string;
  readonly pattern: RegExp;
};

/**
 * The markers a fix-spec template may not contain. Deliberately broader than prose
 * needs: it scans only our own closed, authored vocabulary, never customer data (the
 * design doc's composed-input rule). No pattern carries the `g` flag, which is
 * stateful across `.test` calls, a determinism bug inside the guard that exists to
 * make the output deterministic. The brace pair is not banned because `{surface}` is
 * the placeholder syntax `substitute` reads, and it refuses unresolved placeholders.
 */
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
    // "change the retry limit to 5", "replace the handler with a guard". An instruction
    // phrased as an edit.
    //
    // The object is one to four words, not exactly one: a real instruction names its
    // object in a phrase, and a pattern that only saw "change X to Y" would step over
    // the shape people actually write.
    //
    // No word of the object may carry a comma or a full stop, which is what keeps the
    // shipped "was set aside, leaving no share to report", whose first three words are
    // `set`, `aside,`, `leaving`. From reading as one. The clause boundary is where an
    // instruction stops being an instruction.
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

/**
 * True when a string reads as code, a diff, or an instruction to edit one. Point this
 * at our own vocabulary only: it fires on perfectly ordinary customer data (a path
 * like `/docs/readme.md` ends in a file extension and is not a patch), so every caller
 * runs it over a template before a value is written in. Miss direction: an unmatched
 * phrasing renders; the primary control is that no sentence is composed here at all.
 */
export function isCodeShaped(text: string): boolean {
  return codeMarkerIn(text) !== null;
}

/** The name of the first marker a string trips, or `null`. Module-private: the refusal
 * message is the only consumer, and a second public predicate would be a second thing
 * to keep in step with `isCodeShaped`. */
function codeMarkerIn(text: string): string | null {
  for (const marker of CODE_SHAPED_MARKERS) {
    if (marker.pattern.test(text)) return marker.name;
  }
  return null;
}

// The output contract

/**
 * A finding's structured state, as sentences.
 *
 * Four named sections plus one flattening, and the flattening is not a convenience.
 * `sentences` is what an audit scans and what a caller with no layout of its own
 * renders; keeping it a derived field rather than a separately-assembled one means a
 * section cannot be added to the spec and quietly omitted from the scan.
 *
 * Every array is non-empty by construction. `evidence` falls back to the no-evidence
 * sentence, `measurement` always carries the window and the confidence, and `boundary`
 * always carries its three fixed sentences. There is no input for which a section is
 * blank, so no consumer needs an empty-state branch that would never be exercised.
 */
export type FixSpec = {
  /** The customer's own normalised `url_path`, verbatim. Never rewritten. */
  readonly surface: string;
  /** What is wrong, in one sentence, keyed by the class the gate concluded. */
  readonly symptom: string;
  /** What kind of thing was seen. At least one sentence, always. */
  readonly evidence: readonly string[];
  /** The counts with their denominators, the window, and the confidence. */
  readonly measurement: readonly string[];
  /** What this spec is not, and what the run could not see. */
  readonly boundary: readonly string[];
  /** `symptom`, then `evidence`, then `measurement`, then `boundary`. */
  readonly sentences: readonly string[];
};

/**
 * The runtime mirror of `FixSpec`. The shape that crosses the MCP wire.
 *
 * Declared beside the hand-written type rather than inferred from it, so the `readonly`
 * the type carries is not lost; the two are held together by a named test that parses a
 * real rendered spec through this schema. Every string is `.min` and every array
 * `.min`: an empty sentence and an empty section are both unrenderable states that
 * would reach a reader as a gap.
 */
export const fixSpecSchema = z.object({
  surface: z.string().min(1),
  symptom: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  measurement: z.array(z.string().min(1)).min(1),
  boundary: z.array(z.string().min(1)).min(1),
  sentences: z.array(z.string().min(1)).min(1),
});

/**
 * Everything `renderFixSpec` reads.
 *
 * `signals` is a separate parameter rather than a field on the candidate because
 * `CandidateFinding` genuinely does not carry one: `../findings/candidate.ts` holds the
 * gate's conclusion and its magnitudes, while `EvidenceSignal[]` lives on the
 * detector's own `DetectorCandidate`. The two are joined by the caller, and an empty
 * array is a legitimate join result rather than an error, see
 * `FIX_SPEC_NO_EVIDENCE_TEMPLATE`.
 */
export type FixSpecInput = {
  readonly candidate: CandidateFinding;
  readonly signals: readonly EvidenceSignal[];
};

/**
 * The boundary. Both halves are parsed by the schema that owns them, so this module
 * states no rule of its own about what a candidate or a signal is.
 */
export const fixSpecInputSchema = z.object({
  candidate: candidateFindingSchema,
  signals: z.array(evidenceSignalSchema),
});

// Rendering

/** `2026-06-01`, the date part of an ISO instant. */
const ISO_DATE_LENGTH = 10;

/** A full stop followed by a space: the boundary between two sentences inside one fixed
 * string. */
const SENTENCE_BOUNDARY = ". ";
const FULL_STOP = ".";

/**
 * The placeholders whose presence makes a template a count sentence.
 *
 * Typed `readonly FloorToken[]` so a token renamed in `../summary/substitute.ts` fails
 * this assignment rather than silently exempting every count sentence from the people
 * guard below.
 */
const COUNT_TOKENS: readonly FloorToken[] = ["numerator", "denominator", "unit"];

function carriesACount(template: string): boolean {
  const placeholders: readonly string[] = placeholdersIn(template);
  return COUNT_TOKENS.some((token) => placeholders.includes(token));
}

/**
 * Returns a template fit to render, or refuses. The last gate before our vocabulary
 * becomes a sentence, run on every render rather than once at module load. Three
 * refusals: not exactly one sentence (refused rather than split, because splitting
 * would author a sentence boundary); code-shaped (the product decision, mechanised);
 * and a count sentence that describes people (conditional on the template carrying a
 * count, because a count-free sentence may name people where a cohort magnitude
 * licenses it). The error names the slot and the marker, never template text. The full
 * argument for each refusal is in the design doc.
 */
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

/**
 * Gate the template, then write the values in. In that order, always. The guards scan
 * our vocabulary and never the customer's data (see the design doc), and this function
 * is the only place the two steps are sequenced, so there is no call site that can get
 * the order wrong.
 */
function write(
  template: string,
  slot: string,
  values: Partial<Record<FloorToken, string>>,
): string {
  return substitute(templateOrRefuse(template, slot), values);
}

/**
 * Returns the surface, or refuses.
 *
 * A path segment can carry a live token or an address,
 * `packages/shared/src/sessions/url-path.ts:105-110` is the record of that hazard, and
 * `candidateFindingSchema.surface` accepts any non-empty string, so the contract alone
 * does not guarantee the redaction ran. A fix spec is handed to an agent that may log
 * it, so an unredacted path reaching one is the same leak one step further out than the
 * incident that motivated redaction.
 *
 * The refusal names only the normalised form, never the value that came in: naming the
 * input would put the very token this check exists to stop into a log line. Same
 * discipline as `../summary/floor.ts:189-199`.
 *
 * Applied to every surface rendered, including the one a `struggle` or `clean_exit`
 * signal carries of its own. A signal's surface is a different field from the
 * candidate's and nothing guarantees the two agree.
 */
function normalisedSurfaceOrRefuse(surface: string): string {
  if (!isNormalisedUrlPath(surface)) {
    const normalised = normaliseUrlPath(surface, null);
    throw new Error(`fix_spec_surface_not_normalised: ${normalised ?? "none"}`);
  }
  return surface;
}

/** The page a signal is about: its own where it has one, the candidate's otherwise. Two
 * of the five variants carry a `surface`; the other three are about an event and
 * inherit the page the claim is about. */
function surfaceOfSignal(signal: EvidenceSignal, fallback: string): string {
  return signal.kind === "struggle" || signal.kind === "clean_exit" ? signal.surface : fallback;
}

/**
 * One magnitude, with its denominator in the same sentence: every count template
 * carries `{numerator}`, `{denominator}` and `{unit}` in one string, so no call shape
 * can render a numerator alone. A zero denominator takes the explicit no-rate
 * sentence, never a division, a blank, `0%` or `NaN`; `rate.value` is deliberately
 * never printed, because this product renders no numeric precision anywhere and the
 * numerator and the denominator are the claim.
 */
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

/** What the run could not see. Order is fixed, so two runs over one coverage render
 * byte-identically. */
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

/**
 * Turns a finding's structured state into the sentences a coding agent reads.
 *
 * Fail direction: refuse, at every step. The input schema is parsed first; every
 * surface (the candidate's or a signal's own) must already be normalised; a `counts`
 * arity that disagrees with the detector's declared roles refuses (`resolveCounts`);
 * and every template gates on every render. No code is emitted, no ratio is computed
 * between counts, no class is re-derived, no signal magnitude is rendered, and no
 * clock is read. Isolation of one refused finding from a whole run is not claimed
 * here; it belongs to whatever eventually calls this, and nothing does yet. The
 * argument for each of these is in the design doc.
 */
export function renderFixSpec(input: FixSpecInput): FixSpec {
  // 1. The boundary, and it comes first. No `??`, no default, no fallback
  //  anywhere below.
  const parsed = fixSpecInputSchema.parse(input);
  const candidate: CandidateFinding = parsed.candidate;
  const signals: readonly EvidenceSignal[] = parsed.signals;

  // 2. The customer's page address, proved redacted, then carried verbatim.
  const surface = normalisedSurfaceOrRefuse(candidate.surface);

  // 3. The symptom, keyed by the class the gate concluded.
  const symptom = write(SYMPTOM[candidate.finalClass], "symptom", { surface });

  // 4. The evidence.
  //
  //  Deduplicated, and it is not cosmetic (edge taxonomy). Four struggle
  //  signals on one page produce four identical sentences, because these
  //  sentences are qualitative and carry no per-signal magnitude. Emitting
  //  the same sentence four times would state one observation as though it
  //  had been made four separate ways, which is the multiplicity failure
  //  dressed as prose. First-occurrence order is preserved, so the result is
  //  a function of the input order and nothing else.
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

  // 5. The magnitudes, in declared role order, never in array order, and never
  //  by index. `resolveCounts` is what stands between a reader and the
  //  arrival count sitting under the departure sentence.
  //
  //  The one deduplication here: both of a funnel finding's counts share one
  //  denominator, so at a zero denominator both roles produce the identical
  //  no-rate sentence. Emitting it twice would state one fact about the
  //  window as though it had been measured twice.
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

  // Confidence, in words. The table carries no digit and none may be added.
  measurement.push(
    write(CONFIDENCE[candidate.ranking.confidenceBasis], "measurement.confidence", {}),
  );

  // 6. What this spec is not, then what the run could not see.
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
    // Derived, never separately assembled. A section added above cannot be omitted from
    // the flattening a caller and an audit both read.
    sentences: [symptom, ...evidence, ...measurement, ...boundary],
  };
}
