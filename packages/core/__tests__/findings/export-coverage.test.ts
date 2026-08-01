// Fr-j, the self-enumerating export-coverage guard for the five modules (add
// tasks/signature-ledger/add.md "Self-enumerating guard").
//
// Why this exists. A previous sprint's version of this guard named two missing test
// titles verbatim on resume from a dead, context-exhausted agent, which turned a lost
// session into a two-line brief instead of a re-audit of the whole diff. The value of
// this file is entirely in the quality of its failure message. A bare "3 exports lack
// tests" would have been useless for that resume; "Missing test for `resolveSignature`.
// Expected a test titled `should resolve …`" is what makes the guard worth having.
// Every failure path below names the missing test title verbatim.
//
// Why this file lives in `packages/core/__tests__`, not `packages/db`. the five modules
// span two packages, and `packages/core -> packages/db` is a forbidden import direction
// (add c-c). A test file is bound by the same rule if it imports the other package's
// runtime code. But this file never imports `@growthmind/db`; it reads db's source and
// test files off disk with `node:fs`, exactly the way `packages/core/__tests__/detect/
// purity.test.ts` reads its own package's files with `Bun.file` to scan them without
// becoming an import. A disk read is not a module import. Nothing resolves through
// Node's module graph, nothing crosses the dependency arrow this add polices.
// `packages/core` is the chosen home (rather than `packages/db`) because the
// checklist already pins this exact path
// (`packages/core/__tests__/findings/export-coverage.test.ts`) and because
// `packages/core/src/findings` is where the identity half of the ledger's contract is
// defined; the guard reading outward from there to verify the persistence half
// (`packages/db`) is no different in kind from `no-org-param.test.ts` reading two
// directories (`repositories/`, `services/`) from one test file.
//
// What counts as "an exported function" HERE. Only top-level `export function` /
// `export async function` declarations, never a type, an exported `const`, or a method
// signature declared inside an exported `interface`. The five service entry points
// (`recordSignature`, `consultSignature`, `markSignatureDelivered`, `recordDismissal`,
// `recordAncestry`) and the four repository methods on each of the three repos are
// `SignatureLedgerService`/`*Repo` interface methods, implemented as object-literal
// properties inside their factory's returned object. They are not standalone exported
// functions, so this guard does not enumerate them individually. Every one of them is
// still covered: T-E2E-1 and the per-repository integration suites exercise all nine
// through the one function this guard does enumerate for each file. The factory
// (`createFindingSignaturesRepo`, `createDismissalsRepo`,
// `createSignatureAncestryRepo`, `createSignatureLedgerService`).
//
// How a miss is detected, not just a count. `EXPECTED_TEST_TITLES` is a manifest.
// Export name -> the literal, currently-passing test title that proves that export is
// tested (titles copied verbatim from the real test files, verified present before this
// guard shipped). The guard:
// 1. Scans each module's source file and derives its exported function
//  names — never a hand-maintained list, so a function added to one of
//  these six files after this guard was written is picked up
//  automatically next run.
// 2. For each discovered name with NO manifest entry, fails with an
//  instruction to add one (a new export the manifest has never heard of
//  is itself the gap — this is what makes the guard "self-enumerating"
//  rather than a static checklist).
// 3. For each discovered name with a manifest entry, reads that entry's
//  test file off disk and checks the exact title is present among its
//  `test`/`it` calls. A miss fails with the exact title
//  expected, quoted, next to the file it belongs in.
// 4. A companion assertion catches manifest rot the other way: an entry
//  naming a function no module exports anymore.
//
// Precedents followed (both cited by the add for this exact file):
// `packages/db/__tests__/repositories/no-org-param.test.ts`, parse
//  Declarations with comments stripped, never grep raw text; prove
//  non-vacuity with named anti-vacuity blocks before trusting the scan.
// `packages/core/__tests__/detect/purity.test.ts`, prove the scanner
//  Before trusting it, on paired fixtures (a case that must be found, a
//  structurally similar case — here, a comment — that must not be).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "bun:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `packages/core`, this file's own package root. */
const CORE_ROOT = path.join(HERE, "..", "..");
/** `packages/db`, a sibling package root, read from disk only, never imported (see
 * header). */
