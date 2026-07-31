// ADD §7 "Unit — the not-built guard" — the four named tests (D-17, BS-2),
// plus D-9's two guards (ADD §D-9's own "Test:" line, ESC-5).
//
// ── What this file defends, and why it is not paranoia ──────────────────────
//
// The T1 event-vocabulary probe returned FAILED-TO-PIN — NOT "absent" — for
// `$rageclick`, `$dead_click`/`$dead_swipe` and `$autocapture` (ADD §2, rows
// A-2/A-3/A-4). The test project's entire history is 220 synthetic events with
// ZERO browser-originated traffic in it, so their absence measured OUR OWN
// WRITES rather than PostHog's client configuration. Inconclusive is not
// absence, and A DETECTOR IS NEVER BUILT ON AN ASSUMPTION — which is why
// `rage_click` and `dead_click` are NOT BUILT rather than guessed at.
//
// The dangerous move is not building the detector. It is building the PROXY:
// "infer rage from rapid repeated clicks on one path, grouped by time". That
// must never land here. Without `elements_chain` — present on the wire and
// deliberately never parsed (A-7), and reaching for it is an adapter change
// this sprint does not take — you cannot prove two clicks hit the SAME
// element, and rapid clicking across DIFFERENT elements is fast navigation,
// not rage. Such a predicate fires on a SUPERSET of its target by
// construction: the textbook D10 conflation, and the exact reasoning that kept
// the F-9 host predicate out of the exclusion classifier
// (`packages/shared/src/exclusions/classify.ts:69-78`, guarded the same way by
// `packages/shared/__tests__/exclusions/automation.test.ts`).
//
// It would also be worse than the absence DOWNSTREAM. A proxy built to hit a
// detector count feeds the evidence gate false `confusing` proof, and the gate
// would correctly pass it — so the fabrication would reach a founder wearing
// the gate's own credibility.
//
// ── How the scan is built, and why it is not a grep ─────────────────────────
//
//   1. COMMENTS ARE STRIPPED FIRST. `not-built.ts` legitimately *documents*
//      every one of these names in its comment block — that is the F-9
//      precedent working — so a naive text grep would fail on the very file
//      that records the decision. Comments come out before anything is read.
//   2. Then STRING LITERALS are lifted out of the remaining executable source,
//      and IDENTIFIERS are read from what is left. Every assertion below is
//      against those two token streams, never against raw file text. (Order
//      matters: `not-built.ts`'s comments contain backticked paths, which a
//      literal scan run first would read as template literals.)
//   3. Test 4 is the guard on all of that: it proves the scan finds the
//      modules and the tokens it claims to scan, that the comment strip
//      actually stripped, that it did NOT over-strip, and — the strongest leg
//      — that the offender detector demonstrably FLAGS a synthetic offender.
//      Without that, an over-aggressive strip would make this whole suite
//      vacuously green.
//
// House rules honoured here (STATE.md standing constraints):
//   - No node builtin. Source is read through `Bun.Glob` and `Bun.file`, not
//     `node:fs` — `packages/core` imports no node builtin in `src/` OR in
//     `__tests__/`, which is what makes FR-5's purity auditable (D-13).
//   - No `Date.now()`. Every fixture instant is a frozen constant.
//   - New fixture vocabulary prefix `t1nb`, colliding with no other suite.
//   - The rule set is fetched BY VERSION and handed in as a parameter (D-14).
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

// ═══════════════════════════════════════════════════════════════════════════
// The scanner
// ═══════════════════════════════════════════════════════════════════════════

const SRC_DIR = `${import.meta.dir}/../../src`;
const DETECT_DIR = `${SRC_DIR}/detect`;

/** Where a token was found and what kind of thing it is. `module` is the bare
 * file name so an offender report names the file a reader must open. */
type CodeToken = {
  readonly module: string;
  readonly kind: "literal" | "identifier";
  readonly text: string;
};

type ScannedModule = {
  readonly module: string;
  /** Raw file text — used ONLY by test 4, to prove the strip stripped. */
  readonly raw: string;
  /** Executable source: comments removed. */
  readonly code: string;
  readonly tokens: readonly CodeToken[];
};

