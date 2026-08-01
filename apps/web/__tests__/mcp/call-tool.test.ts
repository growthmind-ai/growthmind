// THE SEAM, PROVED FROM BOTH SIDES — WIRE-S1…S5 (O-013, lane W0-T-D).
//
// This sprint's whole structural claim is one sentence: THE SDK RENDERS, AND IT
// NEVER DECIDES. `apps/web/lib/mcp/call-tool.ts` is the deciding half and
// `apps/web/lib/mcp/wire.ts` is the rendering half, and the value of the split
// is only real while the two stay apart.
//
// Five rows hold it:
//   S1  the deciding half cannot even NAME a transport (source text)
//   S2  the organization it reads with comes from the credential, structurally
//   S3  the v1 SDK is imported nowhere in the workspace (source text)
//   S4  the transport package is named in exactly ONE source file (source text)
//   S5  the deciding half returns a value for every failure and never throws
//
// Three of the five read source text rather than behaviour, deliberately. A
// behavioural test can only cover the paths someone remembered to write a case
// for; "this file may not name the wire" is total, and only a scan can say so.
//
// ---------------------------------------------------------------------------
// WHY S2 AND S5 ARE RED, AND WHAT WOULD BE THE WRONG WAY TO FIX THEM
// ---------------------------------------------------------------------------
//
// `callTool` currently exists as a SIGNATURE-ONLY STUB whose body throws — Wave
// 2 landed it precisely so this suite typechecks while it runs red. So S2 and
// S5 fail with `callTool has no implementation yet — task 7.1 owns the body`.
// That is the right red: the symbol exists, the types are final, and what is
// missing is the behaviour task 7.1 owns.
//
// DO NOT MAKE THEM GREEN BY WRITING AN IMPLEMENTATION INTO `call-tool.ts` FROM
// HERE. Task 7.1 moves the real logic down from `./server.ts`; a reference
// implementation written to satisfy a test would be a second copy of decisions
// that already exist, and the drift between them is the bug this sprint is
// removing.
//
// S1, S3 and S4 are guard rows and are green from the moment they are written.
// That is correct: they are not waiting for a feature, they are standing over
// one.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MCP_TOOL } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { callTool } from "../../lib/mcp/call-tool";
import type { McpCredential } from "../../lib/mcp/credentials";
import { fakeReadPort, throwingReadPort } from "./helpers/mcp-fixture";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/**
 * THE TWO PACKAGE SPECIFIERS THIS FILE REASONS ABOUT ARE BUILT AT RUNTIME, AND
 * THAT IS NOT A STYLE CHOICE.
 *
 * `WIRE-S3` scans `apps/web/**` for the v1 specifier and `apps/web/__tests__`
 * is inside `apps/web`. Spelling the v1 name as a literal anywhere in this file
 * would make the scan find THIS FILE and go red on its own text — the row would
 * fail for the most confusing reason available. The same applies to `WIRE-S4`'s
 * non-vacuity half, which asserts the scanner finds the v2 name where it
 * legitimately lives: a literal here would put a second, spurious entry in the
 * result.
 *
 * `apps/web/lib/mcp/wire.ts`'s header makes the same move for the same reason
 * and says so out loud. If you came here to "tidy" these into constants, the
 * tidying is what would break.
 */
const SDK_SCOPE = "@modelcontextprotocol";
const V1_SDK_SPECIFIER = [SDK_SCOPE, "sdk"].join("/");
const TRANSPORT_SPECIFIER = [SDK_SCOPE, "server"].join("/");

// ---------------------------------------------------------------------------
// A self-enumerating source walk
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;
const SKIPPED_DIRECTORIES = ["node_modules", ".next", "dist", "build", ".turbo"] as const;

/**
 * Every source file under `relativeRoot`, DISCOVERED rather than listed.
 *
 * The enumeration is the point of `WIRE-S3` and `WIRE-S4`: a hard-coded file
 * list is a guard that silently stops covering whatever was added after it was
 * written, which is exactly the file most likely to reach for the wrong import.
 * Paths come back repo-relative with forward slashes, so an assertion reads the
 * way a person would type it on any platform.
 *
 * Descends by hand rather than with a recursive `readdirSync` so a skipped
 * directory is never WALKED, only never reported — `apps/web/node_modules` and
 * `apps/web/.next` between them hold more files than the rest of the repository
 * by two orders of magnitude, and a scan that reads them all before filtering
 * turns a guard row into a slow one.
 */
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

/** The repo-relative paths, among `files`, whose text contains `needle`. */
function filesContaining(files: readonly string[], needle: string): readonly string[] {
  return files.filter((relative) =>
    readFileSync(path.join(REPO_ROOT, relative), "utf8").includes(needle),
  );
}

const isTestFile = (relative: string): boolean =>
  relative.includes("/__tests__/") ||
  relative.endsWith(".test.ts") ||
  relative.endsWith(".test.tsx");

// ---------------------------------------------------------------------------
// WIRE-S1 — the tool core names no transport
// ---------------------------------------------------------------------------

