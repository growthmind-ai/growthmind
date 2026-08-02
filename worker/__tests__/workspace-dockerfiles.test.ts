import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCKERFILES = ["worker/Dockerfile", "apps/web/Dockerfile"] as const;

function workspacePackages(): string[] {
  const packagesDir = path.join(REPO_ROOT, "packages");
  return readdirSync(packagesDir).filter((entry) => {
    const full = path.join(packagesDir, entry);
    return statSync(full).isDirectory() && existsPackageJson(full);
  });
}

function existsPackageJson(dir: string): boolean {
  try {
    return statSync(path.join(dir, "package.json")).isFile();
  } catch {
    return false;
  }
}

for (const dockerfile of DOCKERFILES) {
  test(`${dockerfile} copies every workspace package manifest`, () => {
    const contents = readFileSync(path.join(REPO_ROOT, dockerfile), "utf-8");
    const missing = workspacePackages().filter(
      (pkg) => !contents.includes(`packages/${pkg}/package.json`),
    );

    expect(
      missing,
      `${dockerfile} is missing COPY lines for: ${missing.join(", ")}. ` +
        `Without them bun install cannot resolve the workspace:* link and ` +
        `\`docker compose up\` from a clean clone fails. Add: ` +
        missing.map((pkg) => `COPY packages/${pkg}/package.json packages/${pkg}/`).join(" ; "),
    ).toEqual([]);
  });
}

test("the guard itself is not vacuous — it sees the real packages", () => {
  const packages = workspacePackages();
  expect(packages.length).toBeGreaterThan(1);
  expect(packages).toContain("shared");
});
