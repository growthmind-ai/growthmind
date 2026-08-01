// Unit tests for detector purity and coverage: the six named tests (and multiplicity).
//
// What this file is for. Five of the six tests here assert nothing about what a
// detector computes. They assert what a detector is allowed to reach for. No database,
// no node builtin, no clock, no randomness, no magnitude written into a body. That is
// the difference between "That decision was reviewed and looked pure" and "That
// decision is true by construction": a reviewer reads one diff, a scan reads every
// module, every time, including the ones a later sprint adds.
//
// Test 3 is the load-bearing one. `packages/core` importing NO node builtin at all is
// what makes the "no clock, no randomness" an auditable property rather than a promise.
// There is no `node:crypto` to hash with, no `node:fs` to read with, no `perf_hooks` to
// time with, so the surface on which an impurity could enter simply does not exist.
//
// And the asymmetry is the point. `node:crypto`'s `createHash` does legitimately appear
// in `__tests__/rules/thresholds.test.ts`: the content hash is a test artefact,
// computed by the test to prove the rule set's canonical serialisation is stable. A
// test may reach for a builtin; shipped `src/` may not. So test 3 scans `src/` only,
// and proves its scanner is not blind by running it against that very test file and
// asserting it does find the builtin there.
//
// Two precedents are followed here deliberately:
//
// `packages/db/__tests__/repositories/no-org-param.test.ts`, parse
//  Declarations, never grep raw text. A text grep matches the word inside a
//  comment explaining why the thing is forbidden, and inside a string, and
//  then reports confidently that the code is clean because it also matched
//  something real. Every scan below runs over source with comments and (for
//  the numeric scan) string literals blanked out first, and then over
//  Statements and function regions, not over the file.
//
// `packages/db/__tests__/system/reachability.test.ts`, assert non-vacuity
//  before asserting zero offenders. A scan over an empty file list passes
//  perfectly and means nothing. Every test below first proves it found the
//  modules, the imports, or the bodies it claims to be checking.
//
// That decision is binding on test 5. the target is unnamed numeric literals inside
// detector function bodies. A named module constant is not merely tolerated, it is the
// opposite of the magic number exists to prevent, `PERCENT_SCALE = 100` at
// `src/counts/percent.ts` is exactly right, and could not have come from the rule set
// (it is arithmetic, not a threshold). So the scan below is over function bodies, never
// over modules, and test 5 proves that distinction on two synthetic fixtures before it
// reports on the real ones: a module-level `const NAME = 100` must pass, an inline
// `100` in a body must fail.
//
// House rules (state.md standing constraints):
// No `Date.now`. Every instant in this file descends from the frozen
//  constants below.
// No node builtin. This suite reads source with `Bun.file` and enumerates
//  it with `Bun.Glob`, so it does not become the offender it is policing.
// Lane prefix `t1pur`, shared with no other suite.
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

// Part 1, the source scanner

const SRC_DIR = `${import.meta.dir}/../../src`;
const TESTS_DIR = `${import.meta.dir}/..`;

/** Enumerated with `Bun.Glob`, not `node:fs`. See the header. Paths are returned
 * relative to `src/`, with forward slashes on every platform. */
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
 * `withoutComments` keeps string literals intact. Import specifiers live in them.
 * `codeOnly` blanks the strings too, so a magnitude mentioned inside a message string
 * can never be reported as a magic number.
 *
 * Both are produced by one left-to-right pass rather than by a pair of independent
 * regexes, because the naive version has a real bug: blanking comments first turns the
 * `//` inside a `"https://…"` literal into a line-comment start and eats the rest of
 * the line. Blanking preserves length and newlines, so every index and every line
 * boundary still lines up with the original file.
 */
type StrippedSource = {
  readonly withoutComments: string;
  readonly codeOnly: string;
};

/** Overwrites `[from, to)` with spaces, leaving newlines in place so line boundaries
 * (and therefore column-zero brace detection) still line up with the original file. */
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
      // Strings survive in `withoutComments`. Specifiers are read from them.
      blank(codeOnly, cursor, scan);
      cursor = scan;
      continue;
    }

    cursor += 1;
  }

  return { withoutComments: withoutComments.join(""), codeOnly: codeOnly.join("") };
}

