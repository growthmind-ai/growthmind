import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import oxlintrc from "../.oxlintrc.json";
import packageJson from "../package.json";

const REPO_ROOT = join(import.meta.dir, "..");

describe("type-aware lint gate", () => {
  test("oxlint is configured to run type-aware", () => {
    expect(oxlintrc.options?.typeAware).toBe(true);
  });

  test("the type-aware engine is a declared dev dependency", () => {
    expect(packageJson.devDependencies["oxlint-tsgolint"]).toBeString();
  });

  test("the tsgolint binary is actually on disk", () => {
    expect(
      existsSync(join(REPO_ROOT, "node_modules", "oxlint-tsgolint", "bin", "tsgolint.js")),
    ).toBe(true);
  });

  test("every rule switched off in .oxlintrc.json is one docs/stack.md accounts for", async () => {
    const stack = await Bun.file(join(REPO_ROOT, "docs", "stack.md")).text();

    const disabledTypeAwareRules = Object.entries(oxlintrc.rules)
      .filter(([name, severity]) => name.startsWith("typescript/") && severity === "off")
      .map(([name]) => name.slice("typescript/".length));

    expect(disabledTypeAwareRules.length).toBeGreaterThan(0);

    for (const rule of disabledTypeAwareRules) {
      expect(stack).toContain(rule);
    }
  });
});
