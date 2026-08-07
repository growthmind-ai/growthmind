// REHOMED from __tests__/companies/identity-key-guard.test.ts, assertion intact — the original
// is deleted in wave 7 with the rest of that suite. D-10 Layer 2 + D9: the replay surface reads
// sessions whose identityKey must never leave the DTO boundary, and any recording-id parse must
// go through the named recordingIdFromSessionKey helper beside deriveSessionKey
// (packages/shared/src/sessions/grouping.ts) rather than an inline "ph:" substring check.
//
// The guard gets MORE relevant with the deletion, not less. /companies was one consumer of
// recordingIdFromSessionKey; the company filter panel is its replacement, and the sweep below is
// widened from the four companies directories to the replay surface that inherits the job.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const APPS_WEB = path.join(import.meta.dir, "..", "..");

const GUARDED_DIRS: readonly string[] = [
  "app/(app)/replays",
  "app/api/replays",
  "components/replay",
  "components/replay/filters",
  "lib/replay",
];

// The replay surface holds 12 .ts/.tsx files today and grows through this sprint. 5 is
// comfortably below that real count and above zero, so a future accidental near-empty glob — a
// directory renamed, a path typo — still fails loudly instead of passing vacuously. Every check
// below filters a file list, and filtering nothing finds nothing.
const MINIMUM_EXPECTED_FILES = 5;

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
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(full);
    }
  };

  walk(dir);
  return found;
}

function guardedFiles(): readonly string[] {
  return [...new Set(GUARDED_DIRS.flatMap(sourceFilesUnder))];
}

function relative(file: string): string {
  return path.relative(APPS_WEB, file).split(path.sep).join("/");
}

describe('no identityKey or inline "ph:" check leaks into the replay surface (D9, D-10 Layer 2)', () => {
  test("scans real files before trusting an empty pass, then finds zero identityKey/ph: leaks", () => {
    const files = guardedFiles();

    // This assertion must run, and fail, BEFORE the leak checks below: an empty glob would
    // otherwise make every leak check pass vacuously, which is a guard that looks green while
    // proving nothing.
    if (files.length < MINIMUM_EXPECTED_FILES) {
      throw new Error(
        `found only ${files.length} .ts/.tsx file(s) under ${GUARDED_DIRS.join(", ")} ` +
          `(expected at least ${MINIMUM_EXPECTED_FILES}). The identityKey/"ph:" checks below ` +
          `would silently pass over nothing and give false confidence that nothing leaks.`,
      );
    }
    expect(files.length).toBeGreaterThanOrEqual(MINIMUM_EXPECTED_FILES);

    const identityKeyLeaks = files.filter((file) =>
      readFileSync(file, "utf8").includes("identityKey"),
    );
    if (identityKeyLeaks.length > 0) {
      throw new Error(
        `identityKey reaches the replay surface in ${identityKeyLeaks.map(relative).join(", ")}. ` +
          `It is a derived personal identifier and must not leave the DTO boundary — no ` +
          `personal data in the event stream, and none on the way back out of it either.`,
      );
    }
    expect(identityKeyLeaks).toEqual([]);

    // grouping.ts is the one file allowed to hold the literal check — it is the named helper
    // (recordingIdFromSessionKey) every other file must call instead of re-deriving it inline.
    // One place derives a recording id from a session key, and it survives the surface that
    // used to own it.
    const inlinePhChecks = files.filter((file) => {
      if (path.basename(file) === "grouping.ts") return false;
      return readFileSync(file, "utf8").includes('.startsWith("ph:")');
    });
    if (inlinePhChecks.length > 0) {
      throw new Error(
        `${inlinePhChecks.map(relative).join(", ")} derive a recording id from a "ph:" prefix ` +
          `inline. Call recordingIdFromSessionKey from @growthmind/shared instead: a second ` +
          `copy of the session-key format forks the moment deriveSessionKey changes, and ` +
          `nothing would fail when it does.`,
      );
    }
    expect(inlinePhChecks).toEqual([]);
  });
});
