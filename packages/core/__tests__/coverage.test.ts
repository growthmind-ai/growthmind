// Unit tests for export coverage: both named tests.
//
// Why this file exists. the definition of done is "every pure function unit-tested with
// declared fail directions". Everywhere else in this package that claim is *made*; here
// it is *enforced*. The two tests below are the difference between a sprint that
// believes it is covered and a sprint that can prove it, and, more importantly, between
// a package that is covered today and one that stays covered after the next function is
// added.
//
// The rule both tests obey: Nothing is hand-listed that can be enumerated. A
// hand-written list of exports silently stops covering the function someone adds next
// month, which is precisely the failure these tests exist to prevent. So the
// enumeration comes from the artefacts themselves. The barrel (`src/index.ts`, parsed
// and cross-checked against the runtime module), the threshold rule set's own keys, and
// `PROOF_PREDICATES`'s own keys. The only hand-written thing here is the *coverage map*
// in test 2, and that map is typed `Record<ThresholdKey, …>` so a threshold added
// without a declared fail-direction test is a compile error before it is a test
// failure.
//
// Non-vacuity is asserted first, every time (the `reachability.test.ts` pattern). An
// enumeration that resolves to nothing passes perfectly and means nothing: "zero
// uncovered exports" out of zero exports is not coverage, it is a broken scan reporting
// green.
//
// House rules honoured here (state.md standing constraints):
// No node builtin. Source and test text is read through `Bun.file`,
//  `Bun.Glob`, and `import.meta.dir` — never `node:fs` / `node:path`. A
//  sibling test asserts `packages/core/src` imports no node builtin, and
//  this package's test side keeps the same discipline.
// No `Date.now`: nothing here reads a clock.
import { describe, expect, test } from "bun:test";

import { PROOF_PREDICATES } from "../src/evidence/predicates";
import * as barrel from "../src/index";
import { THRESHOLD_RULE_SETS } from "../src/rules/thresholds";
import type { FindingClass, ThresholdRuleSet } from "../src/rules/types";

// -- paths (no `node:path`; forward slashes everywhere)

const TESTS_ROOT = import.meta.dir;
const BARREL_PATH = `${TESTS_ROOT}/../src/index.ts`;

/** Bun.Glob yields `\`-separated entries on Windows. One vocabulary, always. */
function slash(value: string): string {
  return value.replaceAll("\\", "/");
}

/**
 * This file is excluded from its own corpus. A coverage test that can satisfy itself
 * from its own test names is a mirror, not a gate.
 */
const SELF = "coverage.test.ts";

// -- the suite, discovered rather than listed

type TestSuite = {
  /** Posix-relative to `__tests__`, e.g. `evidence/gate.test.ts`. */
  readonly files: readonly string[];
  /** file -> source text. */
  readonly sources: ReadonlyMap<string, string>;
  /** file -> the `test` / `it` names declared in it. */
  readonly names: ReadonlyMap<string, readonly string[]>;
};

let suiteCache: TestSuite | null = null;

/** Every `test` / `it` name in one file, quote style agnostic. */
function testNamesIn(source: string): string[] {
  const declaration = /\b(?:test|it)\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(source)) !== null) {
    found.push(match[2]);
  }
  return found;
}

async function readSuite(): Promise<TestSuite> {
  if (suiteCache) return suiteCache;

  const files: string[] = [];
  for await (const entry of new Bun.Glob("**/*.test.ts").scan({ cwd: TESTS_ROOT })) {
    const relative = slash(entry);
    if (relative !== SELF) files.push(relative);
  }
  files.sort();

  const sources = new Map<string, string>();
  const names = new Map<string, readonly string[]>();
  for (const file of files) {
    const source = await Bun.file(`${TESTS_ROOT}/${file}`).text();
    sources.set(file, source);
    names.set(file, testNamesIn(source));
  }

  suiteCache = { files, sources, names };
  return suiteCache;
}

// -- the barrel, parsed and cross-checked against the runtime module

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

type ParsedBarrel = {
  /** exported value name -> the module specifier it came from. */
  readonly valueExports: ReadonlyMap<string, string>;
  /** The barrel source with every parsed re-export block removed. */
  readonly residue: string;
};

