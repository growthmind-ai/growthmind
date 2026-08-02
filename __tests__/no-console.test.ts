import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * Application code. `scripts/` is deliberately absent: a CLI writing a report to
 * stdout is an interface, not logging, and `.oxlintrc.json` exempts it for the
 * same reason.
 */
const APPLICATION = /^(apps|packages|worker)\//;

const SKIPPED = [
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)__tests__\//,
  /^packages\/db\/drizzle\//,
  /\.d\.ts$/,
];

/** The logger is the one place a console call is the point. */
const THE_LOGGER = "packages/shared/src/logging/logger.ts";

const CONSOLE_CALL = /\bconsole\s*\.\s*(log|info|warn|error|debug|trace|table|dir)\s*\(/;

function offenders(): string[] {
  const found: string[] = [];

  for (const rel of new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: ROOT })) {
    const file = rel.replaceAll("\\", "/");
    if (!APPLICATION.test(file) || SKIPPED.some((pattern) => pattern.test(file))) continue;
    if (file === THE_LOGGER) continue;

    const lines = readFileSync(`${ROOT}/${file}`, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (CONSOLE_CALL.test(line)) found.push(`${file}:${index + 1} ${line.trim()}`);
    });
  }

  return found.toSorted();
}

describe("no console in application code", () => {
  test("every log goes through the logger, so it has a level and structured fields", () => {
    expect(offenders()).toEqual([]);
  });

  test("the logger itself is the only exemption, and it is still exercised", () => {
    const source = readFileSync(`${ROOT}/${THE_LOGGER}`, "utf8");
    expect(CONSOLE_CALL.test(source)).toBe(true);
  });

  test("the scanner fires on a known-positive control", () => {
    expect(CONSOLE_CALL.test('  console.error("boom", { error });')).toBe(true);
    expect(CONSOLE_CALL.test("console . log(x)")).toBe(true);
    expect(CONSOLE_CALL.test('logger.error("boom", { error });')).toBe(false);
  });
});
