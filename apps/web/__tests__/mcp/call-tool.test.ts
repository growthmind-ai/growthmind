import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MCP_TOOL } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { callTool } from "../../lib/mcp/call-tool";
import type { McpCredential } from "../../lib/mcp/credentials";
import { credentialFor, fakeReadPort, throwingReadPort } from "./helpers/mcp-fixture";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

const SDK_SCOPE = "@modelcontextprotocol";
const V1_SDK_SPECIFIER = [SDK_SCOPE, "sdk"].join("/");
const TRANSPORT_SPECIFIER = [SDK_SCOPE, "server"].join("/");

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;
const SKIPPED_DIRECTORIES = ["node_modules", ".next", "dist", "build", ".turbo"] as const;

function sourceFilesUnder(relativeRoot: string): readonly string[] {
  const files: string[] = [];
  const pending = [path.join(REPO_ROOT, relativeRoot)];

  while (pending.length > 0) {
    const directory = pending.pop() as string;

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.some((skipped) => entry.name === skipped)) {
          pending.push(path.join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      files.push(path.relative(REPO_ROOT, absolute).split(path.sep).join("/"));
    }
  }

  return files.toSorted();
}

function filesContaining(files: readonly string[], needle: string): readonly string[] {
  return files.filter((relative) =>
    readFileSync(path.join(REPO_ROOT, relative), "utf8").includes(needle),
  );
}

const isTestFile = (relative: string): boolean =>
  relative.includes("/__tests__/") ||
  relative.endsWith(".test.ts") ||
  relative.endsWith(".test.tsx");

describe("WIRE-S1 — the tool core names no transport", () => {
  const CALL_TOOL_SRC = "apps/web/lib/mcp/call-tool.ts";
  const SERVER_SRC = "apps/web/lib/mcp/server.ts";

  const FORBIDDEN_WORDS = [
    SDK_SCOPE,
    "Request",
    "Response",
    "Headers",
    "jsonrpc",
    "structuredContent",
    "isError",
  ] as const;

  test("names no transport word anywhere in its source", () => {
    const source = readFileSync(path.join(REPO_ROOT, CALL_TOOL_SRC), "utf8");
    const named = FORBIDDEN_WORDS.filter((word) => source.includes(word));

    expect(named).toEqual([]);
  });

  test("the same scan finds a transport word in the neighbouring file that legitimately has one", () => {
    const source = readFileSync(path.join(REPO_ROOT, SERVER_SRC), "utf8");

    expect(source.length).toBeGreaterThan(0);
    expect(source.includes("Response")).toBe(true);
  });
});

describe("WIRE-S2 — callTool takes the credential separately and reads the organization from nowhere else", () => {
  const CREDENTIAL_ORG = "org-from-the-credential";
  const FOREIGN_ORG = "org-from-the-request";

  test("asks the read port only about the credential's organization, on all four tools", async () => {
    const spy = fakeReadPort();
    const credential: McpCredential = credentialFor(CREDENTIAL_ORG);

    await callTool(MCP_TOOL.LIST_OPEN_FIXES, { organizationId: FOREIGN_ORG }, spy.port, credential);
    await callTool(
      MCP_TOOL.GET_FIX,
      { organizationId: FOREIGN_ORG, fixId: "fix-anything" },
      spy.port,
      credential,
    );
    await callTool(
      MCP_TOOL.GET_FINDING,
      { organizationId: FOREIGN_ORG, findingId: "finding-anything" },
      spy.port,
      credential,
    );

    await callTool(
      MCP_TOOL.GET_GROWTH_CONTEXT,
      { organizationId: FOREIGN_ORG, surface: "/checkout" },
      spy.port,
      credential,
    );

    expect(spy.organizationsAsked).toEqual([
      CREDENTIAL_ORG,
      CREDENTIAL_ORG,
      CREDENTIAL_ORG,
      CREDENTIAL_ORG,
    ]);
  });
});

describe("WIRE-S3 — the v1 SDK is imported nowhere in the workspace", () => {
  const scanned = [...sourceFilesUnder("apps/web"), ...sourceFilesUnder("packages")];

  test("no source file under apps/web or packages names the v1 SDK", () => {
    expect(filesContaining(scanned, V1_SDK_SPECIFIER)).toEqual([]);
  });

  test("the same scan finds the transport package where it legitimately is", () => {
    expect(scanned.length).toBeGreaterThan(0);
    expect(filesContaining(scanned, TRANSPORT_SPECIFIER)).toContain("apps/web/lib/mcp/wire.ts");
  });
});

describe("WIRE-S4 — the SDK is named in exactly one source file", () => {
  test("only wire.ts names the transport package across apps/web/lib and apps/web/app", () => {
    const scanned = [
      ...sourceFilesUnder("apps/web/lib"),
      ...sourceFilesUnder("apps/web/app"),
    ].filter((relative) => !isTestFile(relative));

    expect(filesContaining(scanned, TRANSPORT_SPECIFIER)).toEqual(["apps/web/lib/mcp/wire.ts"]);
  });

  test("the scan covers the shipped source it claims to, with test files excluded", () => {
    const scanned = [
      ...sourceFilesUnder("apps/web/lib"),
      ...sourceFilesUnder("apps/web/app"),
    ].filter((relative) => !isTestFile(relative));

    expect(scanned).toContain("apps/web/lib/mcp/call-tool.ts");
    expect(scanned).toContain("apps/web/lib/mcp/wire-constants.ts");
    expect(scanned.some(isTestFile)).toBe(false);
  });
});

describe("WIRE-S5 — callTool returns a refusal union and never a Response, and never throws", () => {
  const credential: McpCredential = credentialFor("org-s5");

  const cases: readonly { readonly name: string; readonly run: () => Promise<unknown> }[] = [
    {
      name: "an unknown tool name",
      run: () => callTool("not_a_tool", {}, fakeReadPort().port, credential),
    },
    {
      name: "arguments that do not fit the tool's schema",
      run: () => callTool(MCP_TOOL.GET_FIX, { fixId: 42 }, fakeReadPort().port, credential),
    },
    {
      name: "a port that answers with nothing",
      run: () =>
        callTool(MCP_TOOL.GET_FIX, { fixId: "no-such-fix" }, fakeReadPort().port, credential),
    },
    {
      name: "a port that throws",
      run: () => callTool(MCP_TOOL.LIST_OPEN_FIXES, {}, throwingReadPort(), credential),
    },
  ];

  for (const { name, run } of cases) {
    test(`answers ${name} with a refusal value rather than an exception`, async () => {
      const outcome = await run();

      expect((outcome as { readonly ok: unknown }).ok).toBe(false);
      expect("refusal" in (outcome as object)).toBe(true);

      expect((outcome as unknown) instanceof Response).toBe(false);
    });
  }
});