const DB_ROOT = path.join(CORE_ROOT, "..", "db");
/** Repo root, used only to print short, stable paths in failure messages. */
const REPO_ROOT = path.join(CORE_ROOT, "..", "..");

function relativeToRepoRoot(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
}

// Part 1, the two scanners, each proven on fixtures before being trusted

/**
 * Blanks `//` and `/* *‍/` comments to spaces (preserving length and newlines, so
 * line-anchored regexes still line up), while leaving string literals untouched. A
 * title inside a string must survive; prose inside a comment claiming to declare an
 * export or a test must not be mistaken for one. Ported from the `no-org-param.test.ts`
 * / `purity.test.ts` precedent's `stripSource`, narrowed to the one view
 * (`withoutComments`) this file needs for both of its scans.
 */
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
      // Skip over the string's content untouched. Titles and specifiers live inside
      // these and must survive for the caller to read.
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

/** A top-level `export function` / `export async function` declaration's name, anchored
 * at the start of a line (with only leading whitespace) so an indented object-literal
 * method (e.g. a repo factory's returned `async upsertSeen {`) can never match.
 * Those are interface implementations, not exported function declarations (see header). */
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

/** Every literal string title passed as the first argument to `test` or `it`
 * in a test file. Quote-agnostic. */
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

// Scanner self-proof (purity.test.ts's "prove it before you trust it")

/** Must be found: a real top-level exported function. Must not be found: a non-exported
 * helper, an interface method, and a commented-out export that only looks like a
 * declaration once comments are stripped incorrectly. */
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

/** Must be found: both a \`test\` and an \`it\` title, single- and
 * double-quoted. Must not be found: a commented-out test's title. */
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

// Part 2, the six modules, and the manifest of what proves them tested

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

/**
 * export name -> the literal test title that proves it is tested, copied verbatim from
 * the real, currently-green test files (confirmed present before this guard shipped).
 * Every title here is a `test`/`it` call's first argument,
 * character-for-character.
 */
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

// Part 3, the guard itself

describe("export coverage guard — every exported function has a named test (FR-J)", () => {
  it("enumerates more than zero exports across the modules and finds signatureTuple and suppressionDecision by name", () => {
    const allExports = MODULES.flatMap((mod) =>
      collectExportedFunctionNames(readFileSync(mod.sourcePath, "utf8")),
    );

    // Non-vacuity: if the scan silently matched nothing. A wrong path, a regex
    // that stopped matching this codebase's style. Every assertion below would pass on
    // an empty set and mean nothing.
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

      // Anti-vacuity per module: a wrong `sourcePath` reads real bytes but finds zero
      // exports, which would silently drop that file out of the guard's coverage with
      // no assertion noticing.
      expect(exportedNames.length).toBeGreaterThan(0);
      totalExports += exportedNames.length;

      const testSource = readFileSync(mod.testPath, "utf8");
      const actualTitles = new Set(collectTestTitles(testSource));

      for (const exportName of exportedNames) {
        const expectedTitle = EXPECTED_TEST_TITLES.get(exportName);

        if (expectedTitle === undefined) {
          // A new export this manifest has never heard of. This is the
          // "self-enumerating" half of the guard: it does not require someone to
          // remember to update a checklist when a seventh function is added to one of
          // these six files. The scan finds it, and its total absence from the manifest
          // IS the failure.
          offenders.push(
            `Missing manifest entry for exported function \`${exportName}\` in ` +
              `${relativeToRepoRoot(mod.sourcePath)} — add an EXPECTED_TEST_TITLES entry ` +
              `naming a real test title in ${relativeToRepoRoot(mod.testPath)}.`,
          );
          continue;
        }

        if (!actualTitles.has(expectedTitle)) {
          // The requirement this guard exists for: name the missing test title
          // verbatim, not a count.
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
    // The other direction of manifest rot: an export renamed or removed leaves a
    // permanently-vacuous row that can never fail, silently shrinking the guard's real
    // coverage while its test count looks unchanged.
    const allExports = new Set(
      MODULES.flatMap((mod) => collectExportedFunctionNames(readFileSync(mod.sourcePath, "utf8"))),
    );
    const stale = [...EXPECTED_TEST_TITLES.keys()].filter((name) => !allExports.has(name));

    expect(stale).toEqual([]);
  });
});
