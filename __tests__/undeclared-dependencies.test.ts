// A PACKAGE MAY ONLY IMPORT WHAT SOMETHING INSTALLS FOR IT.
//
// THE INCIDENT THIS FILE EXISTS FOR.
//
// Four test files under `apps/web/__tests__/api/first-run/` imported `eq` from
// `drizzle-orm`. `apps/web/package.json` does not declare `drizzle-orm` and never
// has — `packages/db` owns the database and owns that dependency. Every local gate
// passed anyway: `bun run typecheck`, `bun run lint`, `bun test`, `bun run build`,
// all green, because a developer's `node_modules` had accumulated a reachable copy
// over many installs. CI runs `bun install --frozen-lockfile` into an empty tree,
// where nothing puts `drizzle-orm` anywhere `apps/web` can see it, and the build
// died on four `TS2307`s that no one could reproduce locally.
//
// THE FAILURE SHAPE IS THE POINT, NOT THE PACKAGE NAME. An import is checked
// against whatever happens to be on disk, and what is on disk locally is the union
// of every install anyone has ever run. What is on disk in CI is exactly what the
// manifests asked for. The two agree until they don't, and when they stop agreeing
// the report lands on the wrong machine, in the wrong vocabulary, on somebody
// else's pull request. For a public repository that is the worst possible place to
// spend a first-time contributor's patience: their change was fine, the error names
// a file they never opened, and the only way to see it is to push again.
//
// So the check is moved to where the mistake is made. This file re-derives, from
// the manifests alone, what each package is ALLOWED to reach, and reads every
// tracked source file to find out what it actually reaches. It runs in `bun test`,
// it costs about a second, and it names the package, the specifier, the file, the
// line, and the fix.
//
// WHAT COUNTS AS "INSTALLED FOR IT", PRECISELY. Node resolution walks up from the
// importing file, so a workspace member can reach two things: its own manifest's
// dependencies (bun's isolated layout puts them under the member), and the ROOT
// manifest's dependencies (they sit at the top of that walk, and `bun install
// --frozen-lockfile` at the root installs them in CI too). It cannot reach a
// SIBLING'S dependencies, which is the entire drizzle incident. Node builtins and
// `bun:*` are free. Everything else is a finding.
//
// The root allowance is real, so it is written down rather than assumed — DEP-5
// pins the exact set of packages using it, with a reason each, and fails both when
// the set grows and when an entry goes stale.
//
// THIS DOES NOT SUBSUME `apps/web/__tests__/mcp/no-direct-zod.test.ts`, AND MUST
// NOT REPLACE IT. That file asserts a DELIBERATE ABSENCE — `apps/web` must never
// declare `zod`, so the MCP tool schemas can only ever be declared once, in
// `packages/shared`. The claim there is about a dependency that must not be added
// even though adding it would work. The claim here is the converse: everything
// imported must be declared. A repository can satisfy this file completely by
// adding `zod` to `apps/web/package.json`, which is exactly what WIRE-Z1 forbids.
// Two opposite directions on the same edge; both are needed, neither covers the
// other. WIRE-Z1 also probes RESOLUTION (it imports and asserts the failure), which
// no manifest walk can do.
//
// THE SCANNER LIVES BESIDE ITS CONTROLS, deliberately, and per the standing rule
// the first-run suites already follow: a scanner in one file and its planted
// offender in another is a scanner nobody can see has gone vacuous. DEP-2 plants
// the incident into a synthetic workspace and proves it is reported. DEP-3 pins the
// extractor against every import form the incident could hide in — type-only,
// dynamic, re-exported — and against the three places a specifier may appear
// WITHOUT being an import, which is what stops this file failing on the planted
// fixtures that other suites in this repository keep in template literals.
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = path.join(import.meta.dir, "..");

const repoRelative = (absolute: string): string =>
  path.relative(REPO_ROOT, absolute).split(path.sep).join("/");

// ===========================================================================
// The manifests — self-enumerating, never listed
// ===========================================================================

