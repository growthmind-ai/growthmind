import type { ConnectionState, ExclusionReason } from "@growthmind/shared";
import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { CountBasis, SetAsideBasis } from "../../src/counts/measured-count";
import { detectErrorEvent } from "../../src/detect/error-event";
import { detectFunnelDropoff } from "../../src/detect/funnel-dropoff";
import { NOT_BUILT_DETECTORS } from "../../src/detect/not-built";
import type {
  AnalysisWindow,
  DetectorCandidate,
  DetectorCorpus,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";
import { detectorProposedClassSchema, findingClassSchema } from "../../src/rules/types";

const SRC_DIR = `${import.meta.dir}/../../src`;
const DETECT_DIR = `${SRC_DIR}/detect`;
const SPINE_DIR = `${SRC_DIR}/spine`;

type CodeToken = {
  readonly module: string;
  readonly kind: "literal" | "identifier";
  readonly text: string;
};

type ScannedModule = {
  readonly module: string;

  readonly raw: string;

  readonly code: string;
  readonly tokens: readonly CodeToken[];
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const STRING_LITERAL =
  /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

function codeTokens(module: string, commentStripped: string): readonly CodeToken[] {
  const tokens: CodeToken[] = [];

  const withoutLiterals = commentStripped.replace(STRING_LITERAL, (_whole, dq, sq, bt) => {
    const value: string = dq ?? sq ?? bt ?? "";
    tokens.push({ module, kind: "literal", text: value });
    return " ";
  });

  for (const match of withoutLiterals.matchAll(IDENTIFIER)) {
    tokens.push({ module, kind: "identifier", text: match[0] });
  }

  return tokens;
}

function scanSource(module: string, raw: string): ScannedModule {
  const code = stripComments(raw);
  return { module, raw, code, tokens: codeTokens(module, code) };
}

async function scanDirectory(dir: string, prefix = ""): Promise<readonly ScannedModule[]> {
  const names = [...new Bun.Glob("*.ts").scanSync({ cwd: dir })].toSorted();
  const scanned: ScannedModule[] = [];
  for (const name of names) {
    scanned.push(scanSource(`${prefix}${name}`, await Bun.file(`${dir}/${name}`).text()));
  }
  return scanned;
}

const DETECT_MODULES: readonly ScannedModule[] = [
  ...(await scanDirectory(DETECT_DIR)),
  ...(await scanDirectory(SPINE_DIR, "spine/")),
];
const DETECT_TOKENS: readonly CodeToken[] = DETECT_MODULES.flatMap((mod) => mod.tokens);

const NOT_BUILT_NAMES: ReadonlySet<string> = new Set(
  NOT_BUILT_DETECTORS.map((detector) => detector.name),
);

function isDocumentedAbsenceName(token: CodeToken): boolean {
  return (
    token.module === "not-built.ts" && token.kind === "literal" && NOT_BUILT_NAMES.has(token.text)
  );
}

function describeToken(token: CodeToken): string {
  return `${token.module} :: ${token.kind} "${token.text}"`;
}

function offenders(
  tokens: readonly CodeToken[],
  pattern: RegExp,
  options: { readonly exemptDocumentedAbsence: boolean },
): readonly string[] {
  return tokens
    .filter((token) => pattern.test(token.text))
    .filter((token) => !(options.exemptDocumentedAbsence && isDocumentedAbsenceName(token)))
    .map(describeToken);
}

const AUTOCAPTURE = /autocapture/i;

const VENDOR_CLICK_EVENT = /\$\s*(?:rageclick|rage_click|dead_?click|dead_?swipe)/i;

const CLICK_CONCEPT = /click|swipe|mousedown|pointerdown|elements_chain|\btaps?\b|\btapped\b/i;

const CLUSTERING_CONCEPT =
  /\bcluster|\bburst|\brapid|\bthrash|\brage|\bstorm|\bdebounce|\bthrottle|\bproximit|\bconsecutiveclicks/i;

const TIME_CONCEPT = /window|elapsed|duration|timestamp|interval|\bgap|\bwithin|ms$|Ms$/i;

const CHANGED_MIND = /changed[_\s]?mind/i;

const NB_WINDOW: AnalysisWindow = {
  start: new Date("2026-09-01T00:00:00.000Z"),
  end: new Date("2026-09-08T00:00:00.000Z"),
};

const NB_FIRST_EVENT_AT = new Date("2026-09-03T10:00:00.000Z");

const NB_PROJECT_ID = "t1nb-project";
const NB_ORIGIN = "/t1nb/pricing";
const NB_DESTINATION = "/t1nb/checkout";
const NB_SINGLE_SURFACE = "/t1nb/editor";
const NB_ACTION = "t1nb_submit_attempted";
const NB_NORMALISATION_VERSION = 1;

const SESSION_STRIDE_MS = 60_000;
const EVENT_STRIDE_MS = 1_000;

const BURST_STRIDE_MS = 20;
const BURST_EVENTS_PER_SESSION = 10;
const BURST_SESSIONS = 30;

const FUNNEL_AT_ORIGIN = 30;
const FUNNEL_DROPPED = 18;
const FUNNEL_CONVERTED = FUNNEL_AT_ORIGIN - FUNNEL_DROPPED;

const ERROR_SESSIONS = 8;

const ERROR_CORRELATION_GAP_MS = 5_000;

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

const NB_CONNECTION_STATE: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "t1nb-connection",
    organizationId: "t1nb-org",
    projectId: NB_PROJECT_ID,
    sourceKind: "posthog",
    host: "https://t1nb.example.invalid",
    sourceProjectId: "t1nb-source-project",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: NB_WINDOW.end,
    watermarkAt: NB_WINDOW.end,
    backfillBefore: null,
    pollIntervalSeconds: 300,
    connectedAt: NB_WINDOW.start,
    inferredInternalDomain: null,
    internalDomainProvenance: null,
  },
};

