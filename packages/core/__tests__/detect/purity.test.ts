import type { ConnectionState, ExclusionReason } from "@growthmind/shared";
import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { CountBasis } from "../../src/counts/measured-count";
import { detectErrorEvent } from "../../src/detect/error-event";
import { detectFunnelDropoff } from "../../src/detect/funnel-dropoff";
import type {
  AnalysisWindow,
  DetectorCorpus,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

const SRC_DIR = `${import.meta.dir}/../../src`;
const TESTS_DIR = `${import.meta.dir}/..`;

async function listSourceModules(): Promise<readonly string[]> {
  const found: string[] = [];
  for await (const entry of new Bun.Glob("**/*.ts").scan({ cwd: SRC_DIR })) {
    found.push(entry.replaceAll("\\", "/"));
  }
  return found.toSorted();
}

function readSource(relativePath: string): Promise<string> {
  return Bun.file(`${SRC_DIR}/${relativePath}`).text();
}

type StrippedSource = {
  readonly withoutComments: string;
  readonly codeOnly: string;
};

function blank(target: string[], from: number, to: number): void {
  for (let index = from; index < to && index < target.length; index += 1) {
    if (target[index] !== "\n") target[index] = " ";
  }
}

function stripSource(source: string): StrippedSource {
  const withoutComments = [...source];
  const codeOnly = [...source];

  let cursor = 0;
  while (cursor < source.length) {
    const pair = source.slice(cursor, cursor + 2);

    if (pair === "//") {
      const lineEnd = source.indexOf("\n", cursor);
      const stop = lineEnd === -1 ? source.length : lineEnd;
      blank(withoutComments, cursor, stop);
      blank(codeOnly, cursor, stop);
      cursor = stop;
      continue;
    }

    if (pair === "/*") {
      const close = source.indexOf("*/", cursor + 2);
      const stop = close === -1 ? source.length : close + 2;
      blank(withoutComments, cursor, stop);
      blank(codeOnly, cursor, stop);
      cursor = stop;
      continue;
    }

    const quote = source[cursor];
    if (quote === '"' || quote === "'" || quote === "`") {
      let scan = cursor + 1;
      while (scan < source.length) {
        if (source[scan] === "\\") {
          scan += 2;
          continue;
        }
        if (source[scan] === quote) {
          scan += 1;
          break;
        }
        scan += 1;
      }

      blank(codeOnly, cursor, scan);
      cursor = scan;
      continue;
    }

    cursor += 1;
  }

  return { withoutComments: withoutComments.join(""), codeOnly: codeOnly.join("") };
}

function collectImportSpecifiers(source: string): readonly string[] {
  const { withoutComments } = stripSource(source);
  const specifiers: string[] = [];

  const statements = withoutComments.match(/^[ \t]*(?:import|export)\b[^;]*;/gm) ?? [];
  for (const statement of statements) {
    const fromClause = /\bfrom\s*["']([^"']+)["']/.exec(statement);
    if (fromClause?.[1] !== undefined) {
      specifiers.push(fromClause[1]);
      continue;
    }
    const sideEffect = /^[ \t]*import\s*["']([^"']+)["']/.exec(statement);
    if (sideEffect?.[1] !== undefined) specifiers.push(sideEffect[1]);
  }

  const deferred = withoutComments.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g);
  for (const match of deferred) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }

  return specifiers;
}

type FunctionRegion = {
  readonly owner: string;

  readonly params: string;

  readonly text: string;
};

function readParenGroup(source: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return source.slice(openIndex + 1);
}

const FUNCTION_HEAD = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;

function collectFunctionRegions(source: string): readonly FunctionRegion[] {
  const { codeOnly } = stripSource(source);
  const regions: FunctionRegion[] = [];

  FUNCTION_HEAD.lastIndex = 0;
  let head: RegExpExecArray | null = FUNCTION_HEAD.exec(codeOnly);
  while (head !== null) {
    const openIndex = head.index + head[0].length - 1;
    const terminator = codeOnly.indexOf("\n}", openIndex);
    const stop = terminator === -1 ? codeOnly.length : terminator + 2;
    regions.push({
      owner: head[1] ?? "<function>",
      params: readParenGroup(codeOnly, openIndex),
      text: codeOnly.slice(openIndex, stop),
    });
    head = FUNCTION_HEAD.exec(codeOnly);
  }

  return regions;
}

