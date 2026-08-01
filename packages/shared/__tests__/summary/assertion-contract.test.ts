// The String Assertion Contract's own guard.
//
// What this suite is for, in one sentence: a contract whose rows cite tests is worth
// exactly as much as the citations are true, and nothing but a machine can keep them
// true across a rename.
//
// The citations are resolved mechanically, never by eye. Every `enforcedBy` entry names
// a test string and a workspace-relative file; this suite opens that file and looks for
// the verbatim `test` declaration. A citation naming a test that does not exist is
// a failure, never a skip. A skip would turn a broken citation into a green run, which
// is the exact failure mode the contract exists to prevent one level up.
//
// Why this file may use `node:fs` when `packages/core`'s tests may not. `packages/core`
// holds a package-wide purity property asserted over `src/`, and its suites stay on
// `Bun.file`/`Bun.Glob` so they do not become the offender they police. `shared`'s test
// lane has no such property and already reads source with `node:fs`
// (`messages.test.ts:13`). Nothing here is imported by production code.
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

/** `packages/shared/__tests__/summary/` → the workspace root, four levels up. */
function workspacePath(relativePath: string): string {
  return fileURLToPath(new URL(`../../../../${relativePath}`, import.meta.url));
}

/**
 * True when the cited test exists verbatim in the cited file.
 *
 * Matches on `test("<name>"` rather than on the bare name, so a citation that happens
 * to appear in a comment or in a denylist array does not count as an enforcing test. A
 * missing file throws rather than returning false. That is a broken citation too, and
 * it deserves a message naming the path.
 */
function citationResolves(citation: EnforcingTest): boolean {
  const source = readFileSync(workspacePath(citation.file), "utf8");
  return source.includes(`test("${citation.test}"`);
}

/** Every citation in the enforced half of the contract, flattened. */
const ALL_CITATIONS: readonly EnforcingTest[] = Object.values(SAC_CONTRACT).flatMap((row) => [
  ...row.enforcedBy,
]);

describe("the String Assertion Contract", () => {
  test("every assertion-contract row cites a test name that exists verbatim in the tree", () => {
    // Non-vacuity, before any "all resolve" claim. A contract that had lost its rows
    // would pass an every over nothing.
    expect(Object.keys(SAC_CONTRACT).length).toBeGreaterThan(0);
    expect(ALL_CITATIONS.length).toBeGreaterThan(0);

    const unresolved = ALL_CITATIONS.filter((citation) => !citationResolves(citation));

    // Reported as the citations themselves, not a count: a failure here must name the
    // test that moved.
    expect(unresolved).toEqual([]);
  });

  test("the extraction guard reports a planted citation of a test that does not exist", () => {
    const planted: EnforcingTest = {
      test: "this test name was never declared anywhere in this repository",
      file: "packages/core/__tests__/summary/floor.test.ts",
    };

    expect(citationResolves(planted)).toBe(false);

    // And the control, so the guard is not simply always-false: a real citation from
    // the contract resolves against the same reader.
    const real = ALL_CITATIONS[0];
    if (!real) throw new Error("the contract must carry at least one citation");
    expect(citationResolves(real)).toBe(true);
  });

  test("the assertion contract has a row for every SAC id it claims to cover", () => {
    // The partition observed at runtime. The compiler already proves it is total,
    // `UnenforcedSacId` is `Exclude<SacId, EnforcedSacId>`, and this is the second,
    // independent statement of the same fact, so a hand-edited `SAC_IDS` that drifted
    // from the union is caught too.
    const covered = [...Object.keys(SAC_CONTRACT), ...Object.keys(SAC_NOT_YET_ENFORCED)];

    expect(covered.toSorted()).toEqual([...SAC_IDS].toSorted());

    // Disjoint, not merely covering: a row in both halves would present as enforced and
    // unenforced at once.
    const enforced = new Set(Object.keys(SAC_CONTRACT));
    const overlap = Object.keys(SAC_NOT_YET_ENFORCED).filter((id) => enforced.has(id));
    expect(overlap).toEqual([]);
  });

  test("the disjointness proof this contract cites exists verbatim in the detector suite", () => {
    // SAC-11's "structurally disjoint" is itself an assertion. If the proof test were
    // renamed or deleted, the contract that forbids unsupported claims would be making
    // one.
    expect(SAC_11_DISJOINTNESS_PROOF.file).toBe(
      "packages/core/__tests__/detect/funnel-dropoff.test.ts",
    );
    expect(citationResolves(SAC_11_DISJOINTNESS_PROOF)).toBe(true);

    // ..and it is actually cited BY the SAC-11 row, not merely exported beside it. A
    // proof nothing references would be decoration.
    const sac11 = SAC_CONTRACT["SAC-11"];
    expect(sac11.enforcedBy).toContainEqual(SAC_11_DISJOINTNESS_PROOF);
  });

  test("every not-yet-enforced row states why no test can exist and who inherits it", () => {
    const rows = Object.values(SAC_NOT_YET_ENFORCED);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.notEnforcedBecause.trim().length).toBeGreaterThan(0);
      expect(row.inheritedBy.trim().length).toBeGreaterThan(0);

      // The inheritor is named by outcome ID, not by a vague promise. "later" and
      // "TODO" are how an unenforced row becomes permanent.
      expect(row.inheritedBy).toMatch(/O-\d+/);
      expect(row.notEnforcedBecause.toUpperCase()).not.toContain("TODO");
    }
  });
});