type SessionSpec = {
  readonly sessionId: string;

  readonly startedAt: Date;
  readonly strideMs: number;
  readonly steps: readonly { readonly name: string; readonly urlPath: string | null }[];
  readonly exclusionReason: ExclusionReason;
};

function sessionTimeline(spec: SessionSpec): SessionTimeline {
  const events: readonly TimelineEvent[] = spec.steps.map((step, index) => ({
    sourceEventId: `${spec.sessionId}-e${String(index).padStart(3, "0")}`,
    name: step.name,
    occurredAt: new Date(spec.startedAt.getTime() + index * spec.strideMs),
    urlPath: step.urlPath,
    urlPathNormalisationVersion: step.urlPath === null ? null : NB_NORMALISATION_VERSION,
  }));

  return {
    sessionId: spec.sessionId,
    startedAt: spec.startedAt,
    exclusionReason: spec.exclusionReason,
    entryUrlPath: spec.steps.find((step) => step.urlPath !== null)?.urlPath ?? null,
    events,
  };
}

function cohort(input: {
  readonly idPrefix: string;
  readonly count: number;
  readonly strideMs?: number;
  readonly steps: readonly { readonly name: string; readonly urlPath: string | null }[];
  readonly exclusionReason: ExclusionReason;
}): readonly SessionTimeline[] {
  return Array.from({ length: input.count }, (_unused, index) =>
    sessionTimeline({
      sessionId: `${input.idPrefix}-${String(index).padStart(3, "0")}`,
      startedAt: new Date(NB_FIRST_EVENT_AT.getTime() + index * SESSION_STRIDE_MS),
      strideMs: input.strideMs ?? EVENT_STRIDE_MS,
      steps: input.steps,
      exclusionReason: input.exclusionReason,
    }),
  );
}

const SET_ASIDE_REASONS: readonly ExclusionReason[] = [
  "internal_domain",
  "automation_headless",
  "automation_known_agent",
  "automation_coding_agent",
];

function basisOf(sessions: readonly SessionTimeline[]): CountBasis {
  const setAside: SetAsideBasis[] = [];
  for (const reason of SET_ASIDE_REASONS) {
    const count = sessions.filter((session) => session.exclusionReason === reason).length;
    if (count > 0) setAside.push({ reason, count, label: EXCLUSION_REASON_LABELS[reason] });
  }
  return {
    totalInWindow: sessions.length,
    kept: sessions.filter((session) => session.exclusionReason === "none").length,
    keptUnchecked: 0,
    setAside,
  };
}

