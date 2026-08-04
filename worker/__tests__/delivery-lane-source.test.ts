import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SOURCE = readFileSync(
  path.join(REPO_ROOT, "worker", "src", "delivery-lane-source.ts"),
  "utf8",
);

const LOCAL_FUNCTION = /\bfunction\s+toMeasuredCount\s*\(/;

const LOCAL_BINDING = /\b(?:const|let|var)\s+toMeasuredCount\s*[:=]/;

const CORE_IMPORT = /import\s*\{[^}]*\btoMeasuredCount\b[^}]*\}\s*from\s*["']@growthmind\/core["']/;

describe("worker/src/delivery-lane-source.ts", () => {
  // D12: two brand minters fork the moment `MeasuredCount` grows a field, and nothing
  // fails — the second minter just keeps producing the older shape.
  test("mints a measured count from a persisted row in exactly one place", () => {
    expect(LOCAL_FUNCTION.test(SOURCE)).toBe(false);
    expect(LOCAL_BINDING.test(SOURCE)).toBe(false);

    expect(CORE_IMPORT.test(SOURCE)).toBe(true);

    // The lane must still USE it, or the two rows above pass by deletion.
    expect(/\btoMeasuredCount\s*\(/.test(SOURCE)).toBe(true);
  });
});