const NUMERIC_LITERAL = /(?<![\w$.])\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function numericLiteralsInFunctionBodies(
  source: string,
): readonly { readonly owner: string; readonly literal: string }[] {
  const offenders: { owner: string; literal: string }[] = [];
  for (const region of collectFunctionRegions(source)) {
    for (const literal of region.text.match(NUMERIC_LITERAL) ?? []) {
      offenders.push({ owner: region.owner, literal });
    }
  }
  return offenders;
}

const NODE_BUILTINS: ReadonlySet<string> = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  return NODE_BUILTINS.has(specifier.split("/")[0] ?? specifier);
}

type ScannedModule = {
  readonly path: string;
  readonly source: string;
  readonly specifiers: readonly string[];
};

async function scanSourceModules(): Promise<readonly ScannedModule[]> {
  const paths = await listSourceModules();
  return Promise.all(
    paths.map(async (path) => {
      const source = await readSource(path);
      return { path, source, specifiers: collectImportSpecifiers(source) };
    }),
  );
}

const isDetectModule = (module: ScannedModule): boolean => module.path.startsWith("detect/");

function exportedDetectorsOf(source: string): readonly string[] {
  const { codeOnly } = stripSource(source);
  return [...codeOnly.matchAll(/export\s+function\s+(detect\w+)\s*\(/g)].map(
    (match) => match[1] ?? "",
  );
}

const T1PUR_WINDOW: AnalysisWindow = {
  start: new Date("2026-04-06T00:00:00.000Z"),
  end: new Date("2026-04-13T00:00:00.000Z"),
};
const T1PUR_FIRST_SESSION_AT = new Date("2026-04-08T10:00:00.000Z");
const T1PUR_SESSION_STRIDE_MS = 60_000;
const T1PUR_EVENT_STRIDE_MS = 1_000;

const T1PUR_ORIGIN = "/t1pur/pricing";
const T1PUR_DESTINATION = "/t1pur/checkout";
const T1PUR_DETOUR = "/t1pur/support";
const T1PUR_ACTION = "t1pur_button_clicked";
const T1PUR_NORMALISATION_VERSION = 1;

const KEPT_AT_ORIGIN = 25;
const DROPPERS = 12;
const STRUGGLERS = 5;
const CONVERTERS = KEPT_AT_ORIGIN - DROPPERS - STRUGGLERS;
const SET_ASIDE = 3;
const SESSIONS_WITH_EXCEPTIONS = 4;
const EXCEPTIONS_PER_SESSION = 2;
const ORIGIN_VISITS_PER_STRUGGLER = 3;

const FUNNEL_DECLARED_COUNTS = 2;
const ERROR_DECLARED_COUNTS = 1;

const FUNNEL_DECLARED_CANDIDATES = 1;

const ERROR_DECLARED_CANDIDATES = 1;

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

const T1PUR_CONNECTION_STATE: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "t1pur-connection",
    organizationId: "t1pur-org",
    projectId: "t1pur-project",
    sourceKind: "posthog",
    host: "https://t1pur.example.invalid",
    sourceProjectId: "t1pur-source-project",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: T1PUR_WINDOW.end,
    watermarkAt: T1PUR_WINDOW.end,
    backfillBefore: null,
    pollIntervalSeconds: 300,
    connectedAt: T1PUR_WINDOW.start,
    inferredInternalDomain: null,
    internalDomainProvenance: null,
  },
};

type SessionSpec = {
  readonly sessionId: string;

  readonly startedAt: Date;
  readonly paths: readonly string[];

  readonly exceptionCount: number;
  readonly exceptionName: string;
  readonly exclusionReason: ExclusionReason;
};

