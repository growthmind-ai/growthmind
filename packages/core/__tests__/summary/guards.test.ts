import type { ConnectionState } from "@growthmind/shared";
import {
  FLOOR_CONFIDENCE_TEMPLATES,
  FLOOR_COUNT_TEMPLATES,
  FLOOR_NO_RATE_TEMPLATE,
  FLOOR_OBSERVATION_TEMPLATES,
  FLOOR_TIMEFRAME_TEMPLATE,
} from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { measuredCount } from "../../src/counts/measured-count";
import { detectErrorEvent } from "../../src/detect/error-event";
import { detectFunnelDropoff } from "../../src/detect/funnel-dropoff";
import type {
  AnalysisWindow,
  DetectorCandidate,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";
import { PROOF_PREDICATES } from "../../src/evidence/predicates";
import { traceEntry } from "../../src/evidence/trace";
import type { CandidateFinding } from "../../src/findings/candidate";
import { candidateFindingSchema, confidenceBasisSchema } from "../../src/findings/candidate";
import { EVIDENCE_SHAPE_VERSION } from "../../src/findings/evidence-shape";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";
import { detectorNameSchema, findingClassSchema } from "../../src/rules/types";
import { renderFixSpec } from "../../src/fixes/fix-spec";
import { renderFloorSummary } from "../../src/summary/floor";
import { FLOOR_TOKENS, placeholdersIn } from "../../src/summary/substitute";
import type { FloorSummary } from "../../src/summary/types";

const SUMMARY_SRC_DIR = `${import.meta.dir}/../../src/summary`;

const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

const FIXTURE_PROJECT_ID = "t1gd-project";
const FIXTURE_NORMALISATION_VERSION = 1;
const FIXTURE_EVIDENCE_SHAPE = "t1gd-evidence-shape";

const EVENT_STRIDE_MS = 1_000;
const SESSION_STRIDE_MS = 60_000;
const PERCENT_SCALE = 100;

const FUNNEL_HEADROOM_SESSIONS = 10;
const FUNNEL_RATE_HEADROOM_SESSIONS = 1;
const ERROR_HEADROOM_SESSIONS = 2;

const FUNNEL_ORIGIN = "/t1gd/pricing";
const FUNNEL_DESTINATION = "/t1gd/checkout";
const FUNNEL_EVENT_NAME = "t1gd_step_viewed";

const ERROR_SURFACE = "/t1gd/settings";
const ERROR_ACTION = "t1gd_save_clicked";

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

const FIXTURE_CONNECTION_STATE: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "t1gd-connection",
    organizationId: "t1gd-org",
    projectId: FIXTURE_PROJECT_ID,
    sourceKind: "posthog",
    host: "https://t1gd.example.invalid",
    sourceProjectId: "t1gd-source-project",
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

function corpusOf(sessions: readonly SessionTimeline[]) {
  return {
    projectId: FIXTURE_PROJECT_ID,
    window: FIXTURE_WINDOW,
    connectionState: FIXTURE_CONNECTION_STATE,
    sessions,
    basis: {
      totalInWindow: sessions.length,
      kept: sessions.length,
      setAside: [],
      keptUnchecked: 0,
    },
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

function sessionStartedAt(index: number): Date {
  return new Date(FIXTURE_WINDOW.start.getTime() + index * SESSION_STRIDE_MS);
}

function funnelSession(index: number, paths: readonly string[]): SessionTimeline {
  const sessionId = `t1gd-funnel-${String(index).padStart(3, "0")}`;
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

function firingFunnelCorpus(ruleSet: ThresholdRuleSet) {
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
  const sessionId = `t1gd-error-${String(index).padStart(3, "0")}`;
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

  return { sessionId, startedAt, exclusionReason: "none", entryUrlPath: ERROR_SURFACE, events };
}

function firingErrorCorpus(ruleSet: ThresholdRuleSet) {
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
    throw new Error(`the ${result.detector} fixture corpus produced no candidate to scan`);
  }
  return candidate;
}

function candidateFindingFrom(
  source: DetectorCandidate,
  ruleSet: ThresholdRuleSet,
): CandidateFinding {
  const sampleSize = source.counts[0];
  if (!sampleSize) throw new Error("a detector candidate must carry at least one count");

  return candidateFindingSchema.parse({
    detector: source.detector,
    claimedClass: source.claimedClass,
    finalClass: source.claimedClass,
    trace: [
      traceEntry({
        class: source.claimedClass,
        predicate: "t1gd-fixture-predicate",
        predicateVersion: 1,
        satisfied: true,
      }),
    ],
    counts: source.counts,
    timeframe: source.timeframe,
    claimSubject: source.claimSubject,
    surface: source.surface,
    surfaceNormalisationVersion: source.surfaceNormalisationVersion,
    evidenceShape: FIXTURE_EVIDENCE_SHAPE,
    evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
    thresholdRuleSetVersion: ruleSet.version,
    ranking: { sampleSize, confidenceBasis: "threshold_met" },
    coverage: source.coverage,
  });
}

function funnelCandidate(ruleSet: ThresholdRuleSet): CandidateFinding {
  return candidateFindingFrom(
    firstCandidateOf(detectFunnelDropoff(firingFunnelCorpus(ruleSet), ruleSet)),
    ruleSet,
  );
}

function errorCandidate(ruleSet: ThresholdRuleSet): CandidateFinding {
  return candidateFindingFrom(
    firstCandidateOf(detectErrorEvent(firingErrorCorpus(ruleSet), ruleSet)),
    ruleSet,
  );
}

function everyRenderableSummary(): readonly {
  candidate: CandidateFinding;
  summary: FloorSummary;
}[] {
  const ruleSet = ruleSetV1();
  return [funnelCandidate(ruleSet), errorCandidate(ruleSet)].map((candidate) => ({
    candidate,
    summary: renderFloorSummary({ candidate, source: "floor_no_key_configured" }),
  }));
}

function elementsOf(summary: FloorSummary): readonly string[] {
  return [summary.headline, ...summary.context];
}

function bareDigitOffenders(text: string, allowed: ReadonlySet<string>): readonly string[] {
  return (text.match(/\d+/g) ?? []).filter((run) => !allowed.has(run));
}

function denominatorlessOffenders(
  sentences: readonly string[],
  counts: readonly { numerator: number; denominator: number }[],
): readonly string[] {
  const offenders: string[] = [];
  for (const sentence of sentences) {
    const runs = new Set(sentence.match(/\d+/g) ?? []);
    for (const count of counts) {
      if (runs.has(String(count.numerator)) && !runs.has(String(count.denominator))) {
        offenders.push(sentence);
      }
    }
  }
  return offenders;
}

const STRUGGLE_TOKENS = ["coming back", "over and over", "repeatedly", "again", "revisit"] as const;

const DROP_TOKENS = ["left", "dropped", "without going anywhere", "gave up"] as const;

function cohortConflationOffenders(sentences: readonly string[]): readonly string[] {
  return sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return (
      STRUGGLE_TOKENS.some((token) => lower.includes(token)) &&
      DROP_TOKENS.some((token) => lower.includes(token))
    );
  });
}

const MACHINE_IDENTIFIERS: readonly string[] = [
  ...findingClassSchema.options,
  ...confidenceBasisSchema.options,
  ...detectorNameSchema.options,
  ...Object.values(PROOF_PREDICATES).map((predicate) => predicate.name),
  "evidence_shape",
];

function machineIdentifierOffenders(text: string): readonly string[] {
  const lower = text.toLowerCase();
  const found = MACHINE_IDENTIFIERS.filter((identifier) =>
    lower.includes(identifier.toLowerCase()),
  );

  const versions = text.match(/\bv\d+\b|\b\d+\.\d+(?:\.\d+)?\b/g) ?? [];
  return [...found, ...versions];
}

const CAUSAL_CONNECTIVES = [
  "because",
  "caused",
  "due to",
  "so that",
  "which is why",
  "therefore",
] as const;

function causalConnectiveOffenders(sentences: readonly string[]): readonly string[] {
  return sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return CAUSAL_CONNECTIVES.some((connective) => lower.includes(connective));
  });
}

