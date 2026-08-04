import { describe, expect, test } from "bun:test";

import { initialsOf } from "../../lib/initials";
import { checkSummary, outcomeWordOf, tallyChecks } from "../../lib/preview/summaries";
import type { FixCheck } from "../../lib/preview/types";

function check(state: FixCheck["state"]): FixCheck {
  return { text: `a ${state} check`, state, stamp: state };
}

describe("tallyChecks / checkSummary", () => {
  test("counts each state and reports the confirmed fraction", () => {
    const tally = tallyChecks([
      check("confirmed"),
      check("confirmed"),
      check("measuring"),
      check("missing"),
    ]);

    expect(tally).toEqual({ confirmed: 2, measuring: 1, missing: 1 });
    expect(checkSummary(tally)).toBe(
      "2 of 4 confirmed · 1 still measuring · 1 asked for and not shipped",
    );
  });

  test("a settled fix reports only the fraction", () => {
    expect(checkSummary(tallyChecks([check("confirmed")]))).toBe("1 of 1 confirmed");
  });

  test("no checks is said out loud rather than rendering 0 of 0", () => {
    expect(checkSummary(tallyChecks([]))).toBe("No checks yet");
  });
});

describe("outcomeWordOf", () => {
  test("reads the call off the verdict sentence rather than a second stored field", () => {
    expect(outcomeWordOf("Kept. It reached the bar we set.")).toBe("KEPT");
    expect(outcomeWordOf("Killed. It did not move.")).toBe("KILLED");
  });

  test("an unreadable verdict degrades to a dash, not to a crash", () => {
    expect(outcomeWordOf("")).toBe("—");
    expect(outcomeWordOf("   ")).toBe("—");
  });
});

describe("initialsOf", () => {
  test("takes the first and last initial of a full name", () => {
    expect(initialsOf("Tom McDonough", "tom@example.com")).toBe("TM");
    expect(initialsOf("Tom", "tom@example.com")).toBe("T");
  });

  test("falls back to the email when there is no usable name", () => {
    expect(initialsOf(null, "tom@example.com")).toBe("T");
    expect(initialsOf("  ", "tom@example.com")).toBe("T");
    expect(initialsOf("···", "tom@example.com")).toBe("T");
  });

  test("falls back to a placeholder rather than rendering an empty circle", () => {
    expect(initialsOf(null, null)).toBe("?");
  });
});
