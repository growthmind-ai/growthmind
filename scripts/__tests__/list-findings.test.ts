import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { THRESHOLD_RULE_SETS } from "../../packages/core/src/rules/thresholds";
import {
  describeFinding,
  nothingFoundYet,
  parseArguments,
  type FindingLine,
} from "../list-findings";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "list-findings.ts");

function source(): string {
  return readFileSync(SCRIPT, "utf8");
}

describe("parseArguments", () => {
  test("defaults to ten findings and no chosen organisation", () => {
    expect(parseArguments([])).toEqual({ limit: 10, org: undefined, help: false, error: null });
  });

  test("refuses a limit that is not a whole number of one or more", () => {
    for (const bad of ["0", "-3", "2.5", "ten"]) {
      expect(parseArguments(["--limit", bad]).error).toBe(
        "--limit needs a whole number of one or more.",
      );
    }
  });

  test("refuses a flag it does not serve rather than ignoring it", () => {
    expect(parseArguments(["--findings"]).error).toBe("Unknown option --findings.");
    expect(parseArguments(["--org"]).error).toBe("--org needs a value.");
  });
});

function render(line: object): string {
  return describeFinding(line as unknown as FindingLine).join("\n");
}

describe("describeFinding", () => {
  const OFFENDER = "jane.doe@acme.example";

  const WITHHELD_PLACEHOLDER = "(the written explanation for this one is not shown here)";

  const CLEAN_TEXT = {
    held: false,
    headline: "People are leaving the pricing page without going any further.",
    context: ["It has been happening all week."],
  } as const;

  const base = {
    findingId: "finding-1",
    foundAt: new Date("2026-08-04T06:30:00.000Z"),
    text: CLEAN_TEXT,
    surface: "/pricing",
  };

  test("says a finding is ready when it carries the detail and has no fix", () => {
    const rendered = render({ ...base, mintable: true, fixId: null });

    expect(rendered).toContain("ready");
    expect(rendered).toContain("/pricing");
  });

  test("names the fix a finding already has instead of offering to mint one", () => {
    const rendered = render({ ...base, mintable: true, fixId: "fix-9" });

    expect(rendered).toContain("fix fix-9");
    expect(rendered).not.toContain("ready");
  });

  test("says a finding written before the detail existed cannot be minted from", () => {
    const rendered = render({ ...base, mintable: false, fixId: null });

    expect(rendered).toContain("no detail");
  });

  test("describeFinding prints the headline for a clean finding", () => {
    const rendered = render({ ...base, mintable: true, fixId: null });

    expect(rendered).toContain(base.text.headline);
  });

  test("describeFinding prints a withheld placeholder line for a finding with a planted PII offender instead of the headline", () => {
    const rendered = render({
      ...base,
      text: { held: true, why: "residual_pii", kind: "email_address", headline: OFFENDER },
      mintable: true,
      fixId: null,
    });

    expect({ offender: OFFENDER, present: rendered.includes(OFFENDER) }).toEqual({
      offender: OFFENDER,
      present: false,
    });
    expect(rendered).not.toContain("undefined");
    expect(rendered).toContain(WITHHELD_PLACEHOLDER);

    expect(rendered).toContain("finding-1");
    expect(rendered).toContain("2026-08-04 06:30");
    expect(rendered).toContain("ready");
    expect(rendered).toContain("on /pricing");
  });
});

describe("nothingFoundYet", () => {
  test("reads the real thresholds rather than restating them", () => {
    const rules = THRESHOLD_RULE_SETS.get(1);
    if (!rules) throw new Error("threshold rule set version 1 must remain resolvable");

    const said = nothingFoundYet().join("\n");

    expect(said).toContain(String(rules.errorMinAffectedSessions));
    expect(said).toContain(String(rules.funnelMinDropoffSessions));
    expect(said).toContain(String(rules.funnelMinSessionsAtOrigin));
  });

  test("names the mistake an operator actually makes", () => {
    expect(nothingFoundYet().join("\n")).toContain("one browser, one visit");
  });

  test("reads to someone who never opens the codebase", () => {
    const said = nothingFoundYet().join("\n");

    for (const jargon of [
      "errorMinAffectedSessions",
      "funnel_dropoff",
      "error_event",
      "$exception",
      "session_id",
      "detector",
    ]) {
      expect({ jargon, present: said.includes(jargon) }).toEqual({ jargon, present: false });
    }
  });
});

// A behavioural test against injected repositories cannot prove the shipped entry point
// reads the shipped tables, so this asserts on source: no second way to read a finding.
describe("the script reads through the repositories and nothing else", () => {
  test("names no table and builds no query of its own", () => {
    const text = source();

    for (const forbidden of ["drizzle-orm", ".select(", ".insert(", ".update(", "sql`"]) {
      expect({ forbidden, present: text.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  test("reads findings, payloads and fixes through their own repositories", () => {
    const text = source();

    for (const factory of [
      "createFindingsRepo",
      "createFindingPayloadsRepo",
      "createFixesRepo",
      "createProjectsRepo",
    ]) {
      expect({ factory, used: text.includes(`${factory}(db, ctx)`) }).toEqual({
        factory,
        used: true,
      });
    }
  });

  test("hands the operator the next command rather than leaving them to guess", () => {
    expect(source()).toContain("bun scripts/mint-fix.ts --finding");
  });
});
