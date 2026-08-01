// Wave 0 (red), `mcp-read-credential`, "Structural gates (source scans, non-vacuity
// required)", all 5 rows.
//
// `packages/db/src/admin/` is an unscoped cross-tenant enumeration by construction: it
// must list every organisation before any scope exists, because a CLI has no session to
// derive scope from. Its only two defences are the `"./admin"` subpath, which keeps a
// violating import to a single greppable line, and this file, which turns that
// convention into a gate. Modelled on
// `packages/db/__tests__/system/reachability.test.ts`, with one deliberate difference:
// `scripts/` is allowed here, because `scripts/` is exactly and only where this module
// is meant to be reached from.
//
// Which rows are red today, and why that is correct:
// The three structural rows (no importer, not on the barrel, walker
//  non-vacuity) and the matcher's positive control hold against an empty
//  tree already. They are guardrails, exactly as items 83-85 of the system
//  version are — their job starts the moment someone reaches for a
//  shortcut, and a guardrail that only starts working after the violation
//  exists is not a guardrail.
// The CLI purity row is red until Wave 5 writes the two scripts. It is
//  the seam gate: if the UI has to re-implement minting, this
//  sprint got the seam wrong, and this row is what notices.
//
// Per add OQ-3 the matcher's positive control is a synthetic source string, never a
// fixed barrel export list. Appending its own exports must not break this file.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "bun:test";

import * as dbBarrel from "../../src/index";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const ADMIN_DIR_POSIX = "packages/db/src/admin";
const ADMIN_SUBPATH = "@growthmind/db/admin";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".ai",
  ".claude",
  "tasks",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

function posix(file: string): string {
  return file.split(path.sep).join("/");
}

function relative(file: string): string {
  return posix(path.relative(REPO_ROOT, file));
}

// Every file the gate covers: `apps/`, `worker/`, and every package's own `src`
// directory. `scripts/` is deliberately absent (it is the one allowed caller) and each
// package's `__tests__` is out of scope because the walk starts at its `src`.
function scannedFiles(): string[] {
  const roots = [path.join(REPO_ROOT, "apps"), path.join(REPO_ROOT, "worker")];

  for (const entry of readdirSync(path.join(REPO_ROOT, "packages"))) {
    const src = path.join(REPO_ROOT, "packages", entry, "src");
    if (existsSync(src)) {
      roots.push(src);
    }
  }

  return roots.flatMap((root) => listSourceFiles(root));
}

/**
 * The matcher. Returns every module specifier in `source` that reaches
 * `packages/db/src/admin`, by any of the three routes available:
 * 1. the published subpath, `@growthmind/db/admin`
 * 2. a workspace-relative path naming the directory outright
 * 3. a relative specifier that resolves into it. The form a file inside
 *  `packages/db/src` would use, and the one a plain substring scan misses
 *
 * Resolving rather than pattern-matching `/admin` keeps the gate from firing on an
 * unrelated directory that happens to be named `admin`, so a future failure here is
 * always a real violation.
 */
function adminImportsIn(source: string, fromFile: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier === undefined) {
      continue;
    }

    if (specifier === ADMIN_SUBPATH || specifier.startsWith(`${ADMIN_SUBPATH}/`)) {
      specifiers.push(specifier);
      continue;
    }

    if (posix(specifier).includes(ADMIN_DIR_POSIX)) {
      specifiers.push(specifier);
      continue;
    }

    if (specifier.startsWith(".")) {
      const resolved = posix(path.resolve(path.dirname(fromFile), specifier));
      const adminDir = posix(path.resolve(REPO_ROOT, ADMIN_DIR_POSIX));
      if (resolved === adminDir || resolved.startsWith(`${adminDir}/`)) {
        specifiers.push(specifier);
      }
    }
  }

  return specifiers;
}

