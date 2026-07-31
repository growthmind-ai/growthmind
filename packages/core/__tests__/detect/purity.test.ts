// ADD §7 "Unit — detector purity and coverage" — the six named tests (O-004
// FR-5, FR-8, D-13, and D3 multiplicity).
//
// WHAT THIS FILE IS FOR. Five of the six tests here assert nothing about what a
// detector computes. They assert what a detector is ALLOWED TO REACH FOR — no
// database, no node builtin, no clock, no randomness, no magnitude written into
// a body. That is the difference between "FR-5 was reviewed and looked pure"
// and "FR-5 is true by construction": a reviewer reads one diff, a scan reads
// every module, every time, including the ones a later sprint adds.
//
// TEST 3 IS THE LOAD-BEARING ONE. `packages/core` importing NO node builtin at
// all is what makes FR-5's "no clock, no randomness" an auditable property
// rather than a promise. There is no `node:crypto` to hash with, no `node:fs`
// to read with, no `perf_hooks` to time with — so the surface on which an
// impurity could enter simply does not exist.
//
// AND THE ASYMMETRY IS THE POINT (D-13). `node:crypto`'s `createHash` DOES
// legitimately appear in `__tests__/rules/thresholds.test.ts`: FR-11's content
// hash is a TEST ARTEFACT, computed by the test to prove the rule set's
// canonical serialisation is stable. A test may reach for a builtin; shipped
// `src/` may not. So test 3 scans `src/` ONLY — and proves its scanner is not
// blind by running it against that very test file and asserting it DOES find
// the builtin there.
//
// TWO PRECEDENTS ARE FOLLOWED HERE DELIBERATELY:
//
//  - `packages/db/__tests__/repositories/no-org-param.test.ts` — parse
//    DECLARATIONS, never grep raw text. A text grep matches the word inside a
//    comment explaining why the thing is forbidden, and inside a string, and
//    then reports confidently that the code is clean because it also matched
//    something real. Every scan below runs over source with comments and (for
//    the numeric scan) string literals blanked out first, and then over
//    STATEMENTS and FUNCTION REGIONS, not over the file.
//
//  - `packages/db/__tests__/system/reachability.test.ts` — assert NON-VACUITY
//    before asserting zero offenders. A scan over an empty file list passes
//    perfectly and means nothing. Every test below first proves it found the
//    modules, the imports, or the bodies it claims to be checking.
//
// PL RULING 26 IS BINDING ON TEST 5. FR-8's target is UNNAMED numeric literals
// INSIDE DETECTOR FUNCTION BODIES. A named module constant is not merely
// tolerated, it is the opposite of the magic number FR-8 exists to prevent —
// `PERCENT_SCALE = 100` at `src/counts/percent.ts` is exactly right, and could
// not have come from the rule set (it is arithmetic, not a threshold). So the
// scan below is over FUNCTION BODIES, never over modules, and test 5 proves
// that distinction on two synthetic fixtures before it reports on the real
// ones: a module-level `const NAME = 100` must PASS, an inline `100` in a body
// must FAIL.
//
// HOUSE RULES (STATE.md standing constraints):
//  - No `Date.now()`. Every instant in this file descends from the frozen
//    constants below.
//  - No node builtin — this suite reads source with `Bun.file` and enumerates
//    it with `Bun.Glob`, so it does not become the offender it is policing.
//  - Lane prefix `t1pur`, shared with no other suite (ADD §6.5).
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

// ===========================================================================
// PART 1 — the source scanner
// ===========================================================================

const SRC_DIR = `${import.meta.dir}/../../src`;
const TESTS_DIR = `${import.meta.dir}/..`;

/** Enumerated with `Bun.Glob`, not `node:fs` — see the header. Paths are
 * returned relative to `src/`, with forward slashes on every platform. */
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

/**
 * The two views of a module this file scans over.
 *
 * `withoutComments` keeps string literals intact — import SPECIFIERS live in
 * them. `codeOnly` blanks the strings too, so a magnitude mentioned inside a
 * message string can never be reported as a magic number.
 *
 * Both are produced by ONE left-to-right pass rather than by a pair of
 * independent regexes, because the naive version has a real bug: blanking
 * comments first turns the `//` inside a `"https://…"` literal into a
 * line-comment start and eats the rest of the line. Blanking preserves LENGTH
 * and NEWLINES, so every index and every line boundary still lines up with the
 * original file.
 */
