// The named tests for the minimal fix spec.
//
// What this file is for, in one sentence: `renderFixSpec` is the first code in this
// repository that puts words in front of a coding agent. Something with write access to
// somebody's repository, and this suite is what holds it to describing what is wrong
// rather than prescribing an edit.
//
// The assertions are written independently of the module's own guard. The no-code test
// below does not call `isCodeShaped` to prove the output is clean. A guard checked
// against itself is a mirror, not a gate. It carries its own literal markers (a fence,
// `@@`, `+++`, an edit instruction, a `file.ts:42`), so a marker deleted from
// `CODE_SHAPED_MARKERS` to make a template pass still fails here. `isCodeShaped` is
// separately proved to fire on real code, so it is not merely blind.
//
// House rules honoured here:
// Fixture time is a constant. Nothing in this file reads a clock; every
//  instant descends from `FIXTURE_WINDOW`, and so does the renderer, which
//  is what the timeframe assertion is really pinning.
// Every helper is declared at module scope, never inside a `test`
//  callback (`unicorn/consistent-function-scoping`). A green `bun test` is
//  not a green build.
// Non-vacuity before any "zero offenders" claim. A scan over an empty
//  corpus passes perfectly and means nothing.
// Lane prefix `t1fx`, shared with no other suite.
// No node builtin, no source-text scan: every claim below is behavioural.
import { EXCLUSION_REASON_LABELS, FORBIDDEN_PRODUCT_JARGON } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { CountBasis, MeasuredCount } from "../../src/counts/measured-count";
import { measuredCount } from "../../src/counts/measured-count";
import { COHORT_NOUNS, describesPeople } from "../../src/delivery/slack-message";
import type { AnalysisWindow, DetectorCoverage } from "../../src/detect/types";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { evidenceSignalKindSchema } from "../../src/evidence/signals";
import { traceEntry } from "../../src/evidence/trace";
import type { CandidateFinding, ConfidenceBasis } from "../../src/findings/candidate";
import { candidateFindingSchema } from "../../src/findings/candidate";
import type { FixSpec } from "../../src/fixes/fix-spec";
import {
  CODE_SHAPED_MARKERS,
  FIX_SPEC_ALL_TEMPLATES,
  FIX_SPEC_BOUNDARY_TEMPLATES,
  FIX_SPEC_COVERAGE_TEMPLATES,
  FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE,
  FIX_SPEC_EVIDENCE_TEMPLATES,
  FIX_SPEC_NO_EVIDENCE_TEMPLATE,
  fixSpecSchema,
  isCodeShaped,
  renderFixSpec,
} from "../../src/fixes/fix-spec";
import type { DetectorName, FindingClass } from "../../src/rules/types";

// Frozen fixture time and vocabulary

const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

/** The only two dates any rendered string may contain. */
const FIXTURE_WINDOW_START_DATE = "2026-06-01";
const FIXTURE_WINDOW_END_DATE = "2026-06-08";

const FUNNEL_SURFACE = "/t1fx/pricing";
const ERROR_SURFACE = "/t1fx/settings";

/**
 * A page address that contains a cohort noun. The exact value
 * `../../src/delivery/slack-message.ts` asserts `describesPeople` returns `true` for,
 * as intended behaviour. It is a customer's own URL, and the whole point of the people
 * guard scanning templates rather than rendered sentences is that this renders
 * verbatim.
 */
const COHORT_NOUN_SURFACE = "/users/profile";

const REACHED = 25;
const LEFT = 12;
const AFFECTED = 4;
const SET_ASIDE = 3;

const CLEAN_COVERAGE: DetectorCoverage = { truncated: false, eventsWithoutUrlPath: 0 };

// Fixture builders

/** A basis in which every session was kept, so `kept` is the denominator. */
function keptBasis(kept: number): CountBasis {
  return { totalInWindow: kept, kept, setAside: [] };
}

