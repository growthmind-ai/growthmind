import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "bun:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CORE_ROOT = path.join(HERE, "..", "..");

const DB_ROOT = path.join(CORE_ROOT, "..", "db");

const REPO_ROOT = path.join(CORE_ROOT, "..", "..");

function relativeToRepoRoot(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
}

function stripComments(source: string): string {
  const chars = [...source];
  let cursor = 0;

  while (cursor < source.length) {
    const pair = source.slice(cursor, cursor + 2);

    if (pair === "//") {
      const lineEnd = source.indexOf("\n", cursor);
      const stop = lineEnd === -1 ? source.length : lineEnd;
      for (let i = cursor; i < stop; i += 1) chars[i] = " ";
      cursor = stop;
      continue;
    }

    if (pair === "/*") {
      const close = source.indexOf("*/", cursor + 2);
      const stop = close === -1 ? source.length : close + 2;
      for (let i = cursor; i < stop; i += 1) {
        if (source[i] !== "\n") chars[i] = " ";
      }
      cursor = stop;
      continue;
    }

    const quote = source[cursor];
    if (quote === '"' || quote === "'" || quote === "`") {
      let scan = cursor + 1;
      while (scan < source.length) {
        if (source[scan] === "\\") {
          scan += 2;
          continue;
        }
        if (source[scan] === quote) {
          scan += 1;
          break;
        }
        scan += 1;
      }
      cursor = scan;
      continue;
    }

    cursor += 1;
  }

  return chars.join("");
}

const EXPORT_FUNCTION_HEAD = /^[ \t]*export\s+(?:async\s+)?function\s+(\w+)/gm;

function collectExportedFunctionNames(source: string): readonly string[] {
  const stripped = stripComments(source);
  const names: string[] = [];

  EXPORT_FUNCTION_HEAD.lastIndex = 0;
  let match: RegExpExecArray | null = EXPORT_FUNCTION_HEAD.exec(stripped);
  while (match !== null) {
    if (match[1] !== undefined) names.push(match[1]);
    match = EXPORT_FUNCTION_HEAD.exec(stripped);
  }

  return names;
}

const TEST_TITLE_CALL = /\b(?:test|it)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

function collectTestTitles(source: string): readonly string[] {
  const stripped = stripComments(source);
  const titles: string[] = [];

  TEST_TITLE_CALL.lastIndex = 0;
  let match: RegExpExecArray | null = TEST_TITLE_CALL.exec(stripped);
  while (match !== null) {
    if (match[2] !== undefined) titles.push(match[2]);
    match = TEST_TITLE_CALL.exec(stripped);
  }

  return titles;
}

const EXPORT_SCANNER_FIXTURE = `
// export function fixtureCommentedOutFn: void {}
export function fixtureExportedFn(x: number): number {
  return x;
}

function fixtureInternalHelper(): void {}

export interface FixtureRepo {
  fixtureInterfaceMethod(): void;
}
`;

const TEST_TITLE_SCANNER_FIXTURE = `
// test("fixture commented-out test", => {});
describe("fixtureThing", () => {
  test("does the fixture thing", () => {});
  it('does another fixture thing', async () => {});
});
`;

describe("export-coverage guard — scanners are proven before being trusted", () => {
  it("collectExportedFunctionNames finds only the real top-level export, never the helper, the interface method, or the commented-out one", () => {
    expect(collectExportedFunctionNames(EXPORT_SCANNER_FIXTURE)).toEqual(["fixtureExportedFn"]);
  });

  it("collectTestTitles finds both quote styles and never a commented-out title", () => {
    const titles = collectTestTitles(TEST_TITLE_SCANNER_FIXTURE);
    expect(titles).toContain("does the fixture thing");
    expect(titles).toContain("does another fixture thing");
    expect(titles).not.toContain("fixture commented-out test");
    expect(titles).toHaveLength(2);
  });
});

interface ModuleSpec {
  readonly sourcePath: string;
  readonly testPath: string;
}

