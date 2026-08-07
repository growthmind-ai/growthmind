import { describe, expect, test } from "bun:test";

import { initialsOf } from "../../lib/initials";
import { outcomeWordOf } from "../../lib/preview/summaries";

// tallyChecks/checkSummary went with the fixture /fixes page. The per-check state they
// summarised has no writer — nothing moves a fix off `open` until O-028 — so the functions
// and their tests were describing a shape the product does not have.

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
