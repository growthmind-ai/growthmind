// AC-G13. The readout states two counts and asserts a verdict only where the number is
// unambiguous; whether "9 of 212" is good is the founder's judgement and not ours to fit a floor
// to. That ruling is held here rather than by intention — see
// .ai/decisions/0027-o-053-report-shipped-human-calls.md for the three magnitudes it permits.
import { existsSync, readFileSync } from "node:fs";

import type { ShippedLeadCount } from "@growthmind/shared";
import { SHIPPED_LEAD_COUNTS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { AtPageCorpus } from "../../src/shipped/corpus";
import { buildAtPageCorpus } from "../../src/shipped/corpus";
import { shippedCounts } from "../../src/shipped/counts";
import { renderShippedReadout } from "../../src/shipped/readout";
import { atPageInput, mustBuild, shippedCorpus } from "./fixtures";

const ROOT = new URL("../../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const SCANNED_GLOBS = [
  "packages/core/src/shipped/**/*.ts",
  "packages/shared/src/shipped/**/*.ts",
] as const;

const SCANNED_FILES = [
  "worker/src/tasks/shipped-readout-tick.ts",
  "packages/db/src/services/shipped-readout.service.ts",
] as const;

// The three Tom ratified, and nothing else may join them.
const RATIFIED_MAGNITUDES = [30, 10, 7] as const;

// Structural literals a count-free file cannot avoid: an index, a length, a first element.
const STRUCTURAL = new Set(["0", "1"]);

// The attribution and not only the record: a bare path reads as a citation, and what the clause
// has to carry is that a person chose the number rather than that it is written down somewhere.
const ADR_POINTER = /Chosen by Tom: see .*0027/;

const DECLARATION = /^export\s+const\s+[A-Z][A-Z0-9_]*(?::\s*number)?\s*=\s*(\d+)\s*;?$/;

// The words naming the thing a grade would judge — as against the denominator, which is what an
// eligibility floor gates on. Matched word by word rather than as substrings: "ratio" sits inside
// duration, iteration and generation, and "rate" inside generated and accurate.
const GRADE_WORDS = new Set([
  "numerator",
  "rate",
  "rates",
  "ratio",
  "ratios",
  "repeat",
  "repeats",
  "share",
  "shares",
  "percent",
  "percentage",
  "adoption",
]);

function wordsIn(operand: string): readonly string[] {
  return operand
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function isGradeOperand(operand: string): boolean {
  return wordsIn(operand).some((word) => GRADE_WORDS.has(word));
}

const COMPARISON_OPERATOR = "(?:<=|>=|===|!==|==|!=|<|>)";

const OPERAND = "[A-Za-z_$][A-Za-z0-9_$.\\[\\]\\s/*+\\-]";

// A named constant is a magnitude someone chose, so a grade read off one is the same offence as a
// grade read off a literal — and it is the spelling that leaves no digit behind to find.
const SCREAMING_CASE = "[A-Z][A-Z0-9_]{2,}(?:\\.[A-Z][A-Z0-9_]*)*";

const NUMBER_ON_THE_RIGHT = new RegExp(
  `(${OPERAND}{0,79}?)\\s*${COMPARISON_OPERATOR}\\s*(\\d+(?:\\.\\d+)?)`,
  "g",
);

const NUMBER_ON_THE_LEFT = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*${COMPARISON_OPERATOR}\\s*(${OPERAND}{0,79})`,
  "g",
);

const CONSTANT_ON_THE_RIGHT = new RegExp(
  `(${OPERAND}{0,79}?)\\s*${COMPARISON_OPERATOR}\\s*(${SCREAMING_CASE})`,
  "g",
);

const CONSTANT_ON_THE_LEFT = new RegExp(
  `(${SCREAMING_CASE})\\s*${COMPARISON_OPERATOR}\\s*(${OPERAND}{0,79})`,
  "g",
);

const NUMERIC_LITERAL = /(?<![\w$.])\d+(?:\.\d+)?/g;

function blankRun(out: string[], from: number, to: number): void {
  for (let index = from; index < to; index += 1) {
    if (out[index] !== "\n") out[index] = " ";
  }
}

// Comments, string literals and regex literals are not code, and a number inside one of them is
// not a magnitude anyone chose. The regex heuristic is the ordinary one: a slash in an operand
// position opens a literal.
function codeOnly(source: string): string {
  const out = [...source];
  const opensRegex = /[([,=:!&|?{};+\-*%\n]/;
  let cursor = 0;

  while (cursor < source.length) {
    const two = source.slice(cursor, cursor + 2);

    if (two === "//") {
      const end = source.indexOf("\n", cursor);
      const stop = end === -1 ? source.length : end;
      blankRun(out, cursor, stop);
      cursor = stop;
      continue;
    }

    if (two === "/*") {
      const end = source.indexOf("*/", cursor + 2);
      const stop = end === -1 ? source.length : end + 2;
      blankRun(out, cursor, stop);
      cursor = stop;
      continue;
    }

    const character = source[cursor];

    if (character === '"' || character === "'" || character === "`") {
      let scan = cursor + 1;
      while (scan < source.length) {
        if (source[scan] === "\\") {
          scan += 2;
          continue;
        }
        if (source[scan] === character) {
          scan += 1;
          break;
        }
        scan += 1;
      }
      blankRun(out, cursor, scan);
      cursor = scan;
      continue;
    }

    if (character === "/") {
      let back = cursor - 1;
      while (back >= 0 && (source[back] === " " || source[back] === "\t")) back -= 1;
      const previous = back < 0 ? "\n" : (source[back] ?? "\n");

      if (opensRegex.test(previous)) {
        let scan = cursor + 1;
        let closed = false;
        while (scan < source.length && source[scan] !== "\n") {
          if (source[scan] === "\\") {
            scan += 2;
            continue;
          }
          if (source[scan] === "/") {
            scan += 1;
            closed = true;
            break;
          }
          scan += 1;
        }
        if (closed) {
          blankRun(out, cursor, scan);
          cursor = scan;
          continue;
        }
      }
    }

    cursor += 1;
  }

  return out.join("");
}

