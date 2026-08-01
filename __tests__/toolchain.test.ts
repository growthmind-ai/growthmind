// THE LINT GATE PROVES ITSELF (docs/stack.md, "Lint is type-aware").
//
// `bun run lint` is type-aware: `.oxlintrc.json` sets `options.typeAware`, and
// oxlint resolves types through the `oxlint-tsgolint` package. That is two
// separate things that have to be true at once, connected by nothing but a
// dev-dependency entry — and if either end goes missing, the failure is a
// SILENT DOWNGRADE rather than an error. Lint still runs, still exits 0, still
// prints nothing alarming; it just stops checking the class of bug it was
// added for, and CI goes on reporting green.
//
// That is the D11 shape (a value produced at one end, consumed at another,
// with no test on the wire between them), so this file is the test on the
// wire. It costs milliseconds and it is the only thing standing between a
// dropped optional dependency and a gate that quietly stops gating.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import oxlintrc from "../.oxlintrc.json";
import packageJson from "../package.json";

const REPO_ROOT = join(import.meta.dir, "..");

describe("type-aware lint gate", () => {
  test("oxlint is configured to run type-aware", () => {
    // The flag itself. Without it, oxlint runs the syntax-only pass and every
    // type-aware rule — no-floating-promises above all — is inert.
    expect(oxlintrc.options?.typeAware).toBe(true);
  });

  test("the type-aware engine is a declared dev dependency", () => {
    // oxlint declares `oxlint-tsgolint` as an OPTIONAL peer, so nothing in the
    // install graph forces it. Our own devDependencies entry is the only thing
    // that does.
    expect(packageJson.devDependencies["oxlint-tsgolint"]).toBeString();
  });

  test("the tsgolint binary is actually on disk", () => {
    // The declaration is not the install. A platform with no published binary,
    // or an `--omit=optional` install, satisfies the two assertions above and
    // still cannot resolve types.
    expect(
      existsSync(join(REPO_ROOT, "node_modules", "oxlint-tsgolint", "bin", "tsgolint.js")),
    ).toBe(true);
  });

  test("every rule switched off in .oxlintrc.json is one docs/stack.md accounts for", async () => {
    // Ten type-aware rules are deliberately off, each with an entry in the
    // deferred-rules table in docs/stack.md. This asserts the table and the
    // config cannot drift: a rule silently added to the "off" list without a
    // written reason is how a lint config rots into permission to ignore it.
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