/**
 * Every module specifier this module declares. The statement-level parse the
 * `no-org-param` precedent insists on.
 *
 * Static `import`/`export … from` statements are matched at the start of a line (a
 * TypeScript module cannot declare one anywhere else), then the specifier is read from
 * that statement's own `from` clause. Bare side-effect imports, dynamic `import`, and
 * `require` are collected too. Each of them is a door into the same house, and a scan
 * that only reads the static form invites the dodge.
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

/** A function declaration's own text: its parameter list, its return type, and its
 * body. Everything except the `function name` that introduces it. */
type FunctionRegion = {
  readonly owner: string;
  /** The balanced parameter list, without the enclosing parens. */
  readonly params: string;
  /** Parameters, return type and body, comment- and string-blanked. */
  readonly text: string;
};

/** The text between `source[openIndex]` (an open paren) and its match. Lifted from the
 * `no-org-param` precedent for the same reason it exists there: a return type naming
 * something must never be mistaken for a parameter. */
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
 * Every function declared in a module, as a region running from its open paren to its
 * closing brace.
 *
 * The terminator is the first `}` at column zero after the head. A top-level
 * declaration's own closing brace, and unreachable from inside a body, where every
 * brace is indented. Deliberately not brace-matching from the first `{` after the
 * parameter list: `attributionOf` in `error-event.ts` returns an object type literal,
 * so the first `{` after its parameters belongs to the return type and a naive matcher
 * would call the type the body.
 *
 * The consequence that matters for test 5: module-level code (a named constant, an
 * exported literal) lies outside every region and is therefore never scanned, which is
 * precisely what That decision requires.
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
 * `PERCENT_SCALE_2`: a digit preceded by an identifier character is part of a name, and
 * a name is the thing That decision is asking for. Array indices (`counts[0]`) DO
 * match, deliberately. This package's own style already destructures (`const [first] =
 * versions`) rather than indexing, and a positional index inside a detector is a
 * magnitude with no name just like any other.
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
 * Node's builtin module names. `node:`-prefixed specifiers are caught by the prefix;
 * the bare forms are caught by this set, and a subpath (`fs/promises`) by its first
 * segment.
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

/** A detector is a module under `detect/` exporting a `detect…` function. The set is
 * derived rather than listed, so a third detector added next sprint is scanned by tests
 * 4 and 5 automatically instead of quietly escaping them. */
function exportedDetectorsOf(source: string): readonly string[] {
  const { codeOnly } = stripSource(source);
  return [...codeOnly.matchAll(/export\s+function\s+(detect\w+)\s*\(/g)].map(
    (match) => match[1] ?? "",
  );
}

// Part 2, the runtime corpus (tests 1 and 6)

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
 * Fixture magnitudes, chosen so both detectors fire on one corpus.
 *
 * Three kept cohorts, and the third is forced by the contract. Under per-origin
 * aggregation `D` is built from the corpus's own walks, so anything a session
 * reaches after its first visit to the origin is by construction a member of `D`,
 * which means "dropped at `O`" reduces to "the walk ends at the session's first visit
 * to `O`". A dropped session therefore visits the origin exactly once and can never
 * also be a repeated-attempt struggler: the dropped and struggling cohorts are
 * structurally disjoint. The previous fixture asked one cohort to be both. Its droppers
 * walked `[origin, detour, origin, detour, origin]`, and under aggregation the detour
 * is a member of `D(origin)`, so every one of them continued, `dropped` was 0, and no
 * candidate fired at all.
 *
 * So the corpus splits the two roles apart:
 *
 * 12 DROPPERS whose walk ends at the origin (>= `funnelMinDropoffSessions`
 *  5, and 12 * 100 >= 40 * 25 clears the rate gate);
 * 5 STRUGGLERS who visit the origin 3 times (>= `struggleRepeatedAttemptMin`
 *  3) and then go on to the destination, so they struggle without dropping;
 * 8 CONVERTERS who step straight through to the destination.
 *
 * Together 25 kept sessions reach the origin (>= `funnelMinSessionsAtOrigin` 20). 4 of
 * the droppers carry the exception (>= `errorMinAffectedSessions` 3). The detour is
 * reached by the 5 strugglers alone (far below the origin floor) so it opens no
 * candidate of its own and the origin stays the only one. Three set-aside sessions sit
 * in the corpus alongside them, so a silent leak moves the numbers test 6 names.
 */
const KEPT_AT_ORIGIN = 25;
const DROPPERS = 12;
const STRUGGLERS = 5;
const CONVERTERS = KEPT_AT_ORIGIN - DROPPERS - STRUGGLERS;
const SET_ASIDE = 3;
const SESSIONS_WITH_EXCEPTIONS = 4;
const EXCEPTIONS_PER_SESSION = 2;
const ORIGIN_VISITS_PER_STRUGGLER = 3;

/** `funnel_dropoff.counts` is exactly two entries: `error_event.counts` is exactly one. */
const FUNNEL_DECLARED_COUNTS = 2;
const ERROR_DECLARED_COUNTS = 1;

/**
 * / fix: At most one candidate per qualifying origin, aggregating across
 * destinations, never one per `(origin, destination)` pair.
 *
 * This corpus observes two origins. `/t1pur/pricing` qualifies: 25 kept sessions reach
 * it, 12 leave without going anywhere they could have gone. It feeds two destinations
 * (`/t1pur/checkout` and `/t1pur/support`) and that multiplicity is exactly what no
 * longer multiplies, one stuck surface is one problem, one count, one `evidence_shape`.
 * `/t1pur/support` is reached by only the 5 strugglers, below
 * `funnelMinSessionsAtOrigin`, so it opens no candidate of its own.
 *
 * This constant read 2 before fix, one per transition out of the origin.
 */
const FUNNEL_DECLARED_CANDIDATES = 1;
/** Every exception lands on one surface, so `error_event` declares one candidate
 * however many exceptions each session carries. */
const ERROR_DECLARED_CANDIDATES = 1;

/** The v1 rule set, fetched by version, never "whatever is current". */
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
  /** Required, no fixture may seed an instant from a clock. */
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

/**
 * The dropper's walk: it ends at the origin. That is what "dropped" means under
 * per-origin aggregation, not "did not reach one particular destination", but "left
 * without going anywhere it could have gone", and `D(origin)` is built from this
 * corpus's own walks, so anything after the first visit would be a member of it.
 */
const DROPPER_PATHS: readonly string[] = [T1PUR_ORIGIN];

/**
 * The struggler's walk: three separate visits to the origin, bouncing off the detour
 * between them, and then onward to the destination.
 *
 * `repeated_attempt` is measured over the sessions AT the origin, never over the
 * dropped ones, so a struggler proves the struggle half of the corpus while plainly
 * continuing, which is the only way both halves can be true at once.
 */
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

/**
 * One corpus on which both detectors fire, built fresh on every call, so test 1 can
 * compare two runs over two structurally identical but distinct object graphs, not over
 * the same one twice.
 *
 * The exception name comes from the rule set, never from a literal here: the fixture
 * reads the contract the same way the detector does.
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
      // The fixture: the first four droppers each carry two exceptions on one surface.
      // A detector that fanned out per signal rather than per session would report
      // eight affected sessions instead of four.
      exceptionCountFor: (index) => (index < SESSIONS_WITH_EXCEPTIONS ? EXCEPTIONS_PER_SESSION : 0),
      exceptionName: ruleSet.exceptionEventName,
      exclusionReason: "none",
      firstStartedAt: new Date(T1PUR_FIRST_SESSION_AT.getTime() + 3_600_000),
    }),
    ...cohort({
      // The struggle half, held apart from the dropped half because the two cohorts are
      // structurally disjoint (see the magnitudes docblock above).
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

/** Every detector this sprint ships, as a name plus its entry point, so tests 1 and 6
 * say "for every detector" and mean it. */
const DETECTORS: readonly {
  readonly name: string;
  readonly run: (corpus: DetectorCorpus, ruleSet: ThresholdRuleSet) => DetectorResult;
}[] = [
  { name: "funnel_dropoff", run: detectFunnelDropoff },
  { name: "error_event", run: detectErrorEvent },
];

// Part 3, test 5's proof fixtures

/**
 * Stated as two sources rather than as a claim.
 *
 * The first is what the shipped code looks like today: the magnitude has a name,
 * declared at module level, and the body reads the name. The second is the regression
 * exists to catch: the same magnitude inlined into the body. Test 5 runs its own
 * scanner over both before it reports on the real detectors, so "this scan would catch
 * a reintroduced literal" is demonstrated rather than asserted.
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

describe("detector purity and coverage", () => {
  // -- test 1
  test("should produce byte-identical output for identical inputs across two calls, for every detector", () => {
    const ruleSet = ruleSetV1();

    for (const detector of DETECTORS) {
      //  the same object graph, twice. Catches a detector that mutates its input,
      // memoises across calls, or lets an internal accumulator survive.
      const shared = multiSignalCorpus(ruleSet);
      const first = JSON.stringify(detector.run(shared, ruleSet));
      const second = JSON.stringify(detector.run(shared, ruleSet));

      // Non-vacuity: two empty results are byte-identical and prove nothing.
      expect(detector.run(shared, ruleSet).candidates.length).toBeGreaterThan(0);
      expect(second).toBe(first);

      //  two distinct but structurally identical graphs. This is the half that would
      // catch a `Date.now`, a `Math.random`, an id counter, or an iteration order
      // derived from object identity. None of which the repeat-call comparison above
      // can see.
      const rebuilt = JSON.stringify(detector.run(multiSignalCorpus(ruleSet), ruleSet));
      expect(rebuilt).toBe(first);
      expect(rebuilt.length).toBeGreaterThan(0);
    }
  });

  // -- test 2
  test("should import nothing from @growthmind/db in any detect module", async () => {
    const modules = await scanSourceModules();
    const detectModules = modules.filter(isDetectModule);

    // Non-vacuity, three ways: the scan found modules, it found the detect modules by
    // name, and its specifier parse actually returns specifiers.
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

    // The dependency arrow is `db -> core`, never the reverse. A detector that could
    // reach the database would stop being a pure function of its corpus, and every
    // determinism claim above it would become unprovable.
    expect(offenders).toEqual([]);

    // Strictly stronger, and true today: Nothing under `src/` imports it, so the arrow
    // cannot be reversed anywhere in this package.
    const packageWide = modules.flatMap((module) =>
      module.specifiers
        .filter((specifier) => specifier.split("/").slice(0, 2).join("/") === "@growthmind/db")
        .map((specifier) => `${module.path} :: ${specifier}`),
    );
    expect(packageWide).toEqual([]);
  });

  // -- test 3
  test("should import no node builtin anywhere in packages/core", async () => {
    const modules = await scanSourceModules();

    // Non-vacuity: the scan really enumerated `src/`.
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.map((module) => module.path)).toContain("evidence/gate.ts");
    expect(modules.flatMap((module) => module.specifiers)).toContain("zod");

    // Non-vacuity, and the point of. `node:crypto` legitimately appears in
    // `__tests__/rules/thresholds.test.ts`. The content hash is a test artefact, and a
    // test may reach for a builtin that shipped code may not. Running the very same
    // collector over that file proves the scan below is not simply blind to builtins:
    // it finds this one, and reports zero in `src/` because there are none there.
    const hashingTest = await Bun.file(`${TESTS_DIR}/rules/thresholds.test.ts`).text();
    const hashingSpecifiers = collectImportSpecifiers(hashingTest);
    expect(hashingSpecifiers.filter(isNodeBuiltin)).toEqual(["node:crypto"]);

    const offenders = modules.flatMap((module) =>
      module.specifiers.filter(isNodeBuiltin).map((specifier) => `${module.path} :: ${specifier}`),
    );

    // the "no clock, no randomness" by construction: with no builtin in reach there is
    // no `perf_hooks` to time with, no `crypto` to draw entropy from, and no `fs` to
    // read state from. The property is a fact about the module graph rather than a
    // claim a reviewer has to re-check every sprint.
    expect(offenders).toEqual([]);

    // The two ambient impurities a builtin ban does not cover, since both are language
    // globals: a wall clock and a random source.
    const ambient = modules.flatMap((module) => {
      const { codeOnly } = stripSource(module.source);
      return [/\bDate\s*\.\s*now\s*\(/, /\bMath\s*\.\s*random\s*\(/, /\bnew\s+Date\s*\(\s*\)/]
        .filter((pattern) => pattern.test(codeOnly))
        .map((pattern) => `${module.path} :: ${pattern.source}`);
    });
    expect(ambient).toEqual([]);
  });

  // -- test 4
  test("should take the rule set as a parameter in every detector signature, never reaching for CURRENT_", async () => {
    const modules = await scanSourceModules();
    const detectModules = modules.filter(isDetectModule);

    const detectors = detectModules.flatMap((module) =>
      exportedDetectorsOf(module.source).map((name) => ({ module, name })),
    );

    // Non-vacuity: the derived detector set really contains both detectors this sprint
    // ships. Derived rather than listed, so a third one is scanned automatically
    // instead of quietly escaping.
    expect(detectors.map((entry) => entry.name).toSorted()).toEqual([
      "detectErrorEvent",
      "detectFunnelDropoff",
    ]);

    for (const detector of detectors) {
      const region = collectFunctionRegions(detector.module.source).find(
        (candidate) => candidate.owner === detector.name,
      );
      expect(region).toBeDefined();

      // The rule set arrives. It is not fetched, not defaulted, and not optional. An
      // optional rule set is a reach for the current one with extra steps, and would
      // make a v1 replay silently produce a v2 verdict.
      expect(region?.params).toMatch(/\bruleSet\s*:\s*ThresholdRuleSet\b/);
      expect(region?.params).not.toMatch(/\bruleSet\s*\?/);
      expect(region?.params).not.toMatch(/\bruleSet\s*:\s*ThresholdRuleSet\s*=/);
    }

    // ...and nothing under `detect/` names the current rule set at all, in a signature
    // or in a body. Comments are blanked first, so the two modules whose prose says
    // "nothing here reads `CURRENT_*`" are not what is being read here (the
    // `no-org-param` precedent's whole reason for existing).
    const reaching = detectModules
      .filter((module) => /\bCURRENT_/.test(stripSource(module.source).codeOnly))
      .map((module) => module.path);
    expect(reaching).toEqual([]);

    // Strictly stronger: only the module that defines the current rule set and the
    // barrel that re-exports it may name it. Every consumer takes it as a parameter.
    // The allowlist is two entries long and auditable at a glance.
    const allowed: ReadonlySet<string> = new Set(["rules/thresholds.ts", "index.ts"]);
    const packageWide = modules
      .filter(
        (module) =>
          !allowed.has(module.path) && /\bCURRENT_/.test(stripSource(module.source).codeOnly),
      )
      .map((module) => module.path);
    expect(packageWide).toEqual([]);
  });

  // -- test 5
  test("should contain no numeric literal in any detector body", async () => {
    //  the scanner is proven before it is trusted. A named module constant must
    // pass. It is what That decision is asking for. The same magnitude inlined into a
    // body must fail. If these two disagreed, every assertion below would be theatre.
    expect(numericLiteralsInFunctionBodies(NAMED_CONSTANT_FIXTURE)).toEqual([]);
    expect(numericLiteralsInFunctionBodies(INLINE_LITERAL_FIXTURE)).toEqual([
      { owner: "detectFixture", literal: "100" },
    ]);

    const modules = await scanSourceModules();
    const detectorModules = modules.filter(
      (module) => isDetectModule(module) && exportedDetectorsOf(module.source).length > 0,
    );

    // Non-vacuity: the derived module set is the two detectors.
    expect(detectorModules.map((module) => module.path).toSorted()).toEqual([
      "detect/error-event.ts",
      "detect/funnel-dropoff.ts",
    ]);

    for (const scanned of detectorModules) {
      const regions = collectFunctionRegions(scanned.source);

      // Non-vacuity: the region extractor found real bodies, and they are whole
      // ones. Each ends at its own closing brace, and each detector's region contains
      // the rule-set member only its body names.
      expect(regions.length).toBeGreaterThan(0);
      for (const region of regions) {
        expect(region.text.trimEnd().endsWith("}")).toBe(true);
      }

      // Non-vacuity: the scan covers everything executable in the module. Only
      // `function` declarations are collected, so this asserts the module declares
      // nothing else. No module-level arrow function could sit outside the regions
      // above and dodge the check.
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

    // Every magnitude a detector compares against arrives on the rule-set parameter,
    // and the one number that cannot (the percent scale. Arithmetic, not a threshold)
    // has a name and a home at `src/counts/percent.ts`. A bare number in a body is a
    // threshold nobody can version, review, or replay.
    expect(offenders).toEqual([]);
  });

  // -- the pin
  //
  // Why this assertion exists. Test 3 above bans `node:crypto`, and the decides that
  // the sha256 helper's home is `packages/db/src/signatures/ hex.ts`, where importing
  // `node:crypto` is legal and load-bearing. The only thing keeping those two facts
  // compatible is that `SRC_DIR` resolves to `packages/core/src` and nothing wider.
  //
  // That scope is currently a fact about one template literal. Widen it to a package
  // root, a monorepo root, or a sibling package, and test 3 starts failing on
  // `hex.ts`'s perfectly legal import, with no signal anywhere that a documented
  // architecture decision was being revoked rather than a real impurity being caught.
  // asks for the scope itself to be pinned, so the widening fails here, on an assertion
  // that names the decision, instead of there, as a mystery failure a reader would
  // "fix" by deleting an import that belongs where it is.
  test("should assert purity scans packages/core/src and nothing wider", async () => {
    // `import.meta.dir` is backslash-separated on Windows, and `SRC_DIR` is an
    // unresolved literal (`…/__tests__/detect/../../src`). Both are normalised here
    // (forward slashes, `..` segments collapsed) so the pin means the same thing on
    // every platform. Collapsed by hand rather than with `node:path`, because this
    // suite must not import the builtin it polices (see the file header).
    const segments: string[] = [];
    for (const segment of SRC_DIR.replaceAll("\\", "/").split("/")) {
      if (segment === "..") segments.pop();
      else if (segment !== ".") segments.push(segment);
    }
    const resolved = segments.join("/");

    // The scan is rooted at this package's source directory.
    expect(resolved.endsWith("/packages/core/src")).toBe(true);

    // ...and reaches no sibling package. Named explicitly rather than left to the
    // suffix check, because `packages/db/src` is the one that places a legal
    // `node:crypto` import inside.
    expect(resolved).not.toContain("/packages/db/");
    expect(resolved).not.toContain("/packages/shared/");
    expect(resolved).not.toContain("/packages/adapters/");

    // Non-vacuity, and the half a string check cannot give: what the scanner actually
    // enumerates is core modules only. `signatures/hex.ts` is `packages/db`'s file and
    // must be absent from every path this suite ever scans; `detect/error-event.ts` is
    // core's and must be present.
    const paths = await listSourceModules();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toContain("detect/error-event.ts");
    expect(paths.filter((path) => path.endsWith("signatures/hex.ts"))).toEqual([]);

    // And the file itself is real and does import the builtin, so this pin is
    // protecting a live decision, not a hypothetical one. If `hex.ts` ever moves into
    // `packages/core`, this assertion is what fails first.
    const hexSource = await Bun.file(`${SRC_DIR}/../../db/src/signatures/hex.ts`).text();
    expect(collectImportSpecifiers(hexSource).filter(isNodeBuiltin)).toEqual(["node:crypto"]);
  });

  // -- test 6
  test("should produce the declared number of candidates when one session carries two matching signals", () => {
    const ruleSet = ruleSetV1();
    const corpus = multiSignalCorpus(ruleSet);

    // Fixture self-check. If these drift, every number below stops meaning what its
    // name says.
    expect(corpus.basis.kept).toBe(KEPT_AT_ORIGIN);
    expect(corpus.basis.totalInWindow).toBe(KEPT_AT_ORIGIN + SET_ASIDE);

    // -- error_event: two exceptions in one session
    const errors = detectErrorEvent(corpus, ruleSet);

    // Four sessions carry two exceptions each on one surface. The declared output is
    // one candidate, not one per exception, and not one per session.
    expect(errors.candidates).toHaveLength(ERROR_DECLARED_CANDIDATES);
    const errorCandidate = errors.candidates[0];
    expect(errorCandidate.surface).toBe(T1PUR_ORIGIN);

    // Both signals survive, the second is never deduplicated away, because evidence is
    // what a founder reads..
    expect(errorCandidate.signals).toHaveLength(SESSIONS_WITH_EXCEPTIONS * EXCEPTIONS_PER_SESSION);
    // ...but the count is over sessions, and a session that threw twice is one affected
    // session. This is the number that reaches a customer as "4 of 25 sessions", and
    // double-counting it would be a fabricated claim.
    expect(errorCandidate.counts).toHaveLength(ERROR_DECLARED_COUNTS);
    expect(errorCandidate.counts[0].numerator).toBe(SESSIONS_WITH_EXCEPTIONS);
    expect(errorCandidate.counts[0].denominator).toBe(KEPT_AT_ORIGIN);
    expect(errorCandidate.counts[0].unit).toBe("sessions");

    // -- funnel_dropoff: two destinations, three visits, one candidate
    const funnel = detectFunnelDropoff(corpus, ruleSet);

    // fix, asserted rather than iterated: One candidate for the qualifying origin
    // however many destinations it feeds, and not one per visit, per session, or per
    // repeated attempt either. This asserted 2 before fix, once per transition out
    // of the origin.
    expect(funnel.candidates).toHaveLength(FUNNEL_DECLARED_CANDIDATES);
    const candidate = funnel.candidates[0];
    expect(candidate.surface).toBe(T1PUR_ORIGIN);

    // Exactly two counts, in declared order, both over kept sessions.
    expect(candidate.counts).toHaveLength(FUNNEL_DECLARED_COUNTS);
    expect(candidate.counts[0].numerator).toBe(KEPT_AT_ORIGIN);
    for (const count of candidate.counts) {
      expect(count.denominator).toBe(KEPT_AT_ORIGIN);
    }

    // The aggregated numerator, with its denominator. `counts[1]` is a single claim
    // about the origin. The sessions that left it without going anywhere they could
    // have gone, not one numerator per destination. Twelve of the twenty-five kept
    // sessions, and the denominator is asserted against `corpus.basis.kept` itself so
    // the pair can never drift into "12 of 12".
    expect(candidate.counts[1].numerator).toBe(DROPPERS);
    expect(candidate.counts[1].denominator).toBe(corpus.basis.kept);

    // again, on the other detector: five sessions visited the origin three times
    // apiece. That is one struggle signal carrying the per-session maximum, not five
    // signals, not one per visit, and not 15 attempts.
    const struggles = candidate.signals.filter((signal) => signal.kind === "struggle");
    expect(struggles).toHaveLength(1);
    expect(struggles[0]).toMatchObject({
      kind: "struggle",
      subkind: "repeated_attempt",
      surface: T1PUR_ORIGIN,
      attempts: ORIGIN_VISITS_PER_STRUGGLER,
    });

    // The cohort half of the same claim, and the number the gate actually turns on:
    // five distinct sessions each reached the threshold, over the 25 kept. `attempts`
    // above is one session's visit depth and says nothing about how many people
    // struggled. Asserting only it would leave the deciding number unchecked. Note that
    // this is not `DROPPERS`: a dropped walk ends at its first visit to the origin, so
    // a dropped session visits it exactly once and is never a struggler.
    const struggle = struggles[0];
    if (struggle?.kind !== "struggle") throw new Error("expected a struggle signal");
    expect(struggle.strugglingSessions.numerator).toBe(STRUGGLERS);
    expect(struggle.strugglingSessions.denominator).toBe(struggle.strugglingSessions.basis.kept);
  });
});
