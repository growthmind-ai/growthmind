// The parity suite for the sac runtime guard.
//
// Why this file exists. `guards.test.ts` pins four mechanical scanners, each proven
// non-vacuous by a planted offender, but those scanners live in a test file, and a test
// file is not an import surface. therefore re-expresses them in production inside
// `src/summary/output-schema.ts`, and accepts the resulting duplication on one
// condition: that a scanner which stops biting fails a named test here (add risk R-4).
// So the planted offenders below are taken verbatim from `guards.test.ts` (not
// paraphrased) and replayed against the production `guardModelText`. If someone edits a
// scanner in one home and not the other, this suite goes red rather than the model lane
// going quiet.
//
// House rules honoured here:
// Every helper is declared at module scope, never inside a `test`
//  callback (`unicorn/consistent-function-scoping`).
// No node builtin: `packages/core` is pure, and this suite must not be the
//  impurity the purity test polices.
// Lane prefix `t2os`, shared with no other suite.
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

/** The surface the planted offenders name. `guards.test.ts:459` plants "…reached
 * /pricing…", so the candidate must legitimately be about /pricing. Otherwise a replay
 * would be rejected by SAC-4 (a foreign path) and the scanner under test would never be
 * reached. */
const FIXTURE_SURFACE = "/pricing";

/** A headline that is clean under every sac row, so a rejection below is attributable
 * to the planted context and to nothing else. */
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

/**
 * The planted offenders, copied verbatim from `guards.test.ts`.
 *
 * `source` names the line the string was taken from, so a drift review can diff the two
 * files by eye. `counts` is the candidate context each offender needs to be an offence
 * at all. The denominatorless plant is only an offence relative to a 20-of-30 count,
 * exactly as `guards.test.ts:465-472` states it.
 */
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

/**
 * Prose a per-sentence judgement cannot be run over honestly.
 *
 * Not every member need be unsegmentable (production owns that rule) but the suite
 * asserts at least one IS, so "returns null" can never quietly become "never returns
 * null" and take the whole fail direction with it.
 */
const UNSEGMENTABLE_CANDIDATES: readonly string[] = [
  // No terminator anywhere: one unbounded run-on, so no element boundary exists to
  // judge SAC-3 and SAC-11 per sentence.
  "people kept coming back to /pricing and then the save did not work and nothing else happened",
  // A terminator that does not end a sentence. Segmenting on "." here bleeds a clause
  // across two elements, which is precisely what forbids.
  "Sessions dropped off at /pricing e.g. after the save step, and did not return.",
  // Nothing to segment at all.
  "   ",
];

/** Keys the contract never declares. A number, a class name, a confidence.
 * `shared/src/summary/types.ts:188-191` says "rests on this comment alone"; `.strict`
 * is what turns that comment into structure. */
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
    // Non-vacuity first: a replay list that silently emptied would prove nothing.
    expect(PLANTED_OFFENDERS.length).toBeGreaterThan(0);

    // The control: clean text on the same candidate passes. Without it, a guard that
    // rejected everything would score full marks below.
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

      // Reported as {source, ok} rather than a bare boolean: a parity failure must name
      // which shipped plant stopped biting.
      expect({ source: planted.source, ok: verdict.ok }).toEqual({
        source: planted.source,
        ok: false,
      });

      if (verdict.ok) continue;
      expect(verdict.offences.map((offence) => offence.sac)).toContain(planted.sac);
      // An offence names the rule and the element index, never the offending text,
      // which carries a customer's page path and counts.
      for (const offence of verdict.offences) {
        expect(Object.keys(offence).toSorted()).toEqual(["element", "sac"]);
        expect(typeof offence.element).toBe("number");
      }
    }
  });

  test("prose that cannot be segmented into single sentences is withheld rather than judged", () => {
    const refused = UNSEGMENTABLE_CANDIDATES.filter((text) => splitSentences(text) === null);
    // The fail direction only exists if something can actually trigger it.
    expect(refused.length).toBeGreaterThan(0);

    for (const text of refused) {
      const verdict = guardModelText({
        candidate: candidateWithCount(42, 100),
        headline: CLEAN_HEADLINE,
        context: text,
      });
      // Withhold, never publish-unchecked: unsegmentable prose is itself a rejection,
      // so it falls to the floor as `floor_model_text_rejected` rather than reaching a
      // customer unjudged.
      expect({ text, ok: verdict.ok }).toEqual({ text, ok: false });
    }

    // The segmentation that does succeed is single-sentence per element and round-trips
    // through the join. Otherwise per-sentence rules (SAC-3, SAC-11) would be judged
    // over clauses that bled across elements.
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
    // The control: the two declared fields parse.
    expect(modelSummaryOutputSchema.safeParse(declared).success).toBe(true);

    expect(UNDECLARED_KEYS.length).toBeGreaterThan(0);
    for (const key of UNDECLARED_KEYS) {
      const withExtra = { ...declared, [key]: key === "sessions" ? 42 : "broken" };
      // `.strict` is load-bearing: an extra key is a refusal, not a silent drop. A
      // silent drop would let a model emit a number or a class name and leave no trace
      // that it tried.
      expect({ key, success: modelSummaryOutputSchema.safeParse(withExtra).success }).toEqual({
        key,
        success: false,
      });
    }

    // The declared fields are both required and non-empty: an empty headline is a shape
    // failure (`floor_model_output_invalid`), not text for the guard.
    expect(modelSummaryOutputSchema.safeParse({ headline: "", context: "x" }).success).toBe(false);
    expect(modelSummaryOutputSchema.safeParse({ headline: "x" }).success).toBe(false);
  });
});