/** One package the scan attributes files to, and what it is allowed to reach. */
interface Workspace {
  /** The manifest `name`. Lands verbatim in every failure message. */
  readonly name: string;
  /** Repo-relative directory. `""` for the repository root itself. */
  readonly dir: string;
  /** Repo-relative manifest path — where a contributor goes to fix a finding. */
  readonly manifest: string;
  /** Every name in every dependency field of that manifest. */
  readonly declares: ReadonlySet<string>;
  /** True only for the repository root, whose reach is different (see below). */
  readonly isRoot: boolean;
}

interface RawManifest {
  readonly name?: string;
  readonly workspaces?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

const readManifest = (relativeDir: string): RawManifest => {
  const manifestPath = path.join(REPO_ROOT, relativeDir, "package.json");
  return JSON.parse(readFileSync(manifestPath, "utf8")) as RawManifest;
};

const declaredNames = (manifest: RawManifest): ReadonlySet<string> =>
  new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);

const ROOT_MANIFEST = readManifest(".");

/**
 * Every workspace directory, expanded from the root manifest's own `workspaces`
 * globs rather than listed here.
 *
 * A hard-coded list would keep passing while a NEW workspace member — the one most
 * likely to be written by somebody who has not read this file — slipped out of the
 * scan entirely. The globs this repository uses are the plain `dir/*` and
 * bare-directory forms; anything more exotic would have to be taught here, and
 * DEP-4 fails loudly if the expansion stops finding members.
 */
function workspaceDirectories(): readonly string[] {
  const found: string[] = [];

  for (const glob of ROOT_MANIFEST.workspaces ?? []) {
    if (glob.endsWith("/*")) {
      const parent = glob.slice(0, -2);
      const entries = new Bun.Glob("*/package.json").scanSync({
        cwd: path.join(REPO_ROOT, parent),
        onlyFiles: true,
      });
      for (const entry of entries) {
        found.push(`${parent}/${path.dirname(entry).split(path.sep).join("/")}`);
      }
      continue;
    }
    found.push(glob);
  }

  return found.toSorted();
}

const WORKSPACES: readonly Workspace[] = workspaceDirectories().map((dir) => {
  const manifest = readManifest(dir);
  return {
    name: manifest.name ?? dir,
    dir,
    manifest: `${dir}/package.json`,
    declares: declaredNames(manifest),
    isRoot: false,
  };
});

/**
 * The repository root, as a package in its own right.
 *
 * `scripts/` and this directory are not inside any workspace, so nothing else would
 * attribute them — and they are exactly where a one-off operator script gets
 * written against a package nobody installed. Its reach is genuinely wider than a
 * member's: a workspace member is symlinked into the root's own `node_modules` by
 * `bun install`, so the root may import `@growthmind/*` without declaring it.
 */
const ROOT: Workspace = {
  name: ROOT_MANIFEST.name ?? "growthmind",
  dir: "",
  manifest: "package.json",
  declares: declaredNames(ROOT_MANIFEST),
  isRoot: true,
};

const WORKSPACE_NAMES: ReadonlySet<string> = new Set(WORKSPACES.map((w) => w.name));

/** Which workspace packages declare a given specifier — the "import it from here" hint. */
const declaringWorkspaces = (packageName: string): readonly string[] =>
  WORKSPACES.filter((w) => w.declares.has(packageName)).map((w) => w.name);

// ===========================================================================
// The extractor — what a file actually imports
// ===========================================================================

const BUILTINS: ReadonlySet<string> = new Set(builtinModules);

/**
 * Rewrite type-only import syntax into its value-carrying equivalent.
 *
 * ⚠️ LOAD-BEARING, AND THE ONE PIECE THAT CAN ROT SILENTLY. `Bun.Transpiler`'s
 * scanner does the lexing here — it is the only thing in reach that reliably tells
 * a real import from the same words inside a comment, a string or a regex literal —
 * but it reports what SURVIVES transpilation, and a type-only import is erased.
 * `import type { Foo } from "drizzle-orm"` is invisible to it, and that import
 * fails `tsc` with the same TS2307 as any other. So the type keyword is blanked
 * first, in the three places it can appear on an import, and DEP-3 pins all three.
 *
 * Blanking rather than deleting keeps the source the same length, so nothing this
 * does can move a line. Firing inside a comment or a string is harmless: the
 * transpiler ignores those regions either way.
 */
