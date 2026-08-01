// WHERE ZOD LIVES, AND WHAT LEAVES ON THE WIRE — WIRE-Z1…Z3 (O-013, lane W0-T-D).
//
// ---------------------------------------------------------------------------
// THE INVARIANT, AND WHY IT SURVIVED ITS OWN JUSTIFICATION BEING WITHDRAWN
// ---------------------------------------------------------------------------
//
// `apps/web` declares no `zod` dependency. The original argument was an
// `instanceof` hazard: two copies of zod on disk make a schema built in
// `packages/shared` fail an `instanceof` check inside a consumer, silently, at
// runtime. Wave 0 measured the tree after installing the transport package and
// found EXACTLY ONE zod (`4.4.3`, hoisted) — so the hazard does not arise, and
// the invariant no longer rests on it.
//
// It is kept anyway, on a better reason: one package owns the schemas. The
// three tool schemas are declared once in `packages/shared/src/mcp/tools.ts`
// and handed to the transport verbatim, so the object that VALIDATES a
// `tools/call` argument is the same object that RENDERS the advertised
// `inputSchema`. One source, no wire between a producer and a consumer to
// sever. The day `apps/web` declares its own zod is the day a second, local
// schema becomes writable, and the advertised catalogue and the validator start
// drifting with nothing to notice.
//
// ---------------------------------------------------------------------------
// WIRE-Z3 IS INVERTED FROM WHAT IT ORIGINALLY SAID, ON A MEASUREMENT
// ---------------------------------------------------------------------------
//
// It used to assert `no Zod object crosses into the SDK: the advertised
// catalogue is plain JSON`. Measured, that assertion describes the exact
// condition that makes registration THROW: `registerTool` requires a Standard
// Schema and refuses a plain JSON Schema object outright —
// `inputSchema/outputSchema/argsSchema must be a Standard Schema`. The old row
// would have failed on the correct design and passed on the broken one.
//
// So it now asserts the two things that are actually true and actually at risk:
// the schemas ARE Standard Schemas (a), and only their RENDERING leaves on the
// wire (b). The regression it catches is a future author "simplifying" the
// schemas into pre-rendered JSON and re-breaking registration.
//
// ⚠️ Round 2's era reversal does NOT touch this row. Its inversion rests on the
// SCHEMA probe, not on the era probe that was overturned — the two were
// conflated once and should not be again.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MCP_TOOLS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { handleMcpRequest } from "../../lib/mcp/server";
import { fakeCredentials, fakeReadPort, rpcRequest } from "./helpers/mcp-fixture";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

// ---------------------------------------------------------------------------
// A self-enumerating manifest walk
// ---------------------------------------------------------------------------

interface Manifest {
  readonly relativePath: string;
  readonly name: string;
  readonly dependencyNames: readonly string[];
}

/**
 * Every workspace manifest, DISCOVERED from the root manifest's own
 * `workspaces` globs rather than listed here.
 *
 * `WIRE-Z1`'s claim is about a package that must not gain a dependency, and a
 * hard-coded list of manifests would keep passing while a new workspace member
 * — or a renamed one — slipped out of its reach. The globs this repository
 * uses are the simple `dir/*` and bare-directory forms, so they are expanded
 * directly; anything more exotic would fail the shape assertion below rather
 * than be silently skipped.
 *
 * Deliberately NOT `JSON.parse`-free: this row is not one of the four identity
 * suites, and a manifest is data being read, not a refusal being compared.
 */
function workspaceManifests(): readonly Manifest[] {
  const rootText = readFileSync(path.join(REPO_ROOT, "package.json"), "utf8");
  const rootJson = JSON.parse(rootText) as { workspaces?: readonly string[] };
  const globs = rootJson.workspaces ?? [];

  const directories: string[] = [];
  for (const glob of globs) {
    if (glob.endsWith("/*")) {
      const parent = glob.slice(0, -2);
      for (const entry of readdirSync(path.join(REPO_ROOT, parent), { withFileTypes: true })) {
        if (entry.isDirectory()) {
          directories.push(`${parent}/${entry.name}`);
        }
      }
      continue;
    }
    directories.push(glob);
  }

  return directories
    .map((relativeDir) => {
      const relativePath = `${relativeDir}/package.json`;
      const json = JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), "utf8")) as {
        name?: string;
        dependencies?: Readonly<Record<string, string>>;
        devDependencies?: Readonly<Record<string, string>>;
      };

      return {
        relativePath,
        name: json.name ?? relativeDir,
        dependencyNames: [
          ...Object.keys(json.dependencies ?? {}),
          ...Object.keys(json.devDependencies ?? {}),
        ],
      };
    })
    .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
}

const MANIFESTS = workspaceManifests();

const manifestFor = (packageName: string): Manifest => {
  const found = MANIFESTS.find((manifest) => manifest.name === packageName);
  if (found === undefined) {
    throw new Error(
      `no-direct-zod: the workspace walk found no manifest named "${packageName}". Found: ${MANIFESTS.map((m) => m.name).join(", ")}`,
    );
  }
  return found;
};

