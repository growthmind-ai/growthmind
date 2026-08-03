import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const SCANNED = /^(apps|packages|worker|scripts|__tests__)\//;

const SKIPPED = [/(^|\/)node_modules\//, /(^|\/)\.next\//, /^packages\/db\/drizzle\//, /\.d\.ts$/];

/** Comments may occupy this share of a file's lines, and no more. */
const BUDGET = 0.1;

/**
 * Files short enough that the percentage is noise. A twelve-line module with a
 * two-line directive is not the problem this budget exists to catch.
 */
const FLOOR_LINES = 5;

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

interface Offender {
  readonly file: string;
  readonly comments: number;
  readonly lines: number;
  readonly percent: number;
}

/** The budget governs committed source: a gitignored local file cannot be brought under it by a commit. */
function trackedFiles(): ReadonlySet<string> {
  const listed = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: ROOT });
  if (!listed.success)
    throw new Error("comment budget: git ls-files failed, so tracked source is unknown");

  return new Set(
    new TextDecoder()
      .decode(listed.stdout)
      .split("\0")
      .filter(Boolean)
      .map((file) => file.replaceAll("\\", "/")),
  );
}

function sourceFiles(): string[] {
  const tracked = trackedFiles();

  return [...new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: ROOT })]
    .map((rel) => rel.replaceAll("\\", "/"))
    .filter(
      (file) =>
        SCANNED.test(file) && !SKIPPED.some((pattern) => pattern.test(file)) && tracked.has(file),
    );
}

function scan(): Offender[] {
  const offenders: Offender[] = [];

  for (const file of sourceFiles()) {
    const lines = readFileSync(`${ROOT}/${file}`, "utf8").split("\n");
    const comments = lines.filter((line) => COMMENT_LINE.test(line)).length;
    const allowed = Math.max(FLOOR_LINES, Math.ceil(lines.length * BUDGET));
    if (comments > allowed) {
      offenders.push({
        file,
        comments,
        lines: lines.length,
        percent: Math.round((comments / lines.length) * 100),
      });
    }
  }

  return offenders.toSorted((a, b) => b.percent - a.percent);
}

describe("comment budget", () => {
  test("no source file spends more than a tenth of its lines on comments", () => {
    const offenders = scan();
    const report = offenders.map((o) => `${o.file} — ${o.comments}/${o.lines} (${o.percent}%)`);
    expect(report).toEqual([]);
  });

  test("the scanner reaches the real tree", () => {
    const files = sourceFiles();

    expect(files.length).toBeGreaterThan(400);
    expect(files).toContain("packages/core/src/detect/funnel-dropoff.ts");
  });

  test("a file git does not track is outside the budget, not an unfixable offender", () => {
    const tracked = trackedFiles();

    expect(sourceFiles().filter((file) => !tracked.has(file))).toEqual([]);
  });
});
