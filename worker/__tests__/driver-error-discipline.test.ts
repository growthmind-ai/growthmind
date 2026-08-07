// B-041. `describeError` returns `error.message`, and in drizzle-orm 0.45.2 a query
// failure's message IS the statement and every bound parameter. B-039 fixed one file;
// ten more catches on the analysis and delivery lanes carried the identical leak, and
// nothing stopped the eleventh.
//
// This is the hook. Every `describeError` under `worker/src` must be listed below with
// the reason it cannot see a driver error, so a new one is a decision rather than an
// oversight — the same shape as `LITERAL_EXEMPT_PREFIXES` in the routes suite.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const WORKER_SRC = path.join(import.meta.dir, "..", "src");

interface Allowed {
  readonly file: string;
  readonly wraps: string;
  readonly why: string;
}

// Each of these wraps something that cannot reach the driver. A pure renderer, a model
// port, or the Slack poster — none of which can throw a `DrizzleQueryError`.
const ALLOWED: readonly Allowed[] = [
  {
    file: "analysis/gates.ts",
    wraps: "renderFloorSummary",
    why: "a pure core renderer over a candidate already in memory",
  },
  {
    file: "analysis/gates.ts",
    wraps: "computeFindingSignature",
    why: "pure hashing over fields already read; nothing is queried",
  },
  {
    file: "analysis/plan.ts",
    wraps: "summariser.port.render",
    why: "the model port, not the database",
  },
  {
    file: "analysis/cause.ts",
    wraps: "explainer.port.explain",
    why: "the cause-stage model port, not the database — same shape as plan.ts's site",
  },
  {
    file: "delivery-lane-source.ts",
    wraps: "messageInputFor",
    why: "rebuilds counts already in memory",
  },
  {
    file: "tasks/delivery-tick.ts",
    wraps: "JSON.stringify",
    why: "a serialisation throw is a renderer bug, and its own comment says so",
  },
  {
    file: "tasks/delivery-tick.ts",
    wraps: "renderSlackMessage",
    why: "a pure core renderer over a message already in memory",
  },
  {
    file: "tasks/delivery-tick.ts",
    wraps: "poster.post",
    why: "the Slack HTTP port, not the database",
  },
  {
    file: "tasks/notification-dispatch.ts",
    wraps: "poster.post",
    why: "the Slack HTTP port, not the database — the same site delivery-tick already lists; every write beside it goes through the repository",
  },
  {
    file: "tasks/business-research.ts",
    wraps: "deps.fetchSite",
    why: "someone else's web server over HTTP, not the database; the write beside it uses the driver-safe describer",
  },
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const full = path.join(at, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts")) found.push(full);
    }
  };

  walk(dir);
  return found;
}

const relative = (full: string): string =>
  path.relative(WORKER_SRC, full).split(path.sep).join("/");

function describeErrorSites(): { file: string; line: number; text: string }[] {
  const sites: { file: string; line: number; text: string }[] = [];

  for (const full of sourceFiles(WORKER_SRC)) {
    const lines = readFileSync(full, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (/\bdescribeError\s*\(/.test(line)) {
        sites.push({ file: relative(full), line: index + 1, text: line.trim() });
      }
    }
  }

  return sites;
}

describe("driver errors are described by the one describer that withholds the statement", () => {
  test("CONTROL: the scanner finds the sites it claims to check", () => {
    // Without this the allow-list check below passes against a scanner that found
    // nothing at all, which is how a leak survives a green suite.
    const sites = describeErrorSites();

    expect(sourceFiles(WORKER_SRC).length).toBeGreaterThan(10);
    expect(sites.length).toBe(ALLOWED.length);
  });

  test("every describeError under worker/src is one of the listed non-driver sites", () => {
    const budget = new Map<string, number>();
    for (const entry of ALLOWED) {
      budget.set(entry.file, (budget.get(entry.file) ?? 0) + 1);
    }

    const found = new Map<string, number>();
    for (const site of describeErrorSites()) {
      found.set(site.file, (found.get(site.file) ?? 0) + 1);
    }

    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(budget));
  });

  test("every allowed site states what it wraps and why that cannot be the driver", () => {
    for (const entry of ALLOWED) {
      expect(`${entry.file} wraps:${entry.wraps.length > 0}`).toBe(`${entry.file} wraps:true`);
      expect(`${entry.file} why:${entry.why.length > 20}`).toBe(`${entry.file} why:true`);
    }
  });

  test("the lanes that write to the database use the driver-safe describer", () => {
    const writers = [
      "analysis-lane-source.ts",
      "delivery-lane-source.ts",
      "tasks/analysis-tick.ts",
      "tasks/delivery-tick.ts",
      "tasks/session-source-poll.ts",
      "task-logger.ts",
    ];

    for (const file of writers) {
      const source = readFileSync(path.join(WORKER_SRC, file), "utf8");
      expect(`${file}:${source.includes("describeDriverError(")}`).toBe(`${file}:true`);
    }
  });
});