type StrippedSource = {
  readonly withoutComments: string;
  readonly codeOnly: string;
};

/** Overwrites `[from, to)` with spaces, leaving newlines in place so line
 * boundaries — and therefore column-zero brace detection — still line up with
 * the original file. */
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
      // Strings survive in `withoutComments` — specifiers are read from them.
      blank(codeOnly, cursor, scan);
      cursor = scan;
      continue;
    }

    cursor += 1;
  }

  return { withoutComments: withoutComments.join(""), codeOnly: codeOnly.join("") };
}

/**
 * Every module specifier this module DECLARES — the statement-level parse the
 * `no-org-param` precedent insists on.
 *
 * Static `import`/`export … from` statements are matched at the start of a
 * line (a TypeScript module cannot declare one anywhere else), then the
 * specifier is read from that statement's own `from` clause. Bare side-effect
 * imports, dynamic `import()`, and `require()` are collected too — each of
 * them is a door into the same house, and a scan that only reads the static
 * form invites the dodge.
 */
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

/** A function DECLARATION's own text: its parameter list, its return type, and
 * its body — everything except the `function name` that introduces it. */
type FunctionRegion = {
  readonly owner: string;
  /** The balanced parameter list, without the enclosing parens. */
  readonly params: string;
  /** Parameters, return type and body, comment- and string-blanked. */
  readonly text: string;
};

/** The text between `source[openIndex]` (an open paren) and its match. Lifted
 * from the `no-org-param` precedent for the same reason it exists there: a
 * RETURN type naming something must never be mistaken for a parameter. */
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

/**
 * Every function declared in a module, as a region running from its open paren
 * to its closing brace.
 *
 * The terminator is the first `}` AT COLUMN ZERO after the head — a top-level
 * declaration's own closing brace, and unreachable from inside a body, where
 * every brace is indented. Deliberately NOT brace-matching from the first `{`
 * after the parameter list: `attributionOf` in `error-event.ts` returns an
 * object TYPE literal, so the first `{` after its parameters belongs to the
 * return type and a naive matcher would call the type the body.
 *
 * The consequence that matters for test 5: module-level code — a named
 * constant, an exported literal — lies OUTSIDE every region and is therefore
 * never scanned, which is precisely what PL ruling 26 requires.
 */
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

/**
 * A numeric literal, and nothing that merely contains a digit.
 *
 * The lookbehind is what separates `100` from the `1` in `v1`, `sha256`, or
 * `PERCENT_SCALE_2`: a digit preceded by an identifier character is part of a
 * NAME, and a name is the thing FR-8 is asking for. Array indices (`counts[0]`)
 * DO match, deliberately — this package's own style already destructures
 * (`const [first] = versions`) rather than indexing, and a positional index
 * inside a detector is a magnitude with no name just like any other.
 */
const NUMERIC_LITERAL = /(?<![\w$.])\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Every unnamed numeric literal inside a function declared in this source. */
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

/**
 * Node's builtin module names. `node:`-prefixed specifiers are caught by the
 * prefix; the bare forms are caught by this set, and a subpath (`fs/promises`)
 * by its first segment.
 */
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

/** Every module under `src/`, with both scanner views and its specifiers. */
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

/** A DETECTOR is a module under `detect/` exporting a `detect…` function. The
 * set is DERIVED rather than listed, so a third detector added next sprint is
 * scanned by tests 4 and 5 automatically instead of quietly escaping them. */
