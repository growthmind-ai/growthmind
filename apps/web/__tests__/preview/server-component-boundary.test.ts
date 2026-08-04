import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Two ways a server component breaks at request time while typecheck, lint and `next build`
// all stay green:
//  1. `component={Link}` — a function cannot cross into a client component as a prop.
//     Fix: the `ButtonLink` / `AnchorLink` primitives, or wrap the element in `<Link>`.
//  2. `<Table.Thead>` — Mantine's compound members are static properties, and those do not
//     survive the client-reference proxy. Fix: the flat export, `TableThead`.

const ROOTS = [join(import.meta.dir, "..", "..", "app"), join(import.meta.dir, "..", "..", "components")];

function walk(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path));
    } else if (entry.endsWith(".tsx")) {
      found.push(path);
    }
  }

  return found;
}

function serverComponents(): { path: string; source: string }[] {
  return ROOTS.flatMap((root) => walk(root))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter((file) => !file.source.includes('"use client"'));
}

function offendersMatching(pattern: RegExp): string[] {
  const offenders: string[] = [];

  for (const file of serverComponents()) {
    for (const [index, line] of file.source.split("\n").entries()) {
      if (pattern.test(line)) {
        const name = file.path.split(/[\\/]/).slice(-3).join("/");
        offenders.push(`${name}:${String(index + 1)} — ${line.trim()}`);
      }
    }
  }

  return offenders;
}

const FUNCTION_PROP = /component=\{[A-Z]/;
const COMPOUND_COMPONENT = /<[A-Z][A-Za-z]*\.[A-Z][A-Za-z]*/;

describe("the server/client boundary", () => {
  test("CONTROL: both scans catch their offender and clear its safe neighbour", () => {
    expect(FUNCTION_PROP.test(`<Button component={Link} href="/x">go</Button>`)).toBe(true);
    expect(FUNCTION_PROP.test(`<Link href="/x"><Badge>go</Badge></Link>`)).toBe(false);

    expect(COMPOUND_COMPONENT.test(`<Table.Thead>`)).toBe(true);
    expect(COMPOUND_COMPONENT.test(`<TableThead>`)).toBe(false);
    expect(COMPOUND_COMPONENT.test(`{view.rows.map((row) => (`)).toBe(false);
  });

  test("finds every server component, so the scans are not passing on an empty set", () => {
    expect(serverComponents().length).toBeGreaterThan(5);
  });

  test("no server component passes a component as a prop", () => {
    expect(offendersMatching(FUNCTION_PROP)).toEqual([]);
  });

  test("no server component uses a compound Mantine component", () => {
    expect(offendersMatching(COMPOUND_COMPONENT)).toEqual([]);
  });
});
