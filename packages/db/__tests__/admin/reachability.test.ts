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

    const exported = Object.keys(dbBarrel);
    expect(exported).not.toContain("resolveOrganizationForCli");

    expect(exported).toContain("createWriteKeysRepo");
  });

  it("should actually read the files it claims to check", () => {
    const files = scannedFiles().map(relative);

    expect(files.length).toBeGreaterThan(0);

    expect(files).toContain("apps/web/app/api/mcp/route.ts");
    expect(files).toContain("packages/db/src/index.ts");

    expect(files.some((file) => file.startsWith("scripts/"))).toBe(false);
    expect(files.some((file) => file.includes("node_modules"))).toBe(false);
  });

  it("should notice a violating import", () => {
    const routeFile = path.join(REPO_ROOT, "apps", "web", "app", "api", "mcp", "route.ts");
    expect(
      adminImportsIn(`import { resolveOrganizationForCli } from "${ADMIN_SUBPATH}";\n`, routeFile),
    ).toEqual([ADMIN_SUBPATH]);

    expect(
      adminImportsIn(
        `import { resolveOrganizationForCli } from "../../${ADMIN_DIR_POSIX}";\n`,
        routeFile,
      ),
    ).toEqual([`../../${ADMIN_DIR_POSIX}`]);

    const barrelFile = path.join(REPO_ROOT, "packages", "db", "src", "index.ts");
    expect(adminImportsIn(`export * from "./admin";\n`, barrelFile)).toEqual(["./admin"]);
    expect(adminImportsIn(`export { x } from "./admin/organizations";\n`, barrelFile)).toEqual([
      "./admin/organizations",
    ]);

    expect(adminImportsIn(`import { eq } from "drizzle-orm";\n`, barrelFile)).toEqual([]);
    expect(adminImportsIn(`export * from "./system";\n`, barrelFile)).toEqual([]);
  });
});

describe("CLI purity", () => {
  const CLI_FILES = ["scripts/mint-api-key.ts", "scripts/revoke-api-key.ts"];

  it("should keep the CLIs free of credential logic", () => {
    for (const relativePath of CLI_FILES) {
      const full = path.join(REPO_ROOT, ...relativePath.split("/"));

      expect(existsSync(full)).toBe(true);

      const source = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");

      expect(source).not.toMatch(/\brandomBytes\b/);
      expect(source).not.toMatch(/\bcreateHash\b/);
      expect(source).not.toMatch(/\.insert\(/);
      expect(source).not.toMatch(/\.update\(/);
      expect(source).not.toMatch(/["']drizzle-orm(?:\/[^"']*)?["']/);

      expect(source).not.toMatch(/writeFileSync|writeFile|appendFile|createWriteStream|Bun\.write/);

      expect(source).toContain("createApiKeysRepo");
      expect(source).toContain("resolveOrganizationForCli");
    }
  });
});