function exportedDetectorsOf(source: string): readonly string[] {
  const { codeOnly } = stripSource(source);
  return [...codeOnly.matchAll(/export\s+function\s+(detect\w+)\s*\(/g)].map(
    (match) => match[1] ?? "",
  );
}

// ===========================================================================
// PART 2 — the runtime corpus (tests 1 and 6)
// ===========================================================================

/** Frozen fixture time. No test in this file can be time-of-day flaky. */
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

/**
 * Fixture magnitudes, chosen so BOTH detectors fire on one corpus.
 *
 * 25 kept sessions reach the origin (>= `funnelMinSessionsAtOrigin` 20); 12
 * never reach the destination (>= `funnelMinDropoffSessions` 5, and
 * 12 * 100 >= 40 * 25); 4 sessions carry the exception (>=
 * `errorMinAffectedSessions` 3); each dropper visits the origin 3 times (>=
 * `struggleRepeatedAttemptMin` 3). Three set-aside sessions sit in the corpus
 * alongside them, so a silent FR-7 leak moves the numbers test 6 names.
 */
const KEPT_AT_ORIGIN = 25;
const DROPPERS = 12;
const CONVERTERS = KEPT_AT_ORIGIN - DROPPERS;
const SET_ASIDE = 3;
const SESSIONS_WITH_EXCEPTIONS = 4;
const EXCEPTIONS_PER_SESSION = 2;
const ORIGIN_VISITS_PER_DROPPER = 3;

/** PL ruling 15: `funnel_dropoff.counts` is exactly two entries. PL ruling 25:
 * `error_event.counts` is exactly one. */
const FUNNEL_DECLARED_COUNTS = 2;
const ERROR_DECLARED_COUNTS = 1;

/**
 * PL ruling 15 / the transitions this corpus observes:
 *   `/t1pur/pricing` -> `/t1pur/checkout` (the 12 droppers never arrive), and
 *   `/t1pur/pricing` -> `/t1pur/support`  (the 13 converters never detour).
 * `/t1pur/support` is reached by only 12 sessions, below the origin floor, so
 * it opens no candidate of its own.
 */
const FUNNEL_DECLARED_CANDIDATES = 2;
/** Every exception lands on ONE surface, so `error_event` declares one
 * candidate however many exceptions each session carries. */
const ERROR_DECLARED_CANDIDATES = 1;

/** The v1 rule set, fetched BY VERSION, never "whatever is current" (D-14). */
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
  /** REQUIRED — no fixture may seed an instant from a clock (ADD §6.5). */
  readonly startedAt: Date;
  readonly paths: readonly string[];
  /** Appended after the path walk, on the origin surface. */
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

/** The dropper's walk: three separate visits to the origin, and the
 * destination never reached. */
const DROPPER_PATHS: readonly string[] = [
  T1PUR_ORIGIN,
  T1PUR_DETOUR,
  T1PUR_ORIGIN,
  T1PUR_DETOUR,
  T1PUR_ORIGIN,
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

/**
 * ONE corpus on which both detectors fire, built fresh on every call — so
 * test 1 can compare two runs over two structurally identical but distinct
 * object graphs, not over the same one twice.
 *
 * The exception name comes from the RULE SET, never from a literal here
 * (D-18): the fixture reads the contract the same way the detector does.
 */
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
      // The D3 fixture: the first four droppers each carry TWO exceptions on
      // one surface. A detector that fanned out per SIGNAL rather than per
      // SESSION would report eight affected sessions instead of four.
      exceptionCountFor: (index) => (index < SESSIONS_WITH_EXCEPTIONS ? EXCEPTIONS_PER_SESSION : 0),
      exceptionName: ruleSet.exceptionEventName,
      exclusionReason: "none",
      firstStartedAt: new Date(T1PUR_FIRST_SESSION_AT.getTime() + 3_600_000),
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

/** Every detector this sprint ships, as a name plus its entry point — so tests
 * 1 and 6 say "for every detector" and mean it. */
const DETECTORS: readonly {
  readonly name: string;
  readonly run: (corpus: DetectorCorpus, ruleSet: ThresholdRuleSet) => DetectorResult;
}[] = [
  { name: "funnel_dropoff", run: detectFunnelDropoff },
  { name: "error_event", run: detectErrorEvent },
];

// ===========================================================================
// PART 3 — test 5's proof fixtures
// ===========================================================================

/**
 * PL ruling 26, stated as two sources rather than as a claim.
 *
 * The first is what the shipped code looks like today: the magnitude has a
 * NAME, declared at module level, and the body reads the name. The second is
 * the regression FR-8 exists to catch: the same magnitude inlined into the
 * body. Test 5 runs its own scanner over both BEFORE it reports on the real
 * detectors, so "this scan would catch a reintroduced literal" is demonstrated
 * rather than asserted.
 */
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

// ===========================================================================

describe("detector purity and coverage (FR-5, FR-8, D-13)", () => {
  // --- test 1 --------------------------------------------------------------
  test("should produce byte-identical output for identical inputs across two calls, for every detector", () => {
    const ruleSet = ruleSetV1();

    for (const detector of DETECTORS) {
      // (a) THE SAME OBJECT GRAPH, TWICE. Catches a detector that mutates its
      // input, memoises across calls, or lets an internal accumulator survive.
      const shared = multiSignalCorpus(ruleSet);
      const first = JSON.stringify(detector.run(shared, ruleSet));
      const second = JSON.stringify(detector.run(shared, ruleSet));

      // Non-vacuity: two empty results are byte-identical and prove nothing.
      expect(detector.run(shared, ruleSet).candidates.length).toBeGreaterThan(0);
      expect(second).toBe(first);

      // (b) TWO DISTINCT BUT STRUCTURALLY IDENTICAL GRAPHS. This is the half
      // that would catch a `Date.now()`, a `Math.random()`, an id counter, or
      // an iteration order derived from object identity — none of which the
      // repeat-call comparison above can see.
      const rebuilt = JSON.stringify(detector.run(multiSignalCorpus(ruleSet), ruleSet));
      expect(rebuilt).toBe(first);
      expect(rebuilt.length).toBeGreaterThan(0);
    }
  });

  // --- test 2 --------------------------------------------------------------
  test("should import nothing from @growthmind/db in any detect module", async () => {
    const modules = await scanSourceModules();
    const detectModules = modules.filter(isDetectModule);

    // Non-vacuity, three ways: the scan found modules, it found the DETECT
    // modules by name, and its specifier parse actually returns specifiers.
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

    // The dependency arrow is `db -> core`, never the reverse. A detector that
    // could reach the database would stop being a pure function of its corpus,
    // and every determinism claim above it would become unprovable.
    expect(offenders).toEqual([]);

    // Strictly stronger, and true today: NOTHING under `src/` imports it, so
    // the arrow cannot be reversed anywhere in this package.
    const packageWide = modules.flatMap((module) =>
      module.specifiers
        .filter((specifier) => specifier.split("/").slice(0, 2).join("/") === "@growthmind/db")
        .map((specifier) => `${module.path} :: ${specifier}`),
    );
    expect(packageWide).toEqual([]);
  });

  // --- test 3 --------------------------------------------------------------
  test("should import no node builtin anywhere in packages/core", async () => {
    const modules = await scanSourceModules();

    // Non-vacuity (a): the scan really enumerated `src/`.
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.map((module) => module.path)).toContain("evidence/gate.ts");
    expect(modules.flatMap((module) => module.specifiers)).toContain("zod");

    // Non-vacuity (b), and THE POINT OF D-13. `node:crypto` legitimately
    // appears in `__tests__/rules/thresholds.test.ts` — FR-11's content hash is
    // a TEST ARTEFACT, and a test may reach for a builtin that shipped code may
    // not. Running the very same collector over that file proves the scan below
    // is not simply blind to builtins: it finds this one, and reports zero in
    // `src/` because there are none there.
    const hashingTest = await Bun.file(`${TESTS_DIR}/rules/thresholds.test.ts`).text();
    const hashingSpecifiers = collectImportSpecifiers(hashingTest);
    expect(hashingSpecifiers.filter(isNodeBuiltin)).toEqual(["node:crypto"]);

    const offenders = modules.flatMap((module) =>
      module.specifiers.filter(isNodeBuiltin).map((specifier) => `${module.path} :: ${specifier}`),
    );

    // FR-5's "no clock, no randomness" BY CONSTRUCTION: with no builtin in
    // reach there is no `perf_hooks` to time with, no `crypto` to draw entropy
    // from, and no `fs` to read state from. The property is a fact about the
    // module graph rather than a claim a reviewer has to re-check every sprint.
    expect(offenders).toEqual([]);

    // The two ambient impurities a builtin ban does NOT cover, since both are
    // language globals: a wall clock and a random source.
    const ambient = modules.flatMap((module) => {
      const { codeOnly } = stripSource(module.source);
      return [/\bDate\s*\.\s*now\s*\(/, /\bMath\s*\.\s*random\s*\(/, /\bnew\s+Date\s*\(\s*\)/]
        .filter((pattern) => pattern.test(codeOnly))
        .map((pattern) => `${module.path} :: ${pattern.source}`);
    });
    expect(ambient).toEqual([]);
  });

  // --- test 4 --------------------------------------------------------------
  test("should take the rule set as a parameter in every detector signature, never reaching for CURRENT_", async () => {
    const modules = await scanSourceModules();
    const detectModules = modules.filter(isDetectModule);

    const detectors = detectModules.flatMap((module) =>
      exportedDetectorsOf(module.source).map((name) => ({ module, name })),
    );

    // Non-vacuity: the DERIVED detector set really contains both detectors this
    // sprint ships. Derived rather than listed, so a third one is scanned
    // automatically instead of quietly escaping.
    expect(detectors.map((entry) => entry.name).toSorted()).toEqual([
      "detectErrorEvent",
      "detectFunnelDropoff",
    ]);

    for (const detector of detectors) {
      const region = collectFunctionRegions(detector.module.source).find(
        (candidate) => candidate.owner === detector.name,
      );
      expect(region).toBeDefined();

      // D-14: the rule set ARRIVES. It is not fetched, not defaulted, and not
      // optional — an optional rule set is a reach for the current one with
      // extra steps, and would make a v1 replay silently produce a v2 verdict.
      expect(region?.params).toMatch(/\bruleSet\s*:\s*ThresholdRuleSet\b/);
      expect(region?.params).not.toMatch(/\bruleSet\s*\?/);
      expect(region?.params).not.toMatch(/\bruleSet\s*:\s*ThresholdRuleSet\s*=/);
    }

    // ...and nothing under `detect/` names the current rule set at all, in a
    // signature or in a body. Comments are blanked first, so the two modules
    // whose prose says "nothing here reads `CURRENT_*`" are not what is being
    // read here (the `no-org-param` precedent's whole reason for existing).
    const reaching = detectModules
      .filter((module) => /\bCURRENT_/.test(stripSource(module.source).codeOnly))
      .map((module) => module.path);
    expect(reaching).toEqual([]);

    // Strictly stronger: only the module that DEFINES the current rule set and
    // the barrel that re-exports it may name it. Every consumer takes it as a
    // parameter. The allowlist is two entries long and auditable at a glance.
    const allowed: ReadonlySet<string> = new Set(["rules/thresholds.ts", "index.ts"]);
    const packageWide = modules
      .filter(
        (module) =>
          !allowed.has(module.path) && /\bCURRENT_/.test(stripSource(module.source).codeOnly),
      )
      .map((module) => module.path);
    expect(packageWide).toEqual([]);
  });

  // --- test 5 --------------------------------------------------------------
  test("should contain no numeric literal in any detector body", async () => {
    // (a) THE SCANNER IS PROVEN BEFORE IT IS TRUSTED (PL ruling 26). A named
    // module constant must PASS — it is what FR-8 is asking for. The same
    // magnitude inlined into a body must FAIL. If these two disagreed, every
    // assertion below would be theatre.
    expect(numericLiteralsInFunctionBodies(NAMED_CONSTANT_FIXTURE)).toEqual([]);
    expect(numericLiteralsInFunctionBodies(INLINE_LITERAL_FIXTURE)).toEqual([
      { owner: "detectFixture", literal: "100" },
    ]);

    const modules = await scanSourceModules();
    const detectorModules = modules.filter(
      (module) => isDetectModule(module) && exportedDetectorsOf(module.source).length > 0,
    );

    // Non-vacuity (a): the derived module set is the two detectors.
    expect(detectorModules.map((module) => module.path).toSorted()).toEqual([
      "detect/error-event.ts",
      "detect/funnel-dropoff.ts",
    ]);

    for (const scanned of detectorModules) {
      const regions = collectFunctionRegions(scanned.source);

      // Non-vacuity (b): the region extractor found real bodies, and they are
      // whole ones — each ends at its own closing brace, and each detector's
      // region contains the rule-set member only its body names.
      expect(regions.length).toBeGreaterThan(0);
      for (const region of regions) {
        expect(region.text.trimEnd().endsWith("}")).toBe(true);
      }

      // Non-vacuity (c): the scan covers EVERYTHING executable in the module.
      // Only `function` declarations are collected, so this asserts the module
      // declares nothing else — no module-level arrow function could sit
      // outside the regions above and dodge the check.
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

    // FR-8: every magnitude a detector compares against arrives on the rule-set
    // parameter, and the one number that cannot (the percent scale — arithmetic,
    // not a threshold) has a NAME and a home at `src/counts/percent.ts`. A bare
    // number in a body is a threshold nobody can version, review, or replay.
    expect(offenders).toEqual([]);
  });

  // --- test 6 --------------------------------------------------------------
  test("should produce the declared number of candidates when one session carries two matching signals", () => {
    const ruleSet = ruleSetV1();
    const corpus = multiSignalCorpus(ruleSet);

    // Fixture self-check. If these drift, every number below stops meaning what
    // its name says.
    expect(corpus.basis.kept).toBe(KEPT_AT_ORIGIN);
    expect(corpus.basis.totalInWindow).toBe(KEPT_AT_ORIGIN + SET_ASIDE);

    // --- error_event: two exceptions in one session -------------------------
    const errors = detectErrorEvent(corpus, ruleSet);

    // D3. Four sessions carry two exceptions each on ONE surface. The declared
    // output is ONE candidate — not one per exception, and not one per session.
    expect(errors.candidates).toHaveLength(ERROR_DECLARED_CANDIDATES);
    const errorCandidate = errors.candidates[0];
    expect(errorCandidate.surface).toBe(T1PUR_ORIGIN);

    // BOTH signals survive — the second is never deduplicated away, because
    // evidence is what a founder reads...
    expect(errorCandidate.signals).toHaveLength(SESSIONS_WITH_EXCEPTIONS * EXCEPTIONS_PER_SESSION);
    // ...but the COUNT is over sessions, and a session that threw twice is one
    // affected session. This is the number that reaches a customer as
    // "4 of 25 sessions", and double-counting it would be a fabricated claim.
    expect(errorCandidate.counts).toHaveLength(ERROR_DECLARED_COUNTS);
    expect(errorCandidate.counts[0].numerator).toBe(SESSIONS_WITH_EXCEPTIONS);
    expect(errorCandidate.counts[0].denominator).toBe(KEPT_AT_ORIGIN);
    expect(errorCandidate.counts[0].unit).toBe("sessions");

    // --- funnel_dropoff: three visits to one surface in one session ---------
    const funnel = detectFunnelDropoff(corpus, ruleSet);

    // One candidate per observed transition out of a qualifying origin — two —
    // and not one per visit, per session, or per repeated attempt.
    expect(funnel.candidates).toHaveLength(FUNNEL_DECLARED_CANDIDATES);
    expect(funnel.candidates.map((candidate) => candidate.surface)).toEqual([
      T1PUR_ORIGIN,
      T1PUR_ORIGIN,
    ]);

    for (const candidate of funnel.candidates) {
      // PL ruling 15: exactly two counts, in declared order, both over kept
      // sessions.
      expect(candidate.counts).toHaveLength(FUNNEL_DECLARED_COUNTS);
      expect(candidate.counts[0].numerator).toBe(KEPT_AT_ORIGIN);
      for (const count of candidate.counts) {
        expect(count.denominator).toBe(KEPT_AT_ORIGIN);
      }

      // D3 again, on the other detector: twelve sessions visited the origin
      // three times apiece. That is ONE struggle signal carrying the per-session
      // maximum — not twelve signals, not one per visit, and not 36 attempts.
      const struggles = candidate.signals.filter((signal) => signal.kind === "struggle");
      expect(struggles).toHaveLength(1);
      expect(struggles[0]).toMatchObject({
        kind: "struggle",
        subkind: "repeated_attempt",
        surface: T1PUR_ORIGIN,
        attempts: ORIGIN_VISITS_PER_DROPPER,
      });

      // The COHORT half of the same claim, and the number the gate actually
      // turns on: twelve DISTINCT sessions each reached the threshold, over the
      // 25 kept. `attempts` above is one session's visit depth and says nothing
      // about how many people struggled — asserting only it would leave the
      // deciding number unchecked.
      const struggle = struggles[0];
      if (struggle?.kind !== "struggle") throw new Error("expected a struggle signal");
      expect(struggle.strugglingSessions.numerator).toBe(DROPPERS);
      expect(struggle.strugglingSessions.denominator).toBe(struggle.strugglingSessions.basis.kept);
    }

    // The two transitions are distinct claims about the same origin, and their
    // drop-off numerators are the two disjoint cohorts.
    expect(
      funnel.candidates.map((candidate) => candidate.counts[1].numerator).toSorted((a, b) => a - b),
    ).toEqual([DROPPERS, CONVERTERS]);
  });
});
