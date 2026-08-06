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

const FIXTURE_NOW = new Date("2026-05-01T12:00:00.000Z");

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function windowEndingAt(now: Date): AnalysisWindow {
  return { start: new Date(now.getTime() - SEVEN_DAYS_MS), end: now };
}

function keptSessionCount(now: Date): MeasuredCount {
  return measuredCount({
    numerator: 12,
    denominator: 28,
    unit: "sessions",
    timeframe: windowEndingAt(now),
    basis: {
      totalInWindow: 40,
      kept: 28,
      keptUnchecked: 0,
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

type CandidateFixture = Record<string, unknown>;

function candidateFixture(now: Date, overrides: CandidateFixture = {}): CandidateFixture {
  return {
    detector: "funnel_dropoff",
    claimedClass: "broken",
    finalClass: "confusing",
    trace: brokenDowngradedToConfusingTrace(),
    counts: [keptSessionCount(now)],
    timeframe: windowEndingAt(now),

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

// Present on every parsed candidate, but absent from the loop below: a defaulted field
// cannot reject when deleted, which is the whole difference between the two lists.
const DEFAULTED_FIELDS = ["signals"] as const;

function rejectionPaths(input: unknown): readonly string[] {
  const result = candidateFindingSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("candidateFindingSchema — reachability", () => {
  test("should reject a candidate whose final class is unreachable from its claimed class", () => {
    expect(isReachableClass("broken", "broken")).toBe(true);
    expect(isReachableClass("broken", "confusing")).toBe(true);
    expect(isReachableClass("confusing", "broken")).toBe(false);
    expect(isReachableClass("broken", "changed_mind")).toBe(false);
    expect(isReachableClass("instrumentation", "confusing")).toBe(false);

    expect(candidateFindingSchema.safeParse(candidateFixture(FIXTURE_NOW)).success).toBe(true);

    expect(
      rejectionPaths(
        candidateFixture(FIXTURE_NOW, { claimedClass: "confusing", finalClass: "broken" }),
      ),
    ).toContain("finalClass");

    expect(
      rejectionPaths(
        candidateFixture(FIXTURE_NOW, { claimedClass: "broken", finalClass: "changed_mind" }),
      ),
    ).toContain("finalClass");
  });
});

describe("candidateFindingSchema — counts carry denominators", () => {
  test("should reject a candidate carrying a count without a denominator", () => {
    const noDenominator = {
      numerator: 12,
      unit: "sessions",
      timeframe: windowEndingAt(FIXTURE_NOW),
    };

    const unbranded = {
      numerator: 12,
      denominator: 28,
      unit: "sessions",
      timeframe: windowEndingAt(FIXTURE_NOW),
      basis: { totalInWindow: 40, kept: 28, setAside: [], keptUnchecked: 0 },
    };

    for (const count of [noDenominator, unbranded]) {
      expect(rejectionPaths(candidateFixture(FIXTURE_NOW, { counts: [count] }))).toContain(
        "counts.0",
      );
    }

    expect(rejectionPaths(candidateFixture(FIXTURE_NOW, { counts: [] }))).toContain("counts");

    expect(isMeasuredCount(keptSessionCount(FIXTURE_NOW))).toBe(true);
    expect(candidateFindingSchema.safeParse(candidateFixture(FIXTURE_NOW)).success).toBe(true);
  });
});

describe("candidateFindingSchema — what the contract carries", () => {
  test("should carry class, trace, counts, timeframe, surface, evidence_shape + version, and rule-set version", () => {
    const parsed = candidateFindingSchema.parse(candidateFixture(FIXTURE_NOW));

    expect(Object.keys(parsed).toSorted()).toEqual(
      [...REQUIRED_FIELDS, ...DEFAULTED_FIELDS].toSorted(),
    );

    expect(parsed.detector).toBe("funnel_dropoff");
    expect(parsed.claimedClass).toBe("broken");
    expect(parsed.finalClass).toBe("confusing");

    expect(parsed.trace).toHaveLength(2);
    expect(parsed.counts).toHaveLength(1);
    expect(parsed.timeframe.end).toEqual(FIXTURE_NOW);
    expect(parsed.surface).toBe("/checkout/payment");
    expect(parsed.surfaceNormalisationVersion).toBe(1);

    expect(parsed.evidenceShape).toContain("funnel_dropoff");
    expect(parsed.evidenceShapeVersion).toBe(EVIDENCE_SHAPE_VERSION);

    expect(parsed.thresholdRuleSetVersion).toBe(THRESHOLD_RULE_SET_VERSION);

    for (const field of REQUIRED_FIELDS) {
      const missingOne = candidateFixture(FIXTURE_NOW);
      delete missingOne[field];
      expect({ field, rejected: rejectionPaths(missingOne).length > 0 }).toEqual({
        field,
        rejected: true,
      });
    }

    for (const field of DEFAULTED_FIELDS) {
      const missingOne = candidateFixture(FIXTURE_NOW);
      delete missingOne[field];
      const result = candidateFindingSchema.safeParse(missingOne);
      expect({ field, accepted: result.success }).toEqual({ field, accepted: true });
      expect(result.success && result.data.signals).toEqual([]);
    }
  });
});

describe("candidateFindingSchema — the claim subject discriminator", () => {
  test("should reject a candidate finding that omits claimSubject, or claims a subject that is not a surface", () => {
    const omitted = candidateFixture(FIXTURE_NOW);
    delete omitted.claimSubject;
    expect(rejectionPaths(omitted)).toContain("claimSubject");

    expect(rejectionPaths(candidateFixture(FIXTURE_NOW, { claimSubject: undefined }))).toContain(
      "claimSubject",
    );

    for (const wrongSubject of ["segment", "feature_flag", "Surface", "surfaces", ""]) {
      expect(
        rejectionPaths(candidateFixture(FIXTURE_NOW, { claimSubject: wrongSubject })),
      ).toContain("claimSubject");

      expect(claimSubjectSchema.safeParse(wrongSubject).success).toBe(false);
    }

    expect(candidateFindingSchema.safeParse(candidateFixture(FIXTURE_NOW)).success).toBe(true);
  });
});

describe("candidateFindingSchema — ranking inputs, no ranking", () => {
  test("should carry the ranking inputs will need (sample size, confidence basis) without implementing ranking", () => {
    const parsed = candidateFindingSchema.parse(candidateFixture(FIXTURE_NOW));

    expect(Object.keys(parsed.ranking).toSorted()).toEqual(["confidenceBasis", "sampleSize"]);

    expect(isMeasuredCount(parsed.ranking.sampleSize)).toBe(true);
    expect(parsed.ranking.sampleSize.denominator).toBe(28);
    expect(parsed.ranking.sampleSize.unit).toBe("sessions");

    expect(parsed.ranking.confidenceBasis).toBe("threshold_met");

    expect(confidenceBasisSchema.options.toSorted()).toEqual([
      "at_threshold",
      "below_threshold",
      "threshold_met",
    ]);

    expect(
      rejectionPaths(
        candidateFixture(FIXTURE_NOW, {
          ranking: { sampleSize: keptSessionCount(FIXTURE_NOW), confidenceBasis: "probably_fine" },
        }),
      ),
    ).toContain("ranking.confidenceBasis");

    const rankingLike = /rank|score|prioriti|expected|weight/i;
    const rankingFunctions = Object.entries(candidateModule)
      .filter(([name, value]) => typeof value === "function" && rankingLike.test(name))
      .map(([name]) => name);
    expect(rankingFunctions).toEqual([]);
  });
});

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

const COUNT_LIKE = /count|total|numerator|sessions|hits/i;

const BARE_NUMBER = /^(?:readonly\s+)?number(?:\s*\|\s*(?:null|undefined))*$/;

const MEASURED_COUNT_OWN_DEFINITION: ReadonlySet<string> = new Set([
  "MeasuredCount",
  "MeasuredCountInput",
  "CountBasis",
  "SetAsideBasis",
]);

const EXCLUDED_MEMBER_NAMES: ReadonlySet<string> = new Set(["basis"]);

// Every bare `number` on a scanned exported type is an offender unless it is named here with
// why. Classifying by name instead — /count|total|numerator|sessions|hits/ — let `attempts`
// through, of which signals.ts says "it is the number a founder reads", and let
// `eventsWithoutUrlPath` through as well: the same denylist conflation this sprint exists to
// prevent, applied to the sprint's own guard (B-019). A new bare number now fails by default.
const BARE_NUMBER_EXEMPTIONS: ReadonlyMap<string, string> = new Map([
  ["detect/types.ts :: TimelineEvent.urlPathNormalisationVersion", "a version stamp"],
  ["detect/types.ts :: DetectorCandidate.surfaceNormalisationVersion", "a version stamp"],
  ["evidence/gate.ts :: ProposedClaim.surfaceNormalisationVersion", "a version stamp"],
  [
    "findings/evidence-shape.ts :: EvidenceShapeInput.surfaceNormalisationVersion",
    "a version stamp",
  ],
  ["evidence/trace.ts :: TraceEntry.predicateVersion", "a version stamp"],
  ["evidence/predicates.ts :: ProofPredicate.version", "a version stamp"],
  [
    "evidence/signals.ts :: EvidenceSignal.correlationWindowMs",
    "a duration, not a quantity of anything",
  ],
  ["counts/measured-count.ts :: Rate.value", "a ratio derived by rateOf from a MeasuredCount"],

  // Not "allowed" — known, and visible here rather than hidden behind a word list. Both reach
  // a customer-facing sentence as a number with no denominator, which is what the commitment
  // "every number says out of how many" forbids. Closing either means giving it a basis, which
  // is a change to what the detectors produce rather than to this guard.
  [
    "detect/types.ts :: DetectorCoverage.eventsWithoutUrlPath",
    "KNOWN GAP (B-019): a bare count of events, no denominator",
  ],
  [
    "evidence/signals.ts :: EvidenceSignal.attempts",
    "KNOWN GAP (B-019): a bare count of attempts, no denominator",
  ],
]);

type DeclaredMember = {
  readonly module: string;

  readonly owner: string;
  readonly member: string;
  readonly annotation: string;
};

function stripTypeComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

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

function memberKey(entry: DeclaredMember): string {
  return `${entry.module} :: ${entry.owner}.${entry.member}`;
}

function bareNumberCounts(
  members: readonly DeclaredMember[],
  options: { readonly applyExclusions: boolean },
): readonly string[] {
  return members
    .filter((entry) => BARE_NUMBER.test(entry.annotation))
    .filter(
      (entry) =>
        !options.applyExclusions ||
        (!MEASURED_COUNT_OWN_DEFINITION.has(entry.owner) &&
          !EXCLUDED_MEMBER_NAMES.has(entry.member) &&
          !BARE_NUMBER_EXEMPTIONS.has(memberKey(entry))),
    )
    .map((entry) => `${entry.module} :: ${entry.owner}.${entry.member}: ${entry.annotation}`);
}

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

    for (const modulePath of SCANNED_MODULES) {
      expect({
        module: modulePath,
        members: members.filter((entry) => entry.module === modulePath).length > 0,
      }).toEqual({ module: modulePath, members: true });
    }

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

    const withoutExclusions = bareNumberCounts(members, { applyExclusions: false });
    expect(withoutExclusions).toContain(
      "counts/measured-count.ts :: MeasuredCount.numerator: number",
    );
    expect(withoutExclusions).toContain(
      "counts/measured-count.ts :: CountBasis.totalInWindow: number",
    );
    expect(withoutExclusions).toContain("counts/measured-count.ts :: SetAsideBasis.count: number");

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

    // The control the old name-based guard could not fail: a count whose name matches none of
    // count/total/numerator/sessions/hits. Under the allowlist it is an offender on sight.
    const unnamedControl = collectDeclaredMembers(
      "control.ts",
      ["export type Unnamed = {", "  readonly attempts: number;", "};"].join("\n"),
    );
    expect(unnamedControl.filter((entry) => COUNT_LIKE.test(entry.member))).toEqual([]);
    expect(bareNumberCounts(unnamedControl, { applyExclusions: true })).toEqual([
      "control.ts :: Unnamed.attempts: number",
    ]);

    // An exemption that no longer names anything is a rule nobody is following any more.
    const scannedKeys = new Set(members.map(memberKey));
    expect([...BARE_NUMBER_EXEMPTIONS.keys()].filter((key) => !scannedKeys.has(key))).toEqual([]);

    expect(bareNumberCounts(members, { applyExclusions: true })).toEqual([]);

    const parsed = candidateFindingSchema.parse(candidateFixture(FIXTURE_NOW));
    const walked = { offenders: [] as string[], insideCountKeys: [] as string[] };
    bareNumberCountsAtRuntime(parsed, "", false, walked);

    expect(walked.insideCountKeys).toContain("counts[0].numerator");
    expect(walked.insideCountKeys).toContain("counts[0].basis.totalInWindow");
    expect(walked.insideCountKeys).toContain("ranking.sampleSize.numerator");
    expect(walked.offenders).toEqual([]);

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
