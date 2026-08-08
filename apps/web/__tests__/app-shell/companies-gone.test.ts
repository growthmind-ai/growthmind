// AC-9 / G9 / D-9. This inverts companies-reachable.test.ts: the same four assertions, opposite
// sign. That file is deleted in wave 7 with the rest of the surface, not here. No assertion below
// is softened or skipped — a deletion test that quietly passes is worth less than no test, since
// it reports the surface gone while it is still being served.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { navGroupsFor, type NavGroup } from "../../lib/app-nav";
import { ROUTES } from "../../lib/routes";

const APPS_WEB = path.join(import.meta.dir, "..", "..");
const APP_DIR = path.join(APPS_WEB, "app");

// This file has to name the path it is hunting for, so it exempts itself rather than pretending
// otherwise. It is the only exemption; every other file under apps/web is swept, tests included,
// because wave 7 deletes the companies suite along with the surface.
const SWEEP_EXEMPT = "__tests__/app-shell/companies-gone.test.ts";

// A PATH REFERENCE, not every string that contains the word — the same discrimination
// routes.test.ts already makes for /first-run, and for the same reason. A quoted whole path is a
// link, a fetch or a route constant; `/companies` sitting in a sentence inside a comment or an
// error message is prose about a surface that used to exist, and demanding it change would put
// this sprint's sweep inside files wave 7 does not own (findings-reachable.test.ts and
// record-reachable.test.ts each mention it in a comment listing sibling surfaces).
const COMPANIES_PATH = /(?:["'`]|https?:\/\/[^"'`\s]*?)\/(?:api\/)?companies(?=["'`?#/])/;

// The whole surface, not only its pages: a route deleted while its components and lib stay is
// dead code that still typechecks, and D11 is the class this project has shipped before.
const COMPANIES_DIRECTORIES: readonly string[] = [
  "app/(app)/companies",
  "app/api/companies",
  "components/companies",
  "lib/companies",
];

interface RoutableFile {
  readonly file: string;
  readonly urlPath: string;
}

function collectRoutableFiles(): readonly RoutableFile[] {
  const found: RoutableFile[] = [];

  const walk = (dir: string): void => {
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry !== "page.tsx" && entry !== "route.ts") continue;

      const relative = path.relative(APP_DIR, full).split(path.sep);
      const segments = relative
        .slice(0, -1)
        .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
      found.push({
        file: path.relative(APPS_WEB, full).split(path.sep).join("/"),
        urlPath: segments.length === 0 ? "/" : `/${segments.join("/")}`,
      });
    }
  };

  walk(APP_DIR);
  return found;
}

function filesReferencingCompanies(): readonly string[] {
  const offenders: string[] = [];

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
      if (!/\.(ts|tsx|css|json)$/.test(entry)) continue;

      const relative = path.relative(APPS_WEB, full).split(path.sep).join("/");
      if (relative === SWEEP_EXEMPT) continue;
      if (COMPANIES_PATH.test(readFileSync(full, "utf8"))) offenders.push(relative);
    }
  };

  walk(APPS_WEB);
  return offenders;
}

function sourceFilesUnder(relativeDir: string): readonly string[] {
  const dir = path.join(APPS_WEB, ...relativeDir.split("/"));
  if (!existsSync(dir)) return [];
  const found: string[] = [];

  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const full = path.join(at, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      found.push(path.relative(APPS_WEB, full).split(path.sep).join("/"));
    }
  };

  walk(dir);
  return found;
}

function hrefsIn(groups: readonly NavGroup[]): readonly string[] {
  return groups.flatMap((group) => group.items.map((item) => item.href));
}

function labelsIn(groups: readonly NavGroup[]): readonly string[] {
  return groups.flatMap((group) => group.items.map((item) => item.label));
}

describe("the /companies browsing destination is gone (AC-9, G9, D-9)", () => {
  test("CONTROL: the path scan separates a link from prose, and the route resolver still works", () => {
    for (const reference of [
      `companies: "/companies",`,
      `companyDetail: "/companies/[domain]"`,
      `<Link href="/companies">`,
      `await fetch("/api/companies")`,
      "fetch(`/api/companies/${domain}`)",
      `router.push('/companies?sort=recent')`,
    ]) {
      expect(`${reference}: ${COMPANIES_PATH.test(reference)}`).toBe(`${reference}: true`);
    }

    // Prose about a surface is not a reference to it. Both of these are real lines from
    // app-shell suites this sprint does not own.
    for (const prose of [
      `// Like /replays, /agent and /companies before it, every org member must reach it`,
      "`/replays, /agent and /companies all live outside the (preview) group`",
      `import { CompanyRow } from "@/components/companies/CompanyRow";`,
    ]) {
      expect(`${prose}: ${COMPANIES_PATH.test(prose)}`).toBe(`${prose}: false`);
    }

    const files = collectRoutableFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((file) => file.urlPath)).toContain("/");
  });

  test("no file under apps/web references the companies path", () => {
    const offenders = filesReferencingCompanies();

    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} file(s) under apps/web still reference the /companies path: ` +
          `${offenders.join(", ")}. G9 requires the grep to come back empty outside a redirect, ` +
          `and D-9 adds no redirect — the destination is gone, not hidden behind one. Its ` +
          `counts were unconditioned and its verb was "look"; the grouping helper survives and ` +
          `feeds the company filter panel instead.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test("ROUTES carries no companies entry and every surviving entry still has a file behind it", () => {
    const registered = ROUTES as Readonly<Record<string, string>>;

    const companyEntries = Object.entries(registered).filter(([, value]) =>
      value.startsWith("/companies"),
    );
    if (companyEntries.length > 0) {
      throw new Error(
        `apps/web/lib/routes.ts still registers ${companyEntries
          .map(([key, value]) => `${key} -> ${value}`)
          .join(", ")}. The route constants outlive the pages unless they are deleted with them, ` +
          `and a ROUTES entry with no file behind it typechecks perfectly and 404s in production.`,
      );
    }
    expect(companyEntries).toEqual([]);

    // The other half, and the reason this is one test rather than two: proving companies left
    // ROUTES is worth nothing if the deletion took a live entry's file with it.
    const served = new Set(collectRoutableFiles().map((file) => file.urlPath));
    const unresolved = Object.entries(registered)
      .filter(([, value]) => !served.has(value))
      .map(([key, value]) => `${key} -> ${value}`);

    if (unresolved.length > 0) {
      throw new Error(
        `ROUTES entries with no page.tsx or route.ts behind them after the deletion: ` +
          `${unresolved.join(", ")}. Served paths: ${[...served].toSorted().join(", ")}`,
      );
    }
    expect(unresolved).toEqual([]);
  });

  test("the nav renders Replays and no Companies entry in both app-shell variants", () => {
    for (const canSeePreview of [false, true]) {
      const groups = navGroupsFor(canSeePreview);
      const hrefs = hrefsIn(groups);
      const labels = labelsIn(groups);

      const companyHrefs = hrefs.filter((href) => href.startsWith("/companies"));
      if (companyHrefs.length > 0) {
        throw new Error(
          `navGroupsFor(${canSeePreview}) still offers ${companyHrefs.join(", ")}. Both ` +
            `variants must lose it: WORK and WORK_LIVE each list COMPANIES today.`,
        );
      }
      expect(companyHrefs).toEqual([]);
      expect(labels).not.toContain("Companies");

      // The surviving destination, under the word this sprint standardises on. "Recordings" is
      // the label today, and a nav entry is a rendered string like any other (G8).
      expect(hrefs).toContain(ROUTES.replays);
      if (!labels.includes("Replays")) {
        throw new Error(
          `navGroupsFor(${canSeePreview}) offers ${ROUTES.replays} under a label that is not ` +
            `"Replays". The customer-facing word is Replays, and the rail is where most people ` +
            `read it first. Labels: ${labels.join(", ")}`,
        );
      }
      expect(labels).toContain("Replays");
    }
  });

  test("no page.tsx exists under app/(app)/companies, and the rest of the surface is gone with it", () => {
    const survivors = COMPANIES_DIRECTORIES.flatMap(sourceFilesUnder);

    if (survivors.length > 0) {
      throw new Error(
        `the companies surface still holds ${survivors.length} file(s): ${survivors.join(", ")}. ` +
          `The deletion must be real rather than a stub or a redirect page — G9 permits a ` +
          `redirect and D-9 adds none, so nothing should answer at these paths at all. The ` +
          `components and lib go with the pages: a route deleted while its dependencies stay ` +
          `leaves dead code that still typechecks.`,
      );
    }
    expect(survivors).toEqual([]);
  });
});