interface GradeComparison {
  readonly operand: string;
  readonly literal: string;
}

// The line that tells an eligibility floor from an adoption threshold: a floor is compared against
// the denominator and decides whether a claim is made at all; a threshold is compared against the
// numerator, the rate or repeat and decides whether the number is good.
function gradeComparisonsIn(source: string): readonly GradeComparison[] {
  const code = codeOnly(source);
  const found: GradeComparison[] = [];

  for (const pattern of [NUMBER_ON_THE_RIGHT, CONSTANT_ON_THE_RIGHT]) {
    for (const match of code.matchAll(pattern)) {
      const operand = match[1] ?? "";
      if (isGradeOperand(operand)) found.push({ operand: operand.trim(), literal: match[2] ?? "" });
    }
  }

  for (const pattern of [NUMBER_ON_THE_LEFT, CONSTANT_ON_THE_LEFT]) {
    for (const match of code.matchAll(pattern)) {
      const operand = match[2] ?? "";
      if (isGradeOperand(operand)) found.push({ operand: operand.trim(), literal: match[1] ?? "" });
    }
  }

  return found;
}

function walkedFiles(): readonly string[] {
  const found = new Set<string>();

  for (const glob of SCANNED_GLOBS) {
    for (const entry of new Bun.Glob(glob).scanSync({ cwd: ROOT })) {
      found.add(entry.replaceAll("\\", "/"));
    }
  }

  // Loud rather than skipped: a rename that quietly drops a file leaves the glob arms non-empty,
  // so the non-vacuity assertion stays green while the scan has gone blind on that path.
  for (const file of SCANNED_FILES) {
    if (!existsSync(`${ROOT}/${file}`)) {
      throw new Error(
        `AC-G13 scans ${file} and it is not there — point SCANNED_FILES at its new home.`,
      );
    }
    found.add(file);
  }

  return [...found].toSorted();
}

function read(file: string): string {
  return readFileSync(`${ROOT}/${file}`, "utf8");
}

interface Literal {
  readonly file: string;
  readonly line: number;
  readonly value: string;
  readonly text: string;
  readonly previousText: string;
}

function literalsOn(): readonly Literal[] {
  const found: Literal[] = [];

  for (const file of walkedFiles()) {
    const source = read(file);
    const rawLines = source.split("\n");
    const codeLines = codeOnly(source).split("\n");

    codeLines.forEach((line, index) => {
      for (const match of line.matchAll(NUMERIC_LITERAL)) {
        found.push({
          file,
          line: index + 1,
          value: match[0],
          text: (rawLines[index] ?? "").trim(),
          previousText: (rawLines[index - 1] ?? "").trim(),
        });
      }
    });
  }

  return found;
}

function describeLiteral(literal: Literal): string {
  return `${literal.file}:${String(literal.line)} ${literal.value} — ${literal.text}`;
}

