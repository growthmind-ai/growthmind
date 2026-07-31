// ADD §7 "Unit — the candidate contract" — the first FOUR named tests for
// `candidateFindingSchema` (FR-17, FR-10).
//
// This file is the sprint's reason to exist: the candidate contract is what
// O-005 (the model layer), O-006 (the signature and ledger maths) and O-007
// (the Slack block renderer) all compile against. Nothing invalid may be
// CONSTRUCTIBLE through it — a candidate whose final class the gate could not
// have reached, or one carrying a count without its denominator, is refused
// here rather than discovered in a founder's Slack channel.
//
// The fifth ADD test — `should expose no bare number count field on any
// exported detector or gate return type` — was deliberately NOT written at
// Wave 2: it is an AST scan, and an AST scan run against a scaffold of stubs
// is near-vacuous. It lands here now (Wave 7), against real return types.
//
// Two properties of the schema shape these tests, and both are load-bearing:
//
//   1. `candidateFindingSchema` is a REFINED schema (`.refine` carries the
//      reachability rule), so `.shape` DOES NOT EXIST on it. Field presence is
//      therefore asserted by parsing representative candidates, never by
//      introspecting the schema object.
//   2. A `MeasuredCount` is BRANDED with a module-private symbol, so the only
//      way this file can build one is `measuredCount()` itself. That is the
//      point: a test that could fabricate a count would not be testing FR-10.
//
// No clock and no randomness anywhere in this file — the suite's instant is a
// constant, passed as a REQUIRED parameter to every builder (ADD §6.5).
import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { isMeasuredCount, measuredCount } from "../../src/counts/measured-count";
import type { MeasuredCount } from "../../src/counts/measured-count";
import { claimSubjectSchema } from "../../src/detect/types";
import type { AnalysisWindow, DetectorCandidate } from "../../src/detect/types";
import { isReachableClass } from "../../src/evidence/gate";
import { PROOF_PREDICATE_VERSION } from "../../src/evidence/predicates";
import { GATE_REASON_MESSAGES } from "../../src/evidence/trace";
import type { TraceEntry } from "../../src/evidence/trace";
import * as candidateModule from "../../src/findings/candidate";
import { candidateFindingSchema, confidenceBasisSchema } from "../../src/findings/candidate";
import { EVIDENCE_SHAPE_VERSION } from "../../src/findings/evidence-shape";
import { THRESHOLD_RULE_SET_VERSION } from "../../src/rules/thresholds";

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// FIXTURE TIME IS A CONSTANT AND EVERY BUILDER TAKES IT AS A REQUIRED
// PARAMETER. `Date.now()` in a fixture makes a suite time-of-day flaky, and a
// flaky red is indistinguishable from a genuine one — the failure mode ADD
// §6.5 records as having cost a whole sprint-run.

/** The suite's only instant. */
const FIXTURE_NOW = new Date("2026-05-01T12:00:00.000Z");

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function windowEndingAt(now: Date): AnalysisWindow {
  return { start: new Date(now.getTime() - SEVEN_DAYS_MS), end: now };
}

/**
 * A real, branded count: 12 of 28 kept sessions, out of 40 in the window.
 *
 * `kept + Σ setAside.count === totalInWindow` (28 + 3 + 9 = 40) and
 * `denominator === basis.kept`, so `measuredCount` has no reason to refuse it
 * once implemented — the D-7 identity holds.
 */
function keptSessionCount(now: Date): MeasuredCount {
  return measuredCount({
    numerator: 12,
    denominator: 28,
    unit: "sessions",
    timeframe: windowEndingAt(now),
    basis: {
      totalInWindow: 40,
      kept: 28,
      setAside: [
        {
          reason: "internal_domain",
          count: 3,
          label: EXCLUSION_REASON_LABELS.internal_domain,
        },
        {
          reason: "automation_known_agent",
          count: 9,
          label: EXCLUSION_REASON_LABELS.automation_known_agent,
        },
      ],
    },
  });
}