/**
 * Removes block and line comments.
 *
 * The `[^:]` guard on the line-comment arm is the automation.test.ts
 * precedent's: it keeps `https://` inside a string from being read as the
 * start of a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const STRING_LITERAL =
  /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Splits comment-stripped source into its string-literal VALUES and its
 * identifiers.
 *
 * Deliberately total rather than clever: a click-burst predicate has to
 * surface as an identifier somebody declared or read, or as an event-name
 * string somebody wrote. Collecting every identifier leaves no naming
 * convention through which one could arrive unnoticed, and over-collection is
 * safe for a must-not-contain invariant — it can only produce a false
 * POSITIVE, which test 4 proves does not happen against the real modules.
 */
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

async function scanDirectory(dir: string): Promise<readonly ScannedModule[]> {
  const names = [...new Bun.Glob("*.ts").scanSync({ cwd: dir })].toSorted();
  const scanned: ScannedModule[] = [];
  for (const name of names) {
    scanned.push(scanSource(name, await Bun.file(`${dir}/${name}`).text()));
  }
  return scanned;
}

/** Every module under `src/detect/`, scanned once for the whole suite. */
const DETECT_MODULES: readonly ScannedModule[] = await scanDirectory(DETECT_DIR);
const DETECT_TOKENS: readonly CodeToken[] = DETECT_MODULES.flatMap((mod) => mod.tokens);

// ── The documented-absence exemption ────────────────────────────────────────

const NOT_BUILT_NAMES: ReadonlySet<string> = new Set(
  NOT_BUILT_DETECTORS.map((detector) => detector.name),
);

/**
 * The ONE permitted occurrence of a click word under `src/detect/`: a string
 * literal in `not-built.ts` whose value is verbatim a `NOT_BUILT_DETECTORS`
 * name.
 *
 * This is not a loophole, and the scoping is what makes it not one. The
 * exemption is pinned to one file, one token kind, and a value that must equal
 * a member of the exported absence list — so nothing in `funnel-dropoff.ts` or
 * `error-event.ts` can claim it, and an identifier can never claim it at all.
 * A contributor adding an entry to `NOT_BUILT_DETECTORS` widens only the list
 * of things this codebase declares it does NOT build.
 */
function isDocumentedAbsenceName(token: CodeToken): boolean {
  return (
    token.module === "not-built.ts" && token.kind === "literal" && NOT_BUILT_NAMES.has(token.text)
  );
}

/** `module :: kind "text"` — an offender line a reader can act on directly. */
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

// ── The marker vocabulary ───────────────────────────────────────────────────

/** A-4. The event whose payload the barred proxy would have been built on. */
const AUTOCAPTURE = /autocapture/i;

/** A-2 / A-3. The VENDOR literals, `$`-prefixed as PostHog writes them.
 * Zero occurrences, with NO exemption: our own absence list is deliberately
 * free of vendor event names (`not-built.ts` says so), so nothing here has any
 * business carrying one. */
const VENDOR_CLICK_EVENT = /\$\s*(?:rageclick|rage_click|dead_?click|dead_?swipe)/i;

/** The same names in any casing or separator, `$` or not — the form a
 * home-grown proxy would use. Exempt only the documented-absence literals. */
const CLICK_CONCEPT = /click|swipe|mousedown|pointerdown|elements_chain|\btaps?\b|\btapped\b/i;

/** BS-2. The clustering vocabulary a time-grouped click-burst predicate is
 * written in. `\brage` is start-anchored rather than whole-word so it still
 * catches `rageClick` and `rage_click`, and still cannot match "ave-rage". */
const CLUSTERING_CONCEPT =
  /\bcluster|\bburst|\brapid|\bthrash|\brage|\bstorm|\bdebounce|\bthrottle|\bproximit|\bconsecutiveclicks/i;

/** The time half of "time-clustered". Legitimate on its own — `error_event`
 * correlates an exception to the action before it — so this is only ever used
 * in CO-OCCURRENCE with a click concept. */
const TIME_CONCEPT = /window|elapsed|duration|timestamp|interval|\bgap|\bwithin|ms$|Ms$/i;

/** D-9. The class no T1 detector may propose, in either spelling. */
const CHANGED_MIND = /changed[_\s]?mind/i;

// ═══════════════════════════════════════════════════════════════════════════
// Fixture corpora — frozen instants, `t1nb` vocabulary, no clock anywhere
// ═══════════════════════════════════════════════════════════════════════════

