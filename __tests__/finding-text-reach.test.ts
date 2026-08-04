import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const APPLICATION = /^(apps|packages|scripts|worker)\//;

const SKIPPED = [
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)__tests__\//,
  /^packages\/db\/drizzle\//,
  /\.d\.ts$/,
];

const SCHEMA_MODULE = "packages/db/src/schema/findings";

// The table's own directory declares it and wires its foreign keys; it reads no row.
const SCHEMA_DIR = "packages/db/src/schema/";

const GATE_FILES = [
  "packages/db/src/repositories/findings.repo.ts",
  "packages/db/src/services/fixes.service.ts",
  "packages/db/src/services/growth-context.service.ts",
] as const;

const GATE_CALL = "readFindingText(";

const GATE_MODULE = "packages/db/src/repositories/finding-text.ts";

const MINT_MODULE = "packages/core/src/delivery/finding-text.ts";

const SEED_HELPER = "seedUnscannedFinding";

const SEED_HOME = "packages/db/src/testing/fixtures.ts";

const COLUMN_READ = /\bfindings\s*\.\s*(?:headline|context)\b/;

const SCANNED_DIRS = ["packages/db/src/repositories", "packages/db/src/services"] as const;

interface Exemption {
  readonly file: string;
  readonly why: string;
}

const EXEMPT: readonly Exemption[] = [];

function isExempt(entry: Exemption): boolean {
  return entry.why.trim().length > 0;
}

function blank(target: string[], from: number, to: number): void {
  for (let index = from; index < to && index < target.length; index += 1) {
    if (target[index] !== "\n") target[index] = " ";
  }
}

interface StrippedSource {
  readonly withoutComments: string;
  readonly codeOnly: string;
}

function stripSource(source: string): StrippedSource {
  const withoutComments = [...source];
  const codeOnly = [...source];

  let cursor = 0;
  while (cursor < source.length) {
    const pair = source.slice(cursor, cursor + 2);

    if (pair === "//") {
      const lineEnd = source.indexOf("\n", cursor);
      const stop = lineEnd === -1 ? source.length : lineEnd;
      blank(withoutComments, cursor, stop);
      blank(codeOnly, cursor, stop);
      cursor = stop;
      continue;
    }

    if (pair === "/*") {
      const close = source.indexOf("*/", cursor + 2);
      const stop = close === -1 ? source.length : close + 2;
      blank(withoutComments, cursor, stop);
      blank(codeOnly, cursor, stop);
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
      blank(codeOnly, cursor, scan);
      cursor = scan;
      continue;
    }

    cursor += 1;
  }

  return { withoutComments: withoutComments.join(""), codeOnly: codeOnly.join("") };
}

function sourceFiles(): readonly string[] {
  const found: string[] = [];
  for (const entry of new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: ROOT })) {
    const file = entry.replaceAll("\\", "/");
    if (!APPLICATION.test(file)) continue;
    if (SKIPPED.some((pattern) => pattern.test(file))) continue;
    found.push(file);
  }
  return found.toSorted();
}

function testFiles(): readonly string[] {
  const found: string[] = [];
  for (const entry of new Bun.Glob("**/__tests__/**/*.{ts,tsx}").scanSync({ cwd: ROOT })) {
    const file = entry.replaceAll("\\", "/");
    if (/(^|\/)node_modules\//.test(file)) continue;
    found.push(file);
  }
  return found.toSorted();
}

function read(file: string): string {
  return readFileSync(`${ROOT}/${file}`, "utf8");
}

function code(file: string): string {
  return stripSource(read(file)).codeOnly;
}

function importSpecifiers(source: string): readonly string[] {
  const { withoutComments } = stripSource(source);
  const found: string[] = [];

  for (const statement of withoutComments.match(/^[ \t]*(?:import|export)\b[^;]*;/gm) ?? []) {
    const fromClause = /\bfrom\s*["']([^"']+)["']/.exec(statement);
    if (fromClause?.[1] !== undefined) found.push(fromClause[1]);
  }

  return found;
}

function importsSchemaFindings(file: string): boolean {
  const dir = file.slice(0, file.lastIndexOf("/"));
  return importSpecifiers(read(file)).some((specifier) => {
    if (!specifier.startsWith(".")) return false;
    return path.posix.normalize(`${dir}/${specifier}`).replace(/\.ts$/, "") === SCHEMA_MODULE;
  });
}

function present(file: string): { file: string; present: boolean } {
  return { file, present: existsSync(`${ROOT}/${file}`) };
}

describe("finding text reaches no reader outside the residual-PII gate", () => {
  test("a repo-wide scan finds no code path reading findings.headline or findings.context outside the residual-PII gate", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(0);

    const declaring = files.filter((file) => file.startsWith(SCHEMA_DIR));
    expect(declaring).toContain(`${SCHEMA_MODULE}.ts`);

    const importers = files.filter(
      (file) => !file.startsWith(SCHEMA_DIR) && importsSchemaFindings(file),
    );
    expect(importers).toEqual([...GATE_FILES]);

    const blankWhy = EXEMPT.filter((entry) => !isExempt(entry)).map((entry) => entry.file);
    expect(blankWhy).toEqual([]);
    expect(isExempt({ file: GATE_MODULE, why: "   " })).toBe(false);

    const allowed = new Set<string>([...GATE_FILES, ...EXEMPT.filter(isExempt).map((e) => e.file)]);

    const bare: string[] = [];
    for (const file of files) {
      if (allowed.has(file)) continue;
      code(file)
        .split("\n")
        .forEach((line, index) => {
          if (COLUMN_READ.test(line)) bare.push(`${file}:${index + 1}`);
        });
    }
    expect(bare).toEqual([]);

    const ungated = importers.filter((file) => !code(file).includes(GATE_CALL));
    expect(ungated).toEqual([]);
  });

  test("a fixture reader that accesses findings.headline as a bare string is reported by the scan", () => {
    const planted = "const rows = await db.select({ headline: findings.headline }).from(findings);";
    const clean = "const text = readFindingText(row);";
    const prose = '// headline: findings.headline\nconst why = "findings.context";';

    expect(COLUMN_READ.test(stripSource(planted).codeOnly)).toBe(true);
    expect(COLUMN_READ.test(stripSource(clean).codeOnly)).toBe(false);
    expect(COLUMN_READ.test(stripSource(prose).codeOnly)).toBe(false);

    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(3);

    for (const dir of SCANNED_DIRS) {
      const named = readdirSync(`${ROOT}/${dir}`).filter((name) => name.endsWith(".ts"));
      expect(named.length).toBeGreaterThan(0);
      for (const name of named) expect(files).toContain(`${dir}/${name}`);
    }

    expect(present(GATE_MODULE)).toEqual({ file: GATE_MODULE, present: true });
    expect(code(GATE_MODULE)).toContain(`export function ${GATE_CALL}`);
  });

  test("ScannedText is asserted in exactly one non-test source file, and the seed helper that writes an unscanned row is used only from tests", () => {
    const files = sourceFiles();

    const asserting = files.filter((file) => /\bas\s+ScannedText\b/.test(code(file)));
    expect(asserting).toEqual([MINT_MODULE]);

    const seeding = files.filter((file) => code(file).includes(SEED_HELPER));
    expect(seeding).toEqual([SEED_HOME]);

    const exercised = testFiles().filter((file) => code(file).includes(SEED_HELPER));
    expect(exercised.length).toBeGreaterThan(0);
  });
});
