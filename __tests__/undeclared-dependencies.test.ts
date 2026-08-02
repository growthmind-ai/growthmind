import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = path.join(import.meta.dir, "..");

const repoRelative = (absolute: string): string =>
  path.relative(REPO_ROOT, absolute).split(path.sep).join("/");

interface Workspace {
  readonly name: string;

  readonly dir: string;

  readonly manifest: string;

  readonly declares: ReadonlySet<string>;

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

const ROOT: Workspace = {
  name: ROOT_MANIFEST.name ?? "growthmind",
  dir: "",
  manifest: "package.json",
  declares: declaredNames(ROOT_MANIFEST),
  isRoot: true,
};

const WORKSPACE_NAMES: ReadonlySet<string> = new Set(WORKSPACES.map((w) => w.name));

const declaringWorkspaces = (packageName: string): readonly string[] =>
  WORKSPACES.filter((w) => w.declares.has(packageName)).map((w) => w.name);

const BUILTINS: ReadonlySet<string> = new Set(builtinModules);

function asValueImports(source: string): string {
  let rewritten = source.replace(/^#![^\n]*/, "");

  rewritten = rewritten.replace(/\bimport(\s+)type(\s)/g, (_match, gap: string, tail: string) =>
    "import".concat(gap, "    ", tail),
  );

  rewritten = rewritten.replace(
    /\bexport(\s+)type(\s*[{*])/g,
    (_match, gap: string, tail: string) => "export".concat(gap, "    ", tail),
  );

  rewritten = rewritten.replace(
    /\b(?:import|export)\s*\{[^}]*\}\s*from\s*["'][^"']+["']/g,
    (statement) => statement.replace(/\btype\s/g, "     "),
  );

  return rewritten;
}

const TS_TRANSPILER = new Bun.Transpiler({ loader: "ts" });
const TSX_TRANSPILER = new Bun.Transpiler({ loader: "tsx" });

function importedSpecifiers(source: string, file: string): readonly string[] {
  const transpiler = file.endsWith(".tsx") ? TSX_TRANSPILER : TS_TRANSPILER;

  try {
    return transpiler.scanImports(asValueImports(source)).map((found) => found.path);
  } catch (error) {
    throw new Error(`undeclared-dependencies: could not scan ${file} for imports`, {
      cause: error,
    });
  }
}

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

function lineOf(source: string, specifier: string): number {
  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.includes(`"${specifier}"`) || line.includes(`'${specifier}'`)) {
      return index + 1;
    }
  }
  return 0;
}

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

  readonly declaredBy: readonly string[];
}

interface Scan {
  readonly undeclared: readonly Finding[];

  readonly viaRoot: readonly Finding[];

  readonly accepted: readonly { readonly owner: string; readonly specifier: string }[];
}

interface World {
  readonly root: Workspace;
  readonly workspaceNames: ReadonlySet<string>;
  readonly declaringWorkspaces: (packageName: string) => readonly string[];
}

function scan(files: readonly SourceFile[], world: World): Scan {
  const undeclared: Finding[] = [];
  const viaRoot: Finding[] = [];
  const accepted: { owner: string; specifier: string }[] = [];

  for (const { file, source, owner } of files) {
    for (const specifier of importedSpecifiers(source, file)) {
      const packageName = packageOf(specifier);
      if (packageName === null) continue;

      if (packageName === owner.name) continue;

      if (owner.declares.has(packageName)) {
        accepted.push({ owner: owner.name, specifier });
        continue;
      }

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

      if (!owner.isRoot && world.root.declares.has(packageName)) {
        viaRoot.push(finding);
        continue;
      }

      undeclared.push(finding);
    }
  }

  return { undeclared, viaRoot, accepted };
}

const CLEAN = "every bare import is declared by the package that makes it";

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

describe("DEP-1 — every bare import is declared by the package that makes it", () => {
  test("no tracked source file imports a package nothing installs for its workspace", () => {
    expect(report(REPOSITORY_SCAN.undeclared)).toBe(CLEAN);
  });
});

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
    expect(packageOf("drizzle-orm")).toBe("drizzle-orm");
    expect(packageOf("drizzle-orm/pg-core")).toBe("drizzle-orm");
    expect(packageOf("@growthmind/db")).toBe("@growthmind/db");
    expect(packageOf("@growthmind/db/schema")).toBe("@growthmind/db");
  });

  test("a file the scanner cannot read fails loudly, naming the file", () => {
    expect(() => importedSpecifiers("const broken = (((;", "broken-file.ts")).toThrow(
      /broken-file\.ts/,
    );
  });
});

describe("DEP-4 — the walk covers this repository, not an empty list", () => {
  test("this very file is one of the files the scan read", () => {
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
    const db = WORKSPACES.find((w) => w.name === "@growthmind/db");
    expect(db?.declares.has("drizzle-orm")).toBe(true);
    expect(ROOT.declares.has("typescript")).toBe(true);
  });

  test("the scan accepted real drizzle-orm imports from inside packages/db", () => {
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

    expect(used).toEqual(allowed);
  });

  test("and every reason is a sentence somebody wrote, not a placeholder", () => {
    for (const entry of ROOT_ALLOWANCE) {
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });
});

describe("DEP-6 — apps/web reaches the database through packages/db, never through drizzle", () => {
  test("apps/web declares no drizzle-orm", () => {
    const web = WORKSPACES.find((w) => w.name === "@growthmind/web");
    expect(web?.declares.has("drizzle-orm")).toBe(false);
    expect(web?.declares.has("@growthmind/db")).toBe(true);
  });

  test("and no file under apps/web imports it", () => {
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