/**
 * `src/index.ts` is a wall of `export { … } from "./x/y"` blocks, so the specifier each
 * name came from is only visible in the source. The runtime module object knows the
 * names and not their homes. Parsing gives us the homes; the runtime module is then
 * used to decide which of those names are functions, and to prove the parse missed
 * nothing (below).
 */
async function parseBarrel(): Promise<ParsedBarrel> {
  const code = stripComments(await Bun.file(BARREL_PATH).text());
  const block = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']\s*;?/g;

  const valueExports = new Map<string, string>();
  let residue = code;
  let match: RegExpExecArray | null;
  while ((match = block.exec(code)) !== null) {
    residue = residue.replace(match[0], " ");
    if (match[1]) continue; // `export type { … }` — erased, nothing to test.

    for (const raw of match[2].split(",")) {
      const entry = raw.trim();
      if (entry.length === 0 || /^type\s/.test(entry)) continue;
      const parts = entry.split(/\s+as\s+/);
      valueExports.set((parts[1] ?? parts[0]).trim(), match[3]);
    }
  }

  return { valueExports, residue };
}

const runtimeBarrel = barrel as unknown as Record<string, unknown>;

describe("export coverage", () => {
  // item 1.
  //
  // The rule for "needs a test file", stated out loud: every barrel export whose
  // runtime value is a function. Not every export is a pure function. The barrel also
  // carries Zod schemas, constant maps, versioned literals, and (erased) types, and the
  // classification is made at runtime by `typeof` rather than by name, so nothing can
  // dodge it by being called `somethingSchema`. The rule cannot silently exempt a real
  // function: adding one to the barrel adds it to this enumeration automatically.
  //
  // A function is covered when both hold: its module has a mirroring test file,
  // `src/x/y.ts` is covered by
  //  `__tests__/x/y.test.ts`, the convention every existing suite already
  //  follows, so the tests for a module are findable from the module; and
  //  some test file in the suite calls it by name. alone passes for a
  //  function nobody ever invokes; alone loses the naming convention.
  //  `isReachableClass` is why scans the whole suite rather than only
  //  the mirroring file — it lives in `evidence/gate.ts` and is exercised
  //  from `findings/candidate.test.ts`, which is the right home for it.
  test("should have a test file for every exported pure function in packages/core", async () => {
    const { valueExports, residue } = await parseBarrel();
    const suite = await readSuite();

    // -- non-vacuity, before any "zero offenders" claim
    expect(valueExports.size).toBeGreaterThan(0);
    expect(suite.files.length).toBeGreaterThan(0);
    expect(Object.keys(runtimeBarrel).length).toBeGreaterThan(0);

    // The parser must have seen the whole barrel. A bare `export function`, an `export
    // const`, or an `export *` in `index.ts` would be invisible to the block regex
    // above and would therefore be exempt from this test by accident, so anything the
    // regex could not account for fails here.
    expect(residue).not.toMatch(/\bexport\b/);

    // ...and the parse must agree with the runtime module in both directions: a name at
    // runtime the parse missed is an un-enumerated export, and a parsed name absent at
    // runtime means the parse invented one.
    expect([...valueExports.keys()].toSorted()).toEqual(Object.keys(runtimeBarrel).toSorted());

    const functions = [...valueExports].filter(
      ([name]) => typeof runtimeBarrel[name] === "function",
    );
    expect(functions.length).toBeGreaterThan(0);

    // -- the actual assertion
    const uncovered: string[] = [];
    for (const [name, specifier] of functions) {
      const mirrorFile = `${specifier.replace(/^\.\//, "")}.test.ts`;
      if (!suite.sources.has(mirrorFile)) {
        uncovered.push(
          `\`${name}\` (exported from "${specifier}") has no test file — expected __tests__/${mirrorFile}`,
        );
        continue;
      }

      const called = new RegExp(String.raw`\b${name}\s*\(`);
      const callers = suite.files.filter((file) => called.test(suite.sources.get(file) ?? ""));
      if (callers.length === 0) {
        uncovered.push(
          `\`${name}\` (exported from "${specifier}") is never called by any test in the suite — ` +
            `__tests__/${mirrorFile} exists but nothing exercises the function`,
        );
      }
    }

    if (uncovered.length > 0) {
      throw new Error(
        `FR-22: every exported pure function in packages/core needs a test file.\n` +
          uncovered.map((line) => `  - ${line}`).join("\n") +
          `\nDo not exempt one of these to go green — an untested exported function is the gap, not the test.`,
      );
    }

    expect(uncovered).toEqual([]);
  });

  // item 2.
  //
  // What this adds over `rules/thresholds.test.ts`'s fail-direction test. That one
  // proves every threshold declares a fail direction. Documentation, as data. This one
  // proves every threshold has a test whose name states it, so the declared direction
  // is an asserted behaviour and not a comment. the whole value is that the direction
  // is provable; a rule set can declare "under-detect" for a magnitude nothing ever
  // pushes past its boundary.
  //
  // What counts as a "threshold" here, and why the classification cannot let a real one
  // through:
  // Every numeric member of the rule set except `version` (the rule set's
  //  own identity, not a judgement it makes) — enumerated at runtime, so a
  //  new magnitude is in scope the moment it is added;
  // `exceptionEventName` is a name: no magnitude, nothing to be
  //  conservative about, no direction to state (and the same call
  //  `thresholds.test.ts` makes);
  // The four `*ProofSignals` lists are covered by their predicate's row
  //  below — the list is the predicate's parameter, and the predicate is
  //  what turns it into a verdict;
  // Every other name list needs its own row in
  //  `NAME_LIST_FAIL_DIRECTION_TESTS`. A list can be an assertion gate just
  //  as a magnitude can: `passiveEventNames` is what stops a `$pageview`
  //  being named as the action an exception broke, which is the difference
  //  between a passing `broken` verdict and silence;
  // Anything else throws rather than being skipped.
  //
  // `DETECTOR_CORPUS_MAX_SESSIONS` is deliberately not here, and that is a decision
  // rather than an omission: makes it a read-side cost bound rather than a rule-set
  // member, and its fail direction is carried by `coverage.truncated` (a visible
  // truncation, never a silent one), asserted in the corpus service's own suite.
  test("should have at least one test whose name states a fail direction for every threshold and predicate", async () => {
    const suite = await readSuite();
    const ruleSet = ruleSetV1();

    // -- non-vacuity, before any "zero offenders" claim
    expect(suite.files.length).toBeGreaterThan(0);
    expect(Object.keys(ruleSet).length).toBeGreaterThan(0);
    expect(Object.keys(PROOF_PREDICATES).length).toBeGreaterThan(0);

    // The name extractor must have found names in every discovered file. If the regex
    // ever stops matching the house style, this catches it here rather than letting a
    // silently empty corpus report full coverage.
    for (const file of suite.files) {
      expect((suite.names.get(file) ?? []).length).toBeGreaterThan(0);
    }

    // -- every threshold is declared, and nothing declared is stale
    const declaredThresholds = new Map<string, FailDirectionEvidence>(
      Object.entries(THRESHOLD_FAIL_DIRECTION_TESTS),
    );
    const declaredNameLists = new Map<string, FailDirectionEvidence>(
      Object.entries(NAME_LIST_FAIL_DIRECTION_TESTS),
    );
    for (const [key, value] of Object.entries(ruleSet)) {
      if (key === "version") continue;
      if (typeof value === "string") continue;
      if (Array.isArray(value)) {
        // The four `*ProofSignals` lists are covered by their predicate's row below.
        // The list is the predicate's parameter, and the predicate is what turns it
        // into a verdict.
        //
        // Every other name list is a gate in its own right and needs its own named
        // test. `passiveEventNames` decides whether a `$pageview` may be named as the
        // action an exception broke, and that decision is the difference between a
        // passing `broken` verdict and silence. A blanket `continue` here would have
        // exempted it without anybody choosing to. The exact shape of silent miss this
        // file exists to prevent.
        if (PROOF_SIGNAL_KEY.test(key)) continue;
        if (!declaredNameLists.has(key)) {
          throw new Error(
            `\`${key}\` is a rule-set name list with no declared fail-direction test (FR-22, FR-9). ` +
              `Add its row to NAME_LIST_FAIL_DIRECTION_TESTS and write the test it names — a name ` +
              `list that decides which claims reach a founder fails in a direction just as a ` +
              `magnitude does.`,
          );
        }
        continue;
      }
      if (typeof value !== "number") {
        throw new Error(
          `\`${key}\` is a rule-set member this test cannot classify. Decide whether it is a ` +
            `threshold (and name its fail-direction test) — do not let it fall through unclassified.`,
        );
      }
      if (!declaredThresholds.has(key)) {
        throw new Error(
          `\`${key}\` is a threshold with no declared fail-direction test (FR-22, FR-9). ` +
            `Add its row to THRESHOLD_FAIL_DIRECTION_TESTS and write the test it names.`,
        );
      }
    }
    for (const key of declaredThresholds.keys()) {
      expect(Object.keys(ruleSet)).toContain(key);
    }
    for (const key of declaredNameLists.keys()) {
      expect(Object.keys(ruleSet)).toContain(key);
    }

    // -- every predicate is declared, and nothing declared is stale
    const predicateKeys = Object.keys(PROOF_PREDICATES);
    const declaredPredicates = new Map<string, FailDirectionEvidence>(
      Object.entries(PREDICATE_FAIL_DIRECTION_TESTS),
    );
    for (const key of predicateKeys) {
      if (!declaredPredicates.has(key)) {
        throw new Error(
          `\`${key}\` is a registered proof predicate with no declared fail-direction test (FR-22). ` +
            `Add its row to PREDICATE_FAIL_DIRECTION_TESTS and write the test it names.`,
        );
      }
    }
    for (const key of declaredPredicates.keys()) {
      expect(predicateKeys).toContain(key);
    }

    // -- every declared test must state a direction and actually exist
    const rows: [string, FailDirectionEvidence][] = [
      ...[...declaredThresholds].map(([key, row]): [string, FailDirectionEvidence] => [
        `threshold \`${key}\``,
        row,
      ]),
      ...[...declaredNameLists].map(([key, row]): [string, FailDirectionEvidence] => [
        `name list \`${key}\``,
        row,
      ]),
      ...[...declaredPredicates].map(([key, row]): [string, FailDirectionEvidence] => [
        `predicate \`${key}\``,
        row,
      ]),
    ];

    const missing: string[] = [];
    for (const [subject, row] of rows) {
      // A row may not be re-pointed at a happy-path test to go green: the name it names
      // has to read as a fail direction.
      if (!FAIL_DIRECTION.test(row.test)) {
        throw new Error(
          `${subject} names "${row.test}", which states no fail direction. FR-9 requires the ` +
            `covering test's NAME to say which way the threshold fails.`,
        );
      }

      const names = suite.names.get(row.file);
      if (!names) {
        throw new Error(
          `${subject} points at __tests__/${row.file}, which is not part of this suite. ` +
            `The coverage map has rotted — repoint it at the file that now holds the test.`,
        );
      }
      if (!names.includes(row.test)) {
        missing.push(`${subject} — no test named "${row.test}" in __tests__/${row.file}`);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `FR-22 / FR-9: every threshold and every predicate needs at least one test whose NAME ` +
          `states its fail direction. These are missing:\n` +
          missing.map((line) => `  - ${line}`).join("\n") +
          `\nWrite the named test. Softening this map to go green would leave the magnitude's ` +
          `declared under-detect direction asserted by nothing.`,
      );
    }

    expect(missing).toEqual([]);
  });
});

