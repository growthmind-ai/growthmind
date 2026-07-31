// Guards BOTH Dockerfiles (worker and apps/web), not just the worker's — it
// lives here because worker/__tests__ already hosts the repo's structural
// checks and bun test discovers it.
//
// WHY THIS EXISTS: adding a workspace package and forgetting to COPY its
// manifest into the dependency-install layer breaks `docker compose up` from a
// clean clone — bun cannot resolve the `workspace:*` link, and the build dies
// in seconds. That is the self-host promise the compose CI job protects, and
// it costs a full CI round-trip to discover.
//
// It has now happened twice: `packages/adapters` (O-003) and `packages/core`
// (O-004), in consecutive sprints. It will happen every time a package is
// added, because nothing about creating a package reminds anyone about a
// Dockerfile. So the reminder is a failing test rather than a convention.
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

test.each(DOCKERFILES)("%s copies every workspace package manifest", (dockerfile) => {
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

test("the guard itself is not vacuous — it sees the real packages", () => {
  const packages = workspacePackages();
  expect(packages.length).toBeGreaterThan(1);
  expect(packages).toContain("shared");
});
