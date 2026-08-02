import { describe, expect, test } from "bun:test";

import { PROOF_PREDICATES } from "../src/evidence/predicates";
import * as barrel from "../src/index";
import { THRESHOLD_RULE_SETS } from "../src/rules/thresholds";
import type { FindingClass, ThresholdRuleSet } from "../src/rules/types";

const TESTS_ROOT = import.meta.dir;
const BARREL_PATH = `${TESTS_ROOT}/../src/index.ts`;

function slash(value: string): string {
  return value.replaceAll("\\", "/");
}

const SELF = "coverage.test.ts";

type TestSuite = {
  readonly files: readonly string[];

  readonly sources: ReadonlyMap<string, string>;

  readonly names: ReadonlyMap<string, readonly string[]>;
};

let suiteCache: TestSuite | null = null;

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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

type ParsedBarrel = {
  readonly valueExports: ReadonlyMap<string, string>;

  readonly residue: string;
};

async function parseBarrel(): Promise<ParsedBarrel> {
  const code = stripComments(await Bun.file(BARREL_PATH).text());
  const block = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']\s*;?/g;

  const valueExports = new Map<string, string>();
  let residue = code;
  let match: RegExpExecArray | null;
  while ((match = block.exec(code)) !== null) {
    residue = residue.replace(match[0], " ");
    if (match[1]) continue;

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
  test("should have a test file for every exported pure function in packages/core", async () => {
    const { valueExports, residue } = await parseBarrel();
    const suite = await readSuite();

    expect(valueExports.size).toBeGreaterThan(0);
    expect(suite.files.length).toBeGreaterThan(0);
    expect(Object.keys(runtimeBarrel).length).toBeGreaterThan(0);

    expect(residue).not.toMatch(/\bexport\b/);

    expect([...valueExports.keys()].toSorted()).toEqual(Object.keys(runtimeBarrel).toSorted());

    const functions = [...valueExports].filter(
      ([name]) => typeof runtimeBarrel[name] === "function",
    );
    expect(functions.length).toBeGreaterThan(0);

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

  test("should have at least one test whose name states a fail direction for every threshold and predicate", async () => {
    const suite = await readSuite();
    const ruleSet = ruleSetV1();

    expect(suite.files.length).toBeGreaterThan(0);
    expect(Object.keys(ruleSet).length).toBeGreaterThan(0);
    expect(Object.keys(PROOF_PREDICATES).length).toBeGreaterThan(0);

    for (const file of suite.files) {
      expect((suite.names.get(file) ?? []).length).toBeGreaterThan(0);
    }

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

type FailDirectionEvidence = {
  readonly test: string;

  readonly file: string;
};

type NumericMembers<T> = {
  [K in keyof T]-?: T[K] extends number ? K : never;
}[keyof T];
type ThresholdKey = Exclude<NumericMembers<ThresholdRuleSet>, "version">;

type NameListMembers<T> = {
  [K in keyof T]-?: T[K] extends readonly string[] ? K : never;
}[keyof T];
type NameListKey = Exclude<NameListMembers<ThresholdRuleSet>, `${string}ProofSignals`>;

const PROOF_SIGNAL_KEY = /ProofSignals$/;

const FAIL_DIRECTION =
  /\b(?:not|never|no|without|outside|below|unsatisfied)\b|\b(?:drop|downgrade|reject|refuse)\w*/i;

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

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}