/**
 * The trace of a `broken` claim that failed its proof and passed at
 * `confusing` — length 2, one entry per rung evaluated (FR-14, ES-15).
 *
 * Built as literals rather than through `traceEntry()` so a failure in this
 * suite is attributable to the candidate contract and not to the trace
 * builder. The sentences come from `GATE_REASON_MESSAGES` so the fixture can
 * never drift from the real table.
 */
function brokenDowngradedToConfusingTrace(): readonly TraceEntry[] {
  return [
    {
      class: "broken",
      predicate: "broken_failure_correlated",
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: false,
      reasonCode: "broken_unsatisfied",
      reason: GATE_REASON_MESSAGES.broken_unsatisfied,
    },
    {
      class: "confusing",
      predicate: "confusing_struggle",
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: true,
      reasonCode: "confusing_satisfied",
      reason: GATE_REASON_MESSAGES.confusing_satisfied,
    },
  ];
}

/**
 * A representative VALID candidate, as a loose record so a test can drop or
 * corrupt exactly one field. Handing the schema an already-typed value would
 * let the compiler do the refusing and leave the runtime contract — the thing
 * O-005 actually depends on — unasserted.
 */
type CandidateFixture = Record<string, unknown>;

function candidateFixture(now: Date, overrides: CandidateFixture = {}): CandidateFixture {
  return {
    detector: "funnel_dropoff",
    claimedClass: "broken",
    finalClass: "confusing",
    trace: brokenDowngradedToConfusingTrace(),
    counts: [keptSessionCount(now)],
    timeframe: windowEndingAt(now),
    // What `surface` is a claim ABOUT (FR-3c, ESC-6). Every T1 detector sets
    // it; the contract now requires it, so no fixture may omit it.
    claimSubject: "surface",
    surface: "/checkout/payment",
    surfaceNormalisationVersion: 1,
    evidenceShape:
      '{"detector":"funnel_dropoff","signalKinds":["struggle"],' +
      '"surface":"/checkout/payment","surfaceNormalisationVersion":1,' +
      '"symptomClass":"broken","v":1}',
    evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
    thresholdRuleSetVersion: THRESHOLD_RULE_SET_VERSION,
    ranking: { sampleSize: keptSessionCount(now), confidenceBasis: "threshold_met" },
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
    ...overrides,
  };
}

/** Every field FR-17 commits the contract to carrying. */
const REQUIRED_FIELDS = [
  "detector",
  "claimedClass",
  "finalClass",
  "trace",
  "counts",
  "timeframe",
  "claimSubject",
  "surface",
  "surfaceNormalisationVersion",
  "evidenceShape",
  "evidenceShapeVersion",
  "thresholdRuleSetVersion",
  "ranking",
  "coverage",
] as const;