// -- the coverage map
//
// Everything above is enumerated. This is the one thing that cannot be: which test
// covers which threshold is a human claim, so it is written down once and then verified
// from both ends. The subject list comes from the rule set and the predicate registry
// (a new one is a compile error here), and the test name must really exist, in the file
// this map says it lives in.

/** The name of the test that states a subject's fail direction, and its home. */
type FailDirectionEvidence = {
  /** Verbatim `test` name. */
  readonly test: string;
  /** Posix-relative to `__tests__`. */
  readonly file: string;
};

/** The numeric members of the rule set, minus its own identity. */
type NumericMembers<T> = {
  [K in keyof T]-?: T[K] extends number ? K : never;
}[keyof T];
type ThresholdKey = Exclude<NumericMembers<ThresholdRuleSet>, "version">;

/**
 * The rule set's name lists, minus the four `*ProofSignals` lists that their
 * predicate's row already covers. What is left is a list that decides a verdict on its
 * own (today exactly one, `passiveEventNames`) and the `Record<NameListKey, …>` below
 * makes a second one a `bun run typecheck` failure before it is a test failure.
 */
type NameListMembers<T> = {
  [K in keyof T]-?: T[K] extends readonly string[] ? K : never;
}[keyof T];
type NameListKey = Exclude<NameListMembers<ThresholdRuleSet>, `${string}ProofSignals`>;

