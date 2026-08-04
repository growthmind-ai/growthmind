import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "bun:test";

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const REPOSITORIES_DIR = path.join(SRC_DIR, "repositories");

const SERVICES_DIR = path.join(SRC_DIR, "services");

const SCANNED_DIRS: readonly { readonly label: string; readonly dir: string }[] = [
  { label: "repositories", dir: REPOSITORIES_DIR },
  { label: "services", dir: SERVICES_DIR },
];

const ORG_ID_PARAM = /\b(organizationId|organisationId|orgId|organization_id)\b/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

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

describe("repository contract — no organization id parameter", () => {
  it("declares no organization id parameter on any repository or service function or interface method", () => {
    const offenders: string[] = [];
    let scanned = 0;

    for (const { label, dir } of SCANNED_DIRS) {
      const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        scanned += 1;
        const source = readFileSync(path.join(dir, file), "utf8");
        for (const declared of collectDeclaredParams(source)) {
          if (ORG_ID_PARAM.test(declared.params)) {
            offenders.push(`${label}/${file} :: ${declared.owner}(${declared.params.trim()})`);
          }
        }
      }
    }

    expect(scanned).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("covers the four repositories, so the invariant cannot pass by scanning nothing", () => {
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

  it("covers the hand-written aggregation services, where the incident class lives", () => {
    const files = readdirSync(SERVICES_DIR);
    for (const expected of ["detector-corpus.service.ts", "events-counter.service.ts"]) {
      expect(files).toContain(expected);
    }
  });

  it("finds the parameter lists it claims to check in a service, not only a repository", () => {
    const source = readFileSync(path.join(SERVICES_DIR, "detector-corpus.service.ts"), "utf8");
    const owners = collectDeclaredParams(source).map((entry) => entry.owner);

    expect(owners).toContain("createDetectorCorpusService");
    expect(owners).toContain("DetectorCorpusService.read");
  });

  it("finds the parameter lists it claims to check", () => {
    const source = readFileSync(path.join(REPOSITORIES_DIR, "project-connections.repo.ts"), "utf8");
    const declared = collectDeclaredParams(source);
    const owners = declared.map((entry) => entry.owner);

    expect(owners).toContain("createProjectConnectionsRepo");
    expect(owners).toContain("ProjectConnectionsRepo.getActiveForProject");
    expect(owners).toContain("ProjectConnectionsRepo.advanceWatermark");
  });

  it("covers the three repositories, so the invariant cannot pass by scanning nothing", () => {
    const files = readdirSync(REPOSITORIES_DIR);
    for (const expected of [
      "finding-signatures.repo.ts",
      "dismissals.repo.ts",
      "signature-ancestry.repo.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it("covers the fixes repository, so the invariant cannot pass by scanning nothing", () => {
    const repositories = readdirSync(REPOSITORIES_DIR);
    for (const expected of ["fixes.repo.ts", "finding-payloads.repo.ts"]) {
      expect(repositories).toContain(expected);
    }

    expect(readdirSync(SERVICES_DIR)).toContain("fixes.service.ts");
  });
});