describe("WIRE-S1 — the tool core names no transport", () => {
  const CALL_TOOL_SRC = "apps/web/lib/mcp/call-tool.ts";
  const SERVER_SRC = "apps/web/lib/mcp/server.ts";

  /**
   * Not an import list — a WORD list, scanned over the raw source including
   * comments.
   *
   * Deliberately stricter than `refusal-identity-guard.test.ts`, which strips
   * comments before scanning. That row asks "did an assertion get loosened",
   * and prose about an assertion is not an assertion. THIS row asks something
   * else: "does this file know it is behind a wire at all". A file whose
   * comments discuss envelopes and status codes is a file whose next author
   * will branch on one. The cheapest moment to stop that is while it is still
   * only a sentence.
   */
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

    // Listed, not counted: the failure should say which word crept in.
    expect(named).toEqual([]);
  });

  // NON-VACUITY. The scanner is a substring test, and a substring test that has
  // silently stopped reading its file matches nothing forever. `server.ts` is
  // the transport-facing neighbour and is full of `Response`; if the scanner
  // cannot find it there, the assertion above proves nothing.
  test("the same scan finds a transport word in the neighbouring file that legitimately has one", () => {
    const source = readFileSync(path.join(REPO_ROOT, SERVER_SRC), "utf8");

    expect(source.length).toBeGreaterThan(0);
    expect(source.includes("Response")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WIRE-S2 — the organization comes from the credential and from nowhere else
// ---------------------------------------------------------------------------

describe("WIRE-S2 — callTool takes the credential separately and reads the organization from nowhere else", () => {
  const CREDENTIAL_ORG = "org-from-the-credential";
  const FOREIGN_ORG = "org-from-the-request";

  /**
   * D7, proved at the CORE rather than at the route.
   *
   * The route-level cross-tenant suites prove a caller cannot reach another
   * organization's rows. This proves something narrower and more durable: the
   * organization id `callTool` hands the read port is the credential's, and an
   * `organizationId` sitting in the tool ARGUMENTS is inert. It is inert
   * structurally — `input` is `unknown` until a tool's own schema parses it, no
   * tool schema declares an organization key, and the port requires one — so
   * the only value that can satisfy the port is the credential's.
   *
   * Sent on all three tools in one row because the claim is about the
   * signature, not about any one tool's arm, and a per-tool split would let a
   * fourth arm be added with nothing covering it.
   */
  test("asks the read port only about the credential's organization, on all three tools", async () => {
    const spy = fakeReadPort();
    const credential: McpCredential = { organizationId: CREDENTIAL_ORG };

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

    expect(spy.organizationsAsked).toEqual([CREDENTIAL_ORG, CREDENTIAL_ORG, CREDENTIAL_ORG]);
  });
});

// ---------------------------------------------------------------------------
// WIRE-S3 / WIRE-S4 — where the transport package may be named
// ---------------------------------------------------------------------------

describe("WIRE-S3 — the v1 SDK is imported nowhere in the workspace", () => {
  const scanned = [...sourceFilesUnder("apps/web"), ...sourceFilesUnder("packages")];

  test("no source file under apps/web or packages names the v1 SDK", () => {
    expect(filesContaining(scanned, V1_SDK_SPECIFIER)).toEqual([]);
  });

  // NON-VACUITY, two halves: the walk found files at all, and the same
  // substring machinery does find the v2 package where it legitimately is. A
  // scan over an empty file list would pass the assertion above forever.
  test("the same scan finds the transport package where it legitimately is", () => {
    expect(scanned.length).toBeGreaterThan(0);
    expect(filesContaining(scanned, TRANSPORT_SPECIFIER)).toContain("apps/web/lib/mcp/wire.ts");
  });
});

describe("WIRE-S4 — the SDK is named in exactly one source file", () => {
  /**
   * ⚠️ EXACTLY ONE ENTRY. NOT TWO.
   *
   * The ADD's D-4 file table says `wire-constants.ts` imports the SDK
   * "type-only, for WIRE-K3/K4". THAT CELL IS WRONG, and Wave 2 deliberately
   * did not follow it: a type-only import still puts the package name in the
   * file's source text, so following it would make this list return two files
   * and this row go red. `WIRE-K3`/`WIRE-K4` import the package in their TEST
   * file, which this scan excludes.
   *
   * SO: IF THIS ROW EVER GOES RED WITH `wire-constants.ts` AS THE SECOND ENTRY,
   * THE FIX IS TO REMOVE THAT IMPORT — NEVER TO WIDEN THIS EXPECTATION. The
   * confinement is what makes "the transport could be swapped out" a fact
   * rather than a hope.
   */
  test("only wire.ts names the transport package across apps/web/lib and apps/web/app", () => {
    const scanned = [
      ...sourceFilesUnder("apps/web/lib"),
      ...sourceFilesUnder("apps/web/app"),
    ].filter((relative) => !isTestFile(relative));

    expect(filesContaining(scanned, TRANSPORT_SPECIFIER)).toEqual(["apps/web/lib/mcp/wire.ts"]);
  });

  // NON-VACUITY. The filter above removes test files; if it removed everything,
  // the single-entry assertion would be an accident rather than a proof.
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

// ---------------------------------------------------------------------------
// WIRE-S5 — every failure is a value
// ---------------------------------------------------------------------------

describe("WIRE-S5 — callTool returns a refusal union and never a Response, and never throws", () => {
  const credential: McpCredential = { organizationId: "org-s5" };

  /**
   * Four failure shapes, one guarantee.
   *
   * `callTool` is the only place that decides, so it is the only place that can
   * refuse — and a refusal has to be a VALUE, because the layer above renders
   * it and cannot render an exception. An unknown name, arguments that do not
   * fit, a row that is not there and a read that broke are four very different
   * events that must all arrive as `{ ok: false, refusal }`.
   *
   * The `instanceof Response` half looks redundant against the declared return
   * type, and is not: the seam is enforceable in the type system only while
   * nobody reaches for `any`, and this row is what turns "the type says so"
   * into "the runtime says so".
   */
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
      // Cast through `unknown` because the declared union makes the comparison
      // vacuous to the compiler — which is exactly the assumption being tested.
      expect((outcome as unknown) instanceof Response).toBe(false);
    });
  }
});
