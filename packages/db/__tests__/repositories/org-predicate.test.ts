import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "bun:test";

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const SCANNED_DIRS = [path.join(SRC_DIR, "repositories"), path.join(SRC_DIR, "services")] as const;

// scope.ts is the one home of the tenant predicate and the stamp; everything else
// takes both from it (directly or through crud.ts).
const PREDICATE_HOME = "scope.ts";

const HAND_ROLLED_PREDICATE = /eq\(\s*\w+\.organizationId\s*,\s*ctx\.organizationId\s*\)/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function sourceFiles(dir: string): { name: string; code: string }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({
      name,
      code: stripComments(readFileSync(path.join(dir, name), "utf8")),
    }));
}

function valuesGroups(code: string): string[] {
  const groups: string[] = [];
  const head = /\.values\(/g;

  let match: RegExpExecArray | null = head.exec(code);
  while (match !== null) {
    const openIndex = match.index + match[0].length - 1;
    let depth = 0;

    for (let i = openIndex; i < code.length; i += 1) {
      if (code[i] === "(") {
        depth += 1;
      } else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          groups.push(code.slice(openIndex + 1, i));
          break;
        }
      }
    }

    match = head.exec(code);
  }

  return groups;
}

function unstampedValuesGroups(code: string): string[] {
  return valuesGroups(code).filter(
    (group) => group.includes("organizationId") && !group.includes("...s.stamp"),
  );
}

describe("one helper owns every tenant predicate and stamp", () => {
  it("no repository or service reconstructs the org filter by hand", () => {
    for (const dir of SCANNED_DIRS) {
      const files = sourceFiles(dir);
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        if (file.name === PREDICATE_HOME) {
          continue;
        }

        expect({ file: file.name, handRolled: HAND_ROLLED_PREDICATE.test(file.code) }).toEqual({
          file: file.name,
          handRolled: false,
        });
      }
    }
  });

  it("every insert that names the org column takes it from the stamp", () => {
    for (const dir of SCANNED_DIRS) {
      for (const file of sourceFiles(dir)) {
        expect({ file: file.name, unstamped: unstampedValuesGroups(file.code) }).toEqual({
          file: file.name,
          unstamped: [],
        });
      }
    }
  });

  it("the scanner still recognises the predicate it forbids (scope.ts holds it)", () => {
    const scopeCode = stripComments(
      readFileSync(path.join(SRC_DIR, "repositories", PREDICATE_HOME), "utf8"),
    );

    expect(HAND_ROLLED_PREDICATE.test(scopeCode)).toBe(true);
  });

  it("the scanner flags a planted hand-rolled predicate", () => {
    const offender = `db.select().from(events).where(
      and(eq(events.organizationId, ctx.organizationId), eq(events.projectId, projectId)))`;

    expect(HAND_ROLLED_PREDICATE.test(offender)).toBe(true);
  });

  it("the scanner flags a planted unstamped insert and passes a stamped one", () => {
    const offender = `await db.insert(events).values({
      organizationId: ctx.organizationId, projectId })`;
    const stamped = `await db.insert(events).values({ ...s.stamp, projectId })`;

    expect(unstampedValuesGroups(offender)).toHaveLength(1);
    expect(unstampedValuesGroups(stamped)).toEqual([]);
  });
});
