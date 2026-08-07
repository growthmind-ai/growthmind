// AC-14 / FR-13 / D11. Deliberately paired with the behavioural free-mail test in
// __tests__/replay/read.compose.test.ts: a grep alone does not prove the helper is doing the
// work, and the behavioural test alone does not prove production ever calls it. Both are needed,
// and this is the half that catches a surviving helper with no caller — the dead-code class this
// project has shipped before (O-040's citationsFor, O-041's zero-caller detector).
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { groupSessionsByDomain } from "@growthmind/shared";

const REPO_ROOT = path.join(import.meta.dir, "..", "..", "..", "..");

const HELPER = "groupSessionsByDomain";

// Where a production caller may legitimately live. packages/shared itself is excluded: the
// export and its own barrel entry are not callers.
const SEARCHED_ROOTS: readonly string[] = ["apps/web", "packages/core", "worker"];

// The two exclusions, both named so neither is a silent skip.
//
//   1. Tests are not production. A helper called only from its own suite is still dead.
//   2. app/api/companies is deleted in wave 7. Counting it would make this test green today,
//      red the moment the deletion lands, and green again in wave 10 — a ratchet that breaks
//      mid-flight and tells nobody anything. The whole point of AC-14 is the caller that
//      survives the deletion, so the dying one does not count.
const NOT_A_SURVIVING_CALLER: readonly string[] = ["__tests__/", "app/api/companies/"];

function isProductionSource(relativePath: string): boolean {
  return !NOT_A_SURVIVING_CALLER.some((fragment) => relativePath.includes(fragment));
}

function callSites(): readonly string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;

      const relativePath = path.relative(REPO_ROOT, full).split(path.sep).join("/");
      if (!isProductionSource(relativePath)) continue;

      const source = readFileSync(full, "utf8");
      source.split("\n").forEach((line, index) => {
        // A call, not a mention: the helper name followed by an open paren. An import line
        // names it too, and importing a function you never call is the defect, not the fix.
        if (new RegExp(`\\b${HELPER}\\s*\\(`).test(line)) {
          found.push(`${relativePath}:${index + 1}`);
        }
      });
    }
  };

  for (const root of SEARCHED_ROOTS) {
    const full = path.join(REPO_ROOT, root);
    if (existsSync(full)) walk(full);
  }
  return found;
}

describe("the grouping helper survives the deletion with a caller (AC-14, FR-13, D11)", () => {
  test("CONTROL: the scan counts a call and ignores an import, a comment and a dying caller", () => {
    // The scan is line-based, so these are the shapes it must separate.
    const call = new RegExp(`\\b${HELPER}\\s*\\(`);
    expect(call.test(`  const groups = groupSessionsByDomain(sessions, cap);`)).toBe(true);
    expect(call.test(`import { groupSessionsByDomain } from "@growthmind/shared";`)).toBe(false);
    expect(call.test(`// groupSessionsByDomain lives in packages/shared`)).toBe(false);

    expect(isProductionSource("apps/web/lib/replay/read.ts")).toBe(true);
    expect(isProductionSource("apps/web/__tests__/replay/read.compose.test.ts")).toBe(false);
    expect(isProductionSource("apps/web/app/api/companies/route.ts")).toBe(false);

    // The helper is real and still exported, so a red below is about the caller and never about
    // the import resolving.
    expect(typeof groupSessionsByDomain).toBe("function");
  });

  test("groupSessionsByDomain has at least one production call site", () => {
    const sites = callSites();

    if (sites.length === 0) {
      throw new Error(
        `${HELPER} has no production call site outside the /companies surface this sprint ` +
          `deletes. Its only caller today is apps/web/app/api/companies/route.ts:43, which goes ` +
          `in wave 7; the company filter panel must become its replacement in wave 10. A ` +
          `surviving helper with no caller satisfies the "the grouping helper survives" clause ` +
          `on paper and is dead in fact — and its free-mail skip is what keeps "personal ` +
          `addresses aren't companies" true, so losing the caller silently loses that rule too. ` +
          `Searched: ${SEARCHED_ROOTS.join(", ")}, excluding ${NOT_A_SURVIVING_CALLER.join(", ")}.`,
      );
    }
    expect(sites.length).toBeGreaterThanOrEqual(1);
  });
});