function asValueImports(source: string): string {
  let rewritten = source.replace(/^#![^\n]*/, "");

  // `import type X from "p"`, `import type { X } from "p"`.
  rewritten = rewritten.replace(/\bimport(\s+)type(\s)/g, (_match, gap: string, tail: string) =>
    "import".concat(gap, "    ", tail),
  );

  // `export type { X } from "p"`, `export type * from "p"`. Restricted to `{`/`*`
  // so it cannot touch a `export type Foo = …` declaration, which is not an import
  // and which becomes a syntax error the moment the keyword is removed.
  rewritten = rewritten.replace(
    /\bexport(\s+)type(\s*[{*])/g,
    (_match, gap: string, tail: string) => "export".concat(gap, "    ", tail),
  );

  // `import { type X } from "p"` — an import statement whose every binding is a
  // type is erased whole. Confined to a brace list that is followed by `from` and a
  // specifier, so nothing outside an import statement's head is touched.
  rewritten = rewritten.replace(
    /\b(?:import|export)\s*\{[^}]*\}\s*from\s*["'][^"']+["']/g,
    (statement) => statement.replace(/\btype\s/g, "     "),
  );

  return rewritten;
}

const TS_TRANSPILER = new Bun.Transpiler({ loader: "ts" });
const TSX_TRANSPILER = new Bun.Transpiler({ loader: "tsx" });

/** Every specifier a file imports, in any form, including type-only ones. */
function importedSpecifiers(source: string, file: string): readonly string[] {
  const transpiler = file.endsWith(".tsx") ? TSX_TRANSPILER : TS_TRANSPILER;

  try {
    return transpiler.scanImports(asValueImports(source)).map((found) => found.path);
  } catch (error) {
    // Never swallowed. A file the scanner cannot read is a file the scanner is not
    // checking, and a silently skipped file is how this whole guard becomes
    // decoration.
    throw new Error(`undeclared-dependencies: could not scan ${file} for imports`, {
      cause: error,
    });
  }
}

/**
 * The package a specifier belongs to: `@scope/name`, or `name`, or `null` when the
 * specifier is not a package at all.
 *
 * `null` covers relative paths, absolute paths, the `@/…` tsconfig alias `apps/web`
 * uses for its own tree, `node:`/`bun:` prefixes, and bare Node builtins.
 */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@/")) {
    return null;
  }
  if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier === "bun") {
    return null;
  }

  const segments = specifier.split("/");
  const name = specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? specifier);

  return BUILTINS.has(name) ? null : name;
}

/** The first line the specifier is written on, 1-based; `0` when it cannot be found. */
function lineOf(source: string, specifier: string): number {
  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.includes(`"${specifier}"`) || line.includes(`'${specifier}'`)) {
      return index + 1;
    }
  }
  return 0;
}

// ===========================================================================
// The rule
// ===========================================================================

interface SourceFile {
  readonly file: string;
  readonly source: string;
  readonly owner: Workspace;
}

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly packageName: string;
  readonly owner: Workspace;
  /** Workspace packages that DO declare it — the import-from-the-owner hint. */
  readonly declaredBy: readonly string[];
}

interface Scan {
  /** Imports nothing installs for the importing package. These fail the build. */
  readonly undeclared: readonly Finding[];
  /** Imports reachable only because the ROOT manifest declares them. DEP-5 pins these. */
  readonly viaRoot: readonly Finding[];
  /** Accepted package imports, `package → specifier`. DEP-4's proof the walk is not empty. */
  readonly accepted: readonly { readonly owner: string; readonly specifier: string }[];
}

interface World {
  readonly root: Workspace;
  readonly workspaceNames: ReadonlySet<string>;
  readonly declaringWorkspaces: (packageName: string) => readonly string[];
}

/**
 * THE WHOLE RULE, over injected files and an injected world.
 *
 * Nothing here touches disk, which is what lets DEP-2 drive it with a planted
 * offender and a clean fixture instead of trusting that a green repository means a
 * working scanner.
 */
