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

interface Manifest {
  readonly relativePath: string;
  readonly name: string;
  readonly dependencyNames: readonly string[];
}

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

describe("WIRE-Z1 — apps/web declares no direct zod dependency", () => {
  test("neither dependencies nor devDependencies of apps/web name zod", () => {
    expect(manifestFor("@growthmind/web").dependencyNames).not.toContain("zod");
  });

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
  test("reports zod present in packages/shared, where the schemas are declared", () => {
    expect(manifestFor("@growthmind/shared").dependencyNames).toContain("zod");
  });

  test("walks more than one workspace member, discovered rather than listed", () => {
    expect(MANIFESTS.length).toBeGreaterThan(1);
    expect(MANIFESTS.map((manifest) => manifest.relativePath)).toContain("apps/web/package.json");
  });
});

describe("WIRE-Z3 — the schemas handed to the SDK are Standard Schemas, and only their rendering leaves on the wire", () => {
  test("every tool's inputSchema carries both halves of a standard schema", () => {
    expect(MCP_TOOLS.length).toBeGreaterThan(0);

    for (const tool of MCP_TOOLS) {
      const standard = (tool.inputSchema as unknown as Record<string, unknown>)["~standard"] as
        Record<string, unknown> | undefined;

      expect(typeof standard?.validate).toBe("function");
      expect(standard === undefined ? false : "jsonSchema" in standard).toBe(true);
    }
  });

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

    expect(response.status).toBe(200);
    expect(text).toContain(`"inputSchema"`);

    expect(text).not.toContain(`"~standard"`);
    expect(text).not.toContain(`"_def"`);
    expect(text).not.toContain(`"parse"`);
  });
});