const NB_WINDOW: AnalysisWindow = {
  start: new Date("2026-09-01T00:00:00.000Z"),
  end: new Date("2026-09-08T00:00:00.000Z"),
};
/** Every fixture event descends from this instant plus an explicit offset. */
const NB_FIRST_EVENT_AT = new Date("2026-09-03T10:00:00.000Z");

const NB_PROJECT_ID = "t1nb-project";
const NB_ORIGIN = "/t1nb/pricing";
const NB_DESTINATION = "/t1nb/checkout";
const NB_SINGLE_SURFACE = "/t1nb/editor";
const NB_ACTION = "t1nb_submit_attempted";
const NB_NORMALISATION_VERSION = 1;

const SESSION_STRIDE_MS = 60_000;
const EVENT_STRIDE_MS = 1_000;
/** Test 3's behavioural leg: ten events on ONE surface, 20 ms apart. This is
 * the exact input a rage-click proxy exists to fire on. */
const BURST_STRIDE_MS = 20;
const BURST_EVENTS_PER_SESSION = 10;
const BURST_SESSIONS = 30;

/** Comfortably over `funnelMinSessionsAtOrigin` (20), and 18/30 = 60% is
 * comfortably over `funnelDropoffRateThresholdPercent` (40) — this corpus is
 * about producing candidates at all, not about a boundary. */
const FUNNEL_AT_ORIGIN = 30;
const FUNNEL_DROPPED = 18;
const FUNNEL_CONVERTED = FUNNEL_AT_ORIGIN - FUNNEL_DROPPED;
/** Comfortably over `errorMinAffectedSessions` (3). */
const ERROR_SESSIONS = 8;
/** Well inside `errorCorrelationWindowMs` (30_000). */
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
  /** REQUIRED — no fixture may seed an instant from a clock (ADD §6.5). */
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

/** Derived from the sessions, never hand-written, so `measuredCount`'s
 * `kept + Σ setAside === totalInWindow` identity cannot be satisfied by a
 * fixture that lies about its own contents (D-7). */