function scan(files: readonly SourceFile[], world: World): Scan {
  const undeclared: Finding[] = [];
  const viaRoot: Finding[] = [];
  const accepted: { owner: string; specifier: string }[] = [];

  for (const { file, source, owner } of files) {
    for (const specifier of importedSpecifiers(source, file)) {
      const packageName = packageOf(specifier);
      if (packageName === null) continue;

      // A package importing itself by name — the published-entry-point form.
      if (packageName === owner.name) continue;

      if (owner.declares.has(packageName)) {
        accepted.push({ owner: owner.name, specifier });
        continue;
      }

      // The root is the workspace host: `bun install` symlinks every member into
      // its `node_modules`, so `scripts/` may reach them without declaring them.
      if (owner.isRoot && world.workspaceNames.has(packageName)) {
        accepted.push({ owner: owner.name, specifier });
        continue;
      }

      const finding: Finding = {
        file,
        line: lineOf(source, specifier),
        specifier,
        packageName,
        owner,
        declaredBy: world.declaringWorkspaces(packageName),
      };

      // Declared by the root manifest, so it resolves — it sits at the top of the
      // walk in a clean CI install too. Not a build failure; a named allowance.
      if (!owner.isRoot && world.root.declares.has(packageName)) {
        viaRoot.push(finding);
        continue;
      }

      undeclared.push(finding);
    }
  }

  return { undeclared, viaRoot, accepted };
}

// ===========================================================================
// The report — what a contributor actually reads
// ===========================================================================

const CLEAN = "every bare import is declared by the package that makes it";

/**
 * A failure that teaches, not an assertion that failed.
 *
 * This lands in front of somebody whose change is probably fine and who has never
 * seen this rule. It has to say WHICH package, WHICH specifier, WHICH file and
 * line, and — the part that turns a diagnosis into a fix — which workspace package
 * already owns the dependency, because importing from that package is nearly always
 * the correct repair and adding a second copy of the dependency nearly always is
 * not.
 */
function report(findings: readonly Finding[]): string {
  if (findings.length === 0) return CLEAN;

  const count = `${findings.length} import${findings.length === 1 ? "" : "s"}`;
  const lines = [
    `${count} reach a package that nothing installs for the workspace making them.`,
    "",
    `This is the failure that passes on your machine and fails in CI: a node_modules`,
    `that has accumulated the package over past installs resolves it here; a clean`,
    `\`bun install --frozen-lockfile\` in CI cannot, and reports it as TS2307.`,
    "",
  ];

  for (const finding of findings) {
    const at = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
    lines.push(`  ${at}`);
    lines.push(
      `    imports "${finding.specifier}" — ${finding.owner.name} (${finding.owner.manifest}) does not declare "${finding.packageName}".`,
    );
    lines.push(
      finding.declaredBy.length > 0
        ? `    FIX: import it from ${finding.declaredBy.join(" or ")}, which already owns it. Re-export the symbol from that package's barrel if it is not exposed yet.`
        : `    FIX: no workspace package declares it. Either import the symbol from the package that owns the concern, or add "${finding.packageName}" to ${finding.owner.manifest} and re-run \`bun install\`.`,
    );
    lines.push("");
  }

  lines.push(`Adding the dependency to a second manifest is the LAST resort, not the first:`);
  lines.push(`two copies of a library is how a schema stops passing its own instanceof check.`);

  return lines.join("\n");
}

// ===========================================================================
// The repository scan
// ===========================================================================

/**
 * Every source file CI will have, plus every one you have just written.
 *
 * Git decides, not a directory walk. `bun install --frozen-lockfile` runs against a
 * fresh checkout, so "what CI can see" is "what git would carry" — and a plain walk
 * would additionally read local, gitignored machinery (orchestrator scripts, scratch
 * spikes, generated output) and report findings about files no CI run will ever
 * compile. That is the fastest way to teach a contributor to ignore this gate.
 *
 * ⚠️ `--others --exclude-standard` is not optional, and it is the half that makes
 * this local rather than retrospective. The undeclared import is almost always in a
 * file created MINUTES AGO and not yet staged; `git ls-files` alone would skip
 * exactly that file and report the working tree clean until after the commit — the
 * precise delay this file exists to remove. `--exclude-standard` keeps everything
 * `.gitignore` already hides out of it.
 */
