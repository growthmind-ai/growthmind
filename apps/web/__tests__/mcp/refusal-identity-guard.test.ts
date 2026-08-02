import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const MCP_TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

const IDENTITY_SUITES = [
  "cross-tenant.test.ts",
  "cross-tenant-real-keys.test.ts",
  "credentials.test.ts",
  "api-key-credentials.test.ts",
] as const;

const BANNED_TOKENS = ["toMatchObject", "objectContaining", "JSON.parse("] as const;

function blankNonCode(source: string): string {
  const out: string[] = [];
  let index = 0;

  const blankTo = (end: number): void => {
    for (let i = index; i < end; i += 1) {
      out.push(source[i] === "\n" ? "\n" : " ");
    }
    index = end;
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const stop = source.indexOf("\n", index);
      blankTo(stop === -1 ? source.length : stop);
      continue;
    }

    if (char === "/" && next === "*") {
      const stop = source.indexOf("*/", index + 2);
      blankTo(stop === -1 ? source.length : stop + 2);
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === char) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      blankTo(Math.min(cursor, source.length));
      continue;
    }

    out.push(char as string);
    index += 1;
  }

  return out.join("");
}

interface Occurrence {
  readonly token: string;
  readonly line: number;
}

function findBannedTokens(source: string): readonly Occurrence[] {
  const code = blankNonCode(source);
  const found: Occurrence[] = [];

  for (const token of BANNED_TOKENS) {
    let from = code.indexOf(token);
    while (from !== -1) {
      found.push({ token, line: code.slice(0, from).split("\n").length });
      from = code.indexOf(token, from + token.length);
    }
  }

  return found.toSorted((left, right) => left.line - right.line);
}

function readSuite(fileName: string): string {
  return readFileSync(path.join(MCP_TESTS_DIR, fileName), "utf8");
}

describe("WIRE-R10 — the identity suites compare raw bytes and nothing has loosened them", () => {
  test("no identity suite compares a refusal with a partial or parsed match", () => {
    const offenders: string[] = [];

    for (const fileName of IDENTITY_SUITES) {
      for (const occurrence of findBannedTokens(readSuite(fileName))) {
        offenders.push(
          `apps/web/__tests__/mcp/${fileName}:${occurrence.line} uses \`${occurrence.token}\``,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the scanner finds all three banned tokens in a known-positive control", () => {
    const control = [
      "expect(body).toMatchObject({ ok: true });",
      "expect(body).toEqual(expect.objectContaining({ ok: true }));",
      "expect(JSON.parse(print.body)).toEqual(frozen);",
    ].join("\n");

    expect(findBannedTokens(control).map((entry) => entry.token)).toEqual([
      "toMatchObject",
      "objectContaining",
      "JSON.parse(",
    ]);
  });

  test("the scanner ignores a banned token in a comment or a string, and only there", () => {
    const commented = "// this row uses toEqual rather than toMatchObject on purpose\nconst a = 1;";
    const stringy = 'const note = "JSON.parse( is banned here";';
    const live = 'const url = "http://example.test/a"; expect(b).toMatchObject({});';

    expect(findBannedTokens(commented)).toEqual([]);
    expect(findBannedTokens(stringy)).toEqual([]);

    expect(findBannedTokens(live)).toEqual([{ token: "toMatchObject", line: 1 }]);
  });

  test("reads all four identity suites, and none of them is empty", () => {
    for (const fileName of IDENTITY_SUITES) {
      expect(readSuite(fileName).length).toBeGreaterThan(0);
    }
  });
});