function basisOf(sessions: readonly SessionTimeline[]): CountBasis {
  const setAside: SetAsideBasis[] = [];
  for (const reason of SET_ASIDE_REASONS) {
    const count = sessions.filter((session) => session.exclusionReason === reason).length;
    if (count > 0) setAside.push({ reason, count, label: EXCLUSION_REASON_LABELS[reason] });
  }
  return {
    totalInWindow: sessions.length,
    kept: sessions.filter((session) => session.exclusionReason === "none").length,
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

/**
 * THE FULL FIXTURE CORPUS (D-9's second guard). Eight corpora spanning every
 * shape this sprint's two detectors can meet: the firing drop-off, the CLEAN
 * drop-off that D-9 says must produce silence rather than a "they changed
 * their mind" verdict, correlated and uncorrelated exceptions, the burst
 * (test 3's behavioural leg), a path-less corpus, an all-set-aside corpus, and
 * the empty one.
 */
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

/** Both detectors over one corpus. The rule set is a PARAMETER (D-14). */
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

// ═══════════════════════════════════════════════════════════════════════════
// A — the not-built guard (ADD §7's four tests)
// ═══════════════════════════════════════════════════════════════════════════

describe("src/detect contains no barred click proxy (D-17, BS-2)", () => {
  test("should contain no $autocapture literal anywhere under src/detect", () => {
    // A-4 came back FAILED-TO-PIN: 0 of 220 events, in a corpus with zero
    // browser traffic. Nothing may key on it — and no exemption applies, not
    // even to `not-built.ts`, whose reason strings are deliberately free of
    // vendor event names.
    expect(offenders(DETECT_TOKENS, AUTOCAPTURE, { exemptDocumentedAbsence: false })).toEqual([]);
  });

  test("should contain no $rageclick, $dead_click, or $dead_swipe literal anywhere under src/detect", () => {
    // The VENDOR literals, `$`-prefixed. Total, no exemption.
    expect(
      offenders(DETECT_TOKENS, VENDOR_CLICK_EVENT, { exemptDocumentedAbsence: false }),
    ).toEqual([]);

    // And the same names WITHOUT the `$` — the form a home-grown substitute
    // would take. The only permitted occurrences in the whole directory are
    // `not-built.ts`'s own absence-list literals, which is where the decision
    // is recorded rather than acted on.
    expect(offenders(DETECT_TOKENS, CLICK_CONCEPT, { exemptDocumentedAbsence: true })).toEqual([]);

    // The exemption is only as safe as the list it reads from, so the list is
    // asserted: the three names the ADD names, none of them carrying a vendor
    // `$` prefix, each with a real reason attached.
    expect([...NOT_BUILT_NAMES].toSorted()).toEqual(
      ["dead_click", "form_abandonment", "rage_click"].toSorted(),
    );
    for (const detector of NOT_BUILT_DETECTORS) {
      expect(detector.name).not.toContain("$");
      expect(detector.reason.length).toBeGreaterThan(40);
    }
  });

  test("should contain no time-clustered click-burst predicate anywhere under src/detect", () => {
    // LEG 1 — the clustering vocabulary itself. `cluster`, `burst`, `rapid`,
    // `rage`, `throttle`: the words such a predicate is written in. Zero,
    // everywhere, including `not-built.ts`'s executable code.
    expect(offenders(DETECT_TOKENS, CLUSTERING_CONCEPT, { exemptDocumentedAbsence: true })).toEqual(
      [],
    );

    // LEG 2 — CO-OCCURRENCE. `error_event` legitimately correlates an
    // exception to the action before it, so a time window on its own is not an
    // offence. A module naming BOTH a click concept and a time concept is:
    // that is the shape of "group clicks that happened close together".
    const cooccurring = DETECT_MODULES.filter((mod) => {
      const clickish = mod.tokens.some(
        (token) => CLICK_CONCEPT.test(token.text) && !isDocumentedAbsenceName(token),
      );
      const timeish = mod.tokens.some((token) => TIME_CONCEPT.test(token.text));
      return clickish && timeish;
    }).map((mod) => mod.module);
    expect(cooccurring).toEqual([]);

    // LEG 3 — BEHAVIOURAL, and the leg a lexical scan can never provide. Feed
    // both detectors the EXACT input a rage-click proxy exists to fire on:
    // thirty sessions, ten events each on ONE surface, twenty milliseconds
    // apart. A time-clustered burst predicate would light up here. The honest
    // answer — the one this sprint ships — is silence.
    const burst = FIXTURE_CORPORA.find((entry) => entry.name.startsWith("rapid repeated"));
    if (!burst) throw new Error("the burst fixture must remain in FIXTURE_CORPORA");

    // NON-VACUITY of the fixture itself: it really is a dense same-surface
    // burst, so the silence below is a decision and not an empty input.
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
    // (a) THE DIRECTORY. If the glob resolved nothing, every assertion above
    // would be vacuously true.
    expect(DETECT_MODULES.length).toBeGreaterThan(0);
    expect(DETECT_MODULES.map((mod) => mod.module)).toEqual([
      "analysed.ts",
      "error-event.ts",
      "funnel-dropoff.ts",
      "not-built.ts",
      "order.ts",
      "types.ts",
    ]);

    // (b) THE TOKENS. The scanner must actually be reading declarations and
    // literals out of those modules, in both kinds.
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

    // (c) THE STRIP STRIPPED. `not-built.ts`'s comment block spells out every
    // barred concept by name — that is the F-9 precedent, and it is why the
    // scan must never see raw text. Prove the comments are gone.
    const notBuilt = DETECT_MODULES.find((mod) => mod.module === "not-built.ts");
    if (!notBuilt) throw new Error("not-built.ts must exist — it records the D-17 decision");
    for (const commentOnly of ["FAILED-TO-PIN", "SUPERSET", "rapid", "elements", "D10"]) {
      expect({ phrase: commentOnly, inRaw: notBuilt.raw.includes(commentOnly) }).toEqual({
        phrase: commentOnly,
        inRaw: true,
      });
      expect({ phrase: commentOnly, inCode: notBuilt.code.includes(commentOnly) }).toEqual({
        phrase: commentOnly,
        inCode: false,
      });
    }

    // (d) AND IT DID NOT OVER-STRIP. An over-aggressive comment removal would
    // make this entire suite vacuous while still reporting green. The
    // executable declarations must survive it.
    expect(notBuilt.code).toContain("NOT_BUILT_DETECTORS");
    expect(notBuilt.code).toContain("rage_click");

    // (e) THE OFFENDER DETECTOR DETECTS OFFENDERS. The strongest leg: run the
    // real scanner over a synthetic module carrying exactly the proxy this
    // file exists to bar, and require every marker to fire. If a future edit
    // softens a pattern, this fails before the invariants above go quiet.
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
    // ...and the control's comment line alone must NOT be what fired: the
    // exact same text with the code removed is clean, which is the proof that
    // the F-9 documentation pattern stays legal.
    const commentOnlyControl = scanSource(
      "comment-only.ts",
      "// $rageclick, $dead_click, $autocapture, cluster, burst, rapid clicks.\n",
    );
    expect(commentOnlyControl.tokens).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B — the two D-9 guards (ESC-5)
// ═══════════════════════════════════════════════════════════════════════════

describe("no T1 detector may propose changed_mind (D-9, ESC-5)", () => {
  test("should contain no changed_mind literal in any module under src/detect", async () => {
    // D-9's front door. `changed_mind`'s proof is satisfied by the ABSENCE of
    // everything, so a deterministic predicate proposing it renders "we
    // detected nothing" as "we detected a user decision" — BS-1(a)'s silent
    // save told to a founder as "this user changed their mind". FR-13B floors
    // the cascade; this closes the proposal path.
    expect(offenders(DETECT_TOKENS, CHANGED_MIND, { exemptDocumentedAbsence: false })).toEqual([]);

    // NON-VACUITY, and the sharpest form available: the SAME scanner, over the
    // module where the class legitimately lives, must find it. If the pattern
    // or the tokeniser ever stopped matching, this fails first.
    const gate = scanSource("gate.ts", await Bun.file(`${SRC_DIR}/evidence/gate.ts`).text());
    expect(offenders(gate.tokens, CHANGED_MIND, { exemptDocumentedAbsence: false })).not.toEqual(
      [],
    );

    // The type-level half of the same decision: the class is fully built in
    // the gate's vocabulary and absent from the detectors' (ESC-3's posture,
    // applied to `changed_mind`).
    expect(findingClassSchema.options).toContain("changed_mind");
    expect(detectorProposedClassSchema.options).not.toContain("changed_mind");
  });

  test("should emit no candidate claiming changed_mind over the full fixture corpus", () => {
    const ruleSet = ruleSetV1();
    const corpora = FIXTURE_CORPORA.map((entry) => entry.corpus);
    const candidates = candidatesOver(corpora, ruleSet);

    // NON-VACUITY FIRST. A guard over an empty candidate list proves nothing,
    // so the corpus must have made both detectors speak before the absence
    // below means anything.
    expect(candidates.length).toBeGreaterThan(0);
    expect(new Set(candidates.map((candidate) => candidate.detector))).toEqual(
      new Set(["funnel_dropoff", "error_event"]),
    );

    // THE GUARD. Reported per corpus so a failure names the fixture that
    // produced it rather than just a count.
    const claimedByCorpus = FIXTURE_CORPORA.map((entry) => ({
      corpus: entry.name,
      changedMindClaims: detectAll(entry.corpus, ruleSet)
        .flatMap((result) => result.candidates)
        .filter((candidate) => CHANGED_MIND.test(candidate.claimedClass)).length,
    }));
    expect(claimedByCorpus).toEqual(
      FIXTURE_CORPORA.map((entry) => ({ corpus: entry.name, changedMindClaims: 0 })),
    );

    // Every claim made is one the proposal type admits — PL ruling 13's two
    // classes and nothing else.
    for (const candidate of candidates) {
      expect(detectorProposedClassSchema.options).toContain(candidate.claimedClass);
    }
    expect(new Set(candidates.map((candidate) => candidate.claimedClass))).toEqual(
      new Set(["confusing", "broken"]),
    );

    // And no detector emits the SIGNAL `changed_mind`'s proof reads either. A
    // detector cannot manufacture the class through the back door by handing
    // the gate a `clean_exit` it inferred from a quiet session.
    const signalKinds = new Set(
      candidates.flatMap((candidate) => candidate.signals).map((signal) => signal.kind),
    );
    expect(signalKinds).not.toContain("clean_exit");
  });
});