function candidateSourceFiles(): readonly string[] {
  const result = Bun.spawnSync({
    cmd: [
      "git",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "*.ts",
      "*.tsx",
      "*.mts",
      "*.cts",
    ],
    cwd: REPO_ROOT,
  });

  if (!result.success) {
    throw new Error(
      `undeclared-dependencies: \`git ls-files\` failed in ${REPO_ROOT}. This guard asks git for the file list because that is exactly what CI checks out. stderr: ${result.stderr.toString()}`,
    );
  }

  return (
    result.stdout
      .toString()
      .split("\0")
      .filter((file) => file.length > 0)
      // A tracked file deleted in the working tree is still an index entry. Reading it
      // would throw ENOENT and take out the whole suite for a routine `rm`.
      .filter((file) => existsSync(path.join(REPO_ROOT, file)))
  );
}

/** The workspace a file belongs to — longest matching directory, else the root. */
function ownerOf(file: string): Workspace {
  let owner: Workspace = ROOT;
  for (const workspace of WORKSPACES) {
    if (file.startsWith(`${workspace.dir}/`) && workspace.dir.length > owner.dir.length) {
      owner = workspace;
    }
  }
  return owner;
}

const REPOSITORY_FILES: readonly SourceFile[] = candidateSourceFiles().map((file) => ({
  file,
  source: readFileSync(path.join(REPO_ROOT, file), "utf8"),
  owner: ownerOf(file),
}));

const REPOSITORY_SCAN = scan(REPOSITORY_FILES, {
  root: ROOT,
  workspaceNames: WORKSPACE_NAMES,
  declaringWorkspaces,
});

// ===========================================================================
// DEP-1 — the invariant
// ===========================================================================

describe("DEP-1 — every bare import is declared by the package that makes it", () => {
  test("no tracked source file imports a package nothing installs for its workspace", () => {
    expect(report(REPOSITORY_SCAN.undeclared)).toBe(CLEAN);
  });
});

// ===========================================================================
// DEP-2 — the scanner bites
// ===========================================================================

/**
 * A synthetic workspace, so the controls do not depend on the repository being in
 * any particular state. A control built out of the real manifests goes green the
 * day somebody adds the dependency it was planted to catch.
 */
const FIXTURE_WEB: Workspace = {
  name: "@fixture/web",
  dir: "fixture/web",
  manifest: "fixture/web/package.json",
  declares: new Set(["next", "@fixture/db"]),
  isRoot: false,
};

const FIXTURE_DB: Workspace = {
  name: "@fixture/db",
  dir: "fixture/db",
  manifest: "fixture/db/package.json",
  declares: new Set(["drizzle-orm"]),
  isRoot: false,
};

const FIXTURE_ROOT: Workspace = {
  name: "fixture-root",
  dir: "",
  manifest: "package.json",
  declares: new Set(["prettier"]),
  isRoot: true,
};

const FIXTURE_WORLD: World = {
  root: FIXTURE_ROOT,
  workspaceNames: new Set([FIXTURE_WEB.name, FIXTURE_DB.name]),
  declaringWorkspaces: (name) =>
    [FIXTURE_WEB, FIXTURE_DB].filter((w) => w.declares.has(name)).map((w) => w.name),
};

const fixtureFile = (file: string, source: string, owner: Workspace): SourceFile => ({
  file,
  source,
  owner,
});

/** The incident itself, replanted: a route test reaching into the db package's dependency. */
const PLANTED_OFFENDER = fixtureFile(
  "fixture/web/__tests__/api/status.route.test.ts",
  `import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { organizations } from "@fixture/db";

describe("status", () => {
  test("scopes by org", () => {
    expect(eq(organizations.id, "org_1")).toBeDefined();
  });
});
`,
  FIXTURE_WEB,
);

/** Everything a file is allowed to reach, all at once. */
const CLEAN_FIXTURE = fixtureFile(
  "fixture/web/lib/clean.ts",
  `import { readFileSync } from "node:fs";
import path from "path";
import { test } from "bun:test";

import Link from "next/link";
import { organizations } from "@fixture/db";
import { sessions } from "@fixture/db/schema";
import { helper } from "@fixture/web/lib/helper";

import { local } from "./local";
import { shared } from "../shared";
import { aliased } from "@/lib/aliased";

export { readFileSync, path, test, Link, organizations, sessions, helper, local, shared, aliased };
`,
  FIXTURE_WEB,
);

