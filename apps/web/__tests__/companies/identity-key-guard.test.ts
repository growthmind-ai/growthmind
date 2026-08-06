// D-10 Layer 2 + D9 (edge-case-taxonomy.md): the companies surface reads sessions whose
// identityKey must never leave the DTO boundary, and any recording-id parse must go through
// the named recordingIdFromSessionKey helper beside deriveSessionKey
// (packages/shared/src/sessions/grouping.ts) rather than an inline "ph:" substring check. This
// mirrors cross-tenant.test.ts's own source-grep precedent ("scopes every sessions and events
// read through the scope helper"), widened to a directory glob because the companies surface
// spans four directories, none of which exist yet at Wave 0.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const APP_DIR = path.join(import.meta.dir, "..", "..", "app");
const LIB_DIR = path.join(import.meta.dir, "..", "..", "lib");
const COMPONENTS_DIR = path.join(import.meta.dir, "..", "..", "components");

const GUARDED_DIRS: readonly string[] = [
  path.join(APP_DIR, "api", "companies"),
  path.join(APP_DIR, "(app)", "companies"),
  path.join(COMPONENTS_DIR, "companies"),
  path.join(LIB_DIR, "companies"),
];

// Wave 1+ of this sprint creates 13 files across these four directories (dto/deps/refusals,
// two routes, six components, two pages). 5 is comfortably below that real count and above
// zero, so a future accidental near-empty glob still fails loudly instead of passing vacuously.
const MINIMUM_EXPECTED_FILES = 5;

function sourceFilesUnder(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];

  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const full = path.join(at, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(full);
    }
  };

  walk(dir);
  return found;
}

describe("no identityKey or inline \"ph:\" check leaks into the companies surface (D9, D10 Layer 2)", () => {
  test("scans real files before trusting an empty pass, then finds zero identityKey/ph: leaks", () => {
    const files = GUARDED_DIRS.flatMap(sourceFilesUnder);

    // This assertion must run, and fail, BEFORE the leak checks below: an empty glob would
    // otherwise make every leak check pass vacuously (filtering nothing finds nothing), which
    // is a guard that looks green while proving nothing. None of the four directories exist
    // yet at Wave 0, so this is the RED signal for this test right now.
    if (files.length < MINIMUM_EXPECTED_FILES) {
      throw new Error(
        `found only ${files.length} .ts/.tsx file(s) under ${GUARDED_DIRS.join(", ")} ` +
          `(expected at least ${MINIMUM_EXPECTED_FILES}). This is expected to fail in Wave 0 — ` +
          `none of these directories exist yet. Once later waves add the companies surface, this ` +
          `must find real files, or the identityKey/"ph:" checks below would silently pass over ` +
          `nothing and give false confidence that nothing leaks.`,
      );
    }
    expect(files.length).toBeGreaterThanOrEqual(MINIMUM_EXPECTED_FILES);

    const identityKeyLeaks = files.filter((file) => readFileSync(file, "utf8").includes("identityKey"));
    expect(identityKeyLeaks).toEqual([]);

    // grouping.ts is the one file allowed to hold the literal check — it is the named helper
    // (recordingIdFromSessionKey) every other file must call instead of re-deriving it inline.
    const inlinePhChecks = files.filter((file) => {
      if (path.basename(file) === "grouping.ts") return false;
      return readFileSync(file, "utf8").includes('.startsWith("ph:")');
    });
    expect(inlinePhChecks).toEqual([]);
  });
});