describe("admin subpath unreachability", () => {
  it("should be imported by no file under apps/, worker/ or packages/*/src", () => {
    const files = scannedFiles();

    const offenders = files.filter(
      (file) => adminImportsIn(readFileSync(file, "utf8"), file).length > 0,
    );

    expect(offenders.map(relative)).toEqual([]);
  });

  it("should not be re-exported from the main barrel", () => {
    const barrelPath = path.join(REPO_ROOT, "packages", "db", "src", "index.ts");
    const barrel = readFileSync(barrelPath, "utf8");
    const withoutComments = barrel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

    expect(adminImportsIn(withoutComments, barrelPath)).toEqual([]);

    // The runtime half: nothing from `admin/` reaches a caller that imported
    // `@growthmind/db`. A source-level check alone would miss a re-export routed
    // through another module.
    const exported = Object.keys(dbBarrel);
    expect(exported).not.toContain("resolveOrganizationForCli");

    // Not vacuous: the barrel really is loaded and really does export the scoped
    // surface. One stable symbol, not a fixed list. Appending exports must not break
    // this.
    expect(exported).toContain("createWriteKeysRepo");
  });

  it("should actually read the files it claims to check", () => {
    const files = scannedFiles().map(relative);

    expect(files.length).toBeGreaterThan(0);
    // Known files that must be in the scanned set. The composition root that would be
    // the most tempting place to import an unscoped enumeration from, and the barrel
    // this gate is about.
    expect(files).toContain("apps/web/app/api/mcp/route.ts");
    expect(files).toContain("packages/db/src/index.ts");

    // And `scripts/` is deliberately not scanned: it is the one allowed caller, so a
    // scan that covered it would fail the moment Wave 5 lands.
    expect(files.some((file) => file.startsWith("scripts/"))).toBe(false);
    expect(files.some((file) => file.includes("node_modules"))).toBe(false);
  });

  it("should notice a violating import", () => {
    // Synthetic sources, never files on disk. This row proves the matcher can
    // fail, which is the only thing that makes the empty result above mean anything.
    const routeFile = path.join(REPO_ROOT, "apps", "web", "app", "api", "mcp", "route.ts");
    expect(
      adminImportsIn(`import { resolveOrganizationForCli } from "${ADMIN_SUBPATH}";\n`, routeFile),
    ).toEqual([ADMIN_SUBPATH]);

    // The workspace-relative form a script-shaped import would take.
    expect(
      adminImportsIn(
        `import { resolveOrganizationForCli } from "../../${ADMIN_DIR_POSIX}";\n`,
        routeFile,
      ),
    ).toEqual([`../../${ADMIN_DIR_POSIX}`]);

    // The relative form only a file inside packages/db/src can write. The barrel
    // re-export that would undo the whole boundary.
    const barrelFile = path.join(REPO_ROOT, "packages", "db", "src", "index.ts");
    expect(adminImportsIn(`export * from "./admin";\n`, barrelFile)).toEqual(["./admin"]);
    expect(adminImportsIn(`export { x } from "./admin/organizations";\n`, barrelFile)).toEqual([
      "./admin/organizations",
    ]);

    // Negative control: an ordinary import is not flagged, so the matcher is
    // discriminating rather than always-true.
    expect(adminImportsIn(`import { eq } from "drizzle-orm";\n`, barrelFile)).toEqual([]);
    expect(adminImportsIn(`export * from "./system";\n`, barrelFile)).toEqual([]);
  });
});

describe("CLI purity", () => {
  const CLI_FILES = ["scripts/mint-api-key.ts", "scripts/revoke-api-key.ts"];

  it("should keep the CLIs free of credential logic", () => {
    for (const relativePath of CLI_FILES) {
      const full = path.join(REPO_ROOT, ...relativePath.split("/"));
      // Named explicitly so the red reads "the script is missing", not "enoent" from a
      // readFileSync deep inside a loop.
      expect(existsSync(full)).toBe(true);

      const source = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");

      // No minting, no hashing, no persistence, no query builder. If any of these
      // appears here, the seam is in the wrong place and the UI will have to
      // re-implement it.
      expect(source).not.toMatch(/\brandomBytes\b/);
      expect(source).not.toMatch(/\bcreateHash\b/);
      expect(source).not.toMatch(/\.insert\(/);
      expect(source).not.toMatch(/\.update\(/);
      expect(source).not.toMatch(/["']drizzle-orm(?:\/[^"']*)?["']/);

      // The key is never written to a file. Both script headers promise this in prose
      // and both honour it, `process.stdout.write` is the only output call either one
      // makes, but prose is not a gate, and this is the single most consequential
      // property of a script whose whole job is handling raw credential material. A key
      // that lands in a file outlives the terminal it was printed to, survives into
      // `git status`, and gets committed by the next `git add.`. One `writeFileSync`
      // for "operator convenience" is all it would take, and nothing else here would
      // notice.
      expect(source).not.toMatch(/writeFileSync|writeFile|appendFile|createWriteStream|Bun\.write/);

      // The non-vacuity half, built in: the scan really read a script that does the job
      // through the shared seam, not an empty file that passes every negative above.
      expect(source).toContain("createApiKeysRepo");
      expect(source).toContain("resolveOrganizationForCli");
    }
  });
});
