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

const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

const FIXTURE_WINDOW_START_DATE = "2026-06-01";
const FIXTURE_WINDOW_END_DATE = "2026-06-08";

const FUNNEL_SURFACE = "/t1fx/pricing";
const ERROR_SURFACE = "/t1fx/settings";

const COHORT_NOUN_SURFACE = "/users/profile";

const REACHED = 25;
const LEFT = 12;
const AFFECTED = 4;
const SET_ASIDE = 3;

const CLEAN_COVERAGE: DetectorCoverage = { truncated: false, eventsWithoutUrlPath: 0 };

function keptBasis(kept: number): CountBasis {
  return { totalInWindow: kept, kept, setAside: [] };
}

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

const INDEPENDENT_EDIT_PHRASES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "change X to Y", pattern: /\bchange\s+(?:[^\s,.]+\s+){1,4}to\b/i },
  { name: "replace X with Y", pattern: /\breplace\s+(?:[^\s,.]+\s+){1,4}with\b/i },
  { name: "add X to Y", pattern: /\badd\s+(?:[^\s,.]+\s+){1,4}to\b/i },
  { name: "remove X from Y", pattern: /\bremove\s+(?:[^\s,.]+\s+){1,4}from\b/i },
  { name: "you should …", pattern: /\byou\s+(?:should|must|need to|can)\b/i },
  { name: "apply the following", pattern: /\b(?:apply|run|paste|copy)\s+the\s+following\b/i },
  { name: "the fix is", pattern: /\bthe\s+fix\s+is\b/i },
];

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

