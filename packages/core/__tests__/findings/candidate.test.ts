// Unit tests for the candidate contract: the first four named tests for
// `candidateFindingSchema`.
//
// This file is the sprint's reason to exist: the candidate contract is what (the model
// layer), (the signature and ledger maths) and (the Slack block renderer) all compile
// against. Nothing invalid may be constructible through it. A candidate whose final
// class the gate could not have reached, or one carrying a count without its
// denominator, is refused here rather than discovered in a founder's Slack channel.
//
// The fifth add test, `should expose no bare number count field on any exported
// detector or gate return type`. Was deliberately not written at Wave 2: it is an ast
// scan, and an ast scan run against a scaffold of stubs is near-vacuous. It lands here
// now (Wave 7), against real return types.
//
// Two properties of the schema shape these tests, and both are load-bearing:
//
// 1. `candidateFindingSchema` is a refined schema (`.refine` carries the
//  reachability rule), so `.shape` does not exist on it. Field presence is
//  therefore asserted by parsing representative candidates, never by
//  introspecting the schema object.
// 2. A `MeasuredCount` is branded with a module-private symbol, so the only
//  way this file can build one is `measuredCount` itself. That is the
//  point: a test that could fabricate a count would not be testing.
//
// No clock and no randomness anywhere in this file. The suite's instant is a constant,
// passed as a required parameter to every builder.
import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { isMeasuredCount, measuredCount } from "../../src/counts/measured-count";
import type { MeasuredCount } from "../../src/counts/measured-count";
import { claimSubjectSchema } from "../../src/detect/types";
import type { AnalysisWindow } from "../../src/detect/types";
import { isReachableClass } from "../../src/evidence/gate";
import { PROOF_PREDICATE_VERSION } from "../../src/evidence/predicates";
import { GATE_REASON_MESSAGES } from "../../src/evidence/trace";
import type { TraceEntry } from "../../src/evidence/trace";
import * as candidateModule from "../../src/findings/candidate";
import { candidateFindingSchema, confidenceBasisSchema } from "../../src/findings/candidate";
import { EVIDENCE_SHAPE_VERSION } from "../../src/findings/evidence-shape";
import { THRESHOLD_RULE_SET_VERSION } from "../../src/rules/thresholds";

// Fixtures
//
// Fixture time is a constant and every builder takes it as a required parameter.
// `Date.now` in a fixture makes a suite time-of-day flaky, and a flaky red is
// indistinguishable from a genuine one. The failure mode records as having cost a whole
// sprint-run.

/** The suite's only instant. */
const FIXTURE_NOW = new Date("2026-05-01T12:00:00.000Z");

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function windowEndingAt(now: Date): AnalysisWindow {
  return { start: new Date(now.getTime() - SEVEN_DAYS_MS), end: now };
}

/**
 * A real, branded count: 12 of 28 kept sessions, out of 40 in the window.
 *
 * `kept + Σ setAside.count === totalInWindow` and `denominator ===
 * basis.kept`, so `measuredCount` has no reason to refuse it once implemented. The
 * identity holds.
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
 * The trace of a `broken` claim that failed its proof and passed at `confusing`. Length
 * 2, one entry per rung evaluated.
 *
 * Built as literals rather than through `traceEntry` so a failure in this suite is
 * attributable to the candidate contract and not to the trace builder. The sentences
 * come from `GATE_REASON_MESSAGES` so the fixture can never drift from the real table.
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
 * A representative valid candidate, as a loose record so a test can drop or corrupt
 * exactly one field. Handing the schema an already-typed value would let the compiler
 * do the refusing and leave the runtime contract (the thing actually depends on)
 * unasserted.
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
    // What `surface` is a claim about. Every T1 detector sets it; the contract now
    // requires it, so no fixture may omit it.
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

/** Every field commits the contract to carrying. */
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

