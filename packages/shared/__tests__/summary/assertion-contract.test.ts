import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import type { EnforcingTest } from "../../src/summary/assertion-contract";
import {
  SAC_11_DISJOINTNESS_PROOF,
  SAC_CONTRACT,
  SAC_IDS,
  SAC_NOT_YET_ENFORCED,
} from "../../src/summary/assertion-contract";

function workspacePath(relativePath: string): string {
  return fileURLToPath(new URL(`../../../../${relativePath}`, import.meta.url));
}

function citationResolves(citation: EnforcingTest): boolean {
  const source = readFileSync(workspacePath(citation.file), "utf8");
  return source.includes(`test("${citation.test}"`);
}

const ALL_CITATIONS: readonly EnforcingTest[] = Object.values(SAC_CONTRACT).flatMap((row) => [
  ...row.enforcedBy,
]);

describe("the String Assertion Contract", () => {
  test("every assertion-contract row cites a test name that exists verbatim in the tree", () => {
    expect(Object.keys(SAC_CONTRACT).length).toBeGreaterThan(0);
    expect(ALL_CITATIONS.length).toBeGreaterThan(0);

    const unresolved = ALL_CITATIONS.filter((citation) => !citationResolves(citation));

    expect(unresolved).toEqual([]);
  });

  test("the extraction guard reports a planted citation of a test that does not exist", () => {
    const planted: EnforcingTest = {
      test: "this test name was never declared anywhere in this repository",
      file: "packages/core/__tests__/summary/floor.test.ts",
    };

    expect(citationResolves(planted)).toBe(false);

    const real = ALL_CITATIONS[0];
    if (!real) throw new Error("the contract must carry at least one citation");
    expect(citationResolves(real)).toBe(true);
  });

  test("the assertion contract has a row for every SAC id it claims to cover", () => {
    const covered = [...Object.keys(SAC_CONTRACT), ...Object.keys(SAC_NOT_YET_ENFORCED)];

    expect(covered.toSorted()).toEqual([...SAC_IDS].toSorted());

    const enforced = new Set(Object.keys(SAC_CONTRACT));
    const overlap = Object.keys(SAC_NOT_YET_ENFORCED).filter((id) => enforced.has(id));
    expect(overlap).toEqual([]);
  });

  test("the disjointness proof this contract cites exists verbatim in the detector suite", () => {
    expect(SAC_11_DISJOINTNESS_PROOF.file).toBe(
      "packages/core/__tests__/detect/funnel-dropoff.test.ts",
    );
    expect(citationResolves(SAC_11_DISJOINTNESS_PROOF)).toBe(true);

    const sac11 = SAC_CONTRACT["SAC-11"];
    expect(sac11.enforcedBy).toContainEqual(SAC_11_DISJOINTNESS_PROOF);
  });

  test("every not-yet-enforced row states why no test can exist and who inherits it", () => {
    const rows = Object.values(SAC_NOT_YET_ENFORCED);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.notEnforcedBecause.trim().length).toBeGreaterThan(0);
      expect(row.inheritedBy.trim().length).toBeGreaterThan(0);

      expect(row.inheritedBy).toMatch(/O-\d+/);
      expect(row.notEnforcedBecause.toUpperCase()).not.toContain("TODO");
    }
  });
});
