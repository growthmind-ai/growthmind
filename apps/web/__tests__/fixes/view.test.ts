// The list is ranked by expected value and not by date, so the page has to be able to say
// why a row with fewer affected sessions outranks one with more. These assertions are on
// the sentences that do the saying — the ordering itself is the service's and is tested
// in packages/db/__tests__/services/fixes.service.test.ts.
import { describe, expect, test } from "bun:test";

import { measuredCount, type ExpectedValue, type MeasuredCount } from "@growthmind/core";
import { SURFACE_ROLE_NOTES } from "@growthmind/shared";

import {
  dueOf,
  explainRank,
  promiseOf,
  setAsideSentences,
  tailSentence,
  truncationSentence,
  type RankedRow,
} from "../../lib/fixes/view";

const WINDOW = {
  start: new Date("2026-07-20T00:00:00.000Z"),
  end: new Date("2026-08-03T00:00:00.000Z"),
};

function count(numerator: number, denominator: number, setAside = 0): MeasuredCount {
  return measuredCount({
    numerator,
    denominator,
    unit: "sessions",
    timeframe: WINDOW,
    basis: {
      totalInWindow: denominator + setAside,
      kept: denominator,
      keptUnchecked: 0,
      setAside:
        setAside === 0
          ? []
          : [{ reason: "internal_domain", count: setAside, label: "Your own team's visits" }],
    },
  });
}

function ranked(
  affected: number,
  weight: number,
  role: ExpectedValue["role"],
  denominator: number,
): RankedRow {
  return {
    impact: count(affected, denominator),
    rankedBy: { score: affected * weight, affected, weight, weightVersion: 1, role },
  };
}

describe("why a row ranks where it does", () => {
  test("the biggest count on a page nothing has been said about is explained, not left looking like a bug", () => {
    const rows: readonly RankedRow[] = [
      ranked(31, 6, "first_value", 412),
      ranked(58, 1, "unknown", 610),
    ];

    const view = explainRank(rows[1], 1, rows);

    expect(view.lead).toBe(
      "Second, even though 58 sessions ran into this — more than anything else here.",
    );
    expect(view.roleNote).toBe(SURFACE_ROLE_NOTES.unknown);
    expect(view.arithmetic).toBe("58 sessions × 1 = 58");
    expect(view.unroled).toBe(true);
  });

  test("a roled row names the count and the product's own words for what the page is for", () => {
    const rows: readonly RankedRow[] = [ranked(12, 8, "makes_money", 340)];

    const view = explainRank(rows[0], 0, rows);

    expect(view.lead).toBe("First because 12 of 340 sessions measured ran into this.");
    expect(view.roleNote).toBe(SURFACE_ROLE_NOTES.makes_money);
    expect(view.unroled).toBe(false);
    expect(view.against).toBeNull();
  });

  test("two rows worth the same name the promised date as the tie-break", () => {
    const rows: readonly RankedRow[] = [
      ranked(12, 8, "makes_money", 340),
      ranked(24, 4, "leads_to_money", 512),
    ];

    expect(explainRank(rows[1], 1, rows).against).toBe(
      "This is worth the same as the one above it, so the earlier promised date goes first.",
    );
    expect(explainRank(rows[0], 0, rows).against).toBe(
      "The one below it is worth the same, so the earlier promised date went first.",
    );
  });

  test("a row that is not tied is compared against the one above it in the same arithmetic", () => {
    const rows: readonly RankedRow[] = [
      ranked(31, 6, "first_value", 412),
      ranked(12, 8, "makes_money", 340),
    ];

    expect(explainRank(rows[1], 1, rows).against).toBe("Above it: 31 sessions × 6 = 186.");
  });

  test("the weight is read off the value the service ranked on, never re-derived here", () => {
    const rows: readonly RankedRow[] = [
      {
        impact: count(9, 288),
        rankedBy: { score: 999, affected: 9, weight: 111, weightVersion: 7, role: "keeps_people" },
      },
    ];

    expect(explainRank(rows[0], 0, rows).arithmetic).toBe("9 sessions × 111 = 999");
  });
});

describe("a promise we made and have not kept", () => {
  const openedAt = new Date("2026-08-03T00:00:00.000Z");
  const resultsBy = new Date("2026-08-17T00:00:00.000Z");

  test("says we do not have an answer once the date has passed, and does not soften it", () => {
    const view = promiseOf(openedAt, resultsBy, new Date("2026-08-20T00:00:00.000Z"));

    expect(view.late).toBe(true);
    expect(view.lead).toBe(
      "We said we would have an answer by 17 August 2026. We do not have one.",
    );
    expect(view.aside).toBe(
      "The date was set when this was opened on 3 August 2026 and has not been moved.",
    );
  });

  test("states the date and never a remaining duration", () => {
    const inDate = promiseOf(openedAt, resultsBy, new Date("2026-08-10T00:00:00.000Z"));

    expect(inDate.late).toBe(false);
    expect(inDate.lead).toBe("We said we would have an answer by 17 August 2026.");
    for (const sentence of [inDate.lead, inDate.aside]) {
      expect(sentence).not.toMatch(/\b\d+ days?\b|\bin \d+\b|\bleft\b/);
    }
  });

  test("the row's trailing label stops being a due date and becomes a statement", () => {
    expect(dueOf(resultsBy, new Date("2026-08-10T00:00:00.000Z"))).toEqual({
      late: false,
      value: "17 August 2026",
      label: "result due",
    });

    expect(dueOf(resultsBy, new Date("2026-08-20T00:00:00.000Z"))).toEqual({
      late: true,
      value: "no answer",
      label: "since 17 August 2026",
    });
  });

  test("the page says how many of how many are late rather than going quiet", () => {
    expect(tailSentence(3, 5)).toContain("3 of these 5 are past the date");
    expect(tailSentence(1, 5)).toContain("1 of these 5 is past the date");
    expect(tailSentence(0, 5)).toBe(
      "Nothing here needs you. When a result is due we say so in the channel you already use.",
    );
  });
});

describe("every number says out of how many", () => {
  test("a set-aside group states what left the denominator and what the denominator is", () => {
    expect(setAsideSentences(count(12, 340, 47))).toEqual([
      "47 more sessions in that window were set aside as your own team's visits, so they are not in the 340.",
    ]);
  });

  test("a single set-aside session reads as one, not as a plural", () => {
    expect(setAsideSentences(count(12, 340, 1))).toEqual([
      "1 more session in that window was set aside as your own team's visits, so it is not in the 340.",
    ]);
  });

  test("a count with nothing set aside claims no exclusions", () => {
    expect(setAsideSentences(count(12, 340))).toEqual([]);
  });

  test("a truncated list says out of how many, and an untruncated one says nothing", () => {
    expect(truncationSentence(25, 41)).toBe(
      "The 25 most worth fixing, out of 41 open. The rest are ranked below these and appear as these are answered.",
    );
    expect(truncationSentence(5, 5)).toBeNull();
  });
});