function corpusOf(sessions: readonly SessionTimeline[]): DetectorCorpus {
  return {
    projectId: NB_PROJECT_ID,
    window: NB_WINDOW,
    connectionState: NB_CONNECTION_STATE,
    sessions,
    basis: basisOf(sessions),
    coverage: {
      truncated: false,
      eventsWithoutUrlPath: sessions
        .flatMap((session) => session.events)
        .filter((event) => event.urlPath === null).length,
    },
  };
}

const NB_EXCEPTION_NAME = ruleSetV1().exceptionEventName;

const FIXTURE_CORPORA: readonly { readonly name: string; readonly corpus: DetectorCorpus }[] = [
  {
    name: "funnel drop-off, firing",
    corpus: corpusOf([
      ...cohort({
        idPrefix: "t1nb-dropped",
        count: FUNNEL_DROPPED,
        steps: [{ name: NB_ACTION, urlPath: NB_ORIGIN }],
        exclusionReason: "none",
      }),
      ...cohort({
        idPrefix: "t1nb-converted",
        count: FUNNEL_CONVERTED,
        steps: [
          { name: NB_ACTION, urlPath: NB_ORIGIN },
          { name: NB_ACTION, urlPath: NB_DESTINATION },
        ],
        exclusionReason: "none",
      }),
      ...cohort({
        idPrefix: "t1nb-setaside",
        count: 6,
        steps: [{ name: NB_ACTION, urlPath: NB_ORIGIN }],
        exclusionReason: "automation_headless",
      }),
    ]),
  },
  {
    name: "clean single-visit drop-off (D-9's silence case)",
    corpus: corpusOf(
      cohort({
        idPrefix: "t1nb-clean",
        count: FUNNEL_AT_ORIGIN,
        steps: [
          { name: NB_ACTION, urlPath: NB_ORIGIN },
          { name: NB_ACTION, urlPath: NB_DESTINATION },
          { name: NB_ACTION, urlPath: NB_SINGLE_SURFACE },
        ],
        exclusionReason: "none",
      }),
    ),
  },
  {
    name: "exceptions correlated to a preceding action",
    corpus: corpusOf(
      cohort({
        idPrefix: "t1nb-correlated",
        count: ERROR_SESSIONS,
        strideMs: ERROR_CORRELATION_GAP_MS,
        steps: [
          { name: NB_ACTION, urlPath: NB_SINGLE_SURFACE },
          { name: NB_EXCEPTION_NAME, urlPath: NB_SINGLE_SURFACE },
        ],
        exclusionReason: "none",
      }),
    ),
  },
  {
    name: "lone exceptions, nothing before them (ES-13)",
    corpus: corpusOf(
      cohort({
        idPrefix: "t1nb-uncorrelated",
        count: ERROR_SESSIONS,
        steps: [{ name: NB_EXCEPTION_NAME, urlPath: NB_SINGLE_SURFACE }],
        exclusionReason: "none",
      }),
    ),
  },
  {
    name: "rapid repeated events on ONE surface (the barred proxy's input)",
    corpus: corpusOf(
      cohort({
        idPrefix: "t1nb-burst",
        count: BURST_SESSIONS,
        strideMs: BURST_STRIDE_MS,
        steps: Array.from({ length: BURST_EVENTS_PER_SESSION }, () => ({
          name: NB_ACTION,
          urlPath: NB_SINGLE_SURFACE,
        })),
        exclusionReason: "none",
      }),
    ),
  },
  {
    name: "every event path-less (ES-4, BS-4)",
    corpus: corpusOf(
      cohort({
        idPrefix: "t1nb-pathless",
        count: FUNNEL_AT_ORIGIN,
        steps: [
          { name: NB_ACTION, urlPath: null },
          { name: NB_EXCEPTION_NAME, urlPath: null },
        ],
        exclusionReason: "none",
      }),
    ),
  },
  {
    name: "every session set aside (FR-7)",
    corpus: corpusOf(
      cohort({
        idPrefix: "t1nb-allsetaside",
        count: FUNNEL_AT_ORIGIN,
        steps: [
          { name: NB_ACTION, urlPath: NB_ORIGIN },
          { name: NB_EXCEPTION_NAME, urlPath: NB_ORIGIN },
        ],
        exclusionReason: "internal_domain",
      }),
    ),
  },
  { name: "empty corpus (ES-1)", corpus: corpusOf([]) },
];

