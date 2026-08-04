import { readFileSync } from "node:fs";

import { describe, expect, it } from "bun:test";

import type { FixRow, FixesService, OpenFixResult } from "../../packages/db/src/index";
import { mintFix, parseArguments, reportFor } from "../mint-fix";

const SCRIPT = new URL("../mint-fix.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const FIX: FixRow = {
  id: "fix_abc",
  organizationId: "org_1",
  projectId: "proj_1",
  findingId: "finding_1",
  status: "open",
  attempt: 1,
  alreadyLanded: [],
  resultsBy: new Date("2026-08-11T00:00:00.000Z"),
  resultsByRuleVersion: 1,
  openedAt: new Date("2026-08-04T00:00:00.000Z"),
  openedBy: "user_1",
  createdAt: new Date("2026-08-04T00:00:00.000Z"),
};

interface Recorded {
  readonly service: FixesService;
  readonly calls: unknown[][];
}

function recordingService(result: OpenFixResult): Recorded {
  const calls: unknown[][] = [];

  const service: FixesService = {
    openFor(...args: unknown[]): Promise<OpenFixResult> {
      calls.push(args);
      return Promise.resolve(result);
    },
    readFix() {
      throw new Error("the mint path must not read a fix back");
    },
    readFinding() {
      throw new Error("the mint path must not read a finding back");
    },
    listOpen() {
      throw new Error("the mint path must not list fixes");
    },
  } as unknown as FixesService;

  return { service, calls };
}

function source(): string {
  return readFileSync(SCRIPT, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

describe("mint-fix", () => {
  it("opens a fix from the command line through the same service", async () => {
    const recorded = recordingService({ outcome: "opened", fix: FIX });

    const report = await mintFix(recorded.service, "finding_1");

    expect(recorded.calls).toEqual([["finding_1"]]);
    expect(recorded.calls[0]?.length).toBe(1);

    expect(report.code).toBe(0);
    expect(report.lines.join("\n")).toContain("opened");
    expect(report.lines.join("\n")).toContain("fix_abc");
  });

  it("reports every outcome of the closed union verbatim", () => {
    const cases: readonly (readonly [OpenFixResult, string, number])[] = [
      [{ outcome: "opened", fix: FIX }, "opened", 0],
      [{ outcome: "already_open", fix: FIX }, "already_open", 0],
      [{ outcome: "no_payload" }, "no_payload", 1],
      [{ outcome: "unrenderable" }, "unrenderable", 1],
      [{ outcome: "finding_not_found" }, "finding_not_found", 1],
    ];

    for (const [result, word, code] of cases) {
      const report = reportFor(result);
      const first = report.lines[0] ?? "";

      expect(first.startsWith(`${word} — `)).toBe(true);
      expect(report.code).toBe(code);
      expect(report.lines.length).toBeGreaterThan(1);
    }
  });

  it("prints the minted fix id for both outcomes that produce one", () => {
    for (const outcome of ["opened", "already_open"] as const) {
      const report = reportFor({ outcome, fix: FIX });
      expect(report.lines).toContain("Fix id: fix_abc");
    }
  });

  it("says plainly that a pre-payload finding is the expected no_payload answer", () => {
    const text = reportFor({ outcome: "no_payload" }).lines.join(" ");

    expect(text).toContain("before we started keeping the detail");
    expect(text).toContain("Nothing is broken");
    expect(text).toContain("expected answer");
  });

  it("mints through createFixesService rather than a second mint path", () => {
    const text = source();

    expect(text).toContain("createFixesService");
    expect(text).toMatch(/mintFix\(createFixesService\(db, ctx\), args\.finding\)/);
    expect(text).toMatch(/service\.openFor\(findingId\)/);

    expect(text).not.toMatch(/\bclaimFor\b/);
    expect(text).not.toMatch(/\.insert\(/);
    expect(text).not.toMatch(/\.update\(/);
    expect(text).not.toMatch(/["']drizzle-orm(?:\/[^"']*)?["']/);
  });

  it("refuses to guess when the operator gives no finding", () => {
    expect(parseArguments([]).finding).toBeUndefined();
    expect(parseArguments(["--finding"]).error).toBe("--finding needs a value.");
    expect(parseArguments(["--finding", "--org"]).error).toBe("--finding needs a value.");
    expect(parseArguments(["--nope"]).error).toBe("Unknown option --nope.");

    const parsed = parseArguments(["--finding", "finding_1", "--org", "acme"]);
    expect(parsed.finding).toBe("finding_1");
    expect(parsed.org).toBe("acme");
    expect(parsed.error).toBeNull();
  });
});