/** The issue paths of a rejection, dotted, `[]` when the parse succeeded. */
function rejectionPaths(input: unknown): readonly string[] {
  const result = candidateFindingSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

// The tests

describe("candidateFindingSchema — reachability", () => {
  test("should reject a candidate whose final class is unreachable from its claimed class", () => {
    // The rule the schema refuses on, asserted at its source first. The gate only ever
    // descends `DOWNGRADE_PATH`, and `changed_mind` is not a destination from anywhere.
    // That is the floor.
    expect(isReachableClass("broken", "broken")).toBe(true);
    expect(isReachableClass("broken", "confusing")).toBe(true);
    expect(isReachableClass("confusing", "broken")).toBe(false);
    expect(isReachableClass("broken", "changed_mind")).toBe(false);
    expect(isReachableClass("instrumentation", "confusing")).toBe(false);

    // Non-vacuity. The same fixture with a reachable final class must parse, so every
    // rejection below is attributable to reachability and not to a broken fixture.
    expect(candidateFindingSchema.safeParse(candidateFixture(FIXTURE_NOW)).success).toBe(true);

    // An ascent. A candidate cannot come out of this gate claiming `confusing` and
    // concluding `broken`. Nothing in the descent climbs.
    expect(
      rejectionPaths(
        candidateFixture(FIXTURE_NOW, { claimedClass: "confusing", finalClass: "broken" }),
      ),
    ).toContain("finalClass");

    // The flattering sideways step. `broken -> changed_mind` is the shape of's
    // incident. "the product broke under them" rendered as "they changed their mind".
    // Unreachable by the path, and refused here too.
    expect(
      rejectionPaths(
        candidateFixture(FIXTURE_NOW, { claimedClass: "broken", finalClass: "changed_mind" }),
      ),
    ).toContain("finalClass");
  });
});

describe("candidateFindingSchema — counts carry denominators", () => {
  test("should reject a candidate carrying a count without a denominator", () => {
    // A count with no denominator at all: "12 sessions dropped off" is noise a founder
    // cannot act on.
    const noDenominator = {
      numerator: 12,
      unit: "sessions",
      timeframe: windowEndingAt(FIXTURE_NOW),
    };

    // And one that looks complete but was never built by `measuredCount`. The brand is
    // what makes "impossible to construct without a denominator" literal rather than
    // aspirational: a structurally identical object literal is not a `MeasuredCount`,
    // and the schema must say so.
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

    // A candidate with NO counts is not a weaker claim, it is an unmeasured one.
    // `.min` is the refusal.
    expect(rejectionPaths(candidateFixture(FIXTURE_NOW, { counts: [] }))).toContain("counts");

    // Non-vacuity: a properly constructed count passes the same field.
    expect(isMeasuredCount(keptSessionCount(FIXTURE_NOW))).toBe(true);
    expect(candidateFindingSchema.safeParse(candidateFixture(FIXTURE_NOW)).success).toBe(true);
  });
});

describe("candidateFindingSchema — what the contract carries", () => {
  test("should carry class, trace, counts, timeframe, surface, evidence_shape + version, and rule-set version", () => {
    const parsed = candidateFindingSchema.parse(candidateFixture(FIXTURE_NOW));

    // The schema is refined, so `.shape` is unavailable. Presence is asserted over a
    // parsed representative candidate instead, and because Zod strips unknown keys,
    // this key set IS the contract's field set.
    expect(Object.keys(parsed).toSorted()).toEqual(REQUIRED_FIELDS.toSorted());

    expect(parsed.detector).toBe("funnel_dropoff");
    expect(parsed.claimedClass).toBe("broken");
    expect(parsed.finalClass).toBe("confusing");
    // The trace records every rung evaluated, not just the losing one.
    expect(parsed.trace).toHaveLength(2);
    expect(parsed.counts).toHaveLength(1);
    expect(parsed.timeframe.end).toEqual(FIXTURE_NOW);
    expect(parsed.surface).toBe("/checkout/payment");
    expect(parsed.surfaceNormalisationVersion).toBe(1);
    // The canonical string, never a hash. Hashes it, and a hash here would leave it
    // nothing to check its own maths against.
    expect(parsed.evidenceShape).toContain("funnel_dropoff");
    expect(parsed.evidenceShapeVersion).toBe(EVIDENCE_SHAPE_VERSION);
    // Which rule set produced every threshold judgement above, without it, a v2
    // threshold change silently re-reads every candidate on record.
    expect(parsed.thresholdRuleSetVersion).toBe(THRESHOLD_RULE_SET_VERSION);

    // Carried means required, not "present in this fixture". Dropping any one field is
    // a rejection, so cannot construct a partial candidate.
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

// /, the claim subject: what the schema refuses today, and what it cannot yet refuse.
//
// The defect the test below closes. `claimSubject` is declared on `DetectorCandidate`
// (`detect/types.ts`) and set by both T1 detectors, `detect/funnel-dropoff.ts` and
// `detect/error-event.ts` each write `claimSubject: "surface"`, while
// `candidateFindingSchema` had no such field. Produced by two writers, read by nobody:
// a value computed and dropped on the floor, which is the edge-case taxonomy's exactly.
// The type-level half looked complete, and would have hashed an identity whose subject
// was an assumption.
//
// What is protected, and by what. Both ends now declare the field:
// `DetectorCandidate.claimSubject` is required and typed `ClaimSubject`, and
// `candidateFindingSchema` requires `claimSubjectSchema`. The protection is the
// schema's refusal of a candidate that omits it. The single test below, and the whole
// of the enforcement that exists today. That refusal is what converts the silent no-op
// into a loud `.parse` failure: a composer that forgets the field cannot produce a
// `CandidateFinding` at all. A field only the producer writes and nothing refuses would
// not be wired.
//
// What is not protected, stated plainly. There is no composition path from
// `DetectorCandidate` to `CandidateFinding` anywhere in `packages/core/src`: no
// function takes one and returns the other, and nothing in `src/` parses with
// `candidateFindingSchema` at all, `evidence/gate.ts` does not compose one, and
// `index.ts` only re-exports the schema. No test in this file carries a value across
// that boundary, because the boundary has no code yet. Carrying it across is therefore
// an inherited obligation on whoever writes that composer: its own suite must assert
// that the `claimSubject` on the input `DetectorCandidate` is the `claimSubject` on the
// output `CandidateFinding`. A composer that enumerates output fields by hand and omits
// this one is precisely the regression this file cannot catch. The schema's refusal is
// what will make that omission throw instead of pass.
//
// A deleted test, recorded so it is not re-added in the same shape. A test here
// previously claimed to cross that boundary "in one test". It did not: it copied eight
// fields off a typed `DetectorCandidate` literal onto the loose fixture and parsed the
// fixture, and it wrote `claimSubject: "surface"` on the producer side itself, so
// `expect(parsed.claimSubject).toBe(produced.claimSubject)` compared a literal to the
// same literal. With `claimSubjectSchema` a `z.literal("surface")`, that assertion
// cannot fail under any wiring, correct or severed, and its "non-vacuity" leg
// re-asserted the omission rejection already made below. The producer end is asserted
// where it can be asserted for real. Over actual detector output, in
// `__tests__/detect/funnel-dropoff.test.ts`.

describe("candidateFindingSchema — the claim subject discriminator", () => {
  test("should reject a candidate finding that omits claimSubject, or claims a subject that is not a surface", () => {
    //  the load-bearing refusal. Adding the field without this assertion
    //  would leave the same dead wire behind a nicer type: a field only the
    //  producer writes and nothing refuses is not wired.
    const omitted = candidateFixture(FIXTURE_NOW);
    delete omitted.claimSubject;
    expect(rejectionPaths(omitted)).toContain("claimSubject");

    // ...and it is not quietly defaulted to the only value it can hold. A
    // `.default("surface")` would satisfy every presence check in this file while
    // asserting nothing about what the detector actually claimed.
    expect(rejectionPaths(candidateFixture(FIXTURE_NOW, { claimSubject: undefined }))).toContain(
      "claimSubject",
    );

    // , the runtime half. Inside TypeScript a wrong subject is a compile
    //  error — `DetectorCandidate.claimSubject` is typed `ClaimSubject` and
    //  the schema is a `z.literal`, so `claimSubject: "segment"` on a typed
    //  producer fails `bun run typecheck` before any test runs. This covers
    //  the same line for a value arriving from outside the type system (a
    //  persisted row, a JSON payload), where a wrong string would otherwise
    //  be a silent overload of the surface field.
    for (const wrongSubject of ["segment", "feature_flag", "Surface", "surfaces", ""]) {
      expect(
        rejectionPaths(candidateFixture(FIXTURE_NOW, { claimSubject: wrongSubject })),
      ).toContain("claimSubject");
      // The refusal comes from `claimSubjectSchema` itself. The single source of truth.
      // Nothing here reads "surface" out of a comment.
      expect(claimSubjectSchema.safeParse(wrongSubject).success).toBe(false);
    }

    // Non-vacuity: the same fixture with a real subject parses, so every rejection
    // above is attributable to `claimSubject` and not to the fixture.
    expect(candidateFindingSchema.safeParse(candidateFixture(FIXTURE_NOW)).success).toBe(true);
  });
});

describe("candidateFindingSchema — ranking inputs, no ranking", () => {
  test("should carry the ranking inputs will need (sample size, confidence basis) without implementing ranking", () => {
    const parsed = candidateFindingSchema.parse(candidateFixture(FIXTURE_NOW));

    // The inputs, and only the inputs.
    expect(Object.keys(parsed.ranking).toSorted()).toEqual(["confidenceBasis", "sampleSize"]);

    // The sample size is a real `MeasuredCount`, so reads a denominator off a typed
    // value rather than re-deriving one from a rendered string.
    expect(isMeasuredCount(parsed.ranking.sampleSize)).toBe(true);
    expect(parsed.ranking.sampleSize.denominator).toBe(28);
    expect(parsed.ranking.sampleSize.unit).toBe("sessions");

    expect(parsed.ranking.confidenceBasis).toBe("threshold_met");
    // `at_threshold` is its own member, not folded into `threshold_met`: makes every
    // boundary inclusive, and may want to rank the exact boundary case lower than a
    // comfortable pass. Folding it now would destroy that information before its
    // consumer exists.
    expect(confidenceBasisSchema.options.toSorted()).toEqual([
      "at_threshold",
      "below_threshold",
      "threshold_met",
    ]);

    // A stated basis the gate can actually justify is required. An unknown one is
    // rejected, never defaulted to the most flattering value.
    expect(
      rejectionPaths(
        candidateFixture(FIXTURE_NOW, {
          ranking: { sampleSize: keptSessionCount(FIXTURE_NOW), confidenceBasis: "probably_fine" },
        }),
      ),
    ).toContain("ranking.confidenceBasis");

    // And no ranking is implemented. Ranking by expected value is the; a score computed
    // here would be a number this sprint has no evidence to justify, and would inherit
    // it as a fact.
    const rankingLike = /rank|score|prioriti|expected|weight/i;
    const rankingFunctions = Object.entries(candidateModule)
      .filter(([name, value]) => typeof value === "function" && rankingLike.test(name))
      .map(([name]) => name);
    expect(rankingFunctions).toEqual([]);
  });
});

// The fifth add test. No bare `number` count anywhere on the contract. Wave 7's
// addition; the four tests above are untouched.
//
// Why this is a source scan and not a behaviour. `MeasuredCount` exists so a count and
// its denominator cannot be separated: "12 sessions dropped off" is noise a founder
// cannot act on; "12 of 28 kept sessions" is a fact. A behavioural test can only cover
// the fields somebody remembered to write a case for. The mistake this guards is a
// later one. An // author adding `affectedSessions: number` to `DetectorCandidate` or
// `GateOutcome` because it is convenient for a Slack block, and no other test in this
// package would notice. Only a total scan over the declared types can hold that line,
// which is why it is written at source level.
//
// Scope: the modules whose exported types are the detector and gate return surfaces.
// `rules/types.ts` is deliberately not among them, `ThresholdRuleSet` members like
// `funnelMinSessionsAtOrigin: number` are thresholds, magnitudes the detector compares
// against, not measurements it reports. Folding them in would force a false positive
// and the guard would be loosened to accommodate it, which is how a real invariant
// dies.
//
// Read through `Bun.file`, never `node:fs`, `packages/core` imports no node builtin in
// `src/` or in `__tests__/`.

/** The exported-type modules that make up the detector and gate return surfaces.
 * `counts/measured-count.ts` is scanned rather than skipped so the exclusion of
 * `MeasuredCount`'s own definition is explicit and testable (below), instead of
 * achieved by quietly not looking. */
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

/** The field names That decision is about: anything that reads as a measurement. */
const COUNT_LIKE = /count|total|numerator|sessions|hits/i;

/** A bare number, the thing that must never carry a count. `number | null` counts as
 * bare: a nullable count is still a count with no denominator. */
const BARE_NUMBER = /^(?:readonly\s+)?number(?:\s*\|\s*(?:null|undefined))*$/;

/**
 * `MeasuredCount`'s own definition. These four declarations are where a bare
 * `numerator: number` / `kept: number` legitimately lives. They are the inside of the
 * branded value, reachable only through `measuredCount`, which asserts the
 * denominator identity before stamping the brand.
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

/** The text from `start` to the `;` that closes the declaration, ignoring any `;`
 * nested inside braces, brackets or parens, which is what makes an inline union arm (`|
 * { readonly kind: "pass"; … }`) part of one declaration. */
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
 * Collects the object-type members of every `export type` declaration in a module, at
 * any nesting depth (union arms included), with the declaration they belong to.
 *
 * Declaration-scoped rather than a text grep for `: number`, so the owner is known,
 * without it, `MeasuredCount`'s own internals could not be excluded without also
 * excluding every field called `numerator` everywhere, which is exactly the field this
 * guard exists to catch on other types.
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

/** `module:: Owner.member: annotation`, an offender line naming the exact declaration
 * to fix. */
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
 * The runtime half, and the reason it is needed: `CandidateFinding` is inferred from a
 * Zod schema, so it has no `export type … = { … }` declaration for the scan above to
 * read. Walks a parsed candidate and reports every count-like key holding a raw number
 * that is not inside a branded `MeasuredCount`.
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

describe("no bare number count on the contract", () => {
  test("should expose no bare number count field on any exported detector or gate return type", async () => {
    const members: DeclaredMember[] = [];
    for (const modulePath of SCANNED_MODULES) {
      const source = await Bun.file(`${import.meta.dir}/../../src/${modulePath}`).text();
      members.push(...collectDeclaredMembers(modulePath, source));
    }

    // Non-vacuity, before the invariant
    //
    //  The collector found real declarations in every scanned module. A
    //  silent parse failure would make the assertion below vacuously true.
    for (const modulePath of SCANNED_MODULES) {
      expect({
        module: modulePath,
        members: members.filter((entry) => entry.module === modulePath).length > 0,
      }).toEqual({ module: modulePath, members: true });
    }

    //  It found the specific members whose shape this test is about —
    //  including the two legitimate count-like fields that must pass
    //  (`counts` is an array of branded values; `sessions` is an array of
    //  timelines) and one bare `number` that must pass because its name is
    //  not a count (`predicateVersion`).
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

    //  the exclusions are load-bearing, not decoration. With them switched
    //  off, `MeasuredCount`'s own internals are flagged — which proves the
    //  matcher fires on exactly the shape it claims to and that the two
    //  exclusions are carrying real weight rather than hiding an empty
    //  scan.
    const withoutExclusions = bareNumberCounts(members, { applyExclusions: false });
    expect(withoutExclusions).toContain(
      "counts/measured-count.ts :: MeasuredCount.numerator: number",
    );
    expect(withoutExclusions).toContain(
      "counts/measured-count.ts :: CountBasis.totalInWindow: number",
    );
    expect(withoutExclusions).toContain("counts/measured-count.ts :: SetAsideBasis.count: number");

    //  And a synthetic offender of the exact shape a later outcome would
    //  add is caught, exclusions and all.
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

    // The invariant
    expect(bareNumberCounts(members, { applyExclusions: true })).toEqual([]);

    // The runtime half
    //
    // `CandidateFinding` is inferred from a refined Zod schema, so it has no
    // type-literal declaration for the scan above to read. Without this leg the test's
    // headline would silently exclude the very contract it lives beside.
    const parsed = candidateFindingSchema.parse(candidateFixture(FIXTURE_NOW));
    const walked = { offenders: [] as string[], insideCountKeys: [] as string[] };
    bareNumberCountsAtRuntime(parsed, "", false, walked);

    // Non-vacuity: the walker really did reach the numbers, and every one it found was
    // inside a branded count.
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