/**
 * The basis: every session in the window was set aside, so `kept` (and therefore
 * the denominator) is zero. Distinguishable by construction from "nothing happened in
 * the window", which would have `totalInWindow` zero too.
 */
function allSetAsideBasis(total: number): CountBasis {
  return {
    totalInWindow: total,
    kept: 0,
    setAside: [
      { reason: "internal_domain", count: total, label: EXCLUSION_REASON_LABELS.internal_domain },
    ],
  };
}

function countOf(numerator: number, basis: CountBasis): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: basis.kept,
    unit: "sessions",
    timeframe: { start: FIXTURE_WINDOW.start, end: FIXTURE_WINDOW.end },
    basis,
  });
}

/**
 * A `CandidateFinding` parsed through `candidateFindingSchema`, so no fixture here can
 * drift from the contract the renderer is typed against. Every field a test varies is a
 * named parameter; nothing is silently defaulted into a shape the renderer would never
 * meet.
 */
function candidateOf(input: {
  readonly detector: DetectorName;
  readonly finalClass: FindingClass;
  readonly surface: string;
  readonly counts: readonly MeasuredCount[];
  readonly confidenceBasis: ConfidenceBasis;
  readonly coverage: DetectorCoverage;
}): CandidateFinding {
  return candidateFindingSchema.parse({
    detector: input.detector,
    claimedClass: input.finalClass,
    finalClass: input.finalClass,
    trace: [
      traceEntry({
        class: input.finalClass,
        predicate: `${input.finalClass}_t1fx`,
        predicateVersion: 1,
        satisfied: true,
      }),
    ],
    counts: input.counts,
    timeframe: FIXTURE_WINDOW,
    claimSubject: "surface",
    surface: input.surface,
    surfaceNormalisationVersion: 1,
    evidenceShape: "t1fx-evidence-shape",
    evidenceShapeVersion: 1,
    thresholdRuleSetVersion: 1,
    ranking: {
      sampleSize: input.counts[0],
      confidenceBasis: input.confidenceBasis,
    },
    coverage: input.coverage,
  });
}

/**
 * The workhorse fixture: a funnel finding on a surface, with two counts in declared
 * role order and deliberately different numerators, so a renderer that swapped the two
 * magnitude sentences is caught by an assertion rather than hidden by equal numbers.
 */
function funnelCandidate(surface: string = FUNNEL_SURFACE): CandidateFinding {
  const basis = keptBasis(REACHED);
  return candidateOf({
    detector: "funnel_dropoff",
    finalClass: "confusing",
    surface,
    counts: [countOf(REACHED, basis), countOf(LEFT, basis)],
    confidenceBasis: "threshold_met",
    coverage: CLEAN_COVERAGE,
  });
}

function errorCandidate(): CandidateFinding {
  const basis = keptBasis(REACHED);
  return candidateOf({
    detector: "error_event",
    finalClass: "broken",
    surface: ERROR_SURFACE,
    counts: [countOf(AFFECTED, basis)],
    confidenceBasis: "at_threshold",
    coverage: CLEAN_COVERAGE,
  });
}

function struggleSignal(surface: string): EvidenceSignal {
  const basis = keptBasis(REACHED);
  return {
    kind: "struggle",
    subkind: "repeated_attempt",
    surface,
    attempts: 3,
    strugglingSessions: countOf(5, basis),
  };
}

function correlatedFailureSignal(): EvidenceSignal {
  return {
    kind: "failure_correlated",
    eventName: "t1fx_exception",
    occurredAt: FIXTURE_WINDOW.start,
    precedingActionName: "t1fx_save_clicked",
    correlationWindowMs: 5_000,
    correlatedSessions: countOf(AFFECTED, keptBasis(REACHED)),
  };
}

/** One signal of every kind in the union, so a completeness claim is made over the real
 * enumeration rather than over the two kinds a fixture happened to carry. */