function sessionTimelineOf(spec: SessionSpec): SessionTimeline {
  const names = [
    ...spec.paths.map(() => T1PUR_ACTION),
    ...Array.from({ length: spec.exceptionCount }, () => spec.exceptionName),
  ];
  const paths = [...spec.paths, ...Array.from({ length: spec.exceptionCount }, () => T1PUR_ORIGIN)];

  const events: readonly TimelineEvent[] = names.map((name, index) => ({
    sourceEventId: `${spec.sessionId}-e${String(index).padStart(2, "0")}`,
    name,
    occurredAt: new Date(spec.startedAt.getTime() + index * T1PUR_EVENT_STRIDE_MS),
    urlPath: paths[index] ?? T1PUR_ORIGIN,
    urlPathNormalisationVersion: T1PUR_NORMALISATION_VERSION,
  }));

  return {
    sessionId: spec.sessionId,
    startedAt: spec.startedAt,
    exclusionReason: spec.exclusionReason,
    entryUrlPath: spec.paths[0] ?? null,
    events,
  };
}

function cohort(input: {
  readonly idPrefix: string;
  readonly count: number;
  readonly paths: readonly string[];
  readonly exceptionCountFor: (index: number) => number;
  readonly exceptionName: string;
  readonly exclusionReason: ExclusionReason;
  readonly firstStartedAt: Date;
}): readonly SessionTimeline[] {
  return Array.from({ length: input.count }, (_unused, index) =>
    sessionTimelineOf({
      sessionId: `${input.idPrefix}-${String(index).padStart(3, "0")}`,
      startedAt: new Date(input.firstStartedAt.getTime() + index * T1PUR_SESSION_STRIDE_MS),
      paths: input.paths,
      exceptionCount: input.exceptionCountFor(index),
      exceptionName: input.exceptionName,
      exclusionReason: input.exclusionReason,
    }),
  );
}

const DROPPER_PATHS: readonly string[] = [T1PUR_ORIGIN];

const STRUGGLER_PATHS: readonly string[] = [
  T1PUR_ORIGIN,
  T1PUR_DETOUR,
  T1PUR_ORIGIN,
  T1PUR_DETOUR,
  T1PUR_ORIGIN,
  T1PUR_DESTINATION,
];

function basisOf(sessions: readonly SessionTimeline[]): CountBasis {
  const setAside = sessions.filter((session) => session.exclusionReason === "internal_domain");
  return {
    totalInWindow: sessions.length,
    kept: sessions.filter((session) => session.exclusionReason === "none").length,
    setAside:
      setAside.length > 0
        ? [
            {
              reason: "internal_domain",
              count: setAside.length,
              label: EXCLUSION_REASON_LABELS.internal_domain,
            },
          ]
        : [],
  };
}

function multiSignalCorpus(ruleSet: ThresholdRuleSet): DetectorCorpus {
  const sessions: readonly SessionTimeline[] = [
    ...cohort({
      idPrefix: "t1pur-converted",
      count: CONVERTERS,
      paths: [T1PUR_ORIGIN, T1PUR_DESTINATION],
      exceptionCountFor: () => 0,
      exceptionName: ruleSet.exceptionEventName,
      exclusionReason: "none",
      firstStartedAt: T1PUR_FIRST_SESSION_AT,
    }),
    ...cohort({
      idPrefix: "t1pur-dropped",
      count: DROPPERS,
      paths: DROPPER_PATHS,

      exceptionCountFor: (index) => (index < SESSIONS_WITH_EXCEPTIONS ? EXCEPTIONS_PER_SESSION : 0),
      exceptionName: ruleSet.exceptionEventName,
      exclusionReason: "none",
      firstStartedAt: new Date(T1PUR_FIRST_SESSION_AT.getTime() + 3_600_000),
    }),
    ...cohort({
      idPrefix: "t1pur-struggled",
      count: STRUGGLERS,
      paths: STRUGGLER_PATHS,
      exceptionCountFor: () => 0,
      exceptionName: ruleSet.exceptionEventName,
      exclusionReason: "none",
      firstStartedAt: new Date(T1PUR_FIRST_SESSION_AT.getTime() + 5_400_000),
    }),
    ...cohort({
      idPrefix: "t1pur-setaside",
      count: SET_ASIDE,
      paths: [T1PUR_ORIGIN, T1PUR_DESTINATION],
      exceptionCountFor: () => EXCEPTIONS_PER_SESSION,
      exceptionName: ruleSet.exceptionEventName,
      exclusionReason: "internal_domain",
      firstStartedAt: new Date(T1PUR_FIRST_SESSION_AT.getTime() + 7_200_000),
    }),
  ];

  const eventsWithoutUrlPath = 0;
  return {
    projectId: "t1pur-project",
    window: T1PUR_WINDOW,
    connectionState: T1PUR_CONNECTION_STATE,
    sessions,
    basis: basisOf(sessions),
    coverage: { truncated: false, eventsWithoutUrlPath },
  };
}

