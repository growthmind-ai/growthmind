import { describe, expect, test } from "bun:test";

import { REPLAY_FILTER_PARAMS, replayFiltersOf } from "../../src/replays/filters";

describe("replayFiltersOf", () => {
  test("should degrade an unknown who value to the default lane", () => {
    expect(() => replayFiltersOf({ who: "penguins" })).not.toThrow();
    expect(replayFiltersOf({ who: "penguins" }).lane).toBe("real");
  });

  test("should degrade a missing who param to the default lane", () => {
    expect(replayFiltersOf({}).lane).toBe("real");
  });

  test("should drop a company param that is empty after trimming", () => {
    expect(replayFiltersOf({ company: "   " }).company).toBeNull();
  });

  test("should treat a repeated company param as malformed and drop it rather than choosing one", () => {
    // The fail direction is toward more rows, never toward another tenant's (D10).
    expect(replayFiltersOf({ company: ["acme.com", "orbitlabs.co.uk"] }).company).toBeNull();
  });

  test("should ignore an unknown param key without throwing", () => {
    const filters = replayFiltersOf({ sneaky: "value", company: "acme.com" });

    expect(filters.company).toBe("acme.com");
    expect(Object.keys(filters).toSorted()).toEqual(["company", "entry", "lane"]);
  });

  test("should pass through a company value that is not a valid domain", () => {
    expect(replayFiltersOf({ company: "not a domain" }).company).toBe("not a domain");
  });
});

describe("REPLAY_FILTER_PARAMS", () => {
  test("should expose exactly three param names, company, entry and who", () => {
    expect(Object.values(REPLAY_FILTER_PARAMS)).toEqual(["company", "entry", "who"]);
  });
});