const ORDINARY_WORD = /^[A-Za-z][A-Za-z'-]*[.,;:!?]?$/;

function sentenceLiteralOffenders(source: string): readonly string[] {
  const stripped = source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/throw new Error\([\s\S]*?\);/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
    .join("\n");

  const literals = stripped.match(/"[^"\\\n]{12,}"|'[^'\\\n]{12,}'|`[^`\\\n$]{12,}`/g) ?? [];

  return literals.filter((literal) => {
    const words = literal.slice(1, -1).trim().split(/\s+/);
    return words.length >= 4 && words.every((word) => ORDINARY_WORD.test(word));
  });
}

const FORBIDDEN_RENDERER_IMPORTS = ["gate", "predicates", "thresholds", "evidence-shape"] as const;

function forbiddenImportOffenders(source: string): readonly string[] {
  const importLines = source.split("\n").filter((line) => line.trimStart().startsWith("import "));
  return importLines.filter((line) =>
    FORBIDDEN_RENDERER_IMPORTS.some(
      (symbol) => line.includes(`/${symbol}"`) || line.includes(`/${symbol}'`),
    ),
  );
}

async function listSummaryModules(): Promise<readonly string[]> {
  const found: string[] = [];
  for await (const entry of new Bun.Glob("**/*.ts").scan({ cwd: SUMMARY_SRC_DIR })) {
    found.push(entry.replaceAll("\\", "/"));
  }
  return found.toSorted();
}

function readSummaryModule(relativePath: string): Promise<string> {
  return Bun.file(`${SUMMARY_SRC_DIR}/${relativePath}`).text();
}

const FLOOR_TEMPLATES: readonly string[] = [
  ...Object.values(FLOOR_OBSERVATION_TEMPLATES),
  ...Object.values(FLOOR_COUNT_TEMPLATES),
  ...Object.values(FLOOR_CONFIDENCE_TEMPLATES),
  FLOOR_TIMEFRAME_TEMPLATE,
  FLOOR_NO_RATE_TEMPLATE,
];

describe("floor summary guards", () => {
  test("the numbers scanner reports a planted bare digit", () => {
    const planted = "42 of 100 sessions reached /pricing, a 58% improvement.";
    const allowed = new Set(["42", "100"]);

    expect(bareDigitOffenders(planted, allowed)).toContain("58");
  });

  test("the numbers scanner reports a count rendered without its denominator", () => {
    const planted = ["20 sessions dropped off."];
    const counts = [{ numerator: 20, denominator: 30 }];

    expect(denominatorlessOffenders(planted, counts)).toEqual(planted);

    expect(denominatorlessOffenders(["20 of 30 sessions dropped off."], counts)).toHaveLength(0);
  });

  test("no rendered output contains a number that did not arrive by substitution from a MeasuredCount", () => {
    for (const { candidate, summary } of everyRenderableSummary()) {
      const allowed = new Set<string>();
      for (const count of candidate.counts) {
        allowed.add(String(count.numerator));
        allowed.add(String(count.denominator));
      }
      expect(allowed.size).toBeGreaterThan(0);

      const masked = elementsOf(summary)
        .join(" ")
        .replaceAll(candidate.surface, "<surface>")
        .replaceAll(candidate.timeframe.start.toISOString().slice(0, 10), "<start>")
        .replaceAll(candidate.timeframe.end.toISOString().slice(0, 10), "<end>");

      expect(bareDigitOffenders(masked, allowed)).toHaveLength(0);
    }
  });

  test("the numbers scanner still reports an offender when the masked window and surface are removed", () => {
    const { candidate, summary } = everyRenderableSummary()[0]!;
    const allowed = new Set<string>();
    for (const count of candidate.counts) {
      allowed.add(String(count.numerator));
      allowed.add(String(count.denominator));
    }

    const unmasked = elementsOf(summary).join(" ");
    expect(bareDigitOffenders(unmasked, allowed).length).toBeGreaterThan(0);
  });

  test("the cohort-conflation scanner reports a planted sentence joining a struggle clause to a drop clause", () => {
    const planted = "People kept coming back to /pricing and then left without going anywhere.";

    expect(cohortConflationOffenders([planted])).toEqual([planted]);
  });

  test("no rendered sentence contains both a struggle token and a drop token", () => {
    for (const { summary } of everyRenderableSummary()) {
      const elements = elementsOf(summary);
      expect(elements.length).toBeGreaterThan(0);
      expect(cohortConflationOffenders(elements)).toHaveLength(0);
    }
  });

  test("a struggling-cohort count never reaches a rendered sentence", () => {
    const ruleSet = ruleSetV1();
    const source = firstCandidateOf(detectFunnelDropoff(firingFunnelCorpus(ruleSet), ruleSet));
    const sampleSize = source.counts[0];
    if (!sampleSize) throw new Error("a detector candidate must carry at least one count");

    const allowed = new Set<string>();
    for (const count of source.counts) {
      allowed.add(String(count.numerator));
      allowed.add(String(count.denominator));
    }

    // A cohort size the renderer has no licence to print: inside the basis, outside
    // every count the sentences may substitute from.
    let strugglers = sampleSize.denominator;
    while (strugglers > 0 && allowed.has(String(strugglers))) strugglers -= 1;
    if (strugglers === 0) throw new Error("no struggling-cohort size outside the allowed digits");

    const parsed = candidateFindingSchema.parse({
      detector: source.detector,
      claimedClass: source.claimedClass,
      finalClass: source.claimedClass,
      trace: [
        traceEntry({
          class: source.claimedClass,
          predicate: "t1gd-fixture-predicate",
          predicateVersion: 1,
          satisfied: true,
        }),
      ],
      counts: source.counts,
      timeframe: source.timeframe,
      claimSubject: source.claimSubject,
      surface: source.surface,
      surfaceNormalisationVersion: source.surfaceNormalisationVersion,
      evidenceShape: FIXTURE_EVIDENCE_SHAPE,
      evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
      thresholdRuleSetVersion: ruleSet.version,
      ranking: { sampleSize, confidenceBasis: "threshold_met" },
      coverage: source.coverage,
      signals: [
        {
          kind: "struggle",
          subkind: "repeated_attempt",
          surface: source.surface,
          attempts: 4,
          strugglingSessions: measuredCount({
            numerator: strugglers,
            denominator: sampleSize.denominator,
            unit: sampleSize.unit,
            timeframe: sampleSize.timeframe,
            basis: sampleSize.basis,
          }),
        },
      ],
    });

    expect(parsed.signals).toHaveLength(1);
    expect(allowed.has(String(strugglers))).toBe(false);

    const mask = (text: string): string =>
      text
        .replaceAll(parsed.surface, "<surface>")
        .replaceAll(parsed.timeframe.start.toISOString().slice(0, 10), "<start>")
        .replaceAll(parsed.timeframe.end.toISOString().slice(0, 10), "<end>");

    // renderFixSpec is the renderer that actually reads signals (fix-spec.ts:239).
    // Asserting only on the floor summary would pass vacuously: packages/core/src/summary
    // never references signals, so it cannot print the planted count whatever it is.
    const spec = renderFixSpec({ candidate: parsed, signals: parsed.signals });
    expect(spec.sentences.length).toBeGreaterThan(0);
    expect(bareDigitOffenders(mask(spec.sentences.join(" ")), allowed)).toHaveLength(0);

    const floor = elementsOf(
      renderFloorSummary({ candidate: parsed, source: "floor_no_key_configured" }),
    ).join(" ");
    expect(bareDigitOffenders(mask(floor), allowed)).toHaveLength(0);
  });

  test("the cohort scanner reports a struggling count planted into a rendered sentence", () => {
    const allowed = new Set(["3", "40"]);

    expect(bareDigitOffenders("47 of 83 people kept trying.", allowed)).toContain("47");
  });

  test("no floor template contains a third-person plural pronoun", () => {
    expect(FLOOR_TEMPLATES.length).toBeGreaterThan(0);

    for (const template of FLOOR_TEMPLATES) {
      expect(template.toLowerCase()).not.toMatch(/\b(?:they|them|their|theirs|themselves)\b/);
    }
  });

  test("the machine-identifier scanner reports a planted class name", () => {
    const planted = "This finding was classified as changed_mind at threshold_met in v2.";

    const offenders = machineIdentifierOffenders(planted);
    expect(offenders).toContain("changed_mind");
    expect(offenders).toContain("threshold_met");
    expect(offenders).toContain("v2");
  });

  test("no rendered output contains a machine identifier", () => {
    expect(MACHINE_IDENTIFIERS.length).toBeGreaterThan(0);

    for (const { summary } of everyRenderableSummary()) {
      expect(machineIdentifierOffenders(elementsOf(summary).join(" "))).toHaveLength(0);
    }
  });

  test("the causal-connective scanner reports a planted because clause", () => {
    const planted = "People left the page because the save did not work.";

    expect(causalConnectiveOffenders([planted])).toEqual([planted]);
  });

  test("no rendered sentence joins two claims with a causal connective", () => {
    for (const { summary } of everyRenderableSummary()) {
      const elements = elementsOf(summary);
      expect(elements.length).toBeGreaterThan(0);
      expect(causalConnectiveOffenders(elements)).toHaveLength(0);
    }
  });

  test("no module under summary declares a customer-facing sentence literal", async () => {
    const planted = 'const message = "People are coming back to this page over and over";';

    expect(sentenceLiteralOffenders(planted).length).toBeGreaterThan(0);

    const modules = await listSummaryModules();
    expect(modules.length).toBeGreaterThan(0);

    for (const relativePath of modules) {
      const source = await readSummaryModule(relativePath);

      expect({ file: relativePath, offenders: sentenceLiteralOffenders(source) }).toEqual({
        file: relativePath,
        offenders: [],
      });
    }
  });

  test("the renderer imports no gate, predicate, threshold, or evidence-shape symbol", async () => {
    const planted = 'import { PROOF_PREDICATES } from "../evidence/predicates";';
    expect(forbiddenImportOffenders(planted).length).toBeGreaterThan(0);

    const source = await readSummaryModule("floor.ts");
    expect(forbiddenImportOffenders(source)).toHaveLength(0);
  });

  test("substitute is the only place a value is written into a template", async () => {
    const modules = await listSummaryModules();
    expect(modules.length).toBeGreaterThan(0);

    for (const relativePath of modules) {
      if (relativePath === "substitute.ts") continue;
      const source = await readSummaryModule(relativePath);
      const withoutComments = source
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
        .join("\n");

      expect(withoutComments).not.toContain(".replaceAll(");
      expect(withoutComments).not.toContain(".replace(");
    }
  });

  test("every placeholder token in every floor template is a declared FloorToken", () => {
    const declared = new Set<string>(FLOOR_TOKENS);
    expect(FLOOR_TEMPLATES.length).toBeGreaterThan(0);

    for (const template of FLOOR_TEMPLATES) {
      for (const token of placeholdersIn(template)) {
        expect(declared).toContain(token);
      }
    }
  });

  test("no rendered output contains an unresolved placeholder", () => {
    for (const { summary } of everyRenderableSummary()) {
      const text = elementsOf(summary).join(" ");
      expect(placeholdersIn(text)).toHaveLength(0);
      expect(text).not.toContain("{");
      expect(text).not.toContain("}");
    }
  });
});