const DETECTORS: readonly {
  readonly name: string;
  readonly run: (corpus: DetectorCorpus, ruleSet: ThresholdRuleSet) => DetectorResult;
}[] = [
  { name: "funnel_dropoff", run: detectFunnelDropoff },
  { name: "error_event", run: detectErrorEvent },
];

const NAMED_CONSTANT_FIXTURE = `
const PERCENT_SCALE_FIXTURE = 100;

export function detectFixture(corpus: FixtureCorpus, ruleSet: FixtureRules): boolean {
  return corpus.dropped * PERCENT_SCALE_FIXTURE >= ruleSet.thresholdPercent * corpus.atOrigin;
}
`;

const INLINE_LITERAL_FIXTURE = `
export function detectFixture(corpus: FixtureCorpus, ruleSet: FixtureRules): boolean {
  return corpus.dropped * 100 >= ruleSet.thresholdPercent * corpus.atOrigin;
}
`;

describe("detector purity and coverage", () => {
  test("should produce byte-identical output for identical inputs across two calls, for every detector", () => {
    const ruleSet = ruleSetV1();

    for (const detector of DETECTORS) {
      const shared = multiSignalCorpus(ruleSet);
      const first = JSON.stringify(detector.run(shared, ruleSet));
      const second = JSON.stringify(detector.run(shared, ruleSet));

      expect(detector.run(shared, ruleSet).candidates.length).toBeGreaterThan(0);
      expect(second).toBe(first);

      const rebuilt = JSON.stringify(detector.run(multiSignalCorpus(ruleSet), ruleSet));
      expect(rebuilt).toBe(first);
      expect(rebuilt.length).toBeGreaterThan(0);
    }
  });

  test("should import nothing from @growthmind/db in any detect module", async () => {
    const modules = await scanSourceModules();
    const detectModules = modules.filter(isDetectModule);

    expect(modules.length).toBeGreaterThan(0);
    expect(detectModules.map((module) => module.path)).toContain("detect/funnel-dropoff.ts");
    expect(detectModules.map((module) => module.path)).toContain("detect/error-event.ts");

    const funnel = detectModules.find((module) => module.path === "detect/funnel-dropoff.ts");
    expect(funnel?.specifiers).toContain("../counts/measured-count");
    expect(funnel?.specifiers).toContain("../rules/types");

    const offenders = detectModules.flatMap((module) =>
      module.specifiers
        .filter((specifier) => specifier.split("/").slice(0, 2).join("/") === "@growthmind/db")
        .map((specifier) => `${module.path} :: ${specifier}`),
    );

    expect(offenders).toEqual([]);

    const packageWide = modules.flatMap((module) =>
      module.specifiers
        .filter((specifier) => specifier.split("/").slice(0, 2).join("/") === "@growthmind/db")
        .map((specifier) => `${module.path} :: ${specifier}`),
    );
    expect(packageWide).toEqual([]);
  });

  test("should import no node builtin anywhere in packages/core", async () => {
    const modules = await scanSourceModules();

    expect(modules.length).toBeGreaterThan(0);
    expect(modules.map((module) => module.path)).toContain("evidence/gate.ts");
    expect(modules.flatMap((module) => module.specifiers)).toContain("zod");

    const hashingTest = await Bun.file(`${TESTS_DIR}/rules/thresholds.test.ts`).text();
    const hashingSpecifiers = collectImportSpecifiers(hashingTest);
    expect(hashingSpecifiers.filter(isNodeBuiltin)).toEqual(["node:crypto"]);

    const offenders = modules.flatMap((module) =>
      module.specifiers.filter(isNodeBuiltin).map((specifier) => `${module.path} :: ${specifier}`),
    );

    expect(offenders).toEqual([]);

    const ambient = modules.flatMap((module) => {
      const { codeOnly } = stripSource(module.source);
      return [/\bDate\s*\.\s*now\s*\(/, /\bMath\s*\.\s*random\s*\(/, /\bnew\s+Date\s*\(\s*\)/]
        .filter((pattern) => pattern.test(codeOnly))
        .map((pattern) => `${module.path} :: ${pattern.source}`);
    });
    expect(ambient).toEqual([]);
  });

  test("should take the rule set as a parameter in every detector signature, never reaching for CURRENT_", async () => {
    const modules = await scanSourceModules();
    const detectModules = modules.filter(isDetectModule);

    const detectors = detectModules.flatMap((module) =>
      exportedDetectorsOf(module.source).map((name) => ({ module, name })),
    );

    expect(detectors.map((entry) => entry.name).toSorted()).toEqual([
      "detectErrorEvent",
      "detectFunnelDropoff",
    ]);

    for (const detector of detectors) {
      const region = collectFunctionRegions(detector.module.source).find(
        (candidate) => candidate.owner === detector.name,
      );
      expect(region).toBeDefined();

      expect(region?.params).toMatch(/\bruleSet\s*:\s*ThresholdRuleSet\b/);
      expect(region?.params).not.toMatch(/\bruleSet\s*\?/);
      expect(region?.params).not.toMatch(/\bruleSet\s*:\s*ThresholdRuleSet\s*=/);
    }

    const reaching = detectModules
      .filter((module) => /\bCURRENT_/.test(stripSource(module.source).codeOnly))
      .map((module) => module.path);
    expect(reaching).toEqual([]);

    const allowed: ReadonlySet<string> = new Set(["rules/thresholds.ts", "index.ts"]);
    const packageWide = modules
      .filter(
        (module) =>
          !allowed.has(module.path) && /\bCURRENT_/.test(stripSource(module.source).codeOnly),
      )
      .map((module) => module.path);
    expect(packageWide).toEqual([]);
  });

  test("should contain no numeric literal in any detector body", async () => {
    expect(numericLiteralsInFunctionBodies(NAMED_CONSTANT_FIXTURE)).toEqual([]);
    expect(numericLiteralsInFunctionBodies(INLINE_LITERAL_FIXTURE)).toEqual([
      { owner: "detectFixture", literal: "100" },
    ]);

    const modules = await scanSourceModules();
    const detectorModules = modules.filter(
      (module) => isDetectModule(module) && exportedDetectorsOf(module.source).length > 0,
    );

    expect(detectorModules.map((module) => module.path).toSorted()).toEqual([
      "detect/error-event.ts",
      "detect/funnel-dropoff.ts",
    ]);

    for (const scanned of detectorModules) {
      const regions = collectFunctionRegions(scanned.source);

      expect(regions.length).toBeGreaterThan(0);
      for (const region of regions) {
        expect(region.text.trimEnd().endsWith("}")).toBe(true);
      }

      expect(scanned.source).not.toMatch(/^(?:export\s+)?const\s+\w+[^\n]*=>/m);
    }

    const funnelRegions = collectFunctionRegions(
      detectorModules.find((module) => module.path === "detect/funnel-dropoff.ts")?.source ?? "",
    );
    expect(funnelRegions.find((region) => region.owner === "detectFunnelDropoff")?.text).toContain(
      "funnelMinSessionsAtOrigin",
    );

    const offenders = detectorModules.flatMap((module) =>
      numericLiteralsInFunctionBodies(module.source).map(
        (offender) => `${module.path} :: ${offender.owner} :: ${offender.literal}`,
      ),
    );

    expect(offenders).toEqual([]);
  });

  test("should assert purity scans packages/core/src and nothing wider", async () => {
    const segments: string[] = [];
    for (const segment of SRC_DIR.replaceAll("\\", "/").split("/")) {
      if (segment === "..") segments.pop();
      else if (segment !== ".") segments.push(segment);
    }
    const resolved = segments.join("/");

    expect(resolved.endsWith("/packages/core/src")).toBe(true);

    expect(resolved).not.toContain("/packages/db/");
    expect(resolved).not.toContain("/packages/shared/");
    expect(resolved).not.toContain("/packages/adapters/");

    const paths = await listSourceModules();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toContain("detect/error-event.ts");
    expect(paths.filter((path) => path.endsWith("signatures/hex.ts"))).toEqual([]);

    const hexSource = await Bun.file(`${SRC_DIR}/../../db/src/signatures/hex.ts`).text();
    expect(collectImportSpecifiers(hexSource).filter(isNodeBuiltin)).toEqual(["node:crypto"]);
  });

  test("should produce the declared number of candidates when one session carries two matching signals", () => {
    const ruleSet = ruleSetV1();
    const corpus = multiSignalCorpus(ruleSet);

    expect(corpus.basis.kept).toBe(KEPT_AT_ORIGIN);
    expect(corpus.basis.totalInWindow).toBe(KEPT_AT_ORIGIN + SET_ASIDE);

    const errors = detectErrorEvent(corpus, ruleSet);

    expect(errors.candidates).toHaveLength(ERROR_DECLARED_CANDIDATES);
    const errorCandidate = errors.candidates[0];
    expect(errorCandidate.surface).toBe(T1PUR_ORIGIN);

    expect(errorCandidate.signals).toHaveLength(SESSIONS_WITH_EXCEPTIONS * EXCEPTIONS_PER_SESSION);

    expect(errorCandidate.counts).toHaveLength(ERROR_DECLARED_COUNTS);
    expect(errorCandidate.counts[0].numerator).toBe(SESSIONS_WITH_EXCEPTIONS);
    expect(errorCandidate.counts[0].denominator).toBe(KEPT_AT_ORIGIN);
    expect(errorCandidate.counts[0].unit).toBe("sessions");

    const funnel = detectFunnelDropoff(corpus, ruleSet);

    expect(funnel.candidates).toHaveLength(FUNNEL_DECLARED_CANDIDATES);
    const candidate = funnel.candidates[0];
    expect(candidate.surface).toBe(T1PUR_ORIGIN);

    expect(candidate.counts).toHaveLength(FUNNEL_DECLARED_COUNTS);
    expect(candidate.counts[0].numerator).toBe(KEPT_AT_ORIGIN);
    for (const count of candidate.counts) {
      expect(count.denominator).toBe(KEPT_AT_ORIGIN);
    }

    expect(candidate.counts[1].numerator).toBe(DROPPERS);
    expect(candidate.counts[1].denominator).toBe(corpus.basis.kept);

    const struggles = candidate.signals.filter((signal) => signal.kind === "struggle");
    expect(struggles).toHaveLength(1);
    expect(struggles[0]).toMatchObject({
      kind: "struggle",
      subkind: "repeated_attempt",
      surface: T1PUR_ORIGIN,
      attempts: ORIGIN_VISITS_PER_STRUGGLER,
    });

    const struggle = struggles[0];
    if (struggle?.kind !== "struggle") throw new Error("expected a struggle signal");
    expect(struggle.strugglingSessions.numerator).toBe(STRUGGLERS);
    expect(struggle.strugglingSessions.denominator).toBe(struggle.strugglingSessions.basis.kept);
  });
});
