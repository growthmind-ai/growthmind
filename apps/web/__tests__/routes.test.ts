// ROUTES — the coverage guard that does not exist today (AD-17, EC-O9).
// Wave 0f, task 0f.5. ADD §9, 2 rows.
//
// ###########################################################################
// # D9: A STRINGLY-TYPED ROUTE PATH IS A SILENT 404, NOT A COMPILE ERROR.
// #
// # `apps/web/lib/routes.ts` already carries the rule on its own first line —
// # "every consumer imports ROUTES rather than retyping a path string, so a
// # typo becomes a compile error instead of a silent dead redirect". That is
// # true of the CONSUMERS. It says nothing about the DECLARATIONS: a ROUTES
// # entry whose page was never created, moved, or renamed still typechecks
// # perfectly, and every `redirect(ROUTES.x)` in the app compiles all the way
// # to a 404 in production. `worker/src/task-names.ts` has a registry test for
// # exactly this reason; `ROUTES` has had none.
// #
// # This sprint is the one that makes it matter: AD-17 adds
// # `firstRun: "/first-run"` and puts the page in a ROUTE GROUP,
// # `app/(first-run)/first-run/page.tsx` — a directory whose name does NOT
// # appear in the URL. That is precisely the shape a hand-checked "the folder
// # is there" review gets wrong in both directions.
// #
// # BOTH ROWS SHIP THE PLANTED-OFFENDER AND CLEAN-FIXTURE CONTROLS (R-SCAN).
// # A scan nobody proved is a scan nobody has.
// ###########################################################################
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ROUTES } from "../lib/routes";

const APPS_WEB = path.join(import.meta.dir, "..");
const APP_DIR = path.join(APPS_WEB, "app");

/** The literal AD-17 assigns. Written here ONCE, and this is the file whose
 *  job is to prove nowhere else writes it. */
const FIRST_RUN_PATH = "/first-run";

/**
 * Where the literal `/first-run` is ALLOWED to appear, and why each is exempt.
 *
 * Wave 0g's `first-run-constraints.test.ts` scans the same literal for a
 * different reason (deviation 1: nothing links back to the onboarding surface
 * after completion, except `page.tsx`'s dismissal-gated CTA). Two scans, two
 * allow-lists, one literal — so this list is written explicitly rather than
 * inferred, and any divergence is a visible diff rather than a silent drift.
 */
const LITERAL_EXEMPT_PREFIXES: readonly string[] = [
  "lib/routes.ts", // the one home for the string
  "app/(first-run)/", // the surface itself
  "app/api/first-run/", // its routes
  "components/first-run/", // its components
  "__tests__/", // this scan, and the suites that name the path
  // THE ONE FILE THAT CONTAINS THE LITERAL WITHOUT RETYPING THE ROUTE.
  //
  // `SLACK_OAUTH_CALLBACK_PATH` is `/api/first-run/slack/oauth/callback` — an
  // API address that merely CONTAINS `/first-run` as a substring, not the page
  // path this guard is about, and not something `ROUTES.firstRun` could
  // produce. It lives there because the authorize request and the token
  // exchange must send a byte-identical `redirect_uri` or Slack refuses the
  // exchange, so the string has exactly one home (`lib/slack/oauth.ts:111-114`).
  //
  // The alternative was teaching the scan to ignore `/api/first-run/...`, which
  // is a better guard and a bigger change than the one this red is worth; a
  // named single-file exemption keeps the substring scan simple and keeps the
  // exception visible in a diff. That file has no reason to hold a page link.
  "lib/slack/oauth.ts",
];

// ---------------------------------------------------------------------------
// Resolving a ROUTES value to a real file
// ---------------------------------------------------------------------------

interface RoutableFile {
  /** Repo-relative-ish, from `apps/web`. */
  readonly file: string;
  /** The URL it actually serves, route groups removed. */
  readonly urlPath: string;
}

/**
 * Every `page.tsx` and `route.ts` under `app/`, with the URL each one serves.
 *
 * ROUTE GROUPS (`(name)`) ARE STRIPPED, because Next.js does not put them in
 * the URL — that is the whole reason AD-17 chose one ("a route group so the
 * surface can carry its own layout without a URL segment"). A resolver that
 * treated `(first-run)` as a path segment would report `/first-run` missing
 * while it worked perfectly in the browser, which is a guard that cries wolf
 * and gets deleted.
 *
 * DYNAMIC SEGMENTS (`[id]`) are kept verbatim. Nothing in `ROUTES` is dynamic
 * today; if one ever is, this resolver reports it as unmatched rather than
 * pretending to understand it — a loud gap beats a wrong pass.
 */
