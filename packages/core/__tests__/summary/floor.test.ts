import type { ConnectionState } from "@growthmind/shared";
import {
  FLOOR_CONFIDENCE_TEMPLATES,
  FLOOR_COUNT_TEMPLATES,
  FLOOR_NO_RATE_TEMPLATE,
  FLOOR_OBSERVATION_TEMPLATES,
  FLOOR_TIMEFRAME_TEMPLATE,
  SUMMARY_SOURCE_MESSAGES,
  isNormalisedUrlPath,
} from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { MeasuredCount } from "../../src/counts/measured-count";
import { measuredCount } from "../../src/counts/measured-count";
import { detectErrorEvent } from "../../src/detect/error-event";
import { detectFunnelDropoff } from "../../src/detect/funnel-dropoff";
import type {
  AnalysisWindow,
  DetectorCandidate,
  DetectorCorpus,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";
import { reviewFindingText } from "../../src/delivery/finding-text";
import { traceEntry } from "../../src/evidence/trace";
import type { CandidateFinding, ConfidenceBasis } from "../../src/findings/candidate";
import { candidateFindingSchema, confidenceBasisSchema } from "../../src/findings/candidate";
import { EVIDENCE_SHAPE_VERSION } from "../../src/findings/evidence-shape";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { FindingClass, ThresholdRuleSet } from "../../src/rules/types";
import { findingClassSchema } from "../../src/rules/types";
import type { CountRole } from "../../src/summary/count-roles";
import { COUNT_ROLES } from "../../src/summary/count-roles";
import { renderFloorSummary, renderWithheldFloorSummary } from "../../src/summary/floor";
import type { FloorSummary, FloorSummarySource } from "../../src/summary/types";

const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

const FIXTURE_WINDOW_START_DATE = "2026-06-01";
const FIXTURE_WINDOW_END_DATE = "2026-06-08";

const FIXTURE_PROJECT_ID = "t1fl-project";
const FIXTURE_NORMALISATION_VERSION = 1;
const FIXTURE_EVIDENCE_SHAPE = "t1fl-evidence-shape";

const EVENT_STRIDE_MS = 1_000;
const SESSION_STRIDE_MS = 60_000;
const PERCENT_SCALE = 100;

const FUNNEL_HEADROOM_SESSIONS = 10;
const FUNNEL_RATE_HEADROOM_SESSIONS = 1;
const ERROR_HEADROOM_SESSIONS = 2;

const FUNNEL_ORIGIN = "/t1fl/pricing";
const FUNNEL_DESTINATION = "/t1fl/checkout";
const FUNNEL_EVENT_NAME = "t1fl_step_viewed";

const ERROR_SURFACE = "/t1fl/settings";
const ERROR_ACTION = "t1fl_save_clicked";

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

const FIXTURE_CONNECTION_STATE: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "t1fl-connection",
    organizationId: "t1fl-org",
    projectId: FIXTURE_PROJECT_ID,
    sourceKind: "posthog",
    host: "https://t1fl.example.invalid",
    sourceProjectId: "t1fl-source-project",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: FIXTURE_WINDOW.end,
    watermarkAt: FIXTURE_WINDOW.end,
    backfillBefore: null,
    pollIntervalSeconds: 60,
    connectedAt: FIXTURE_WINDOW.start,
    inferredInternalDomain: null,
    internalDomainProvenance: null,
  },
};