/** The issue paths of a rejection, dotted — `[]` when the parse succeeded. */
function rejectionPaths(input: unknown): readonly string[] {
  const result = candidateFindingSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

// ── The tests ───────────────────────────────────────────────────────────────

describe("candidateFindingSchema — reachability (FR-17)", () => {
  test("should reject a candidate whose final class is unreachable from its claimed class", () => {
    // The rule the schema refuses on, asserted at its source first. The gate
    // only ever DESCENDS `DOWNGRADE_PATH`, and `changed_mind` is not a
    // destination from anywhere — that is FR-13B's floor (D-10).
    expect(isReachableClass("broken", "broken")).toBe(true);
    expect(isReachableClass("broken", "confusing")).toBe(true);
    expect(isReachableClass("confusing", "broken")).toBe(false);
    expect(isReachableClass("broken", "changed_mind")).toBe(false);
    expect(isReachableClass("instrumentation", "confusing")).toBe(false);

    // NON-VACUITY. The same fixture with a REACHABLE final class must parse,
    // so every rejection below is attributable to reachability and not to a
    // broken fixture.
    expect(candidateFindingSchema.safeParse(candidateFixture(FIXTURE_NOW)).success).toBe(true);

    // An ASCENT. A candidate cannot come out of this gate claiming `confusing`
    // and concluding `broken` — nothing in the descent climbs.
    expect(
      rejectionPaths(
        candidateFixture(FIXTURE_NOW, { claimedClass: "confusing", finalClass: "broken" }),
      ),
    ).toContain("finalClass");

    // THE FLATTERING SIDEWAYS STEP. `broken -> changed_mind` is the shape of
    // BS-1(a)'s incident — "the product broke under them" rendered as "they
    // changed their mind". Unreachable by the path, and refused here too.
    expect(
      rejectionPaths(
        candidateFixture(FIXTURE_NOW, { claimedClass: "broken", finalClass: "changed_mind" }),
      ),
    ).toContain("finalClass");
  });
});

describe("candidateFindingSchema — counts carry denominators (FR-17, FR-10)", () => {
  test("should reject a candidate carrying a count without a denominator", () => {
    // A count with no denominator at all: "12 sessions dropped off" is noise a
    // founder cannot act on.
    const noDenominator = {
      numerator: 12,
      unit: "sessions",
      timeframe: windowEndingAt(FIXTURE_NOW),
    };

    // And one that LOOKS complete but was never built by `measuredCount`. The
    // brand is what makes "impossible to construct without a denominator"
    // literal rather than aspirational (D-8): a structurally identical object
    // literal is NOT a `MeasuredCount`, and the schema must say so.
    const unbranded = {
      numerator: 12,
      denominator: 28,
      unit: "sessions",
      timeframe: windowEndingAt(FIXTURE_NOW),
      basis: { totalInWindow: 40, kept: 28, setAside: [] },
    };

    for (const count of [noDenominator, unbranded]) {
      expect(rejectionPaths(candidateFixture(FIXTURE_NOW, { counts: [count] }))).toContain(
        "counts.0",
      );
    }

    // A candidate with NO counts is not a weaker claim, it is an unmeasured
    // one. `.min(1)` is the refusal.
    expect(rejectionPaths(candidateFixture(FIXTURE_NOW, { counts: [] }))).toContain("counts");

    // NON-VACUITY: a properly constructed count passes the same field.
    expect(isMeasuredCount(keptSessionCount(FIXTURE_NOW))).toBe(true);
    expect(candidateFindingSchema.safeParse(candidateFixture(FIXTURE_NOW)).success).toBe(true);
  });
});

describe("candidateFindingSchema — what the contract carries (FR-17)", () => {
  test("should carry class, trace, counts, timeframe, surface, evidence_shape + version, and rule-set version", () => {
    const parsed = candidateFindingSchema.parse(candidateFixture(FIXTURE_NOW));

    // The schema is REFINED, so `.shape` is unavailable. Presence is asserted
    // over a parsed representative candidate instead — and because Zod strips
    // unknown keys, this key set IS the contract's field set.
    expect(Object.keys(parsed).toSorted()).toEqual(REQUIRED_FIELDS.toSorted());

    expect(parsed.detector).toBe("funnel_dropoff");
    expect(parsed.claimedClass).toBe("broken");
    expect(parsed.finalClass).toBe("confusing");
    // The trace records EVERY rung evaluated, not just the losing one (ES-15).
    expect(parsed.trace).toHaveLength(2);
    expect(parsed.counts).toHaveLength(1);
    expect(parsed.timeframe.end).toEqual(FIXTURE_NOW);
    expect(parsed.surface).toBe("/checkout/payment");
    expect(parsed.surfaceNormalisationVersion).toBe(1);
    // The CANONICAL STRING, never a hash — O-006 hashes it, and a hash here
    // would leave it nothing to check its own maths against (D-12).
    expect(parsed.evidenceShape).toContain("funnel_dropoff");
    expect(parsed.evidenceShapeVersion).toBe(EVIDENCE_SHAPE_VERSION);
    // Which rule set produced every threshold judgement above (FR-8) — without
    // it, a v2 threshold change silently re-reads every candidate on record.
    expect(parsed.thresholdRuleSetVersion).toBe(THRESHOLD_RULE_SET_VERSION);

    // CARRIED means REQUIRED, not "present in this fixture". Dropping any one
    // field is a rejection, so O-005 cannot construct a partial candidate.
    for (const field of REQUIRED_FIELDS) {
      const missingOne = candidateFixture(FIXTURE_NOW);
      delete missingOne[field];
      expect({ field, rejected: rejectionPaths(missingOne).length > 0 }).toEqual({
        field,
        rejected: true,
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FR-3c / ESC-6 — the claim subject is WIRED, not merely typed (D11, D9).
// ═══════════════════════════════════════════════════════════════════════════
//
// THE DEFECT THESE TWO TESTS CLOSE. `claimSubject` was declared on
// `DetectorCandidate` and SET by both T1 detectors — `detect/funnel-dropoff.ts`
// and `detect/error-event.ts` each write `claimSubject: "surface"` — while
// `candidateFindingSchema` had no such field. Produced by two writers, read by
// nobody: a value computed and dropped on the floor, which is the edge-case
// taxonomy's D11 exactly. The type-level half looked complete, and O-006 would
// have hashed an identity whose subject was an assumption.
//
// A field's PRESENCE proves nothing here. What proves the wire is (a) a parse
// that REFUSES a candidate without it, and (b) one test that carries the value
// across the producer/consumer boundary rather than a producer test beside a
// consumer test.

describe("candidateFindingSchema — the claim subject discriminator (FR-3c, ESC-6, D11)", () => {
  test("should reject a candidate finding that omits claimSubject, or claims a subject that is not a surface", () => {
    // (a) THE LOAD-BEARING REFUSAL. Adding the field without this assertion
    //     would leave the same dead wire behind a nicer type: a field only the
    //     producer writes and nothing refuses is not wired.
    const omitted = candidateFixture(FIXTURE_NOW);
    delete omitted.claimSubject;
    expect(rejectionPaths(omitted)).toContain("claimSubject");

    // ...and it is NOT quietly defaulted to the only value it can hold. A
    // `.default("surface")` would satisfy every presence check in this file
    // while asserting nothing about what the detector actually claimed.
    expect(rejectionPaths(candidateFixture(FIXTURE_NOW, { claimSubject: undefined }))).toContain(
      "claimSubject",
    );

    // (b) D9, the runtime half. Inside TypeScript a wrong subject is a COMPILE
    //     error — `DetectorCandidate.claimSubject` is typed `ClaimSubject` and
    //     the schema is a `z.literal`, so `claimSubject: "segment"` on a typed
    //     producer fails `bun run typecheck` before any test runs. This covers
    //     the same line for a value arriving from outside the type system (a
    //     persisted row, a JSON payload), where a wrong string would otherwise
    //     be a silent overload of the surface field.
    for (const wrongSubject of ["segment", "feature_flag", "Surface", "surfaces", ""]) {
      expect(
        rejectionPaths(candidateFixture(FIXTURE_NOW, { claimSubject: wrongSubject })),
      ).toContain("claimSubject");
      // The refusal comes from `claimSubjectSchema` itself — the single source
      // of truth (D9). Nothing here reads "surface" out of a comment.
      expect(claimSubjectSchema.safeParse(wrongSubject).success).toBe(false);
    }

    // NON-VACUITY: the same fixture with a real subject parses, so every
    // rejection above is attributable to `claimSubject` and not to the fixture.
    expect(candidateFindingSchema.safeParse(candidateFixture(FIXTURE_NOW)).success).toBe(true);
  });

  test("should carry claimSubject from a detector-produced DetectorCandidate through to a parsed CandidateFinding", () => {
    // THE WIRE, IN ONE TEST. A producer test plus a consumer test do not prove
    // the wire between them (D11), so this crosses the boundary in a single
    // assertion path: `DetectorCandidate` — what `detect/error-event.ts:291-297`
    // builds — into `candidateFindingSchema.parse`, which is the real consumer
    // entry point this package has today. (There is deliberately no `src/`
    // composition function yet; inventing one here would be a follow-on
    // sprint's shape, and this test would then prove the wire into a module
    // nothing else calls.)
    //
    // The producer half is a TYPED `DetectorCandidate`, not a loose record, so
    // the compiler binds every field to the detectors' own contract and this
    // literal cannot drift from what they emit without failing typecheck. It is
    // a typed value rather than a live `detectErrorEvent` run on purpose: this
    // file's subject is the candidate CONTRACT, and coupling it to a detector's
    // firing thresholds would make a threshold change read as a contract
    // failure.
    const produced: DetectorCandidate = {
      detector: "error_event",
      claimedClass: "broken",
      // The one line under test, and the only place this string is written on
      // the producer side.
      claimSubject: "surface",
      surface: "/checkout/payment",
      surfaceNormalisationVersion: 1,
      signals: [],
      counts: [keptSessionCount(FIXTURE_NOW)],
      timeframe: windowEndingAt(FIXTURE_NOW),
      coverage: { truncated: false, eventsWithoutUrlPath: 0 },
    };

    // EVERY consumer field is READ OFF the produced candidate — nothing below
    // re-types a value the producer already decided. That is what makes a
    // severed wire fail here rather than a fixture that happens to agree.
    const parsed = candidateFindingSchema.parse(
      candidateFixture(FIXTURE_NOW, {
        detector: produced.detector,
        claimedClass: produced.claimedClass,
        claimSubject: produced.claimSubject,
        surface: produced.surface,
        surfaceNormalisationVersion: produced.surfaceNormalisationVersion,
        counts: [...produced.counts],
        timeframe: produced.timeframe,
        coverage: produced.coverage,
      }),
    );

    // The value ARRIVED, and it is the producer's value.
    expect(parsed.claimSubject).toBe(produced.claimSubject);
    expect(parsed.claimSubject).toBe("surface");
    // ...beside the surface it discriminates, so the pair travels together.
    expect(parsed.surface).toBe(produced.surface);
    expect(parsed.detector).toBe("error_event");

    // NON-VACUITY, the D11 leg: strip the value at the boundary and the parse
    // fails. Without this, the assertions above would still pass against a
    // schema that ignored the field entirely.
    const severed = candidateFixture(FIXTURE_NOW, { surface: produced.surface });
    delete severed.claimSubject;
    expect(rejectionPaths(severed)).toContain("claimSubject");
  });
});

describe("candidateFindingSchema — ranking inputs, no ranking (FR-17)", () => {
  test("should carry the ranking inputs O-006 will need (sample size, confidence basis) without implementing ranking", () => {
    const parsed = candidateFindingSchema.parse(candidateFixture(FIXTURE_NOW));

    // The INPUTS, and only the inputs.
    expect(Object.keys(parsed.ranking).toSorted()).toEqual(["confidenceBasis", "sampleSize"]);

    // The sample size is a real `MeasuredCount`, so O-006 reads a denominator
    // off a typed value rather than re-deriving one from a rendered string.
    expect(isMeasuredCount(parsed.ranking.sampleSize)).toBe(true);
    expect(parsed.ranking.sampleSize.denominator).toBe(28);
    expect(parsed.ranking.sampleSize.unit).toBe("sessions");

    expect(parsed.ranking.confidenceBasis).toBe("threshold_met");
    // `at_threshold` is its OWN member, not folded into `threshold_met`: D-6
    // makes every boundary inclusive, and O-006 may want to rank the exact
    // boundary case lower than a comfortable pass. Folding it now would
    // destroy that information before its consumer exists.
    expect(confidenceBasisSchema.options.toSorted()).toEqual([
      "at_threshold",
      "below_threshold",
      "threshold_met",
    ]);

    // A stated basis the gate can actually justify is required — an unknown
    // one is rejected, never defaulted to the most flattering value.
    expect(
      rejectionPaths(
        candidateFixture(FIXTURE_NOW, {
          ranking: { sampleSize: keptSessionCount(FIXTURE_NOW), confidenceBasis: "probably_fine" },
        }),
      ),
    ).toContain("ranking.confidenceBasis");

    // AND NO RANKING IS IMPLEMENTED (FR-17). Ranking by expected value is
    // O-006's; a score computed here would be a number this sprint has no
    // evidence to justify, and O-006 would inherit it as a fact.
    const rankingLike = /rank|score|prioriti|expected|weight/i;
    const rankingFunctions = Object.entries(candidateModule)
      .filter(([name, value]) => typeof value === "function" && rankingLike.test(name))
      .map(([name]) => name);
    expect(rankingFunctions).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The fifth ADD test — no bare `number` count anywhere on the contract
// (FR-10, D-8). Wave 7's addition; the four tests above are untouched.
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY THIS IS A SOURCE SCAN AND NOT A BEHAVIOUR. `MeasuredCount` exists so a
// count and its denominator cannot be separated (D-8): "12 sessions dropped
// off" is noise a founder cannot act on; "12 of 28 kept sessions" is a fact.
// A behavioural test can only cover the fields somebody remembered to write a
// case for. The mistake this guards is a LATER one — an O-005/O-006/O-007
// author adding `affectedSessions: number` to `DetectorCandidate` or
// `GateOutcome` because it is convenient for a Slack block — and no other test
// in this package would notice. Only a total scan over the declared types can
// hold that line, which is why it is written at source level.
//
// SCOPE: the modules whose exported types ARE the detector and gate return
// surfaces. `rules/types.ts` is deliberately NOT among them — `ThresholdRuleSet`
// members like `funnelMinSessionsAtOrigin: number` are THRESHOLDS, magnitudes
// the detector compares against, not measurements it reports. Folding them in
// would force a false positive and the guard would be loosened to accommodate
// it, which is how a real invariant dies.
//
// Read through `Bun.file`, never `node:fs` — `packages/core` imports no node
// builtin in `src/` or in `__tests__/` (D-13).

/** The exported-type modules that make up the detector and gate return
 * surfaces. `counts/measured-count.ts` is scanned rather than skipped so the
 * exclusion of `MeasuredCount`'s own definition is EXPLICIT and testable
 * (below), instead of achieved by quietly not looking. */
const SCANNED_MODULES: readonly string[] = [
  "detect/types.ts",
  "detect/analysed.ts",
  "evidence/gate.ts",
  "evidence/trace.ts",
  "evidence/signals.ts",
  "evidence/predicates.ts",
  "findings/evidence-shape.ts",
  "counts/measured-count.ts",
];

/** The field names FR-10 is about: anything that reads as a measurement. */
const COUNT_LIKE = /count|total|numerator|sessions|hits/i;

/** A BARE number — the thing that must never carry a count. `number | null`
 * counts as bare: a nullable count is still a count with no denominator. */
const BARE_NUMBER = /^(?:readonly\s+)?number(?:\s*\|\s*(?:null|undefined))*$/;

/**
 * `MeasuredCount`'s OWN definition. These four declarations are where a bare
 * `numerator: number` / `kept: number` legitimately lives — they are the
 * inside of the branded value, reachable only through `measuredCount()`, which
 * asserts the denominator identity before stamping the brand.
 */
const MEASURED_COUNT_OWN_DEFINITION: ReadonlySet<string> = new Set([
  "MeasuredCount",
  "MeasuredCountInput",
  "CountBasis",
  "SetAsideBasis",
]);

/** `basis` is the composition of the denominator, not a count of anything. */
const EXCLUDED_MEMBER_NAMES: ReadonlySet<string> = new Set(["basis"]);

type DeclaredMember = {
  readonly module: string;
  /** The `export type X` the member was declared inside. */
  readonly owner: string;
  readonly member: string;
  readonly annotation: string;
};

function stripTypeComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The text from `start` to the `;` that closes the declaration, ignoring any
 * `;` nested inside braces, brackets or parens — which is what makes an inline
 * union arm (`| { readonly kind: "pass"; … }`) part of ONE declaration. */
function readDeclarationBody(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{" || char === "[" || char === "(") depth += 1;
    else if (char === "}" || char === "]" || char === ")") depth -= 1;
    else if (char === ";" && depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

/**
 * Collects the object-type MEMBERS of every `export type` declaration in a
 * module, at any nesting depth (union arms included), with the declaration
 * they belong to.
 *
 * Declaration-scoped rather than a text grep for `: number`, so the owner is
 * known — without it, `MeasuredCount`'s own internals could not be excluded
 * without also excluding every field called `numerator` everywhere, which is
 * exactly the field this guard exists to catch on other types.
 */
function collectDeclaredMembers(module: string, source: string): readonly DeclaredMember[] {
  const clean = stripTypeComments(source);
  const collected: DeclaredMember[] = [];

  const declarationHead = /export\s+type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/g;
  let head: RegExpExecArray | null = declarationHead.exec(clean);
  while (head !== null) {
    const owner = head[1] ?? "<type>";
    const body = readDeclarationBody(clean, head.index + head[0].length);

    const memberHead = /(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:\s*([^;,}]*)/g;
    let member: RegExpExecArray | null = memberHead.exec(body);
    while (member !== null) {
      collected.push({
        module,
        owner,
        member: member[1] ?? "",
        annotation: (member[2] ?? "").trim(),
      });
      member = memberHead.exec(body);
    }

    head = declarationHead.exec(clean);
  }

  return collected;
}

/** `module :: Owner.member: annotation` — an offender line naming the exact
 * declaration to fix. */
function bareNumberCounts(
  members: readonly DeclaredMember[],
  options: { readonly applyExclusions: boolean },
): readonly string[] {
  return members
    .filter((entry) => COUNT_LIKE.test(entry.member))
    .filter((entry) => BARE_NUMBER.test(entry.annotation))
    .filter(
      (entry) =>
        !options.applyExclusions ||
        (!MEASURED_COUNT_OWN_DEFINITION.has(entry.owner) &&
          !EXCLUDED_MEMBER_NAMES.has(entry.member)),
    )
    .map((entry) => `${entry.module} :: ${entry.owner}.${entry.member}: ${entry.annotation}`);
}

/**
 * The runtime half, and the reason it is needed: `CandidateFinding` is INFERRED
 * from a Zod schema, so it has no `export type … = { … }` declaration for the
 * scan above to read. Walks a parsed candidate and reports every count-like key
 * holding a raw number that is NOT inside a branded `MeasuredCount`.
 */
function bareNumberCountsAtRuntime(
  value: unknown,
  path: string,
  insideMeasuredCount: boolean,
  found: { readonly offenders: string[]; readonly insideCountKeys: string[] },
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      bareNumberCountsAtRuntime(item, `${path}[${index}]`, insideMeasuredCount, found),
    );
    return;
  }
  if (value === null || typeof value !== "object" || value instanceof Date) return;

  const branded = insideMeasuredCount || isMeasuredCount(value);
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "" ? key : `${path}.${key}`;
    if (typeof child === "number" && COUNT_LIKE.test(key)) {
      if (branded) found.insideCountKeys.push(childPath);
      else found.offenders.push(`${childPath}: number`);
      continue;
    }
    bareNumberCountsAtRuntime(child, childPath, branded, found);
  }
}

describe("no bare number count on the contract (FR-10, D-8)", () => {
  test("should expose no bare number count field on any exported detector or gate return type", async () => {
    const members: DeclaredMember[] = [];
    for (const modulePath of SCANNED_MODULES) {
      const source = await Bun.file(`${import.meta.dir}/../../src/${modulePath}`).text();
      members.push(...collectDeclaredMembers(modulePath, source));
    }

    // ── NON-VACUITY, before the invariant ────────────────────────────────
    //
    // (a) The collector found real declarations in every scanned module. A
    //     silent parse failure would make the assertion below vacuously true.
    for (const modulePath of SCANNED_MODULES) {
      expect({
        module: modulePath,
        members: members.filter((entry) => entry.module === modulePath).length > 0,
      }).toEqual({ module: modulePath, members: true });
    }

    // (b) It found the specific members whose shape this test is ABOUT —
    //     including the two legitimate count-like fields that must pass
    //     (`counts` is an array of branded values; `sessions` is an array of
    //     timelines) and one bare `number` that must pass because its NAME is
    //     not a count (`predicateVersion`).
    const found = new Map(members.map((entry) => [`${entry.owner}.${entry.member}`, entry]));
    for (const [key, annotation] of [
      ["DetectorCandidate.counts", "readonly MeasuredCount[]"],
      ["DetectorCorpus.sessions", "readonly SessionTimeline[]"],
      ["DetectorCoverage.eventsWithoutUrlPath", "number"],
      ["TraceEntry.predicateVersion", "number"],
      ["CountBasis.totalInWindow", "number"],
      ["MeasuredCount.numerator", "number"],
      ["ProposedClaim.counts", "readonly MeasuredCount[]"],
    ] as const) {
      expect({ key, annotation: found.get(key)?.annotation }).toEqual({ key, annotation });
    }

    // (c) THE EXCLUSIONS ARE LOAD-BEARING, not decoration. With them switched
    //     off, `MeasuredCount`'s own internals ARE flagged — which proves the
    //     matcher fires on exactly the shape it claims to and that the two
    //     exclusions are carrying real weight rather than hiding an empty
    //     scan.
    const withoutExclusions = bareNumberCounts(members, { applyExclusions: false });
    expect(withoutExclusions).toContain(
      "counts/measured-count.ts :: MeasuredCount.numerator: number",
    );
    expect(withoutExclusions).toContain(
      "counts/measured-count.ts :: CountBasis.totalInWindow: number",
    );
    expect(withoutExclusions).toContain("counts/measured-count.ts :: SetAsideBasis.count: number");

    // (d) And a SYNTHETIC OFFENDER of the exact shape a later outcome would
    //     add is caught, exclusions and all.
    const control = collectDeclaredMembers(
      "control.ts",
      [
        "export type SlackBlockInput = {",
        "  readonly surface: string;",
        "  readonly affectedSessions: number;",
        "  readonly dropoffCount: number | null;",
        "  readonly counts: readonly MeasuredCount[];",
        "};",
      ].join("\n"),
    );
    expect(bareNumberCounts(control, { applyExclusions: true })).toEqual([
      "control.ts :: SlackBlockInput.affectedSessions: number",
      "control.ts :: SlackBlockInput.dropoffCount: number | null",
    ]);

    // ── THE INVARIANT ────────────────────────────────────────────────────
    expect(bareNumberCounts(members, { applyExclusions: true })).toEqual([]);

    // ── THE RUNTIME HALF ─────────────────────────────────────────────────
    //
    // `CandidateFinding` is inferred from a refined Zod schema, so it has no
    // type-literal declaration for the scan above to read. Without this leg
    // the test's headline would silently exclude the very contract it lives
    // beside.
    const parsed = candidateFindingSchema.parse(candidateFixture(FIXTURE_NOW));
    const walked = { offenders: [] as string[], insideCountKeys: [] as string[] };
    bareNumberCountsAtRuntime(parsed, "", false, walked);

    // Non-vacuity: the walker really did reach the numbers, and every one it
    // found was inside a branded count.
    expect(walked.insideCountKeys).toContain("counts[0].numerator");
    expect(walked.insideCountKeys).toContain("counts[0].basis.totalInWindow");
    expect(walked.insideCountKeys).toContain("ranking.sampleSize.numerator");
    expect(walked.offenders).toEqual([]);

    // And the walker flags a candidate-shaped object that carries a loose one.
    const runtimeControl = { offenders: [] as string[], insideCountKeys: [] as string[] };
    bareNumberCountsAtRuntime(
      { surface: "/checkout", sessionCount: 12, coverage: { totalHits: 3 } },
      "",
      false,
      runtimeControl,
    );
    expect(runtimeControl.offenders).toEqual([
      "sessionCount: number",
      "coverage.totalHits: number",
    ]);
  });
});
