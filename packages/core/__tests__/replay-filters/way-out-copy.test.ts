import { describe, expect, test } from "bun:test";

import { wayOutAction, wayOutBody } from "../../src/replay-filters/way-out";
import { filtersOf } from "./fixtures";

// The four bodies and three button labels of .ai/ux/o-050-replays-filters.md §6.2 E3, plus E4's
// body. apps/web asserts the same strings through the rendered state; this is the half that runs
// without a database, so a copy drift fails in a second rather than in a seeded suite.
describe("wayOutBody", () => {
  test("should name the company and the entry when the entry is the culprit and both are on", () => {
    const both = filtersOf({ company: "acme.com", entry: "/pricing" });

    expect(wayOutBody({ relax: "entry" }, both)).toBe("Nobody from acme.com started at /pricing.");
  });

  test("should drop the company clause when the entry is the culprit and no company is on", () => {
    const entryOnly = filtersOf({ entry: "/pricing", lane: "excluded" });

    expect(wayOutBody({ relax: "entry" }, entryOnly)).toBe(
      "Nothing that started at /pricing is in this lane.",
    );
  });

  test("should lead with the company when the company is the culprit", () => {
    const both = filtersOf({ company: "acme.com", entry: "/pricing" });

    expect(wayOutBody({ relax: "company" }, both)).toBe(
      "acme.com has nothing that started at /pricing.",
    );
  });

  test("should blame the lane without naming a value when the lane is the culprit", () => {
    const all = filtersOf({ company: "acme.com", entry: "/pricing", lane: "excluded" });

    expect(wayOutBody({ relax: "lane" }, all)).toBe(
      "Nothing in this lane matches the rest of what you picked.",
    );
  });

  test("should say the combination is the reason when no single filter is", () => {
    expect(wayOutBody("clear_all", filtersOf({ company: "acme.com", entry: "/pricing" }))).toBe(
      "No single one of them is the reason on its own — it is the combination.",
    );
  });

  test("should render no sentence rather than one with an empty value in it", () => {
    const noEntry = filtersOf({ company: "acme.com", lane: "excluded" });

    expect(wayOutBody({ relax: "company" }, noEntry)).toBeNull();
    expect(wayOutBody("rows", filtersOf())).toBeNull();
  });

  test("should never leave a brace token in a rendered sentence", () => {
    const rendered = wayOutBody({ relax: "entry" }, filtersOf({ entry: "/plans?tier={x}" }));

    expect(rendered).toBe("Nothing that started at /plans?tier={x} is in this lane.");
  });
});

describe("wayOutAction", () => {
  test("should offer one label per culprit, and a return to the baseline for the lane", () => {
    expect(wayOutAction({ relax: "company" })).toBe("Clear the company filter");
    expect(wayOutAction({ relax: "entry" })).toBe("Clear the page filter");
    expect(wayOutAction({ relax: "lane" })).toBe("Show real people again");
    expect(wayOutAction("clear_all")).toBe("Clear all filters");
  });

  test("should offer no way out of a state that is not over-filtered", () => {
    expect(wayOutAction("rows")).toBeNull();
    expect(wayOutAction("value_matches_nothing")).toBeNull();
  });
});