function corpusOf(sessions: readonly SessionTimeline[]): DetectorCorpus {
  return {
    projectId: FIXTURE_PROJECT_ID,
    window: FIXTURE_WINDOW,
    connectionState: FIXTURE_CONNECTION_STATE,
    sessions,
    basis: { totalInWindow: sessions.length, kept: sessions.length, setAside: [] },
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

function sessionStartedAt(index: number): Date {
  return new Date(FIXTURE_WINDOW.start.getTime() + index * SESSION_STRIDE_MS);
}

function funnelSession(index: number, paths: readonly string[]): SessionTimeline {
  const sessionId = `t1fl-funnel-${String(index).padStart(3, "0")}`;
  const startedAt = sessionStartedAt(index);
  const events: readonly TimelineEvent[] = paths.map((urlPath, step) => ({
    sourceEventId: `${sessionId}-e${String(step)}`,
    name: FUNNEL_EVENT_NAME,
    occurredAt: new Date(startedAt.getTime() + step * EVENT_STRIDE_MS),
    urlPath,
    urlPathNormalisationVersion: FIXTURE_NORMALISATION_VERSION,
  }));

  return {
    sessionId,
    startedAt,
    exclusionReason: "none",
    entryUrlPath: paths[0] ?? null,
    events,
  };
}

function firingFunnelCorpus(ruleSet: ThresholdRuleSet): DetectorCorpus {
  const atOrigin = ruleSet.funnelMinSessionsAtOrigin + FUNNEL_HEADROOM_SESSIONS;
  const dropped = Math.max(
    ruleSet.funnelMinDropoffSessions,
    Math.ceil((ruleSet.funnelDropoffRateThresholdPercent * atOrigin) / PERCENT_SCALE) +
      FUNNEL_RATE_HEADROOM_SESSIONS,
  );
  const continued = atOrigin - dropped;

  const sessions: SessionTimeline[] = [];
  for (let index = 0; index < continued; index += 1) {
    sessions.push(funnelSession(index, [FUNNEL_ORIGIN, FUNNEL_DESTINATION]));
  }
  for (let index = 0; index < dropped; index += 1) {
    sessions.push(funnelSession(continued + index, [FUNNEL_ORIGIN]));
  }

  return corpusOf(sessions);
}

function errorSession(index: number, ruleSet: ThresholdRuleSet): SessionTimeline {
  const sessionId = `t1fl-error-${String(index).padStart(3, "0")}`;
  const startedAt = sessionStartedAt(index);
  const gapMs = Math.floor(ruleSet.errorCorrelationWindowMs / 2);
  const exceptionAt = new Date(startedAt.getTime() + ruleSet.errorCorrelationWindowMs);
  const actionAt = new Date(exceptionAt.getTime() - gapMs);

  const events: readonly TimelineEvent[] = [
    {
      sourceEventId: `${sessionId}-action`,
      name: ERROR_ACTION,
      occurredAt: actionAt,
      urlPath: ERROR_SURFACE,
      urlPathNormalisationVersion: FIXTURE_NORMALISATION_VERSION,
    },
    {
      sourceEventId: `${sessionId}-exception`,
      name: ruleSet.exceptionEventName,
      occurredAt: exceptionAt,
      urlPath: ERROR_SURFACE,
      urlPathNormalisationVersion: FIXTURE_NORMALISATION_VERSION,
    },
  ];

  return {
    sessionId,
    startedAt,
    exclusionReason: "none",
    entryUrlPath: ERROR_SURFACE,
    events,
  };
}

function firingErrorCorpus(ruleSet: ThresholdRuleSet): DetectorCorpus {
  const affected = ruleSet.errorMinAffectedSessions + ERROR_HEADROOM_SESSIONS;
  const sessions: SessionTimeline[] = [];
  for (let index = 0; index < affected; index += 1) {
    sessions.push(errorSession(index, ruleSet));
  }
  return corpusOf(sessions);
}

function firstCandidateOf(result: DetectorResult): DetectorCandidate {
  const candidate = result.candidates[0];
  if (!candidate) {
    throw new Error(`the ${result.detector} fixture corpus produced no candidate to render`);
  }
  return candidate;
}

function funnelDetectorCandidate(ruleSet: ThresholdRuleSet): DetectorCandidate {
  return firstCandidateOf(detectFunnelDropoff(firingFunnelCorpus(ruleSet), ruleSet));
}

function errorDetectorCandidate(ruleSet: ThresholdRuleSet): DetectorCandidate {
  return firstCandidateOf(detectErrorEvent(firingErrorCorpus(ruleSet), ruleSet));
}

function candidateFindingFrom(input: {
  readonly source: DetectorCandidate;
  readonly ruleSet: ThresholdRuleSet;
  readonly finalClass?: FindingClass;
  readonly trace?: CandidateFinding["trace"];
  readonly counts?: readonly MeasuredCount[];
  readonly surface?: string;
  readonly confidenceBasis?: ConfidenceBasis;
}): CandidateFinding {
  const { source, ruleSet } = input;
  const counts = input.counts ?? source.counts;
  const sampleSize = source.counts[0];
  if (!sampleSize) throw new Error("a detector candidate must carry at least one count");

  return candidateFindingSchema.parse({
    detector: source.detector,
    claimedClass: source.claimedClass,
    finalClass: input.finalClass ?? source.claimedClass,
    trace: input.trace ?? [
      traceEntry({
        class: source.claimedClass,
        predicate: "t1fl-fixture-predicate",
        predicateVersion: 1,
        satisfied: true,
      }),
    ],
    counts,
    timeframe: source.timeframe,
    claimSubject: source.claimSubject,
    surface: input.surface ?? source.surface,
    surfaceNormalisationVersion: source.surfaceNormalisationVersion,
    evidenceShape: FIXTURE_EVIDENCE_SHAPE,
    evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
    thresholdRuleSetVersion: ruleSet.version,
    ranking: { sampleSize, confidenceBasis: input.confidenceBasis ?? "threshold_met" },
    coverage: source.coverage,
  });
}

function funnelCandidate(ruleSet: ThresholdRuleSet): CandidateFinding {
  return candidateFindingFrom({ source: funnelDetectorCandidate(ruleSet), ruleSet });
}

function errorCandidate(ruleSet: ThresholdRuleSet): CandidateFinding {
  return candidateFindingFrom({ source: errorDetectorCandidate(ruleSet), ruleSet });
}

const DEFAULT_SOURCE: FloorSummarySource = "floor_no_key_configured";

function render(candidate: CandidateFinding, source: FloorSummarySource = DEFAULT_SOURCE) {
  return renderFloorSummary({ candidate, source });
}

function elementsOf(summary: FloorSummary): readonly string[] {
  return [summary.headline, ...summary.context];
}

function renderedText(summary: FloorSummary): string {
  return elementsOf(summary).join(" ");
}

function digitsIn(text: string): readonly string[] {
  return text.match(/\d+/g) ?? [];
}

function pathsIn(text: string): readonly string[] {
  return text.match(/\/[A-Za-z0-9\-_]+(?:\/[A-Za-z0-9\-_]+)*/g) ?? [];
}

function templatePattern(template: string): RegExp {
  const escaped = template.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`^${escaped.replaceAll(/\\\{[a-zA-Z]+\\\}/g, ".+")}$`);
}

const ALL_FLOOR_TEMPLATES: readonly string[] = [
  ...Object.values(FLOOR_OBSERVATION_TEMPLATES),
  ...Object.values(FLOOR_COUNT_TEMPLATES),
  ...Object.values(FLOOR_CONFIDENCE_TEMPLATES),
  FLOOR_TIMEFRAME_TEMPLATE,
  FLOOR_NO_RATE_TEMPLATE,
  ...Object.values(SUMMARY_SOURCE_MESSAGES),
].flatMap((template) => {
  const parts = template.split(". ");
  return parts.map((part, index) => (index === parts.length - 1 ? part : `${part}.`));
});

const FLOOR_TEMPLATE_PATTERNS: readonly RegExp[] = ALL_FLOOR_TEMPLATES.map(templatePattern);

const DECLARED_COUNT_ROLES: readonly CountRole[] = [...new Set(Object.values(COUNT_ROLES).flat())];

describe("renderFloorSummary", () => {
  test("renderFloorSummary produces a summary with no model and no API key present", () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();

      const summary = render(funnelCandidate(ruleSetV1()));

      expect(summary.headline.length).toBeGreaterThan(0);
      expect(summary.context.length).toBeGreaterThan(0);
      for (const element of elementsOf(summary)) {
        expect(element.trim().length).toBeGreaterThan(0);
      }
    } finally {
      if (previousKey !== undefined) process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });

  test("renderFloorSummary names the class the gate concluded and never the class the detector claimed", () => {
    const ruleSet = ruleSetV1();

    const candidate = candidateFindingFrom({
      source: errorDetectorCandidate(ruleSet),
      ruleSet,
      finalClass: "confusing",
    });

    expect(candidate.claimedClass).toBe("broken");
    expect(candidate.finalClass).toBe("confusing");

    const summary = render(candidate);

    expect(summary.headline).toBe(
      FLOOR_OBSERVATION_TEMPLATES.confusing.replace("{surface}", candidate.surface),
    );

    const brokenWithoutToken = FLOOR_OBSERVATION_TEMPLATES.broken.replace("{surface}", "");
    const brokenTail = brokenWithoutToken.slice(brokenWithoutToken.indexOf(" is ")).trim();
    expect(brokenTail.length).toBeGreaterThan(0);
    expect(renderedText(summary)).not.toContain(brokenTail);
  });

  test("renderFloorSummary reads finalClass and never recomputes a class from the trace", () => {
    const ruleSet = ruleSetV1();

    const candidate = candidateFindingFrom({
      source: errorDetectorCandidate(ruleSet),
      ruleSet,
      finalClass: "confusing",
      trace: [
        traceEntry({
          class: "confusing",
          predicate: "t1fl-fixture-predicate",
          predicateVersion: 1,
          satisfied: false,
        }),
        traceEntry({
          class: "broken",
          predicate: "t1fl-fixture-predicate",
          predicateVersion: 1,
          satisfied: true,
        }),
      ],
    });

    const summary = render(candidate);

    expect(summary.headline).toBe(
      FLOOR_OBSERVATION_TEMPLATES.confusing.replace("{surface}", candidate.surface),
    );
  });

  test("renderFloorSummary renders the confidence basis as words and never as a number", () => {
    const ruleSet = ruleSetV1();

    for (const basis of confidenceBasisSchema.options) {
      const candidate = candidateFindingFrom({
        source: funnelDetectorCandidate(ruleSet),
        ruleSet,
        confidenceBasis: basis,
      });
      const summary = render(candidate);
      const sentence = FLOOR_CONFIDENCE_TEMPLATES[basis];

      expect(summary.context).toContain(sentence);
      expect(digitsIn(sentence)).toHaveLength(0);
    }
  });

  test("renderFloorSummary renders every count with its denominator in the same sentence", () => {
    const ruleSet = ruleSetV1();
    const candidate = funnelCandidate(ruleSet);
    const summary = render(candidate);

    expect(candidate.counts.length).toBeGreaterThan(0);

    for (const count of candidate.counts) {
      const carrying = summary.context.filter((sentence) =>
        digitsIn(sentence).includes(String(count.numerator)),
      );
      expect(carrying.length).toBeGreaterThan(0);
      for (const sentence of carrying) {
        expect(digitsIn(sentence)).toContain(String(count.denominator));
      }
    }
  });

  test("renderFloorSummary names only the candidate's own surface", () => {
    const ruleSet = ruleSetV1();
    const candidate = funnelCandidate(ruleSet);
    const summary = render(candidate);

    const paths = pathsIn(renderedText(summary));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path).toBe(candidate.surface);
    }

    expect(renderedText(summary)).not.toContain(FUNNEL_DESTINATION);
  });

  test("renderFloorSummary states the candidate's own timeframe and no relative-time phrase", () => {
    const summary = render(funnelCandidate(ruleSetV1()));
    const text = renderedText(summary);

    expect(summary.context).toContain(
      FLOOR_TIMEFRAME_TEMPLATE.replace("{windowStart}", FIXTURE_WINDOW_START_DATE).replace(
        "{windowEnd}",
        FIXTURE_WINDOW_END_DATE,
      ),
    );

    for (const phrase of [
      "recently",
      "today",
      "this week",
      "yesterday",
      "last week",
      "last 7 days",
      "in the last",
      "so far",
      "right now",
    ]) {
      expect(text.toLowerCase()).not.toContain(phrase);
    }
  });

  test("renderFloorSummary states no next step", () => {
    const ruleSet = ruleSetV1();
    const text = [
      renderedText(render(funnelCandidate(ruleSet))),
      renderedText(render(errorCandidate(ruleSet))),
    ]
      .join(" ")
      .toLowerCase();

    for (const phrase of [
      "you should",
      "we recommend",
      "recommend",
      "try ",
      "consider ",
      "fix ",
      "next step",
      "take a look",
      "click here",
      "investigate",
    ]) {
      expect(text).not.toContain(phrase);
    }
  });

  test("renderFloorSummary names no visit-ordering semantics in the drop sentence", () => {
    const dropSentence = FLOOR_COUNT_TEMPLATES.left_without_continuing.toLowerCase();

    for (const phrase of ["first", "last", "initial", "final", "again", "returned", "revisit"]) {
      expect(dropSentence).not.toContain(phrase);
    }
  });

  test("renderFloorSummary states an explicit no-rate when every session in the window was set aside", () => {
    const ruleSet = ruleSetV1();
    const source = funnelDetectorCandidate(ruleSet);
    const setAsideTotal = source.counts[0]?.basis.totalInWindow ?? 0;
    expect(setAsideTotal).toBeGreaterThan(0);

    const emptied = measuredCount({
      numerator: 0,
      denominator: 0,
      unit: "sessions",
      timeframe: FIXTURE_WINDOW,
      basis: {
        totalInWindow: setAsideTotal,
        kept: 0,
        setAside: [{ reason: "internal_domain", count: setAsideTotal, label: "internal traffic" }],
      },
    });

    const candidate = candidateFindingFrom({
      source,
      ruleSet,
      counts: [emptied, emptied],
    });
    const summary = render(candidate);

    expect(summary.context).toContain(FLOOR_NO_RATE_TEMPLATE);

    expect(summary.context.filter((sentence) => sentence === FLOOR_NO_RATE_TEMPLATE)).toHaveLength(
      1,
    );

    const text = renderedText(summary);
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("undefined");
  });

  test("renderFloorSummary refuses a candidate it cannot render rather than emitting a partial sentence", () => {
    const ruleSet = ruleSetV1();
    const source = funnelDetectorCandidate(ruleSet);
    const only = source.counts[0];
    if (!only) throw new Error("the funnel fixture must carry at least one count");

    const candidate = candidateFindingFrom({ source, ruleSet, counts: [only] });

    expect(() => render(candidate)).toThrow(/one count per declared role/);
  });

  test("renderFloorSummary composes its output only from imported templates and substituted values", () => {
    const ruleSet = ruleSetV1();

    for (const candidate of [funnelCandidate(ruleSet), errorCandidate(ruleSet)]) {
      const summary = render(candidate);
      const elements = elementsOf(summary);
      expect(elements.length).toBeGreaterThan(0);

      for (const element of elements) {
        const matched = FLOOR_TEMPLATE_PATTERNS.some((pattern) => pattern.test(element));
        expect(matched).toBe(true);
      }
    }
  });

  test("the floor template table has exactly one entry per FindingClass", () => {
    expect(Object.keys(FLOOR_OBSERVATION_TEMPLATES).toSorted()).toEqual(
      [...findingClassSchema.options].toSorted(),
    );
    expect(Object.keys(FLOOR_CONFIDENCE_TEMPLATES).toSorted()).toEqual(
      [...confidenceBasisSchema.options].toSorted(),
    );
    expect(Object.keys(FLOOR_COUNT_TEMPLATES).toSorted()).toEqual(
      [...DECLARED_COUNT_ROLES].toSorted(),
    );
  });

  test("renderFloorSummary refuses a candidate whose surface is not already normalised", () => {
    const ruleSet = ruleSetV1();

    const rawToken = "AbCdEfGhIjKlMnOpQrStUv";
    const candidate = candidateFindingFrom({
      source: funnelDetectorCandidate(ruleSet),
      ruleSet,
      surface: `/T1FL/Reset-Password/${rawToken}?utm_source=email`,
    });

    let message = "";
    try {
      render(candidate);
      throw new Error("an un-normalised surface must be refused");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("surface_not_normalised");

    expect(message).not.toContain(rawToken);
    expect(message).not.toContain("utm_source");
  });

  test("renderFloorSummary emits exactly one sentence per string element", () => {
    const ruleSet = ruleSetV1();

    for (const candidate of [funnelCandidate(ruleSet), errorCandidate(ruleSet)]) {
      const elements = elementsOf(render(candidate));
      expect(elements.length).toBeGreaterThan(0);

      for (const element of elements) {
        expect(element.endsWith(".")).toBe(true);
        expect(element).not.toContain(". ");
        expect(element.trim()).toBe(element);
      }
    }
  });

  test("renderFloorSummary states the summary source it was given and never derives one", () => {
    const ruleSet = ruleSetV1();
    const candidate = funnelCandidate(ruleSet);

    const floorSources: readonly FloorSummarySource[] = [
      "floor_no_key_configured",
      "floor_cap_exhausted",
      "floor_model_call_failed",
      "floor_model_output_invalid",
      "floor_model_text_rejected",
    ];

    for (const source of floorSources) {
      const summary = render(candidate, source);
      expect(summary.source).toBe(source);

      const own = SUMMARY_SOURCE_MESSAGES[source];
      const ownSentences = own
        .split(". ")
        .map((part, index, all) => (index === all.length - 1 ? part : `${part}.`));
      for (const sentence of ownSentences) {
        expect(summary.context).toContain(sentence);
      }
    }

    // @ts-expect-error `model_rendered` is excluded from `FloorSummarySource`.
    expect(() => render(candidate, "model_rendered")).toThrow();
  });

  test("renderFloorSummary renders both funnel counts and computes no ratio between them", () => {
    const ruleSet = ruleSetV1();
    const candidate = funnelCandidate(ruleSet);
    const summary = render(candidate);

    const reached = candidate.counts[0];
    const left = candidate.counts[1];
    if (!reached || !left) throw new Error("a funnel candidate must carry two counts");

    expect(reached.numerator).not.toBe(left.numerator);

    const masked = renderedText(summary)
      .replaceAll(candidate.surface, "<surface>")
      .replaceAll(FIXTURE_WINDOW_START_DATE, "<window-start>")
      .replaceAll(FIXTURE_WINDOW_END_DATE, "<window-end>");

    const allowed = new Set<string>([
      String(reached.numerator),
      String(reached.denominator),
      String(left.numerator),
      String(left.denominator),
    ]);
    expect(allowed.size).toBeGreaterThan(0);

    const remaining = digitsIn(masked);
    expect(remaining.length).toBeGreaterThan(0);

    for (const digitRun of remaining) {
      expect(allowed).toContain(digitRun);
    }

    expect(renderedText(summary)).not.toContain("%");
  });
});