function detectAll(corpus: DetectorCorpus, ruleSet: ThresholdRuleSet): readonly DetectorResult[] {
  return [detectFunnelDropoff(corpus, ruleSet), detectErrorEvent(corpus, ruleSet)];
}

function candidatesOver(
  corpora: readonly DetectorCorpus[],
  ruleSet: ThresholdRuleSet,
): readonly DetectorCandidate[] {
  return corpora.flatMap((corpus) =>
    detectAll(corpus, ruleSet).flatMap((result) => result.candidates),
  );
}

describe("the analysis modules contain no barred click proxy", () => {
  test("should contain no $autocapture literal anywhere under src/detect or src/spine", () => {
    expect(offenders(DETECT_TOKENS, AUTOCAPTURE, { exemptDocumentedAbsence: false })).toEqual([]);
  });

  test("should contain no $rageclick, $dead_click, or $dead_swipe literal anywhere under src/detect or src/spine", () => {
    expect(
      offenders(DETECT_TOKENS, VENDOR_CLICK_EVENT, { exemptDocumentedAbsence: false }),
    ).toEqual([]);

    expect(offenders(DETECT_TOKENS, CLICK_CONCEPT, { exemptDocumentedAbsence: true })).toEqual([]);

    expect([...NOT_BUILT_NAMES].toSorted()).toEqual(
      ["dead_click", "form_abandonment", "rage_click"].toSorted(),
    );
    for (const detector of NOT_BUILT_DETECTORS) {
      expect(detector.name).not.toContain("$");
      expect(detector.reason.length).toBeGreaterThan(40);
    }
  });

  test("should contain no time-clustered click-burst predicate anywhere under src/detect or src/spine", () => {
    expect(offenders(DETECT_TOKENS, CLUSTERING_CONCEPT, { exemptDocumentedAbsence: true })).toEqual(
      [],
    );

    const cooccurring = DETECT_MODULES.filter((mod) => {
      const clickish = mod.tokens.some(
        (token) => CLICK_CONCEPT.test(token.text) && !isDocumentedAbsenceName(token),
      );
      const timeish = mod.tokens.some((token) => TIME_CONCEPT.test(token.text));
      return clickish && timeish;
    }).map((mod) => mod.module);
    expect(cooccurring).toEqual([]);

    const burst = FIXTURE_CORPORA.find((entry) => entry.name.startsWith("rapid repeated"));
    if (!burst) throw new Error("the burst fixture must remain in FIXTURE_CORPORA");

    const burstEvents = burst.corpus.sessions.flatMap((session) => session.events);
    expect(burst.corpus.sessions).toHaveLength(BURST_SESSIONS);
    expect(burstEvents).toHaveLength(BURST_SESSIONS * BURST_EVENTS_PER_SESSION);
    expect(new Set(burstEvents.map((event) => event.urlPath)).size).toBe(1);

    for (const result of detectAll(burst.corpus, ruleSetV1())) {
      expect({ detector: result.detector, candidates: result.candidates.length }).toEqual({
        detector: result.detector,
        candidates: 0,
      });
    }
  });

  test("should find the modules it claims to scan (non-vacuity)", () => {
    expect(DETECT_MODULES.length).toBeGreaterThan(0);
    expect(DETECT_MODULES.map((mod) => mod.module)).toEqual([
      "analysed.ts",
      "error-event.ts",
      "funnel-dropoff.ts",
      "not-built.ts",
      "observed.ts",
      "order.ts",
      "types.ts",
      "spine/spine.ts",
      "spine/types.ts",
      "spine/walk.ts",
    ]);

    const identifiers = new Set(
      DETECT_TOKENS.filter((token) => token.kind === "identifier").map((token) => token.text),
    );
    for (const expected of [
      "detectFunnelDropoff",
      "detectErrorEvent",
      "NOT_BUILT_DETECTORS",
      "orderTimeline",
      "analysedSessions",
      "DetectorCandidate",
    ]) {
      expect({ identifier: expected, found: identifiers.has(expected) }).toEqual({
        identifier: expected,
        found: true,
      });
    }

    const literals = new Set(
      DETECT_TOKENS.filter((token) => token.kind === "literal").map((token) => token.text),
    );
    for (const expected of ["funnel_dropoff", "error_event", "rage_click", "dead_click"]) {
      expect({ literal: expected, found: literals.has(expected) }).toEqual({
        literal: expected,
        found: true,
      });
    }

    const notBuilt = DETECT_MODULES.find((mod) => mod.module === "not-built.ts");
    if (!notBuilt) throw new Error("not-built.ts must exist — it records the D-17 decision");

    expect(NOT_BUILT_DETECTORS.map((entry) => entry.name)).toEqual([
      "rage_click",
      "dead_click",
      "form_abandonment",
    ]);
    for (const entry of NOT_BUILT_DETECTORS) {
      expect(entry.reason.trim().length).toBeGreaterThan(20);
    }

    expect(notBuilt.code).toContain("NOT_BUILT_DETECTORS");
    expect(notBuilt.code).toContain("rage_click");

    const control = scanSource(
      "control.ts",
      [
        "// A comment naming $rageclick and clusters must NOT be enough to fail.",
        'const RAGE_CLICK_EVENT = "$rageclick";',
        'const DEAD = "$dead_click";',
        'const CAPTURE = "$autocapture";',
        "function clusterClickBurst(events, windowMs) { return events.length; }",
        "",
      ].join("\n"),
    );
    expect(offenders(control.tokens, AUTOCAPTURE, { exemptDocumentedAbsence: false })).not.toEqual(
      [],
    );
    expect(
      offenders(control.tokens, VENDOR_CLICK_EVENT, { exemptDocumentedAbsence: false }),
    ).not.toEqual([]);
    expect(offenders(control.tokens, CLICK_CONCEPT, { exemptDocumentedAbsence: true })).not.toEqual(
      [],
    );
    expect(
      offenders(control.tokens, CLUSTERING_CONCEPT, { exemptDocumentedAbsence: true }),
    ).not.toEqual([]);

    const commentOnlyControl = scanSource(
      "comment-only.ts",
      "// $rageclick, $dead_click, $autocapture, cluster, burst, rapid clicks.\n",
    );
    expect(commentOnlyControl.tokens).toEqual([]);
  });
});

