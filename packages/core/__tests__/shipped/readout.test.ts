import {
  SHIPPED_NO_IDENTITY_LINE,
  SHIPPED_RECORDED_CORPUS_LINE,
  SHIPPED_SPINE_CORPUS_LINE,
  SHIPPED_TRUNCATED_LINE,
  SHIPPED_VERDICT_KEEP_ACTION_ID,
  SHIPPED_VERDICT_KILL_ACTION_ID,
  SHIPPED_VERDICT_LEAVE_ACTION_ID,
  SHIPPED_VERDICT_QUESTION,
} from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { AtPageCorpus } from "../../src/shipped/corpus";
import { buildAtPageCorpus } from "../../src/shipped/corpus";
import { shippedCounts } from "../../src/shipped/counts";
import type { ShippedReadout, ShippedReadoutResult } from "../../src/shipped/readout";
import { renderShippedReadout } from "../../src/shipped/readout";
import { atPageInput, mustBuild, shippedCorpus } from "./fixtures";

// The renderer is handed the page it must speak, so these carry no digits: a page string with a
// number in it would be indistinguishable from a count when the body is scanned for bare numbers.
const CHANGE = "CSV export";
const PAGE = "/reports";

// A real minted id, so the assertion that no id reaches the body has something to find.
const CHANGE_ID = "0f3a9c21-6b4d-4a17-9e52-1c8b7d4e6a90";

function readoutOf(result: ShippedReadoutResult): ShippedReadout {
  return renderShippedReadout({
    changeId: CHANGE_ID,
    change: CHANGE,
    page: PAGE,
    leadCount: "reach",
    result,
  });
}

function recordedCorpus(spec: {
  readonly atPage: number;
  readonly recorded: number;
  readonly touched: number;
  readonly identityGroups?: readonly (number | null)[];
  readonly truncated?: boolean;
}): AtPageCorpus {
  const corpus = shippedCorpus({
    totalSessions: 200,
    atPage: spec.atPage,
    recordedAtPage: spec.recorded,
    touchedAtPage: spec.touched,
    ...(spec.identityGroups === undefined ? {} : { identityGroups: spec.identityGroups }),
    ...(spec.truncated === undefined ? {} : { truncated: spec.truncated }),
  });

  return mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "recorded" })));
}

function pageCorpus(spec: {
  readonly atPage: number;
  readonly identityGroups?: readonly (number | null)[];
}): AtPageCorpus {
  const corpus = shippedCorpus({
    totalSessions: 200,
    atPage: spec.atPage,
    ...(spec.identityGroups === undefined ? {} : { identityGroups: spec.identityGroups }),
  });

  return mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "page" })));
}

function claimOf(corpus: AtPageCorpus): ShippedReadoutResult {
  return { kind: "claim", corpus, counts: shippedCounts(corpus) };
}

function numbersIn(body: string): readonly string[] {
  return body.match(/\d+/g) ?? [];
}