const FIVE_DIGIT_DENOMINATOR = 24_680;
const FIVE_DIGIT_NUMERATOR = 13_579;

const FLOOR_SOURCES: readonly FloorSummarySource[] = [
  "floor_no_key_configured",
  "floor_cap_exhausted",
  "floor_model_call_failed",
  "floor_model_output_invalid",
  "floor_model_text_rejected",
];

function fiveDigitCount(numerator: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: FIVE_DIGIT_DENOMINATOR,
    unit: "sessions",
    timeframe: FIXTURE_WINDOW,
    basis: { totalInWindow: FIVE_DIGIT_DENOMINATOR, kept: FIVE_DIGIT_DENOMINATOR, setAside: [] },
  });
}

// Every floor template embeds `{surface}`, so the surface is the axis that decides whether
// a floor row can be shown at all. Holding it fixed sweeps the classes and misses that.
const REALISTIC_SURFACES: readonly string[] = [
  FUNNEL_ORIGIN,
  "/checkout",
  "/api-reference-getting-started",
  "/key-metrics-dashboard-page",
  "/token-refresh-flow-diagnostics",
  "/rk-8-week-onboarding-programme",
  "/settings/api-keys-and-access-tokens",
  "/pricing-plans-and-billing-options",
];

describe("renderFloorSummary — every row it produces is read through the residual-PII gate", () => {
  test("a floor-rendered summary over a representative candidate scans clean, so the read gate does not withhold every floor row", () => {
    const ruleSet = ruleSetV1();
    const detected = funnelDetectorCandidate(ruleSet);

    const profiles: readonly { label: string; counts: readonly MeasuredCount[] }[] = [
      { label: "detected-counts", counts: detected.counts },
      {
        label: "five-digit-denominator",
        counts: [fiveDigitCount(FIVE_DIGIT_DENOMINATOR), fiveDigitCount(FIVE_DIGIT_NUMERATOR)],
      },
    ];

    const withheld: string[] = [];

    for (const surface of REALISTIC_SURFACES) {
      expect({ surface, normalised: isNormalisedUrlPath(surface) }).toEqual({
        surface,
        normalised: true,
      });

      for (const finalClass of findingClassSchema.options) {
        for (const profile of profiles) {
          const base = candidateFindingFrom({
            source: detected,
            ruleSet,
            counts: profile.counts,
            surface,
          });
          const candidate: CandidateFinding = candidateFindingSchema.parse({
            ...base,
            claimedClass: finalClass,
            finalClass,
            trace: [
              traceEntry({
                class: finalClass,
                predicate: "t1fl-fixture-predicate",
                predicateVersion: 1,
                satisfied: true,
              }),
            ],
          });

          for (const source of FLOOR_SOURCES) {
            const verdict = reviewFindingText(renderFloorSummary({ candidate, source }));
            if (verdict.held) {
              withheld.push(`${surface}/${finalClass}/${profile.label}/${source}: ${verdict.why}`);
            }
          }
        }
      }
    }

    expect(withheld).toEqual([]);
  });
});