/** The runtime half of that exclusion. See the enumeration in test 2. */
const PROOF_SIGNAL_KEY = /ProofSignals$/;

/**
 * A name that reads as a fail direction. Deliberately a small, fixed vocabulary: the
 * point is that a reader scanning the suite can see which way the magnitude fails
 * without opening the file.
 */
const FAIL_DIRECTION =
  /\b(?:not|never|no|without|outside|below|unsatisfied)\b|\b(?:drop|downgrade|reject|refuse)\w*/i;

/**
 * Typed `Record<ThresholdKey, …>` so a threshold added to `ThresholdRuleSet` without a
 * fail-direction test fails `bun run typecheck` before it fails here.
 */
const THRESHOLD_FAIL_DIRECTION_TESTS: Record<ThresholdKey, FailDirectionEvidence> = {
  errorCorrelationWindowMs: {
    test: "should not correlate an exception outside the window",
    file: "detect/error-event.test.ts",
  },
  errorMinAffectedSessions: {
    test: "should not fire below errorMinAffectedSessions",
    file: "detect/error-event.test.ts",
  },
  funnelMinSessionsAtOrigin: {
    test: "should not fire below funnelMinSessionsAtOrigin regardless of rate",
    file: "detect/funnel-dropoff.test.ts",
  },
  funnelMinDropoffSessions: {
    test: "should not fire below funnelMinDropoffSessions",
    file: "detect/funnel-dropoff.test.ts",
  },
  funnelDropoffRateThresholdPercent: {
    test: "should not fire at one below funnelDropoffRateThreshold",
    file: "detect/funnel-dropoff.test.ts",
  },
  struggleRepeatedAttemptMin: {
    test: "should not satisfy confusing proof below struggleRepeatedAttemptMin",
    file: "evidence/predicates.test.ts",
  },
  struggleMinStrugglingSessions: {
    test: "should not satisfy confusing proof below struggleMinStrugglingSessions",
    file: "evidence/predicates.test.ts",
  },
  instrumentationDropRatioPercent: {
    test: "should drop instrumentation when the rate does not cross its threshold",
    file: "evidence/gate.test.ts",
  },
  instrumentationMinExpected: {
    test: "should not satisfy instrumentation proof below instrumentationMinExpected",
    file: "evidence/predicates.test.ts",
  },
};