describe("CONTROL — the scan can tell a grade from a floor", () => {
  test("should catch a planted adoption threshold and pass a planted eligibility floor", () => {
    const threshold = gradeComparisonsIn(
      "if (reach.numerator / reach.denominator > 0.05) { grade(); }",
    );
    expect(threshold.length).toBeGreaterThan(0);
    expect(threshold[0]?.literal).toBe("0.05");

    const floor = gradeComparisonsIn(
      "if (corpus.basis.kept < SHIPPED_SPINE_ELIGIBILITY_FLOOR) { refuse(); }",
    );
    expect(floor).toEqual([]);

    // A literal floor compared against the denominator is still not a grade.
    expect(gradeComparisonsIn("if (corpus.basis.kept < 30) { refuse(); }")).toEqual([]);

    // And the mirrored spelling of the same threshold is caught too.
    expect(gradeComparisonsIn("if (0.05 < repeatShare) { grade(); }").length).toBeGreaterThan(0);
  });

  test("should catch a threshold read off a named constant, which leaves no literal behind", () => {
    const planted = gradeComparisonsIn(
      "if (counts.reach.numerator >= SHIPPED_RECORDED_ELIGIBILITY_FLOOR) { grade(); }",
    );

    expect(planted.length).toBeGreaterThan(0);
    expect(planted[0]?.literal).toBe("SHIPPED_RECORDED_ELIGIBILITY_FLOOR");

    // The mirrored spelling, and a rate against a constant, are the same offence.
    expect(
      gradeComparisonsIn("if (ADOPTION_FLOOR < counts.repeatRate.value) { grade(); }").length,
    ).toBeGreaterThan(0);

    // The floor this gate exists to permit still passes: the same constant against the denominator.
    expect(
      gradeComparisonsIn("if (corpus.basis.kept < SHIPPED_SPINE_ELIGIBILITY_FLOOR) { refuse(); }"),
    ).toEqual([]);
  });

  test("should read the operand word by word, so ratio inside duration is not a grade", () => {
    expect(gradeComparisonsIn("if (repeatRatio > 0.2) { grade(); }").length).toBeGreaterThan(0);
    expect(gradeComparisonsIn("if (ratio > 0.2) { grade(); }").length).toBeGreaterThan(0);

    expect(gradeComparisonsIn("if (windowDuration > 14) { wait(); }")).toEqual([]);
    expect(gradeComparisonsIn("if (generation > 2) { migrate(); }")).toEqual([]);
    expect(gradeComparisonsIn("if (generated > 2) { stop(); }")).toEqual([]);
  });

  test("should walk a non-empty set of files, and every named one", () => {
    // Without this arm every assertion below is green against a path the scan never reached,
    // which is how a scan goes blind and reports clean.
    const walked = walkedFiles();

    expect(walked.length).toBeGreaterThan(0);
    for (const file of SCANNED_FILES) {
      expect(walked).toContain(file);
    }
    expect(walked).toContain("packages/core/src/shipped/floors.ts");
  });
});

