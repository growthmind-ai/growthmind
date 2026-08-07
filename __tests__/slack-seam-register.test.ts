// Every seam that can put words in front of a customer's Slack workspace, enumerated with
// its reason — so the next bespoke call site is a failing build, not a code-review find
// (ADD §5.4, FR-12; B-055 is the incident). Two scans, deliberately different in what
// they strip: the port scan reads code only, while the network scan keeps string literals
// because apps/web/lib/slack/acknowledge.ts names its host in one — stripping it would
// leave this register green and blind to the exact bypass it exists to see.
//
// RED in Wave 0: ALLOWED is populated by RUNNING the scan and reading its output (task
// 4.3), never by transcribing the ADD's paragraph — the CONTROL is what forces that.
import { readFileSync } from "node:fs";

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

const PORT_CALL = /\.post\s*\(/;

const NETWORK = /slack\.com|hooks\.slack|SLACK_WEBHOOK/;

const ACKNOWLEDGE_BYPASS = "apps/web/lib/slack/acknowledge.ts";

const INTEREST_BYPASS = "worker/src/tasks/provider-interest-tick.ts";

const DIGEST_TASK = "worker/src/tasks/notification-digest.ts";

interface Allowed {
  readonly file: string;
  readonly wraps: string;
  readonly why: string;
}

// One entry per seam occurrence, per file — the count map below compares in both
// directions, so a second site inside an already-blessed file fails where a presence set
// would pass silently. Populated by task 4.3 from the scan's own output.
const ALLOWED: readonly Allowed[] = [];

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

function read(file: string): string {
  return readFileSync(`${ROOT}/${file}`, "utf8");
}

interface Seam {
  readonly file: string;
  readonly line: number;
  readonly kind: "port" | "network";
}

function seamsIn(file: string, source: string): readonly Seam[] {
  const { withoutComments, codeOnly } = stripSource(source);
  const found: Seam[] = [];

  codeOnly.split("\n").forEach((line, index) => {
    if (PORT_CALL.test(line)) found.push({ file, line: index + 1, kind: "port" });
  });
  withoutComments.split("\n").forEach((line, index) => {
    if (NETWORK.test(line)) found.push({ file, line: index + 1, kind: "network" });
  });

  return found;
}

function allSeams(): readonly Seam[] {
  const found: Seam[] = [];
  for (const file of sourceFiles()) {
    found.push(...seamsIn(file, read(file)));
  }
  return found;
}

function countByFile(files: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

describe("every Slack-posting seam is a registered decision", () => {
  test("CONTROL: the walk reaches the tree and every found seam has a registered entry", () => {
    const files = sourceFiles();
    const seams = allSeams();

    // Without both arms this suite can pass against a scanner that read nothing at all,
    // which is how a register goes green and blind (driver-error-discipline's shape).
    expect(files.length).toBeGreaterThan(20);
    expect(seams.length).toBeGreaterThan(0);
    expect(seams.length).toBe(ALLOWED.length);
  });

  test("the per-file count map matches in both directions — a second seam in a blessed file still fails", () => {
    const budget = countByFile(ALLOWED.map((entry) => entry.file));
    const found = countByFile(allSeams().map((seam) => seam.file));

    expect(found).toEqual(budget);
  });

  test("every registered entry names a token present in its file and a reason longer than a shrug", () => {
    // Guarded against the zero-row green: an empty register asserts nothing, and Wave 0's
    // red here is exactly that emptiness until task 4.3 populates it from the scan.
    expect(ALLOWED.length).toBeGreaterThan(0);

    for (const entry of ALLOWED) {
      const source = read(entry.file);
      expect(`${entry.file} wraps:${source.includes(entry.wraps)}`).toBe(
        `${entry.file} wraps:true`,
      );
      expect(`${entry.file} why:${entry.why.trim().length > 20}`).toBe(`${entry.file} why:true`);
    }
  });

  test("the two port-bypassing seams are registered entries, not blind spots", () => {
    // The scan half: both files carry a Slack network token the walker must see — the
    // acknowledgement host lives in a string literal, which is why the network scan reads
    // withoutComments rather than codeOnly (C-4's failure class).
    const scanned = new Set(allSeams().map((seam) => seam.file));
    expect(scanned.has(ACKNOWLEDGE_BYPASS)).toBe(true);
    expect(scanned.has(INTEREST_BYPASS)).toBe(true);

    // The register half: a register keyed on poster.post alone would be green and blind
    // to both — the exact failure it exists to prevent.
    const registered = new Set(ALLOWED.map((entry) => entry.file));
    expect(registered.has(ACKNOWLEDGE_BYPASS)).toBe(true);
    expect(registered.has(INTEREST_BYPASS)).toBe(true);
  });
});

describe("the scanner's own controls", () => {
  test("a planted network call and a planted port call both match, and prose matches nothing", () => {
    const plantedNetwork =
      'await fetch("https://hooks.slack.com/services/T000/B000/XXX", { method: "POST" });';
    const plantedPort = "await poster.post({ channelId, blocks, fallbackText });";
    const prose = "// the summary is posted to slack.com by the dispatch task\nconst x = 1;";
    const literalHost = 'const ACKNOWLEDGEMENT_HOST = "hooks.slack.com";';

    expect(NETWORK.test(stripSource(plantedNetwork).withoutComments)).toBe(true);
    expect(PORT_CALL.test(stripSource(plantedPort).codeOnly)).toBe(true);
    expect(NETWORK.test(stripSource(prose).withoutComments)).toBe(false);

    // The load-bearing asymmetry: the host in a string literal survives the network
    // scan's strip and vanishes from the port scan's — both by design.
    expect(NETWORK.test(stripSource(literalHost).withoutComments)).toBe(true);
    expect(NETWORK.test(stripSource(literalHost).codeOnly)).toBe(false);
  });

  test("the register carries no exemptions, and a blank why could never smuggle one in", () => {
    expect(EXEMPT).toEqual([]);

    const blankWhy = EXEMPT.filter((entry) => !isExempt(entry)).map((entry) => entry.file);
    expect(blankWhy).toEqual([]);
    expect(isExempt({ file: "anything.ts", why: "   " })).toBe(false);
  });
});

describe("the weekly digest added no Slack seam (ADD D-8 — the register's first live test)", () => {
  test("the digest task is walked, posts nothing itself, and holds no entry in the register", () => {
    // Non-vacuous by construction: the file must exist and be part of the walked tree
    // before its absence from the seam list means anything.
    expect(sourceFiles()).toContain(DIGEST_TASK);

    const source = read(DIGEST_TASK);
    expect(source.length).toBeGreaterThan(0);

    // A summary posted directly would be the fifth bespoke call site this register exists
    // to forbid; the digest's Slack leg is the ordinary dispatch arm instead.
    expect(seamsIn(DIGEST_TASK, source)).toEqual([]);
    expect(ALLOWED.some((entry) => entry.file === DIGEST_TASK)).toBe(false);
  });
});