/**
 * Typed `Record<NameListKey, …>` for the same reason as the map above: a name list
 * added to `ThresholdRuleSet` without a fail-direction test fails `bun run typecheck`
 * before it fails here.
 */
const NAME_LIST_FAIL_DIRECTION_TESTS: Record<NameListKey, FailDirectionEvidence> = {
  passiveEventNames: {
    test: "should not name a passive page event as the action an exception broke",
    file: "detect/error-event.test.ts",
  },
  userInitiatedVendorEvents: {
    test: "should not name an unlisted vendor event as the action an exception broke",
    file: "detect/error-event.test.ts",
  },
};

/**
 * Keyed by `FindingClass` (the key `PROOF_PREDICATES` itself is keyed by) so a fifth
 * class cannot arrive without declaring how its predicate fails.
 *
 * A row may repeat a threshold's test: one test name can legitimately state both the
 * predicate's direction and its magnitude's, and forcing a distinct name per subject
 * would manufacture a gap rather than find one.
 */
const PREDICATE_FAIL_DIRECTION_TESTS: Record<FindingClass, FailDirectionEvidence> = {
  broken: {
    test: "should NOT satisfy broken proof from a failure_uncorrelated signal",
    file: "evidence/predicates.test.ts",
  },
  confusing: {
    test: "should downgrade confusing when no struggle signal exists",
    file: "evidence/gate.test.ts",
  },
  changed_mind: {
    test: "should drop changed_mind when an error or struggle signal is present",
    file: "evidence/gate.test.ts",
  },
  instrumentation: {
    test: "should drop instrumentation when the rate does not cross its threshold",
    file: "evidence/gate.test.ts",
  },
};

/** The v1 rule set fetched by version, never as "whatever is current". */
function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}
