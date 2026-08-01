// WIRE-R10, the row that keeps the crown jewel honest (rule 5).
//
// The claim: `the identity suites compare raw bytes and nothing has loosened them to a
// parsed comparison`.
//
// Why a source scan rather than a behavioural test
//
// This surface's central security property is that two refusals a caller must not be
// able to tell apart are not tellable apart. A fix id belonging to another organization
// answers with the same bytes as a fix id that does not exist, and a revoked credential
// answers with the same bytes as no credential at all. A refusal that varies is an
// oracle: it answers the question "does this id exist in some other tenant?" that the
// surface exists to refuse.
//
// The four suites below prove that by comparing `fingerprint`. Status, content type,
// and the response body as a raw string. The proof is only worth anything while the
// comparison stays whole. `toMatchObject` compares a subset. `expect.objectContaining`
// compares a subset. `JSON.parse` throws away key order, whitespace, and every byte the
// framing put around the payload, which under the pinned SSE framing is most of the
// answer. Each of the three is a plausible, well-meaning edit that leaves a green suite
// proving strictly less than it did the day before, with nothing to notice.
//
// No behavioural test can catch that, because the loosening does not change behaviour.
// It changes what the suite is willing to see. So this row reads the source text of the
// four files and fails if any of the three appears.
//
// Precedent: the source-text freeze proof in
// `packages/core/__tests__/findings/signature-tuple.test.ts`, and the self-enumerating
// `packages/db/__tests__/repositories/no-org-param.test.ts`. The second one also
// supplies the comment-stripping rule this file follows.
//
// The target set is fixed and written out, deliberately
//
// `WIRE-S3` and `WIRE-S4` self-enumerate, because their claims are about "anywhere in
// the workspace" and an enumerated list would shrink silently as files were added. This
// row's claim is the opposite: it is about four named suites, the ones carrying the
// byte-identity comparisons. Enumerating them means a rename or a move fails here,
// loudly, rather than quietly dropping a file out of the guard's reach.
//
// The five loosenings this row was authored against are gone
//
// ⚠️ an earlier version of this header listed five offenders by `file:line` and said
// the row was red on arrival. It was, once. As landed at `35d5e6f` three of the four
// suites carried a loosened comparison, two `JSON.parse(` sites in
// `api-key-credentials.test.ts` and three `toMatchObject` sites across
// `cross-tenant.test.ts` and `cross-tenant-real-keys.test.ts`, and waves 5.1 and 5.2
// removed all five. The line numbers are not repeated here because they no longer point
// at anything, and a `file:line` that resolves to unrelated code is worse than no
// reference at all.
//
// So this is now a guard that starts satisfied and must stay so. Red means a loosening
// was reintroduced, and the failure message names the file, the line and the token. The
// two `JSON.parse` sites were replaced by the fixture's `sseDataLines` / `sseDataLine`
// extractor. Reach for that, never for a parse. The three `toMatchObject` sites were
// non-vacuity halves and became whole comparisons. The way to make this row green is
// never to relax the list below.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const MCP_TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The four suites carrying the byte-identity comparisons. Repo-relative, so a failure
 * message names the file the way a person would type it.
 */
const IDENTITY_SUITES = [
  "cross-tenant.test.ts",
  "cross-tenant-real-keys.test.ts",
  "credentials.test.ts",
  "api-key-credentials.test.ts",
] as const;

/**
 * The three ways a whole-body comparison gets quietly narrowed. Not a style list: each
 * one leaves the suite green while it stops seeing the bytes the cross-tenant proof
 * rests on.
 */
const BANNED_TOKENS = ["toMatchObject", "objectContaining", "JSON.parse("] as const;

// The scanner

/**
 * Returns `source` with every comment and every string literal replaced by spaces,
 * character for character, with newlines preserved, so an offset into the result is an
 * offset into the original and a line number is exact.
 *
 * Why comments are excluded, with the case that forced it. `no-org-param.test.ts`
 * strips comments for the same reason and says so: prose about a token is not a use of
 * it. Here the case is live, `api-key-credentials.test.ts:152` carries a comment
 * explaining that the row uses a whole-object `toEqual` rather than `toMatchObject`, so
 * a fabricated row cannot hide inside a partial match. That comment argues for this
 * row's claim. A raw-text scan would fail on it and pressure its author to delete the
 * best explanation in the file. A guard that punishes the thing it is protecting.
 *
 * Why string literals are excluded too. A banned token inside a string is data, not an
 * assertion; it cannot loosen anything. Excluding them also keeps a URL or a JSON
 * fixture containing `//` from being mistaken for a comment opener and blanking the
 * rest of a line that might have carried a real occurrence.
 *
 * Known limit, stated rather than hidden: a regular-expression literal is treated as
 * code, so a regex containing an escaped `//` could confuse the comment detector. No
 * file in the target set contains one, and a banned token hidden inside a regex would
 * not be an assertion either.
 */
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

/** Every banned token appearing in the code of `source`, with its line. */
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

// WIRE-R10

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

    // Listed rather than counted, so the diff that fixes this row shows exactly which
    // comparison was narrowed and where.
    expect(offenders).toEqual([]);
  });

  // Non-vacuity, mandatory. A scanner that silently matches nothing passes forever, and
  // this one has two ways to become blind: a token could be mistyped, or `blankNonCode`
  // could over-blank and hand back an empty file.
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

  // The other half of non-vacuity: the exclusions must be narrow. If `blankNonCode`
  // blanked more than comments and string literals, the main assertion would pass on an
  // empty view of four real files.
  test("the scanner ignores a banned token in a comment or a string, and only there", () => {
    const commented = "// this row uses toEqual rather than toMatchObject on purpose\nconst a = 1;";
    const stringy = 'const note = "JSON.parse( is banned here";';
    const live = 'const url = "http://example.test/a"; expect(b).toMatchObject({});';

    expect(findBannedTokens(commented)).toEqual([]);
    expect(findBannedTokens(stringy)).toEqual([]);
    // The same line carries a `//` inside a string. A naive comment stripper would
    // blank the rest of the line and miss the real assertion after it.
    expect(findBannedTokens(live)).toEqual([{ token: "toMatchObject", line: 1 }]);
  });

  // A guard cannot pass by reading nothing. If one of the four is renamed or moved,
  // this fails on the name rather than shrinking the scan in silence.
  test("reads all four identity suites, and none of them is empty", () => {
    for (const fileName of IDENTITY_SUITES) {
      expect(readSuite(fileName).length).toBeGreaterThan(0);
    }
  });
});