// ---------------------------------------------------------------------------
// WIRE-Z1 / WIRE-Z2
// ---------------------------------------------------------------------------

describe("WIRE-Z1 — apps/web declares no direct zod dependency", () => {
  test("neither dependencies nor devDependencies of apps/web name zod", () => {
    expect(manifestFor("@growthmind/web").dependencyNames).not.toContain("zod");
  });

  /**
   * The companion measurement: the declaration and the RESOLUTION agree.
   *
   * A manifest says what a package asked for; it does not say what it can
   * reach. This half imports the specifier for real and asserts it fails, so
   * the invariant is about the module graph rather than about a JSON file.
   *
   * ⚠️ THE SPECIFIER IS BUILT AT RUNTIME, AND IT HAS TO BE. A literal
   * `import("zod")` in an `apps/web` test breaks `bun run typecheck` with
   * TS2307 — the type checker resolves the literal, cannot find the package,
   * and fails the build the row was meant to protect. Measured, as is the other
   * temptation: `Bun.resolveSync` disagrees with a real import here and is not
   * a trustworthy oracle, so the assertion is made by importing.
   */
  test("and zod is not resolvable from apps/web at runtime either", async () => {
    const specifier = ["z", "od"].join("");
    let thrown: unknown = null;

    try {
      await import(specifier);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).not.toBeNull();
    expect(String((thrown as Error).message)).toContain("Cannot find package");
  });
});

describe("WIRE-Z2 — the manifest scan does see zod where it legitimately lives", () => {
  // NON-VACUITY for WIRE-Z1, and mandatory. A walk that discovered nothing, or
  // a manifest reader that returned empty dependency lists, would make the
  // assertion above true forever and mean nothing.
  test("reports zod present in packages/shared, where the schemas are declared", () => {
    expect(manifestFor("@growthmind/shared").dependencyNames).toContain("zod");
  });

  test("walks more than one workspace member, discovered rather than listed", () => {
    expect(MANIFESTS.length).toBeGreaterThan(1);
    expect(MANIFESTS.map((manifest) => manifest.relativePath)).toContain("apps/web/package.json");
  });
});

// ---------------------------------------------------------------------------
// WIRE-Z3 — the schemas are Standard Schemas, and only their rendering leaves
// ---------------------------------------------------------------------------

describe("WIRE-Z3 — the schemas handed to the SDK are Standard Schemas, and only their rendering leaves on the wire", () => {
  /**
   * (a) The precondition `registerTool` enforces, asserted on our side of it.
   *
   * A Standard Schema carrying JSON is an object with `~standard.validate` (how
   * an incoming `tools/call` argument is checked) and `~standard.jsonSchema`
   * (how the shape is advertised in `tools/list`). Both come off the same
   * object, which is precisely why the advertised schema and the validator
   * cannot drift. Pre-render these to plain JSON and registration throws — this
   * half is what makes that a failing test rather than a production incident.
   */
  test("every tool's inputSchema carries both halves of a standard schema", () => {
    expect(MCP_TOOLS.length).toBeGreaterThan(0);

    for (const tool of MCP_TOOLS) {
      const standard = (tool.inputSchema as unknown as Record<string, unknown>)["~standard"] as
        Record<string, unknown> | undefined;

      expect(typeof standard?.validate).toBe("function");
      expect(standard === undefined ? false : "jsonSchema" in standard).toBe(true);
    }
  });

  /**
   * (b) And none of that machinery leaves the process.
   *
   * The wire should carry the RENDERING — a JSON Schema document — and never a
   * trace of the object that produced it. `~standard`, `_def` and `parse` are
   * the three keys that would show a Zod object had been serialised whole
   * instead.
   *
   * ⚠️ RED UNTIL WAVE 8, BY DESIGN. There is no `tools/list` on this route yet:
   * `wire.ts` is a signature-only stub, so the precondition below (an HTTP 200
   * whose body actually advertises a schema) fails first. THAT PRECONDITION IS
   * LOAD-BEARING — without it this row would pass today against a refusal body,
   * which trivially contains none of the three keys, and would then be a green
   * row proving nothing at the exact moment the feature landed.
   *
   * Scanned as text over the whole response rather than parsed, so the SSE
   * framing the surface is pinned to makes no difference to what is asserted.
   */
  test("a real tools/list advertises rendered schemas and no zod internals", async () => {
    const reads = fakeReadPort();
    const response = await handleMcpRequest(
      rpcRequest({ method: "tools/list", key: "zod-row-key" }),
      {
        reads: reads.port,
        credentials: fakeCredentials({ "zod-row-key": "org-zod-row" }),
      },
    );
    const text = await response.text();

    // The precondition. A refusal body would pass the three key assertions
    // below by carrying no schema at all.
    expect(response.status).toBe(200);
    expect(text).toContain(`"inputSchema"`);

    expect(text).not.toContain(`"~standard"`);
    expect(text).not.toContain(`"_def"`);
    expect(text).not.toContain(`"parse"`);
  });
});