function everyRenderedSentence(specs: readonly FixSpec[]): readonly string[] {
  return specs.flatMap((spec) => spec.sentences);
}

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

    expect(spec.sentences).toEqual([
      spec.symptom,
      ...spec.evidence,
      ...spec.measurement,
      ...spec.boundary,
    ]);

    for (const sentence of spec.sentences) {
      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence).not.toContain(". ");
      expect(sentence.trim()).toBe(sentence);
    }
  });

  test("should parse its own output through fixSpecSchema", () => {
    const specs = auditCorpus();
    expect(specs.length).toBeGreaterThan(0);

    for (const spec of specs) {
      expect(() => fixSpecSchema.parse(spec)).not.toThrow();
    }
  });

  test("should carry a denominator in the same sentence as every numerator it renders", () => {
    const spec = renderFixSpec({ candidate: funnelCandidate(), signals: [] });

    const reached = spec.measurement.find((sentence) => sentence.includes(`${String(REACHED)} of`));
    const left = spec.measurement.find((sentence) => sentence.includes(`${String(LEFT)} of`));
    expect(reached).toBeDefined();
    expect(left).toBeDefined();

    for (const sentence of [reached, left]) {
      expect(sentence).toContain(`of ${String(REACHED)} sessions`);
    }

    expect(left).toContain("sessions");
    expect(describesPeople(left ?? "")).toBe(false);
  });

  test("should render the explicit no-rate sentence, never a percentage, when the denominator is zero", () => {
    const spec = renderFixSpec({
      candidate: candidateOf({
        detector: "error_event",
        finalClass: "broken",
        surface: ERROR_SURFACE,

        counts: [countOf(0, allSetAsideBasis(SET_ASIDE))],
        confidenceBasis: "below_threshold",
        coverage: CLEAN_COVERAGE,
      }),
      signals: [],
    });

    const rendered = spec.sentences.join(" ");
    expect(rendered).toContain("set aside");

    expect(rendered).not.toContain("0%");
    expect(rendered).not.toContain("NaN");
    expect(rendered).not.toContain("Infinity");

    expect(rendered).not.toMatch(/\d\s*%/);

    expect(spec.symptom.length).toBeGreaterThan(0);
    expect(spec.boundary.length).toBeGreaterThan(0);
    expect(rendered).toContain(FIXTURE_WINDOW_START_DATE);
  });

  test("should render a complete, honest spec when the finding carries no evidence signals", () => {
    const spec = renderFixSpec({ candidate: funnelCandidate(), signals: [] });

    expect(spec.evidence).toEqual([FIX_SPEC_NO_EVIDENCE_TEMPLATE]);
    expect(spec.symptom.length).toBeGreaterThan(0);
    expect(spec.measurement.length).toBeGreaterThan(1);
    expect(spec.boundary.length).toBeGreaterThan(0);

    expect(spec.boundary).not.toContain(FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE);

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

    expect(spec.evidence).toHaveLength(1);

    const mixed = renderFixSpec({
      candidate: funnelCandidate(),
      signals: [struggleSignal(FUNNEL_SURFACE), correlatedFailureSignal()],
    });
    expect(mixed.evidence).toHaveLength(2);
  });

  test("should have an evidence sentence for every member of the evidence signal union", () => {
    const kinds = evidenceSignalKindSchema.options;
    expect(kinds.length).toBeGreaterThan(0);

    expect(Object.keys(FIX_SPEC_EVIDENCE_TEMPLATES).toSorted()).toEqual([...kinds].toSorted());

    const spec = renderFixSpec({
      candidate: funnelCandidate(),
      signals: oneSignalOfEveryKind(FUNNEL_SURFACE),
    });
    expect(spec.evidence).toHaveLength(kinds.length);
  });

  test("should render a surface containing a cohort noun verbatim, never rewriting a customer's own page address", () => {
    expect(describesPeople(COHORT_NOUN_SURFACE)).toBe(true);
    const nouns: readonly string[] = COHORT_NOUNS;
    expect(nouns.some((noun) => COHORT_NOUN_SURFACE.includes(noun))).toBe(true);

    const spec = renderFixSpec({
      candidate: funnelCandidate(COHORT_NOUN_SURFACE),
      signals: [struggleSignal(COHORT_NOUN_SURFACE)],
    });

    expect(spec.surface).toBe(COHORT_NOUN_SURFACE);
    expect(spec.symptom).toContain(COHORT_NOUN_SURFACE);
    expect(spec.evidence.join(" ")).toContain(COHORT_NOUN_SURFACE);
    expect(spec.measurement.join(" ")).toContain(COHORT_NOUN_SURFACE);

    expect(spec.sentences.length).toBeGreaterThan(5);
  });

  test("should never pair a count with a cohort noun in any rendered sentence", () => {
    const sentences = everyRenderedSentence(auditCorpus());
    expect(sentences.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const spec of auditCorpus()) {
      for (const sentence of spec.sentences) {
        const prose = sentence.replaceAll(spec.surface, " ");
        if (/\d+\s+of\s+\d+/.test(prose) && describesPeople(prose)) offenders.push(sentence);
      }
    }
    expect(offenders).toEqual([]);

    const counted = sentences.filter((sentence) => /\d+\s+of\s+\d+/.test(sentence));
    expect(counted.length).toBeGreaterThan(0);
  });

  test("should contain no code fence, no diff marker and no file-and-line reference in any rendered sentence", () => {
    const sentences = everyRenderedSentence(auditCorpus());

    expect(sentences.length).toBeGreaterThan(0);
    expect(INDEPENDENT_CODE_MARKERS.length).toBeGreaterThan(0);

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

    expect(offenders).toEqual([]);
  });

  test("should contain no instruction phrased as an edit in any fixed string or rendered sentence", () => {
    const corpus = [...FIX_SPEC_ALL_TEMPLATES, ...everyRenderedSentence(auditCorpus())];

    expect(FIX_SPEC_ALL_TEMPLATES.length).toBeGreaterThan(0);
    expect(corpus.length).toBeGreaterThan(FIX_SPEC_ALL_TEMPLATES.length);
    expect(INDEPENDENT_EDIT_PHRASES.length).toBeGreaterThan(0);

    expect(markersTrippedBy("Change the retry limit to 5.", INDEPENDENT_EDIT_PHRASES)).toEqual([
      "change X to Y",
    ]);
    expect(markersTrippedBy("You should update the handler.", INDEPENDENT_EDIT_PHRASES)).toEqual([
      "you should …",
    ]);

    const offenders = corpus.flatMap((text) =>
      markersTrippedBy(text, INDEPENDENT_EDIT_PHRASES).map((phrase) => `${phrase} :: ${text}`),
    );

    expect(offenders).toEqual([]);
  });

  test("should refuse to render a template that reads as code rather than shipping it", () => {
    expect(CODE_SHAPED_MARKERS.length).toBeGreaterThan(0);
    for (const sample of REAL_CODE_SAMPLES) {
      expect(isCodeShaped(sample)).toBe(true);
    }

    for (const template of FIX_SPEC_ALL_TEMPLATES) {
      expect(isCodeShaped(template)).toBe(false);
    }

    for (const marker of CODE_SHAPED_MARKERS) {
      expect(marker.pattern.global).toBe(false);
    }
  });

  test("should contain no product jargon in any fixed string or rendered sentence", () => {
    const corpus = [...FIX_SPEC_ALL_TEMPLATES, ...everyRenderedSentence(auditCorpus())];
    expect(corpus.length).toBeGreaterThan(0);

    const offenders = corpus.flatMap((text) => jargonIn(text).map((word) => `${word} :: ${text}`));
    expect(offenders).toEqual([]);

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

    expect(jargonIn("This finding was dropped by the suppression policy.")).toEqual([
      "suppression",
      "policy",
    ]);
  });

  test("should render byte-identically for the same input twice and for two structurally identical inputs", () => {
    const shared = { candidate: funnelCandidate(), signals: oneSignalOfEveryKind(FUNNEL_SURFACE) };
    const first = JSON.stringify(renderFixSpec(shared));
    const second = JSON.stringify(renderFixSpec(shared));

    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);

    const rebuilt = JSON.stringify(
      renderFixSpec({
        candidate: funnelCandidate(),
        signals: oneSignalOfEveryKind(FUNNEL_SURFACE),
      }),
    );
    expect(rebuilt).toBe(first);

    const spec = renderFixSpec(shared);
    expect(spec.measurement.join(" ")).toContain(FIXTURE_WINDOW_START_DATE);
    expect(spec.measurement.join(" ")).toContain(FIXTURE_WINDOW_END_DATE);
  });

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

    expect(spec.boundary).toContain(FIX_SPEC_COVERAGE_TEMPLATES.truncated);
    expect(spec.boundary).toContain(FIX_SPEC_COVERAGE_TEMPLATES.eventsWithoutUrlPath);

    const clean = renderFixSpec({ candidate: funnelCandidate(), signals: [] });
    expect(clean.boundary).not.toContain(FIX_SPEC_COVERAGE_TEMPLATES.truncated);
    expect(clean.boundary).not.toContain(FIX_SPEC_COVERAGE_TEMPLATES.eventsWithoutUrlPath);

    expect(spec.boundary.join(" ")).not.toContain("7");
  });

  test("should refuse a surface that is not already in its normalised form, naming no input value", () => {
    const raw = "/T1FX/Pricing?utm_source=leak";
    const candidate = {
      ...funnelCandidate(),
      surface: raw,
    };

    expect(() => renderFixSpec({ candidate, signals: [] })).toThrow(
      /fix_spec_surface_not_normalised/,
    );

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
    const candidate = {
      ...errorCandidate(),
      counts: [countOf(AFFECTED, keptBasis(REACHED)), countOf(LEFT, keptBasis(REACHED))],
    };

    expect(() => renderFixSpec({ candidate, signals: [] })).toThrow(/one count per declared role/);
  });

  test("should refuse a finding that does not satisfy the input contract, before rendering anything", () => {
    const candidate: CandidateFinding = { ...funnelCandidate(), evidenceShapeVersion: 0 };

    expect(() => renderFixSpec({ candidate, signals: [] })).toThrow();

    expect(() => renderFixSpec({ candidate: funnelCandidate(), signals: [] })).not.toThrow();
  });
});
