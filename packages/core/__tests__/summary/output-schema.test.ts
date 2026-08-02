import { describe, expect, test } from "bun:test";

import { measuredCount } from "../../src/counts/measured-count";
import type { CandidateFinding } from "../../src/findings/candidate";
import { candidateFindingSchema } from "../../src/findings/candidate";
import { EVIDENCE_SHAPE_VERSION } from "../../src/findings/evidence-shape";
import { traceEntry } from "../../src/evidence/trace";
import {
  guardModelText,
  joinSentences,
  modelSummaryOutputSchema,
  splitSentences,
} from "../../src/summary/output-schema";

const FIXTURE_WINDOW = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
};

const FIXTURE_SURFACE = "/pricing";

const CLEAN_HEADLINE = "Sessions on /pricing did not continue";

function candidateWithCount(numerator: number, denominator: number): CandidateFinding {
  const count = measuredCount({
    numerator,
    denominator,
    unit: "sessions",
    timeframe: FIXTURE_WINDOW,
    basis: { totalInWindow: denominator, kept: denominator, setAside: [] },
  });

  return candidateFindingSchema.parse({
    detector: "funnel_dropoff",
    claimedClass: "broken",
    finalClass: "broken",
    trace: [
      traceEntry({
        class: "broken",
        predicate: "t2os-fixture-predicate",
        predicateVersion: 1,
        satisfied: true,
      }),
    ],
    counts: [count],
    timeframe: FIXTURE_WINDOW,
    claimSubject: "surface",
    surface: FIXTURE_SURFACE,
    surfaceNormalisationVersion: 1,
    evidenceShape: "t2os-evidence-shape",
    evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
    thresholdRuleSetVersion: 1,
    ranking: { sampleSize: count, confidenceBasis: "threshold_met" },
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  });
}

const PLANTED_OFFENDERS: readonly {
  readonly source: string;
  readonly sac: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly context: string;
}[] = [
  {
    source: "guards.test.ts:459 — the bare-digit plant",
    sac: "SAC-2",
    numerator: 42,
    denominator: 100,
    context: "42 of 100 sessions reached /pricing, a 58% improvement.",
  },
  {
    source: "guards.test.ts:466 — the denominatorless-count plant",
    sac: "SAC-3",
    numerator: 20,
    denominator: 30,
    context: "20 sessions dropped off.",
  },
  {
    source: "guards.test.ts:516 — the cohort-conflation plant",
    sac: "SAC-11",
    numerator: 20,
    denominator: 30,
    context: "People kept coming back to /pricing and then left without going anywhere.",
  },
  {
    source: "guards.test.ts:579 — the machine-identifier plant",
    sac: "SAC-8",
    numerator: 20,
    denominator: 30,
    context: "This finding was classified as changed_mind at threshold_met in v2.",
  },
  {
    source: "guards.test.ts:600 — the causal-connective plant",
    sac: "SAC-7",
    numerator: 20,
    denominator: 30,
    context: "People left the page because the save did not work.",
  },
];

const UNSEGMENTABLE_CANDIDATES: readonly string[] = [
  "people kept coming back to /pricing and then the save did not work and nothing else happened",

  "Sessions dropped off at /pricing e.g. after the save step, and did not return.",

  "   ",
];

const UNDECLARED_KEYS: readonly string[] = [
  "sessions",
  "dropoffRate",
  "finalClass",
  "confidence",
  "confidenceBasis",
  "surface",
  "timeframe",
];

describe("model summary output schema and SAC guard", () => {
  test("the SAC guard rejects every planted offender the shipped scanner suite reports", () => {
    expect(PLANTED_OFFENDERS.length).toBeGreaterThan(0);

    const control = guardModelText({
      candidate: candidateWithCount(42, 100),
      headline: CLEAN_HEADLINE,
      context: "42 of 100 sessions did not continue past /pricing.",
    });
    expect(control.ok).toBe(true);

    for (const planted of PLANTED_OFFENDERS) {
      const verdict = guardModelText({
        candidate: candidateWithCount(planted.numerator, planted.denominator),
        headline: CLEAN_HEADLINE,
        context: planted.context,
      });

      expect({ source: planted.source, ok: verdict.ok }).toEqual({
        source: planted.source,
        ok: false,
      });

      if (verdict.ok) continue;
      expect(verdict.offences.map((offence) => offence.sac)).toContain(planted.sac);

      for (const offence of verdict.offences) {
        expect(Object.keys(offence).toSorted()).toEqual(["element", "sac"]);
        expect(typeof offence.element).toBe("number");
      }
    }
  });

  test("prose that cannot be segmented into single sentences is withheld rather than judged", () => {
    const refused = UNSEGMENTABLE_CANDIDATES.filter((text) => splitSentences(text) === null);

    expect(refused.length).toBeGreaterThan(0);

    for (const text of refused) {
      const verdict = guardModelText({
        candidate: candidateWithCount(42, 100),
        headline: CLEAN_HEADLINE,
        context: text,
      });

      expect({ text, ok: verdict.ok }).toEqual({ text, ok: false });
    }

    const segmented = splitSentences("Sessions stopped at /pricing. None continued.");
    expect(segmented).not.toBeNull();
    expect(segmented).toHaveLength(2);
    for (const element of segmented ?? []) {
      expect(element.trim()).not.toHaveLength(0);
      expect(element.trimEnd().slice(0, -1)).not.toMatch(/[.!?]\s/);
    }
    expect(joinSentences(segmented ?? [])).toContain("Sessions stopped at /pricing.");
  });

  test("the model output schema refuses a field the contract never declared", () => {
    const declared = { headline: "Sessions stopped at /pricing", context: "None continued." };

    expect(modelSummaryOutputSchema.safeParse(declared).success).toBe(true);

    expect(UNDECLARED_KEYS.length).toBeGreaterThan(0);
    for (const key of UNDECLARED_KEYS) {
      const withExtra = { ...declared, [key]: key === "sessions" ? 42 : "broken" };

      expect({ key, success: modelSummaryOutputSchema.safeParse(withExtra).success }).toEqual({
        key,
        success: false,
      });
    }

    expect(modelSummaryOutputSchema.safeParse({ headline: "", context: "x" }).success).toBe(false);
    expect(modelSummaryOutputSchema.safeParse({ headline: "x" }).success).toBe(false);
  });
});