describe("DEP-2 — the scanner bites, and does not bite what it should not", () => {
  test("the planted offender is reported, with the package that owns it named", () => {
    const found = scan([PLANTED_OFFENDER], FIXTURE_WORLD);

    expect(found.undeclared).toHaveLength(1);

    const [finding] = found.undeclared;
    expect(finding?.specifier).toBe("drizzle-orm");
    expect(finding?.packageName).toBe("drizzle-orm");
    expect(finding?.owner.name).toBe("@fixture/web");
    expect(finding?.file).toBe("fixture/web/__tests__/api/status.route.test.ts");
    // The line the import is actually written on, so the failure is clickable.
    expect(finding?.line).toBe(2);
    expect(finding?.declaredBy).toEqual(["@fixture/db"]);
  });

  test("and the failure text names package, specifier, file, line, and the fix", () => {
    const rendered = report(scan([PLANTED_OFFENDER], FIXTURE_WORLD).undeclared);

    expect(rendered).not.toBe(CLEAN);
    expect(rendered).toContain("@fixture/web");
    expect(rendered).toContain("fixture/web/package.json");
    expect(rendered).toContain(`imports "drizzle-orm"`);
    expect(rendered).toContain("fixture/web/__tests__/api/status.route.test.ts:2");
    expect(rendered).toContain("FIX: import it from @fixture/db");
  });

  test("an import nothing anywhere declares says so, rather than naming a package", () => {
    const orphan = fixtureFile(
      "fixture/web/lib/orphan.ts",
      `import { thing } from "nobody-installs-this";\nexport { thing };\n`,
      FIXTURE_WEB,
    );
    const rendered = report(scan([orphan], FIXTURE_WORLD).undeclared);

    expect(rendered).toContain("no workspace package declares it");
    expect(rendered).toContain("fixture/web/package.json");
  });

  test("the clean fixture reports nothing at all", () => {
    const found = scan([CLEAN_FIXTURE], FIXTURE_WORLD);

    expect(report(found.undeclared)).toBe(CLEAN);
    expect(found.viaRoot).toEqual([]);
    // Non-vacuity for the row above: the clean fixture is silent because every
    // specifier was CHECKED and allowed, not because none were seen.
    expect(found.accepted.map((entry) => entry.specifier).toSorted()).toEqual([
      "@fixture/db",
      "@fixture/db/schema",
      "next/link",
    ]);
  });

  test("a sibling's dependency is a finding; the ROOT manifest's is an allowance", () => {
    const siblingReach = fixtureFile(
      "fixture/web/lib/sibling.ts",
      `import { sql } from "drizzle-orm";\nexport { sql };\n`,
      FIXTURE_WEB,
    );
    const rootReach = fixtureFile(
      "fixture/web/__tests__/format.test.ts",
      `import prettier from "prettier";\nexport { prettier };\n`,
      FIXTURE_WEB,
    );

    const found = scan([siblingReach, rootReach], FIXTURE_WORLD);

    expect(found.undeclared.map((f) => f.specifier)).toEqual(["drizzle-orm"]);
    expect(found.viaRoot.map((f) => f.specifier)).toEqual(["prettier"]);
  });

  test("the repository root may reach a workspace member it does not declare", () => {
    const script = fixtureFile(
      "scripts/mint.ts",
      `import { organizations } from "@fixture/db";\nexport { organizations };\n`,
      FIXTURE_ROOT,
    );

    expect(scan([script], FIXTURE_WORLD).undeclared).toEqual([]);
  });
});

// ===========================================================================
// DEP-3 — the extractor
// ===========================================================================

