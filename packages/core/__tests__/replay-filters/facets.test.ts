import { describe, expect, test } from "bun:test";

import { companyFacet, entryFacet, laneFacet, listFacet } from "../../src/replay-filters/facets";
import { selectReplaySessions } from "../../src/replay-filters/select";
import { fact, facts, filtersOf } from "./fixtures";

const ACME_AT_PRICING = fact({
  sessionKey: "ph:acme-1",
  identityEmailDomain: "acme.com",
  entryUrlPath: "/pricing",
});

const ACME_AT_PRICING_2 = fact({
  sessionKey: "ph:acme-2",
  identityEmailDomain: "acme.com",
  entryUrlPath: "/pricing",
});

const ORBIT_AT_DOCS = fact({
  sessionKey: "ph:orbit-1",
  identityEmailDomain: "orbitlabs.co.uk",
  entryUrlPath: "/docs",
});

describe("companyFacet", () => {
  test("should keep an option for a company with zero sessions under the active entry filter, counted 0", () => {
    const universe = [ACME_AT_PRICING, ACME_AT_PRICING_2, ORBIT_AT_DOCS];
    const conditioned = universe.filter((session) => session.entryUrlPath === "/pricing");

    const options = companyFacet({ universe, conditioned });

    expect(options).toHaveLength(2);
    expect(options.filter((option) => option.value === "orbitlabs.co.uk")).toEqual([
      { value: "orbitlabs.co.uk", sessionCount: 0, replayCount: 0 },
    ]);
  });

  test("should build the option universe before the other filters are applied", () => {
    const universe = [ACME_AT_PRICING, ACME_AT_PRICING_2, ORBIT_AT_DOCS];
    const conditioned = universe.filter((session) => session.entryUrlPath === "/pricing");

    const unfiltered = companyFacet({ universe, conditioned: universe });
    const filtered = companyFacet({ universe, conditioned });

    expect(filtered).toHaveLength(unfiltered.length);
    expect(filtered.map((option) => option.value)).toEqual(
      unfiltered.map((option) => option.value),
    );
    expect(filtered.map((option) => option.sessionCount)).not.toEqual(
      unfiltered.map((option) => option.sessionCount),
    );
  });

  test("should count replays through recordingIdFromSessionKey, so a domain whose keys carry no ph: prefix reads 0 replays with a non-zero session count", () => {
    const universe = facts(5, (index) => ({
      sessionKey: `gm:legacy-${String(index)}`,
      identityEmailDomain: "legacy.example",
    }));

    const options = companyFacet({ universe, conditioned: universe });

    expect(options).toEqual([{ value: "legacy.example", sessionCount: 5, replayCount: 0 }]);
  });

  test("should never make a free-mail domain an option, because it groups through groupSessionsByDomain", () => {
    const universe = [
      ACME_AT_PRICING,
      fact({ sessionKey: "ph:free-1", identityEmailDomain: "gmail.com" }),
      fact({ sessionKey: "ph:free-2", identityEmailDomain: "gmail.com" }),
    ];

    const options = companyFacet({ universe, conditioned: universe });

    expect(options.filter((option) => option.value === "gmail.com")).toHaveLength(0);
    expect(options).toHaveLength(1);
  });

  test("should put a session whose identity_email_domain is null in no company", () => {
    const anonymous = fact({
      sessionKey: "ph:anon-1",
      identityEmailDomain: null,
      entryUrlPath: "/pricing",
    });
    const universe = [ACME_AT_PRICING, anonymous];

    const options = companyFacet({ universe, conditioned: universe });
    const selection = selectReplaySessions(universe, filtersOf());

    expect(options.map((option) => option.value)).toEqual(["acme.com"]);
    expect(selection.rows.filter((row) => row.sessionKey === "ph:anon-1")).toHaveLength(1);
  });
});

describe("entryFacet", () => {
  test("should put a session whose accessor value is null in no bucket and create no null option row", () => {
    const universe = [
      ACME_AT_PRICING,
      fact({ sessionKey: "ph:no-entry-1", entryUrlPath: null }),
      fact({ sessionKey: "ph:no-entry-2", entryUrlPath: null }),
    ];

    const options = entryFacet({ universe, conditioned: universe });

    expect(options.map((option) => option.value)).toEqual(["/pricing"]);
    expect(options.filter((option) => option.value.length === 0)).toHaveLength(0);
  });
});

describe("listFacet", () => {
  test("should build the company and entry facets from one builder with a different accessor", () => {
    const universe = [ACME_AT_PRICING, ORBIT_AT_DOCS];

    const viaBuilder = listFacet((session) => session.entryUrlPath)({
      universe,
      conditioned: universe,
    });
    const entry = entryFacet({ universe, conditioned: universe });
    const company = companyFacet({ universe, conditioned: universe });

    expect(viaBuilder).toEqual(entry);
    expect(company).toHaveLength(2);
    expect(entry).toHaveLength(2);
    expect(company.map((option) => Object.keys(option).toSorted())).toEqual(
      entry.map((option) => Object.keys(option).toSorted()),
    );
  });
});

describe("laneFacet", () => {
  test("should count all three lanes under the active company and entry filters and leave the lane filter out", () => {
    const everyLaneRead = [
      ACME_AT_PRICING,
      ACME_AT_PRICING_2,
      fact({ sessionKey: "ph:sim-1", origin: "synthetic" }),
      fact({ sessionKey: "ph:excluded-1", exclusionReason: "automation_headless" }),
    ];

    const options = laneFacet({ universe: everyLaneRead, conditioned: everyLaneRead });

    expect(options).toHaveLength(3);
    expect(options.map((option) => option.value).toSorted()).toEqual([
      "excluded",
      "real",
      "simulated",
    ]);
    expect(options.reduce((total, option) => total + option.sessionCount, 0)).toBe(
      everyLaneRead.length,
    );
  });
});