describe("AC-G13 — no fourth magnitude exists on the readout path", () => {
  test("should permit only the three ratified magnitudes on the readout path", () => {
    const literals = literalsOn();
    const ratified = new Set(RATIFIED_MAGNITUDES.map((value) => String(value)));

    const offenders = literals
      .filter((literal) => !STRUCTURAL.has(literal.value) && !ratified.has(literal.value))
      .map(describeLiteral);

    expect(walkedFiles().length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  test("should hold each ratified magnitude at one declaration site carrying its ADR pointer", () => {
    const literals = literalsOn();

    for (const magnitude of RATIFIED_MAGNITUDES) {
      const sites = literals.filter((literal) => literal.value === String(magnitude));

      expect(`${String(magnitude)} sites:${String(sites.length)}`).toBe(
        `${String(magnitude)} sites:1`,
      );

      const site = sites[0];
      if (site === undefined) continue;

      const declared = DECLARATION.exec(site.text);
      expect(`${describeLiteral(site)} declares:${declared?.[1] ?? "nothing"}`).toBe(
        `${describeLiteral(site)} declares:${String(magnitude)}`,
      );
      expect(`${String(magnitude)} pointer:${String(ADR_POINTER.test(site.previousText))}`).toBe(
        `${String(magnitude)} pointer:true`,
      );
    }
  });

  test("should forbid any numeric comparison against a numerator, a rate or repeat", () => {
    const offenders = walkedFiles().flatMap((file) =>
      gradeComparisonsIn(read(file)).map(
        (comparison) => `${file}: ${comparison.operand} ~ ${comparison.literal}`,
      ),
    );

    expect(walkedFiles().length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

// Everything above scans for a magnitude, and a grade spoken in adjectives leaves no magnitude to
// find. What settles it is the rendered body: two corpora far apart on adoption may differ in their
// numerals and in nothing else.
const CHANGE = "CSV export";
const PAGE = "/reports";
const CHANGE_ID = "0f3a9c21-6b4d-4a17-9e52-1c8b7d4e6a90";

function bodyOf(corpus: AtPageCorpus, lead: ShippedLeadCount): string {
  return renderShippedReadout({
    changeId: CHANGE_ID,
    change: CHANGE,
    page: PAGE,
    leadCount: lead,
    result: { kind: "claim", corpus, counts: shippedCounts(corpus) },
  }).body;
}

function recordedCorpusOf(spec: {
  readonly atPage: number;
  readonly touched: number;
}): AtPageCorpus {
  return mustBuild(
    buildAtPageCorpus(
      atPageInput(
        shippedCorpus({
          totalSessions: spec.atPage * 2,
          atPage: spec.atPage,
          recordedAtPage: spec.atPage,
          touchedAtPage: spec.touched,
          identityGroups: [0, 1, 2],
        }),
        { kind: "recorded" },
      ),
    ),
  );
}

function pageCorpusOf(spec: {
  readonly atPage: number;
  readonly identityGroups: readonly number[];
}): AtPageCorpus {
  return mustBuild(
    buildAtPageCorpus(
      atPageInput(
        shippedCorpus({
          totalSessions: spec.atPage * 2,
          atPage: spec.atPage,
          identityGroups: spec.identityGroups,
        }),
        { kind: "page" },
      ),
    ),
  );
}

function withoutNumerals(body: string): string {
  return body.replaceAll(/\d/g, "");
}

const HIGH_ADOPTION_RECORDED = recordedCorpusOf({ atPage: 12, touched: 9 });
const LOW_ADOPTION_RECORDED = recordedCorpusOf({ atPage: 212, touched: 1 });

// The page is the change, so adoption there is carried by repeat alone: everyone identified came
// back, against nobody who did.
const HIGH_ADOPTION_PAGE = pageCorpusOf({ atPage: 40, identityGroups: [0, 1] });
const LOW_ADOPTION_PAGE = pageCorpusOf({
  atPage: 40,
  identityGroups: Array.from({ length: 40 }, (_, index) => index),
});

const ADOPTION_PAIRS = [
  { high: HIGH_ADOPTION_RECORDED, low: LOW_ADOPTION_RECORDED },
  { high: HIGH_ADOPTION_PAGE, low: LOW_ADOPTION_PAGE },
] as const;

describe("AC-G13 — a high-adoption readout and a low-adoption one differ only in their numerals", () => {
  test("should build two pairs the readout would have to grade differently, if it graded", () => {
    const high = shippedCounts(HIGH_ADOPTION_RECORDED);
    const low = shippedCounts(LOW_ADOPTION_RECORDED);

    expect(high.reach.numerator).toBe(9);
    expect(high.reach.denominator).toBe(12);
    expect(low.reach.numerator).toBe(1);
    expect(low.reach.denominator).toBe(212);

    const highRepeat = shippedCounts(HIGH_ADOPTION_PAGE).repeat;
    const lowRepeat = shippedCounts(LOW_ADOPTION_PAGE).repeat;
    if (highRepeat === null || lowRepeat === null) {
      throw new Error("both page corpora identify people, so both must yield a repeat count");
    }

    expect(highRepeat.numerator).toBe(highRepeat.denominator);
    expect(lowRepeat.numerator).toBe(0);
  });

  test("should say the same words about a change nine in twelve used and one two hundred and twelve barely did", () => {
    expect(ADOPTION_PAIRS.length).toBe(2);
    expect(SHIPPED_LEAD_COUNTS.length).toBe(2);

    for (const pair of ADOPTION_PAIRS) {
      for (const lead of SHIPPED_LEAD_COUNTS) {
        const high = bodyOf(pair.high, lead);
        const low = bodyOf(pair.low, lead);

        // Without these two arms a renderer that returned the empty string for both would pass.
        expect(high.length).toBeGreaterThan(0);
        expect(low.length).toBeGreaterThan(0);
        expect(high).not.toBe(low);

        expect(withoutNumerals(high)).toBe(withoutNumerals(low));
      }
    }
  });

  test("CONTROL — should catch a grade planted into one body and absent from the other", () => {
    const high = bodyOf(HIGH_ADOPTION_RECORDED, "reach");
    const low = bodyOf(LOW_ADOPTION_RECORDED, "reach");
    const graded = high.replace("used it", "used it, which is strong take-up");

    expect(graded).not.toBe(high);
    expect(withoutNumerals(graded)).not.toBe(withoutNumerals(low));
  });
});
