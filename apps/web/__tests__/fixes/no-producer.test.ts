// `open` is the only status anything writes, and six things the fixture page carried have
// no producer anywhere in the codebase. Rendering any of them is a claim the product cannot
// keep — "sent to Claude Code" in particular, since `opened_by` is an opaque actor id that
// may be an api key or a Slack press and is never an assistant's name.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const WEB_ROOT = path.join(import.meta.dir, "..", "..");

const SURFACES: readonly string[] = [
  path.join(WEB_ROOT, "app", "(app)", "fixes"),
  path.join(WEB_ROOT, "components", "fixes"),
  path.join(WEB_ROOT, "lib", "fixes"),
];

const WITHOUT_A_PRODUCER: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: "a status word on a list of open fixes", pattern: /awaiting_verification|withdrawn/ },
  { what: "the checks tally", pattern: /checks?\s+confirmed|tallyChecks/i },
  { what: "an introduced-by or fixed-by pull request", pattern: /\bPR #|pull request/i },
  { what: "an event log for a fix", pattern: /in order|event log/i },
  { what: "the assistant a fix was supposedly sent to", pattern: /sent to|Claude Code|Cursor/i },
  { what: "an attempt counter or what already landed", pattern: /alreadyLanded|already_landed/ },
  { what: "the actor who opened it", pattern: /openedBy|opened_by/ },
  { what: "a verdict or read-out control", pattern: /verdict|readOut|read out the result/i },
];

function sourcesUnder(dir: string): readonly { readonly file: string; readonly source: string }[] {
  const found: { file: string; source: string }[] = [];

  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const full = path.join(at, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        found.push({
          file: path.relative(WEB_ROOT, full).split(path.sep).join("/"),
          source: readFileSync(full, "utf8"),
        });
      }
    }
  };

  walk(dir);
  return found;
}

describe("the fixes surface renders nothing that has no producer", () => {
  const sources = SURFACES.flatMap((dir) => sourcesUnder(dir));

  test("the surface exists at the plain route, so this scan has a subject", () => {
    expect(sources.map((entry) => entry.file)).toContain("app/(app)/fixes/page.tsx");
    expect(sources.map((entry) => entry.file)).toContain("app/(app)/fixes/[id]/page.tsx");
  });

  for (const { what, pattern } of WITHOUT_A_PRODUCER) {
    test(`nothing renders ${what}`, () => {
      const offenders = sources
        .filter((entry) => pattern.test(entry.source))
        .map((entry) => entry.file);

      expect(offenders).toEqual([]);
    });
  }
});