function sentencesIn(body: string): readonly string[] {
  return body
    .split(/[.?\n]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

// Twelve recorded sessions across three people; five touched the change and two of those people
// came back to it. Every number the body is entitled to state is therefore 12, 5, 3, 2 or 0.
const RECORDED_CLAIM_CORPUS = recordedCorpus({
  atPage: 20,
  recorded: 12,
  touched: 5,
  identityGroups: [0, 1, 2],
});

// One person per session but for the first two, so a page-level reach is 32 of 32 while repeat is
// honestly 2 of 30 — the asymmetry Decision 6f exists for.
const PAGE_CLAIM_GROUPS: readonly number[] = [
  0,
  0,
  1,
  1,
  ...Array.from({ length: 28 }, (_, index) => index + 2),
];

const PAGE_CLAIM_CORPUS = pageCorpus({ atPage: 32, identityGroups: PAGE_CLAIM_GROUPS });

const NOBODY_CORPUS = recordedCorpus({
  atPage: 20,
  recorded: 12,
  touched: 0,
  identityGroups: [0, 1, 2],
});

const BELOW_FLOOR_CORPUS = pageCorpus({ atPage: 4 });

const EVERY_BRANCH: readonly ShippedReadoutResult[] = [
  claimOf(RECORDED_CLAIM_CORPUS),
  claimOf(NOBODY_CORPUS),
  { kind: "too_few", corpus: BELOW_FLOOR_CORPUS },
  { kind: "stale_page_spelling" },
  { kind: "corpus_predates_who_counts" },
];

describe("the readout says which corpus answered", () => {
  test("should name the recorded corpus on a control-level claim", () => {
    const body = readoutOf(claimOf(RECORDED_CLAIM_CORPUS)).body;

    expect(body).toContain(SHIPPED_RECORDED_CORPUS_LINE);
    expect(body).not.toContain(SHIPPED_SPINE_CORPUS_LINE);
  });

  test("should name the spine corpus on a page-level claim", () => {
    const body = readoutOf(claimOf(PAGE_CLAIM_CORPUS)).body;

    expect(body).toContain(SHIPPED_SPINE_CORPUS_LINE);
    expect(body).not.toContain(SHIPPED_RECORDED_CORPUS_LINE);
  });
});

describe("AC-G8 — a denominator drawn from a truncated corpus says so", () => {
  test("should carry the truncation sentence when the corpus was capped", () => {
    const truncated = recordedCorpus({
      atPage: 20,
      recorded: 12,
      touched: 5,
      identityGroups: [0, 1, 2],
      truncated: true,
    });

    expect(truncated.truncated).toBe(true);
    expect(readoutOf(claimOf(truncated)).body).toContain(SHIPPED_TRUNCATED_LINE);
  });

  test("should leave the truncation sentence out when the whole window was read", () => {
    expect(RECORDED_CLAIM_CORPUS.truncated).toBe(false);
    expect(readoutOf(claimOf(RECORDED_CLAIM_CORPUS)).body).not.toContain(SHIPPED_TRUNCATED_LINE);
  });
});

describe("AC-G12 — every branch ends in the question and never in a grade", () => {
  test("should end every readout branch in the verdict question with all three options", () => {
    // A vacuous pass here would be an empty branch list agreeing with itself.
    expect(EVERY_BRANCH.length).toBe(5);

    for (const result of EVERY_BRANCH) {
      const readout = readoutOf(result);

      expect(readout.body.trimEnd().endsWith(SHIPPED_VERDICT_QUESTION)).toBe(true);
      expect(readout.actions.map((action) => action.actionId)).toEqual([
        SHIPPED_VERDICT_KEEP_ACTION_ID,
        SHIPPED_VERDICT_KILL_ACTION_ID,
        SHIPPED_VERDICT_LEAVE_ACTION_ID,
      ]);
      expect(readout.actions.filter((action) => action.label.trim().length > 0)).toHaveLength(3);
    }
  });
});

describe("Decision 6f — a page-level reach is never a fraction of itself", () => {
  test("should state a page-level reach as a count and not as N of N", () => {
    const counts = shippedCounts(PAGE_CLAIM_CORPUS);
    const body = readoutOf(claimOf(PAGE_CLAIM_CORPUS)).body;

    expect(counts.reach.numerator).toBe(counts.reach.denominator);
    expect(counts.reach.denominator).toBe(32);
    expect(body).toContain("32");

    // No sentence may state the same number twice, which is what "32 of 32" would be.
    for (const sentence of sentencesIn(body)) {
      const repeated = numbersIn(sentence).filter(
        (value, index, all) => all.indexOf(value) !== index,
      );
      expect(repeated).toEqual([]);
    }
  });

  test("should still carry repeat as a fraction of the same denominator", () => {
    const counts = shippedCounts(PAGE_CLAIM_CORPUS);
    const repeat = counts.repeat;
    if (repeat === null) throw new Error("thirty identified people must yield a repeat count");

    expect(repeat.numerator).toBe(2);
    expect(repeat.denominator).toBe(30);

    const body = readoutOf(claimOf(PAGE_CLAIM_CORPUS)).body;
    expect(body).toContain("30");
    expect(body).toContain("2");
  });
});

describe("every number the readout states says out of how many", () => {
  test("should state no number the claim cannot account for", () => {
    const counts = shippedCounts(RECORDED_CLAIM_CORPUS);
    const repeat = counts.repeat;
    if (repeat === null) throw new Error("three identified people must yield a repeat count");

    const entitled = new Set(
      [
        counts.reach.numerator,
        counts.reach.denominator,
        repeat.numerator,
        repeat.denominator,
        RECORDED_CLAIM_CORPUS.unidentifiedEligible,
      ].map((value) => String(value)),
    );

    const stated = numbersIn(readoutOf(claimOf(RECORDED_CLAIM_CORPUS)).body);

    expect(stated.length).toBeGreaterThan(0);
    expect(stated.filter((value) => !entitled.has(value))).toEqual([]);
    expect(stated).toContain(String(counts.reach.denominator));
  });

  test("should make no used or not-used claim below the floor and state only the denominator", () => {
    expect(BELOW_FLOOR_CORPUS.basis.kept).toBe(4);

    const body = readoutOf({ kind: "too_few", corpus: BELOW_FLOOR_CORPUS }).body;

    expect(numbersIn(body).length).toBeGreaterThan(0);
    expect(new Set(numbersIn(body))).toEqual(new Set(["4"]));
  });

  test("should state no number at all when the corpus could not be read", () => {
    expect(numbersIn(readoutOf({ kind: "stale_page_spelling" }).body)).toEqual([]);
    expect(numbersIn(readoutOf({ kind: "corpus_predates_who_counts" }).body)).toEqual([]);
  });

  test("should say nobody could be told apart rather than state a repeat of zero", () => {
    const unidentified = pageCorpus({ atPage: 32, identityGroups: [null] });
    const counts = shippedCounts(unidentified);

    expect(counts.repeatRate).toEqual({ kind: "no_rate", reason: "no_identity_coverage" });

    const body = readoutOf(claimOf(unidentified)).body;

    expect(body).toContain(SHIPPED_NO_IDENTITY_LINE);
    expect(numbersIn(body).length).toBeGreaterThan(0);
    expect(new Set(numbersIn(body))).toEqual(new Set(["32"]));
  });
});

describe("FR-9.5 — no id and no key-shaped string reaches the reader", () => {
  test("should render no id and no key-shaped substring in any branch", () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const hexRun = /\b[0-9a-f]{32,}\b/i;

    expect(EVERY_BRANCH.length).toBe(5);
    expect(CHANGE_ID).toMatch(uuid);

    for (const result of EVERY_BRANCH) {
      const readout = readoutOf(result);

      expect(readout.body).not.toContain(CHANGE_ID);
      expect(readout.body).not.toMatch(uuid);
      expect(readout.body).not.toMatch(hexRun);

      // The id travels in the button value, which Slack never renders.
      expect(readout.actions.map((action) => action.value)).toEqual([
        CHANGE_ID,
        CHANGE_ID,
        CHANGE_ID,
      ]);
    }
  });
});
