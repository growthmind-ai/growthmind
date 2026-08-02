import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ROUTES } from "../lib/routes";

const APPS_WEB = path.join(import.meta.dir, "..");
const APP_DIR = path.join(APPS_WEB, "app");

const FIRST_RUN_PATH = "/first-run";

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

interface RoutableFile {
  readonly file: string;

  readonly urlPath: string;
}

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

function unresolvedRoutes(
  routes: Readonly<Record<string, string>>,
  files: readonly RoutableFile[],
): readonly string[] {
  const served = new Set(files.map((file) => file.urlPath));
  return Object.entries(routes)
    .filter(([, value]) => !served.has(value))
    .map(([key, value]) => `${key} -> ${value}`);
}

function isExempt(relativePath: string): boolean {
  return LITERAL_EXEMPT_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

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

describe("ROUTES coverage (AD-17, EC-O9, D9)", () => {
  test("CONTROL: the resolver reports a ROUTES entry whose file does not exist", () => {
    const files = collectRoutableFiles();

    expect(files.length).toBeGreaterThan(0);
    expect(files.map((file) => file.urlPath)).toContain("/");

    const planted = unresolvedRoutes({ ghost: "/a-page-nobody-ever-made" }, files);
    expect(planted).toEqual(["ghost -> /a-page-nobody-ever-made"]);

    const grouped: readonly RoutableFile[] = [
      { file: "app/(first-run)/first-run/page.tsx", urlPath: "/first-run" },
    ];
    expect(unresolvedRoutes({ firstRun: "/first-run" }, grouped)).toEqual([]);
  });

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
    expect(isExempt("app/page.tsx")).toBe(false);
    expect(`<Link href="/first-run">`.includes(FIRST_RUN_PATH)).toBe(true);

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

  test("firstRun is registered in ROUTES and is never retyped as a literal", () => {
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
