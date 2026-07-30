// Wave 0b (RED/guardrail) — lane L3.
// ADD tasks/session-source-posthog-adapter/add.md §9 item 70 — FR-19.
//
// A STRUCTURAL invariant, not a behaviour: no repository method in
// packages/db accepts an organization id as a parameter. The only way to name
// an organization is the `TenantContext` handed to the factory at
// construction, so a client-supplied org id has no door to walk through.
//
// This is a source-level assertion because that is the only level at which it
// can be total — a behavioural test can only cover the methods someone
// remembered to write a case for. It holds today against the typed-stub
// scaffold and must keep holding once Wave 1 fills the bodies in, which is
// exactly when the mistake becomes available: an implementation is free to add
// `find(projectId, organizationId)` and no other test would notice.
//
// Deliberately parameter-scoped rather than a plain text grep. A real
// implementation will be full of `eq(table.organizationId, ctx.organizationId)`
// and `values({ organizationId: ctx.organizationId })`, and `write-keys.repo`
// already RETURNS an `organizationId` field — none of those are org-id
// parameters, and a naive grep would fire on all of them.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "bun:test";

const REPOSITORIES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "repositories",
);

const ORG_ID_PARAM = /\b(organizationId|organisationId|orgId|organization_id)\b/;

/** Removes block and line comments so prose about `ctx.organizationId` cannot
 * be mistaken for code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Returns the text between `source[openIndex]` (an open paren) and its
 * matching close paren — the parameter list, and nothing after it, so a
 * RETURN type mentioning `organizationId` is never mistaken for a parameter. */
function readParenGroup(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, i);
      }
    }
  }
  return source.slice(openIndex + 1);
}

/** Returns the text of the `{ … }` block starting at `openIndex`. */
function readBraceGroup(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, i);
      }
    }
  }
  return source.slice(openIndex + 1);
}

interface DeclaredParams {
  owner: string;
  params: string;
}

/**
 * Collects the parameter lists of (a) every top-level function declaration and
 * (b) every method signature inside an `interface` block. Function BODIES are
 * excluded by construction: the scan stops at the matching close paren of the
 * signature.
 */
function collectDeclaredParams(source: string): DeclaredParams[] {
  const clean = stripComments(source);
  const collected: DeclaredParams[] = [];

  const functionHead = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;
  let functionMatch: RegExpExecArray | null = functionHead.exec(clean);
  while (functionMatch !== null) {
    const openIndex = functionMatch.index + functionMatch[0].length - 1;
    collected.push({
      owner: functionMatch[1] ?? "<function>",
      params: readParenGroup(clean, openIndex),
    });
    functionMatch = functionHead.exec(clean);
  }

  const interfaceHead = /(?:export\s+)?interface\s+(\w+)[^{]*\{/g;
  let interfaceMatch: RegExpExecArray | null = interfaceHead.exec(clean);
  while (interfaceMatch !== null) {
    const braceIndex = interfaceMatch.index + interfaceMatch[0].length - 1;
    const body = readBraceGroup(clean, braceIndex);
    const methodHead = /(\w+)\s*(?:<[^>]*>)?\s*\(/g;
    let methodMatch: RegExpExecArray | null = methodHead.exec(body);
    while (methodMatch !== null) {
      const openIndex = methodMatch.index + methodMatch[0].length - 1;
      collected.push({
        owner: `${interfaceMatch[1] ?? "<interface>"}.${methodMatch[1] ?? "<method>"}`,
        params: readParenGroup(body, openIndex),
      });
      methodMatch = methodHead.exec(body);
    }
    interfaceMatch = interfaceHead.exec(clean);
  }

  return collected;
}

describe("repository contract — no organization id parameter (FR-19)", () => {
  it("declares no organization id parameter on any repository function or interface method", () => {
    const files = readdirSync(REPOSITORIES_DIR).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(REPOSITORIES_DIR, file), "utf8");
      for (const declared of collectDeclaredParams(source)) {
        if (ORG_ID_PARAM.test(declared.params)) {
          offenders.push(`${file} :: ${declared.owner}(${declared.params.trim()})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("covers the four O-003 repositories, so the invariant cannot pass by scanning nothing", () => {
    const files = readdirSync(REPOSITORIES_DIR);
    for (const expected of [
      "project-connections.repo.ts",
      "sessions.repo.ts",
      "events.repo.ts",
      "poll-runs.repo.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it("finds the parameter lists it claims to check", () => {
    const source = readFileSync(
      path.join(REPOSITORIES_DIR, "project-connections.repo.ts"),
      "utf8",
    );
    const declared = collectDeclaredParams(source);
    const owners = declared.map((entry) => entry.owner);

    // If the collector silently matched nothing, the invariant above would be
    // vacuously true — this is the guard against that.
    expect(owners).toContain("createProjectConnectionsRepo");
    expect(owners).toContain("ProjectConnectionsRepo.getActiveForProject");
    expect(owners).toContain("ProjectConnectionsRepo.advanceWatermark");
  });
});