describe("no T1 detector may propose changed_mind", () => {
  test("should contain no changed_mind literal in any module under src/detect or src/spine", async () => {
    expect(offenders(DETECT_TOKENS, CHANGED_MIND, { exemptDocumentedAbsence: false })).toEqual([]);

    const gate = scanSource("gate.ts", await Bun.file(`${SRC_DIR}/evidence/gate.ts`).text());
    expect(offenders(gate.tokens, CHANGED_MIND, { exemptDocumentedAbsence: false })).not.toEqual(
      [],
    );

    expect(findingClassSchema.options).toContain("changed_mind");
    expect(detectorProposedClassSchema.options).not.toContain("changed_mind");
  });

  test("should emit no candidate claiming changed_mind over the full fixture corpus", () => {
    const ruleSet = ruleSetV1();
    const corpora = FIXTURE_CORPORA.map((entry) => entry.corpus);
    const candidates = candidatesOver(corpora, ruleSet);

    expect(candidates.length).toBeGreaterThan(0);
    expect(new Set(candidates.map((candidate) => candidate.detector))).toEqual(
      new Set(["funnel_dropoff", "error_event"]),
    );

    const claimedByCorpus = FIXTURE_CORPORA.map((entry) => ({
      corpus: entry.name,
      changedMindClaims: detectAll(entry.corpus, ruleSet)
        .flatMap((result) => result.candidates)
        .filter((candidate) => CHANGED_MIND.test(candidate.claimedClass)).length,
    }));
    expect(claimedByCorpus).toEqual(
      FIXTURE_CORPORA.map((entry) => ({ corpus: entry.name, changedMindClaims: 0 })),
    );

    for (const candidate of candidates) {
      expect(detectorProposedClassSchema.options).toContain(candidate.claimedClass);
    }
    expect(new Set(candidates.map((candidate) => candidate.claimedClass))).toEqual(
      new Set(["confusing", "broken"]),
    );

    const signalKinds = new Set(
      candidates.flatMap((candidate) => candidate.signals).map((signal) => signal.kind),
    );
    expect(signalKinds).not.toContain("clean_exit");
  });
});