function oneSignalOfEveryKind(surface: string): readonly EvidenceSignal[] {
  return [
    correlatedFailureSignal(),
    { kind: "failure_uncorrelated", eventName: "t1fx_exception", occurredAt: FIXTURE_WINDOW.start },
    struggleSignal(surface),
    { kind: "clean_exit", surface },
    {
      kind: "instrumentation_rate_drop",
      eventName: "t1fx_step_viewed",
      observed: countOf(2, keptBasis(REACHED)),
      expected: countOf(REACHED, keptBasis(REACHED)),
    },
  ];
}

// The independently-authored scans

/**
 * Code markers written here, not imported from the module under test. If a marker were
 * deleted from `CODE_SHAPED_MARKERS` so a template could pass, the output would still
 * fail this list.
 */
const INDEPENDENT_CODE_MARKERS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "code fence", pattern: /```|~~~/ },
  { name: "inline backtick", pattern: /`/ },
  { name: "diff hunk header", pattern: /@@/ },
  { name: "diff file header", pattern: /^\s*(?:\+\+\+|---)/m },
  { name: "angle bracket", pattern: /[<>]/ },
  { name: "arrow or equality operator", pattern: /=>|===|!==/ },
  { name: "file path with a line number", pattern: /\.\w+:\d+/ },
  { name: "semicolon-terminated statement", pattern: /;\s*$/m },
  { name: "call parentheses", pattern: /\(\s*\)/ },
  { name: "language keyword", pattern: /\b(?:const|let|var|function|return|import|export)\b/ },
];

/**
 * Phrasings that turn a description into an edit. Independently authored, and
 * deliberately including the shapes a well-meaning later edit would reach for first
 * ("change X to Y", "you should update…").
 *
 * The object may be one to four words, not exactly one: "change the retry limit to 5"
 * is the shape a real instruction takes, and a pattern that only saw "change X to Y"
 * would step straight over it.
 */
const INDEPENDENT_EDIT_PHRASES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "change X to Y", pattern: /\bchange\s+(?:[^\s,.]+\s+){1,4}to\b/i },
  { name: "replace X with Y", pattern: /\breplace\s+(?:[^\s,.]+\s+){1,4}with\b/i },
  { name: "add X to Y", pattern: /\badd\s+(?:[^\s,.]+\s+){1,4}to\b/i },
  { name: "remove X from Y", pattern: /\bremove\s+(?:[^\s,.]+\s+){1,4}from\b/i },
  { name: "you should …", pattern: /\byou\s+(?:should|must|need to|can)\b/i },
  { name: "apply the following", pattern: /\b(?:apply|run|paste|copy)\s+the\s+following\b/i },
  { name: "the fix is", pattern: /\bthe\s+fix\s+is\b/i },
];

/** Real code, real diffs, real instructions. The corpus that proves both this suite's
 * scans and the module's own guard are not simply blind. */
const REAL_CODE_SAMPLES: readonly string[] = [
  "```ts\nconst x = 1;\n```",
  "@@ -1,4 +1,6 @@",
  "--- a/packages/core/src/fixes/fix-spec.ts",
  "See packages/core/src/fixes/fix-spec.ts:42 for the offending branch.",
  "Change the retry limit to 5.",
  "Run the following: bun test.",
  "export function renderFixSpec() {}",
];

function markersTrippedBy(
  text: string,
  markers: readonly { readonly name: string; readonly pattern: RegExp }[],
): readonly string[] {
  return markers.filter((marker) => marker.pattern.test(text)).map((marker) => marker.name);
}

function jargonIn(text: string): readonly string[] {
  const lower = text.toLowerCase();
  const banned: readonly string[] = FORBIDDEN_PRODUCT_JARGON;
  return banned.filter((word) => lower.includes(word));
}

/** Every fixed string this module authors, plus every sentence a spec renders. The
 * union an audit has to cover for "total" to mean anything. */
function everyRenderedSentence(specs: readonly FixSpec[]): readonly string[] {
  return specs.flatMap((spec) => spec.sentences);
}

/** The specs the broad audits scan: both detectors, with and without signals, on an
 * ordinary surface and on one carrying a cohort noun. */