describe("renderWithheldFloorSummary — the row that survives a hold", () => {
  test("every floor source produces text that scans clean, so a hold never costs the finding", () => {
    const withheld: string[] = [];

    for (const source of FLOOR_SOURCES) {
      const summary = renderWithheldFloorSummary(source);
      const verdict = reviewFindingText(summary);
      if (verdict.held) withheld.push(`${source}: ${verdict.why}`);

      expect(summary.source).toBe(source);
    }

    expect(withheld).toEqual([]);
  });

  test("it substitutes nothing — no surface, no count, no date reaches the withheld row", () => {
    const ruleSet = ruleSetV1();
    const candidate = funnelCandidate(ruleSet);

    for (const source of FLOOR_SOURCES) {
      const summary = renderWithheldFloorSummary(source);
      const text = renderedText(summary);

      expect(text).not.toContain(candidate.surface);
      expect(pathsIn(text)).toEqual([]);
      expect(digitsIn(text)).toEqual([]);
    }
  });

  test("it emits exactly one sentence per element, all of them registered constants", () => {
    for (const source of FLOOR_SOURCES) {
      const elements = elementsOf(renderWithheldFloorSummary(source));
      expect(elements.length).toBeGreaterThan(0);

      for (const element of elements) {
        expect(element.endsWith(".")).toBe(true);
        expect(element).not.toContain(". ");
        expect(element.trim()).toBe(element);
        expect(ALL_FLOOR_TEMPLATES).toContain(element);
      }
    }
  });
});