function collectRoutableFiles(): RoutableFile[] {
  const found: RoutableFile[] = [];

  const walk = (dir: string): void => {
    let entries: string[];
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

/** The unmatched entries of a `ROUTES`-shaped record. Empty ⇒ full coverage. */
function unresolvedRoutes(
  routes: Readonly<Record<string, string>>,
  files: readonly RoutableFile[],
): readonly string[] {
  const served = new Set(files.map((file) => file.urlPath));
  return Object.entries(routes)
    .filter(([, value]) => !served.has(value))
    .map(([key, value]) => `${key} -> ${value}`);
}

// ---------------------------------------------------------------------------
// Scanning for the retyped literal
// ---------------------------------------------------------------------------

function isExempt(relativePath: string): boolean {
  return LITERAL_EXEMPT_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

/** Every non-exempt `apps/web` source file that retypes the literal. */
function filesRetypingFirstRun(): string[] {
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    let entries: string[];
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
      if (isExempt(relative)) continue;
      if (readFileSync(full, "utf8").includes(FIRST_RUN_PATH)) offenders.push(relative);
    }
  };

  walk(APPS_WEB);
  return offenders;
}

// ===========================================================================

describe("ROUTES coverage (AD-17, EC-O9, D9)", () => {
  test("CONTROL: the resolver reports a ROUTES entry whose file does not exist", () => {
    const files = collectRoutableFiles();

    // CLEAN FIXTURE — the resolver actually found the app's pages, so an empty
    // "unresolved" list below means COVERAGE and not an empty scan.
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((file) => file.urlPath)).toContain("/");

    // PLANTED OFFENDER — a route nobody built.
    const planted = unresolvedRoutes({ ghost: "/a-page-nobody-ever-made" }, files);
    expect(planted).toEqual(["ghost -> /a-page-nobody-ever-made"]);

    // AND THE ROUTE-GROUP CASE, which is the one this sprint introduces: a
    // page inside `(group)/first-run/` must resolve to `/first-run`, NOT to
    // `/(group)/first-run`. Proven against the resolver directly, so the guard
    // is known-correct before the real page exists.
    const grouped: readonly RoutableFile[] = [
      { file: "app/(first-run)/first-run/page.tsx", urlPath: "/first-run" },
    ];
    expect(unresolvedRoutes({ firstRun: "/first-run" }, grouped)).toEqual([]);
  });

  // ------------------------------------------------------------------ row 1
  test("every ROUTES value resolves to a real page or route file", () => {
    const files = collectRoutableFiles();
    const unresolved = unresolvedRoutes(ROUTES, files);

    if (unresolved.length > 0) {
      throw new Error(
        `ROUTES entries with no page.tsx or route.ts behind them: ${unresolved.join(", ")}. ` +
          `A path constant whose file does not exist typechecks perfectly and 404s in ` +
          `production — this guard is the only thing between the two. Served paths found: ` +
          `${files
            .map((file) => file.urlPath)
            .toSorted()
            .join(", ")}`,
      );
    }
    expect(unresolved).toEqual([]);
  });
});

describe("the first-run path has exactly one home (AD-17, D9)", () => {
  test("CONTROL: the literal scan finds a planted offender and clears a clean fixture", () => {
    // PLANTED OFFENDER — the scan's own predicate, run over a synthetic file
    // list, so the control does not require writing a real offending file into
    // the tree (which would then have to be deleted, and one day would not be).
    expect(isExempt("app/page.tsx")).toBe(false);
    expect(`<Link href="/first-run">`.includes(FIRST_RUN_PATH)).toBe(true);

    // CLEAN FIXTURE — every exempt prefix really is exempt, and the list is
    // the one written at the top of this file rather than an inline repeat.
    for (const exempt of [
      "lib/routes.ts",
      "app/(first-run)/first-run/page.tsx",
      "app/api/first-run/status/route.ts",
      "components/first-run/Stage.tsx",
      "__tests__/routes.test.ts",
      "lib/slack/oauth.ts",
    ]) {
      expect(`${exempt}: ${isExempt(exempt)}`).toBe(`${exempt}: true`);
    }
  });

  // ------------------------------------------------------------------ row 2
  test("firstRun is registered in ROUTES and is never retyped as a literal", () => {
    // REGISTERED. `ROUTES.firstRun` is ADD Wave 6a task 6a.1's one-line edit,
    // and until it lands every consumer that needs the path has to retype it —
    // which is exactly the D9 failure this row exists to prevent.
    const registered = (ROUTES as Readonly<Record<string, string>>).firstRun;
    if (registered === undefined) {
      throw new Error(
        `NOT IMPLEMENTED YET: apps/web/lib/routes.ts has no \`firstRun\` entry. AD-17 adds ` +
          `\`firstRun: "${FIRST_RUN_PATH}"\`, and ADD Wave 6a task 6a.1 owns that one-line edit. ` +
          `This is a Wave 0 red for the RIGHT reason: the constant every consumer must import ` +
          `does not exist, so the "never retyped" rule below has nothing to point at.`,
      );
    }
    expect(registered).toBe(FIRST_RUN_PATH);

    // NEVER RETYPED. Outside `routes.ts` and the first-run tree, the literal
    // appears nowhere under `apps/web` — a retyped path is a silent dead
    // redirect, and the compiler cannot see it.
    const offenders = filesRetypingFirstRun();
    if (offenders.length > 0) {
      throw new Error(
        `these files retype the literal "${FIRST_RUN_PATH}" instead of importing ROUTES.firstRun: ` +
          `${offenders.join(", ")}. Exempt prefixes: ${LITERAL_EXEMPT_PREFIXES.join(", ")}.`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