describe("DEP-3 — the extractor sees every import form, and only real imports", () => {
  const EVERY_FORM = `
import valueDefault from "form-value-default";
import { named } from "form-named";
import "form-side-effect";
import type { Shape } from "form-type-only";
import type Default from "form-type-default";
import { type InlineOnly } from "form-inline-type-only";
import { type Mixed, alsoValue } from "form-mixed";
export * from "form-star-reexport";
export { thing } from "form-named-reexport";
export type { Thing } from "form-type-reexport";
const lazy = await import("form-dynamic");
const cjs = require("form-require");
import scoped from "@scope/form-scoped";
import sub from "form-subpath/deep/module";
`;

  test("type-only, dynamic, re-exported and scoped imports are all extracted", () => {
    // The type-only rows are the ones that matter most: they are erased by every
    // transpiler and they fail `tsc` with the same TS2307 the incident produced.
    expect(importedSpecifiers(EVERY_FORM, "probe.ts").toSorted()).toEqual([
      "@scope/form-scoped",
      "form-dynamic",
      "form-inline-type-only",
      "form-mixed",
      "form-named",
      "form-named-reexport",
      "form-require",
      "form-side-effect",
      "form-star-reexport",
      "form-subpath/deep/module",
      "form-type-default",
      "form-type-only",
      "form-type-reexport",
      "form-value-default",
    ]);
  });

  test("a `type Foo = …` declaration survives the type-keyword rewrite", () => {
    // The rewrite blanks the word `type`. Aimed at a declaration instead of an
    // import it produces `Foo = { … }` and the scan throws — which would take out
    // half the repository. Both spellings are pinned here.
    const declarations = `
export type FieldValues = Record<string, string>;
type Local<T> = { readonly value: T };
import { real } from "declared-package";
export type { FieldValues, Local };
export { real };
`;
    expect(importedSpecifiers(declarations, "probe.ts")).toEqual(["declared-package"]);
  });

  test("specifiers in comments, strings and template literals are NOT imports", () => {
    // This is what lets the repository keep planted-offender fixtures in template
    // literals — `apps/web/__tests__/first-run/` is full of them — without this
    // guard failing on its own colleagues' controls. It is also why the scanner
    // uses a real lexer rather than a line-anchored regex.
    const decoys = `
// import { fake } from "comment-package";
/* import { fake } from "block-comment-package"; */
const asString = "import { fake } from 'string-package'";
const asTemplate = \`
import { fake } from "template-package";
export * from "template-reexport-package";
\`;
const asRegex = /import .* from "regex-package"/;
import { real } from "declared-package";
export { asString, asTemplate, asRegex, real };
`;
    expect(importedSpecifiers(decoys, "probe.ts")).toEqual(["declared-package"]);
  });

  test("relative paths, aliases, builtins and bun namespaces are not packages", () => {
    for (const specifier of [
      "./sibling",
      "../parent",
      "@/lib/routes",
      "node:fs",
      "node:test",
      "fs",
      "path",
      "bun",
      "bun:test",
    ]) {
      expect(packageOf(specifier)).toBeNull();
    }
  });

  test("and a real package name is extracted from any specifier depth", () => {
    // Non-vacuity for the row above: `packageOf` returning null for everything
    // would make DEP-1 pass forever.
    expect(packageOf("drizzle-orm")).toBe("drizzle-orm");
    expect(packageOf("drizzle-orm/pg-core")).toBe("drizzle-orm");
    expect(packageOf("@growthmind/db")).toBe("@growthmind/db");
    expect(packageOf("@growthmind/db/schema")).toBe("@growthmind/db");
  });

  test("a file the scanner cannot read fails loudly, naming the file", () => {
    // The alternative — a try/catch returning `[]` — would skip the file silently
    // and report it as clean. Every unreadable file must be a red row.
    expect(() => importedSpecifiers("const broken = (((;", "broken-file.ts")).toThrow(
      /broken-file\.ts/,
    );
  });
});

// ===========================================================================
// DEP-4 — the walk is real
// ===========================================================================