const MODULES: readonly ModuleSpec[] = [
  {
    sourcePath: path.join(CORE_ROOT, "src", "findings", "signature-tuple.ts"),
    testPath: path.join(CORE_ROOT, "__tests__", "findings", "signature-tuple.test.ts"),
  },
  {
    sourcePath: path.join(CORE_ROOT, "src", "findings", "suppression-policy.ts"),
    testPath: path.join(CORE_ROOT, "__tests__", "findings", "suppression-policy.test.ts"),
  },
  {
    sourcePath: path.join(DB_ROOT, "src", "signatures", "hex.ts"),
    testPath: path.join(DB_ROOT, "__tests__", "signatures", "hex.test.ts"),
  },
  {
    sourcePath: path.join(DB_ROOT, "src", "repositories", "finding-signatures.repo.ts"),
    testPath: path.join(DB_ROOT, "__tests__", "repositories", "finding-signatures.repo.test.ts"),
  },
  {
    sourcePath: path.join(DB_ROOT, "src", "repositories", "dismissals.repo.ts"),
    testPath: path.join(DB_ROOT, "__tests__", "repositories", "dismissals.repo.test.ts"),
  },
  {
    sourcePath: path.join(DB_ROOT, "src", "repositories", "signature-ancestry.repo.ts"),
    testPath: path.join(DB_ROOT, "__tests__", "repositories", "signature-ancestry.repo.test.ts"),
  },
  {
    sourcePath: path.join(DB_ROOT, "src", "services", "signature-ledger.service.ts"),
    testPath: path.join(DB_ROOT, "__tests__", "services", "signature-ledger.service.test.ts"),
  },
];

const EXPECTED_TEST_TITLES: ReadonlyMap<string, string> = new Map([
  [
    "signatureTuple",
    "should throw for an unregistered tuple version rather than falling back to current",
  ],
  [
    "suppressionDecision",
    "should return suppress with reason dismissed when the row carries dismissed_at",
  ],
  ["isSignatureHex", "returns true for a well-formed 64-char lowercase hex string"],
  ["signatureHex", "refuses uppercase hex"],
  ["sha256Hex", "returns a 64-char lowercase hex digest for an opaque material string"],
  ["signatureDisplayPrefix", "(P1) is display-only and is never accepted as a lookup input"],
  [
    "createFindingSignaturesRepo",
    "creates one row and increments times_seen to 2 when the same signature is recorded twice",
  ],
  [
    "carryForwardValues",
    "carries the old ledger row's provenance and lifetime state onto the new signature without naming an organization",
  ],
  [
    "createDismissalsRepo",
    "writes one dismissal row and returns the same result when the dismissal path is called twice with the same payload",
  ],
  [
    "createSignatureAncestryRepo",
    "resolves to the input signature against an EMPTY ancestry table",
  ],
  [
    "computeFindingSignature",
    "reproduces a committed golden hex digest for the W0-5 fixture input",
  ],
  [
    "createSignatureLedgerService",
    "records, delivers, suppresses, dismisses, and stays suppressed for a teammate through the real repository entry points",
  ],
]);

describe("export coverage guard — every exported function has a named test (FR-J)", () => {
  it("enumerates more than zero exports across the modules and finds signatureTuple and suppressionDecision by name", () => {
    const allExports = MODULES.flatMap((mod) =>
      collectExportedFunctionNames(readFileSync(mod.sourcePath, "utf8")),
    );

    expect(allExports.length).toBeGreaterThan(0);
    expect(allExports).toContain("signatureTuple");
    expect(allExports).toContain("suppressionDecision");
  });

  it("declares no exported function the manifest and its test file cannot account for", () => {
    const offenders: string[] = [];
    let totalExports = 0;

    for (const mod of MODULES) {
      const source = readFileSync(mod.sourcePath, "utf8");
      const exportedNames = collectExportedFunctionNames(source);

      expect(exportedNames.length).toBeGreaterThan(0);
      totalExports += exportedNames.length;

      const testSource = readFileSync(mod.testPath, "utf8");
      const actualTitles = new Set(collectTestTitles(testSource));

      for (const exportName of exportedNames) {
        const expectedTitle = EXPECTED_TEST_TITLES.get(exportName);

        if (expectedTitle === undefined) {
          offenders.push(
            `Missing manifest entry for exported function \`${exportName}\` in ` +
              `${relativeToRepoRoot(mod.sourcePath)} — add an EXPECTED_TEST_TITLES entry ` +
              `naming a real test title in ${relativeToRepoRoot(mod.testPath)}.`,
          );
          continue;
        }

        if (!actualTitles.has(expectedTitle)) {
          offenders.push(
            `Missing test for \`${exportName}\` — expected a test titled ` +
              `\`${expectedTitle}\` in ${relativeToRepoRoot(mod.testPath)}.`,
          );
        }
      }
    }

    expect(totalExports).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("carries no manifest entry for a function no module exports anymore", () => {
    const allExports = new Set(
      MODULES.flatMap((mod) => collectExportedFunctionNames(readFileSync(mod.sourcePath, "utf8"))),
    );
    const stale = [...EXPECTED_TEST_TITLES.keys()].filter((name) => !allExports.has(name));

    expect(stale).toEqual([]);
  });
});