function auditCorpus(): readonly FixSpec[] {
  return [
    renderFixSpec({ candidate: funnelCandidate(), signals: [] }),
    renderFixSpec({
      candidate: funnelCandidate(),
      signals: oneSignalOfEveryKind(FUNNEL_SURFACE),
    }),
    renderFixSpec({ candidate: errorCandidate(), signals: [correlatedFailureSignal()] }),
    renderFixSpec({
      candidate: funnelCandidate(COHORT_NOUN_SURFACE),
      signals: [struggleSignal(COHORT_NOUN_SURFACE)],
    }),
    renderFixSpec({
      candidate: candidateOf({
        detector: "error_event",
        finalClass: "instrumentation",
        surface: ERROR_SURFACE,
        counts: [countOf(0, allSetAsideBasis(SET_ASIDE))],
        confidenceBasis: "below_threshold",
        coverage: { truncated: true, eventsWithoutUrlPath: 7 },
      }),
      signals: [],
    }),
  ];
}

describe("renderFixSpec — structured state as plain sentences", () => {
  // -- the shape

  test("should render every section non-empty for a finding with evidence", () => {
    const spec = renderFixSpec({
      candidate: funnelCandidate(),
      signals: oneSignalOfEveryKind(FUNNEL_SURFACE),
    });

    expect(spec.surface).toBe(FUNNEL_SURFACE);
    expect(spec.symptom.length).toBeGreaterThan(0);
    expect(spec.evidence.length).toBeGreaterThan(0);
    expect(spec.measurement.length).toBeGreaterThan(0);
    expect(spec.boundary.length).toBeGreaterThan(0);

    // `sentences` is derived, so a section cannot be added to the spec and quietly
    // omitted from the flattening an audit and a caller both read.
    expect(spec.sentences).toEqual([
      spec.symptom,
      ...spec.evidence,
      ...spec.measurement,
      ...spec.boundary,
    ]);

    // Every element is exactly one sentence.
    for (const sentence of spec.sentences) {
      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence).not.toContain(". ");
      expect(sentence.trim()).toBe(sentence);
    }
  });

  test("should parse its own output through fixSpecSchema", () => {
    const specs = auditCorpus();
    expect(specs.length).toBeGreaterThan(0);

    // The hand-written `FixSpec` type and the runtime schema are two statements of one
    // contract. This is what stops them drifting: a field added to the type but not the
    // schema renders unvalidated, and a field the schema requires that nothing produces
    // fails here.
    for (const spec of specs) {
      expect(() => fixSpecSchema.parse(spec)).not.toThrow();
    }
  });

  // -- counts and denominators

  test("should carry a denominator in the same sentence as every numerator it renders", () => {
    const spec = renderFixSpec({ candidate: funnelCandidate(), signals: [] });

    // Both magnitudes, in declared role order. The arrival count first, the departure
    // count second. Asserted with different numerators so a swap is visible.
    const reached = spec.measurement.find((sentence) => sentence.includes(`${String(REACHED)} of`));
    const left = spec.measurement.find((sentence) => sentence.includes(`${String(LEFT)} of`));
    expect(reached).toBeDefined();
    expect(left).toBeDefined();

    // Every rendered digit run that is not a date sits beside its denominator.
    for (const sentence of [reached, left]) {
      expect(sentence).toContain(`of ${String(REACHED)} sessions`);
    }

    // ...and the unit is sessions, never people. `MeasuredCount.unit` is the literal
    // `"sessions"` because identity stitching does not exist in this product, and the
    // rendered sentence must not enlarge the claim.
    expect(left).toContain("sessions");
    expect(describesPeople(left ?? "")).toBe(false);
  });

  test("should render the explicit no-rate sentence, never a percentage, when the denominator is zero", () => {
    const spec = renderFixSpec({
      candidate: candidateOf({
        detector: "error_event",
        finalClass: "broken",
        surface: ERROR_SURFACE,
        // : everything in the window was set aside, so `kept` (and the denominator)
        // is zero. A real, reportable state, not an error.
        counts: [countOf(0, allSetAsideBasis(SET_ASIDE))],
        confidenceBasis: "below_threshold",
        coverage: CLEAN_COVERAGE,
      }),
      signals: [],
    });

    const rendered = spec.sentences.join(" ");
    expect(rendered).toContain("set aside");

    // The three things a zero denominator must never become.
    expect(rendered).not.toContain("0%");
    expect(rendered).not.toContain("NaN");
    expect(rendered).not.toContain("Infinity");
    // ...and no percentage of any size, since none was computed.
    expect(rendered).not.toMatch(/\d\s*%/);

    // Non-vacuity: the spec is complete, not truncated to the no-rate line.
    expect(spec.symptom.length).toBeGreaterThan(0);
    expect(spec.boundary.length).toBeGreaterThan(0);
    expect(rendered).toContain(FIXTURE_WINDOW_START_DATE);
  });

  // -- the empty and repeated evidence cases

  test("should render a complete, honest spec when the finding carries no evidence signals", () => {
    const spec = renderFixSpec({ candidate: funnelCandidate(), signals: [] });

    // Not an empty section and not a crash: the honest sentence, then the counts the
    // spec still stands on.
    expect(spec.evidence).toEqual([FIX_SPEC_NO_EVIDENCE_TEMPLATE]);
    expect(spec.symptom.length).toBeGreaterThan(0);
    expect(spec.measurement.length).toBeGreaterThan(1);
    expect(spec.boundary.length).toBeGreaterThan(0);

    // The evidence limitation sentence qualifies evidence lines, so with none rendered
    // it must not appear. It would refer to nothing.
    expect(spec.boundary).not.toContain(FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE);

    // ...and the three unconditional boundary sentences are all present.
    for (const boundary of FIX_SPEC_BOUNDARY_TEMPLATES) {
      expect(spec.boundary).toContain(boundary);
    }
  });

  test("should emit one sentence per distinct observation when a finding repeats one signal kind", () => {
    const repeated = [
      struggleSignal(FUNNEL_SURFACE),
      struggleSignal(FUNNEL_SURFACE),
      struggleSignal(FUNNEL_SURFACE),
    ];
    const spec = renderFixSpec({ candidate: funnelCandidate(), signals: repeated });

    // multiplicity. Three signals, one observation. These sentences are qualitative and
    // carry no per-signal magnitude, so emitting the identical sentence three times
    // would state one observation as though it had been made three separate ways.
    expect(spec.evidence).toHaveLength(1);

    // Non-vacuity: a spec built from two different kinds really does render two.
    const mixed = renderFixSpec({
      candidate: funnelCandidate(),
      signals: [struggleSignal(FUNNEL_SURFACE), correlatedFailureSignal()],
    });
    expect(mixed.evidence).toHaveLength(2);
  });

  test("should have an evidence sentence for every member of the evidence signal union", () => {
    const kinds = evidenceSignalKindSchema.options;
    expect(kinds.length).toBeGreaterThan(0);

    // The table is `Record<EvidenceSignalKind, string>`, so a sixth kind added without
    // its sentence is a compile error. This is the other direction: a key here with no
    // member behind it in the union.
    expect(Object.keys(FIX_SPEC_EVIDENCE_TEMPLATES).toSorted()).toEqual([...kinds].toSorted());

    // ...and every one of them really renders, rather than merely existing.
    const spec = renderFixSpec({
      candidate: funnelCandidate(),
      signals: oneSignalOfEveryKind(FUNNEL_SURFACE),
    });
    expect(spec.evidence).toHaveLength(kinds.length);
  });

  // -- the people guard, and the customer's own URL

  test("should render a surface containing a cohort noun verbatim, never rewriting a customer's own page address", () => {
    // Non-vacuity, and the whole reason this test exists: the guard really does fire on
    // this value. `../../src/delivery/slack-message.ts` asserts the same thing as
    // intended behaviour, and a path is not a claim about people.
    expect(describesPeople(COHORT_NOUN_SURFACE)).toBe(true);
    const nouns: readonly string[] = COHORT_NOUNS;
    expect(nouns.some((noun) => COHORT_NOUN_SURFACE.includes(noun))).toBe(true);

    const spec = renderFixSpec({
      candidate: funnelCandidate(COHORT_NOUN_SURFACE),
      signals: [struggleSignal(COHORT_NOUN_SURFACE)],
    });

    // Verbatim, not redacted, not replaced with a placeholder, not dropped.
    expect(spec.surface).toBe(COHORT_NOUN_SURFACE);
    expect(spec.symptom).toContain(COHORT_NOUN_SURFACE);
    expect(spec.evidence.join(" ")).toContain(COHORT_NOUN_SURFACE);
    expect(spec.measurement.join(" ")).toContain(COHORT_NOUN_SURFACE);

    // ..and the spec still renders in full. A guard that fired on the path could only
    // respond by rewriting it, dropping the sentence, or refusing the spec. All three
    // worse than the thing prevented.
    expect(spec.sentences.length).toBeGreaterThan(5);
  });

  test("should never pair a count with a cohort noun in any rendered sentence", () => {
    const sentences = everyRenderedSentence(auditCorpus());
    expect(sentences.length).toBeGreaterThan(0);

    // A sentence carrying a numerator-and-denominator pair may not describe human
    // beings: identity stitching does not exist in this product, so "12 of 25" is 12 of
    // 25 sessions. The scan excises the surface first. The customer's own URL is not
    // our prose, and is exactly what must not be policed (the composed-input rule).
    const offenders: string[] = [];
    for (const spec of auditCorpus()) {
      for (const sentence of spec.sentences) {
        const prose = sentence.replaceAll(spec.surface, " ");
        if (/\d+\s+of\s+\d+/.test(prose) && describesPeople(prose)) offenders.push(sentence);
      }
    }
    expect(offenders).toEqual([]);

    // Non-vacuity: the scan really found count sentences to judge.
    const counted = sentences.filter((sentence) => /\d+\s+of\s+\d+/.test(sentence));
    expect(counted.length).toBeGreaterThan(0);
  });

  // -- no code

  test("should contain no code fence, no diff marker and no file-and-line reference in any rendered sentence", () => {
    const sentences = everyRenderedSentence(auditCorpus());

    // Non-vacuity, twice: there is a corpus, and the marker list is not empty.
    expect(sentences.length).toBeGreaterThan(0);
    expect(INDEPENDENT_CODE_MARKERS.length).toBeGreaterThan(0);

    // ...and the markers really fire on real code, so a clean report below is a fact
    // about the output rather than about a broken scan.
    for (const sample of REAL_CODE_SAMPLES) {
      expect(
        markersTrippedBy(sample, INDEPENDENT_CODE_MARKERS).length +
          markersTrippedBy(sample, INDEPENDENT_EDIT_PHRASES).length,
      ).toBeGreaterThan(0);
    }

    const offenders = sentences.flatMap((sentence) =>
      markersTrippedBy(sentence, INDEPENDENT_CODE_MARKERS).map(
        (marker) => `${marker} :: ${sentence}`,
      ),
    );

    // We dispatch a spec, not a patch. A fix spec carrying a diff is the product doing
    // the one thing it promised not to do, handed to an agent with write access to
    // somebody's repository.
    expect(offenders).toEqual([]);
  });

  test("should contain no instruction phrased as an edit in any fixed string or rendered sentence", () => {
    const corpus = [...FIX_SPEC_ALL_TEMPLATES, ...everyRenderedSentence(auditCorpus())];

    expect(FIX_SPEC_ALL_TEMPLATES.length).toBeGreaterThan(0);
    expect(corpus.length).toBeGreaterThan(FIX_SPEC_ALL_TEMPLATES.length);
    expect(INDEPENDENT_EDIT_PHRASES.length).toBeGreaterThan(0);

    // Proof the phrase list is not blind.
    expect(markersTrippedBy("Change the retry limit to 5.", INDEPENDENT_EDIT_PHRASES)).toEqual([
      "change X to Y",
    ]);
    expect(markersTrippedBy("You should update the handler.", INDEPENDENT_EDIT_PHRASES)).toEqual([
      "you should …",
    ]);

    const offenders = corpus.flatMap((text) =>
      markersTrippedBy(text, INDEPENDENT_EDIT_PHRASES).map((phrase) => `${phrase} :: ${text}`),
    );

    // The spec describes what is wrong and what the evidence is. What to change is the
    // agent's decision, and stating it here would be a claim nothing measured. This
    // module has never read a line of the customer's source.
    expect(offenders).toEqual([]);
  });

  test("should refuse to render a template that reads as code rather than shipping it", () => {
    // The module's own guard, proved to fire before it is trusted to report clean. A
    // guard checked only against the strings it passes is a mirror.
    expect(CODE_SHAPED_MARKERS.length).toBeGreaterThan(0);
    for (const sample of REAL_CODE_SAMPLES) {
      expect(isCodeShaped(sample)).toBe(true);
    }

    // ...and it passes every fixed string this module actually ships, so the strictness
    // above is not achieved by refusing everything.
    for (const template of FIX_SPEC_ALL_TEMPLATES) {
      expect(isCodeShaped(template)).toBe(false);
    }

    // No marker carries the `g` flag: a global pattern is stateful across `.test`
    // calls, so the same template would match on one render and not the next. A
    // determinism bug inside the guard that exists to make the output deterministic.
    for (const marker of CODE_SHAPED_MARKERS) {
      expect(marker.pattern.global).toBe(false);
    }
  });

  // -- the plain-English audit

  test("should contain no product jargon in any fixed string or rendered sentence", () => {
    const corpus = [...FIX_SPEC_ALL_TEMPLATES, ...everyRenderedSentence(auditCorpus())];
    expect(corpus.length).toBeGreaterThan(0);

    const offenders = corpus.flatMap((text) => jargonIn(text).map((word) => `${word} :: ${text}`));
    expect(offenders).toEqual([]);

    // The banned list is the prd's, in full. Imported rather than restated, so a word
    // added to `FORBIDDEN_PRODUCT_JARGON` tightens this scan for free and a shortened
    // copy cannot make it pass by scanning for less.
    const banned: readonly string[] = FORBIDDEN_PRODUCT_JARGON;
    expect(banned.toSorted()).toEqual([
      "candidate",
      "dedup",
      "hash",
      "ledger",
      "policy",
      "signature",
      "suppression",
    ]);

    // Non-vacuity: the scanner really finds jargon when it is there.
    expect(jargonIn("This finding was dropped by the suppression policy.")).toEqual([
      "suppression",
      "policy",
    ]);
  });

  // -- determinism

  test("should render byte-identically for the same input twice and for two structurally identical inputs", () => {
    //  the same object graph, twice. Catches a renderer that mutates its input,
    // memoises across calls, or lets an accumulator survive.
    const shared = { candidate: funnelCandidate(), signals: oneSignalOfEveryKind(FUNNEL_SURFACE) };
    const first = JSON.stringify(renderFixSpec(shared));
    const second = JSON.stringify(renderFixSpec(shared));

    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);

    //  two distinct but structurally identical graphs. The half that would catch a
    // clock, a random source, an id counter, or an iteration order derived from object
    // identity. None of those can hide in.
    const rebuilt = JSON.stringify(
      renderFixSpec({
        candidate: funnelCandidate(),
        signals: oneSignalOfEveryKind(FUNNEL_SURFACE),
      }),
    );
    expect(rebuilt).toBe(first);

    // The window is rendered from the finding's own timeframe, so no clock is read and
    // these are the only two dates any rendered string may contain.
    const spec = renderFixSpec(shared);
    expect(spec.measurement.join(" ")).toContain(FIXTURE_WINDOW_START_DATE);
    expect(spec.measurement.join(" ")).toContain(FIXTURE_WINDOW_END_DATE);
  });

  // -- coverage, and the refusals

  test("should state what the run could not see when the read was truncated", () => {
    const spec = renderFixSpec({
      candidate: candidateOf({
        detector: "funnel_dropoff",
        finalClass: "confusing",
        surface: FUNNEL_SURFACE,
        counts: [countOf(REACHED, keptBasis(REACHED)), countOf(LEFT, keptBasis(REACHED))],
        confidenceBasis: "threshold_met",
        coverage: { truncated: true, eventsWithoutUrlPath: 7 },
      }),
      signals: [],
    });

    // A limitation carried onto every finding may never be silently dropped. A spec
    // that hid a truncated read would hand an agent a floor while presenting it as a
    // total.
    expect(spec.boundary).toContain(FIX_SPEC_COVERAGE_TEMPLATES.truncated);
    expect(spec.boundary).toContain(FIX_SPEC_COVERAGE_TEMPLATES.eventsWithoutUrlPath);

    // ...and a clean run says neither, rather than saying "nothing was missed" in words
    // nobody asked for.
    const clean = renderFixSpec({ candidate: funnelCandidate(), signals: [] });
    expect(clean.boundary).not.toContain(FIX_SPEC_COVERAGE_TEMPLATES.truncated);
    expect(clean.boundary).not.toContain(FIX_SPEC_COVERAGE_TEMPLATES.eventsWithoutUrlPath);

    // The bare `eventsWithoutUrlPath` number never reaches the reader: it is a count
    // with no denominator, and a bare number in front of a reader is the one thing
    // `MeasuredCount` exists to prevent.
    expect(spec.boundary.join(" ")).not.toContain("7");
  });

  test("should refuse a surface that is not already in its normalised form, naming no input value", () => {
    const raw = "/T1FX/Pricing?utm_source=leak";
    const candidate = {
      ...funnelCandidate(),
      surface: raw,
    };

    // Fail direction: Refuse. `candidateFindingSchema.surface` accepts any non-empty
    // string, so the contract alone does not prove the redaction ran, and a fix spec is
    // handed to an agent that may log it.
    expect(() => renderFixSpec({ candidate, signals: [] })).toThrow(
      /fix_spec_surface_not_normalised/,
    );

    // The refusal names only the normalised form. Naming the input would put the very
    // query string this check exists to stop into a log line.
    try {
      renderFixSpec({ candidate, signals: [] });
      throw new Error("expected a refusal");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("utm_source");
      expect(message).not.toContain(raw);
    }
  });

  test("should refuse a finding whose counts do not match its detector's declared roles", () => {
    // An error finding declares one count; this one carries two. Refusing is the safe
    // direction: truncating drops a magnitude silently, padding invents one, and either
    // puts a number that means something else in front of an agent about to change
    // somebody's product.
    const candidate = {
      ...errorCandidate(),
      counts: [countOf(AFFECTED, keptBasis(REACHED)), countOf(LEFT, keptBasis(REACHED))],
    };

    expect(() => renderFixSpec({ candidate, signals: [] })).toThrow(/one count per declared role/);
  });

  test("should refuse a finding that does not satisfy the input contract, before rendering anything", () => {
    // The boundary comes first, so a caller cannot skip it by passing an already-typed
    // value. `evidenceShapeVersion` is `z.number.int.positive` on the contract
    // and the type says only `number`, so this is a shape the compiler accepts and the
    // schema must refuse. Exactly the gap a parse at the door exists to close.
    const candidate: CandidateFinding = { ...funnelCandidate(), evidenceShapeVersion: 0 };

    expect(() => renderFixSpec({ candidate, signals: [] })).toThrow();

    // ...and nothing was rendered on the way to the refusal: the parse is the first
    // statement in the function, before the surface check, before the count resolution,
    // and before any template is read.
    expect(() => renderFixSpec({ candidate: funnelCandidate(), signals: [] })).not.toThrow();
  });
});