describe("DEP-4 — the walk covers this repository, not an empty list", () => {
  test("this very file is one of the files the scan read", () => {
    // The cheapest possible proof that the file list is real and rooted where it
    // thinks it is. It moves with the file, so it cannot go stale — and on the day
    // this file is first written it is also the proof that an UNSTAGED new file is
    // in scope, which is the whole point of `--others` above.
    expect(REPOSITORY_FILES.map((entry) => entry.file)).toContain(repoRelative(import.meta.path));
  });

  test("every workspace member the root manifest declares contributed source files", () => {
    expect(WORKSPACES.length).toBeGreaterThan(1);

    const scanned = new Set(REPOSITORY_FILES.map((entry) => entry.owner.name));
    for (const workspace of WORKSPACES) {
      expect({ workspace: workspace.name, scanned: scanned.has(workspace.name) }).toEqual({
        workspace: workspace.name,
        scanned: true,
      });
    }
  });

  test("the manifests were read, not stubbed", () => {
    // A manifest reader that returned empty dependency sets would make DEP-1 fail
    // everywhere; one that returned everything would make it pass forever. This
    // pins the shape from the other side.
    const db = WORKSPACES.find((w) => w.name === "@growthmind/db");
    expect(db?.declares.has("drizzle-orm")).toBe(true);
    expect(ROOT.declares.has("typescript")).toBe(true);
  });

  test("the scan accepted real drizzle-orm imports from inside packages/db", () => {
    // THE INCIDENT'S OWN SPECIFIER, observed being accepted where it is declared.
    // If the extractor ever stops seeing imports, DEP-1 goes quietly green and this
    // row is what goes red instead.
    const dbDrizzle = REPOSITORY_SCAN.accepted.filter(
      (entry) => entry.owner === "@growthmind/db" && entry.specifier.startsWith("drizzle-orm"),
    );
    expect(dbDrizzle.length).toBeGreaterThan(0);
  });

  test("and the scan resolved imports across the repository, in bulk", () => {
    expect(REPOSITORY_FILES.length).toBeGreaterThan(100);
    expect(REPOSITORY_SCAN.accepted.length).toBeGreaterThan(100);
  });
});

// ===========================================================================
// DEP-5 — the root-manifest allowance, named
// ===========================================================================

/**
 * Packages a workspace member imports without declaring, reachable only because the
 * ROOT manifest declares them and the root sits at the top of the resolution walk.
 *
 * These do not break CI — `bun install --frozen-lockfile` installs the root's
 * dependencies too. They are listed rather than silently permitted because the
 * allowance is the one hole in DEP-1, and a hole nobody can see is a hole that
 * grows. Every entry needs a reason; every entry must still be in use.
 */
const ROOT_ALLOWANCE: readonly { readonly packageName: string; readonly why: string }[] = [
  {
    packageName: "@modelcontextprotocol/client",
    why: "The real MCP client, used only by apps/web's transport-conformance suite to prove the server answers a genuine client rather than a hand-rolled request. It is a harness, not something apps/web ships, so it is declared once at the root alongside the other tooling rather than in the app that ships to users.",
  },
];

describe("DEP-5 — the root-manifest allowance is named, and nothing else uses it", () => {
  test("every root-satisfied import is one this file has a written reason for", () => {
    const used = [...new Set(REPOSITORY_SCAN.viaRoot.map((f) => f.packageName))].toSorted();
    const allowed = ROOT_ALLOWANCE.map((entry) => entry.packageName).toSorted();

    // Equality, not a subset. A stale entry is dead permission sitting in a file
    // whose whole job is to keep permissions visible, and it costs one line to
    // delete when the import goes.
    expect(used).toEqual(allowed);
  });

  test("and every reason is a sentence somebody wrote, not a placeholder", () => {
    for (const entry of ROOT_ALLOWANCE) {
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });
});

// ===========================================================================
// DEP-6 — the incident, pinned
// ===========================================================================

describe("DEP-6 — apps/web reaches the database through packages/db, never through drizzle", () => {
  test("apps/web declares no drizzle-orm", () => {
    const web = WORKSPACES.find((w) => w.name === "@growthmind/web");
    expect(web?.declares.has("drizzle-orm")).toBe(false);
    expect(web?.declares.has("@growthmind/db")).toBe(true);
  });

  test("and no file under apps/web imports it", () => {
    // DEP-1 covers this today. It is pinned separately because DEP-1's claim is
    // conditional — it would go green the moment somebody "fixed" a TS2307 by
    // adding drizzle-orm to apps/web/package.json, which is the wrong repair and
    // the one this incident actually invites.
    const offenders = REPOSITORY_FILES.filter(
      (entry) => entry.owner.name === "@growthmind/web",
    ).flatMap((entry) =>
      importedSpecifiers(entry.source, entry.file)
        .filter((specifier) => packageOf(specifier) === "drizzle-orm")
        .map((specifier) => `${entry.file}:${lineOf(entry.source, specifier)} → ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });
});
