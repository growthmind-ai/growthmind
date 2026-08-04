import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// `<Button component={Link}>` inside a server component throws at request time — a function
// cannot cross into a client component as a prop — and it is invisible to typecheck, lint and
// `next build`. It shipped five broken pages once; this is the only gate that can see it.
//
// The fix is always the same: use the `ButtonLink` / `AnchorLink` primitives, or wrap the
// element in `<Link>` rather than passing `Link` as a value.

const APP_DIR = join(import.meta.dir, "..", "..", "app");

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

function relative(path: string): string {
  return path.slice(path.indexOf(`app${"\\"}`) >= 0 ? path.indexOf("app\\") : path.indexOf("app/"));
}

describe("server components never hand a function to a client component", () => {
  test("CONTROL: the scan recognises both the offending shape and its safe neighbour", () => {
    const offender = `<Button component={Link} href="/x">go</Button>`;
    const safe = `<Link href="/x"><Badge>go</Badge></Link>`;

    expect(/component=\{[A-Z]/.test(offender)).toBe(true);
    expect(/component=\{[A-Z]/.test(safe)).toBe(false);
  });

  test("no page or layout outside a client component passes `component={Component}`", () => {
    const offenders: string[] = [];

    for (const file of walk(APP_DIR)) {
      const source = readFileSync(file, "utf8");

      // A client component may pass one freely — that is how `ButtonLink` itself works.
      if (source.includes('"use client"')) continue;

      for (const [index, line] of source.split("\n").entries()) {
        if (/component=\{[A-Z]/.test(line)) {
          offenders.push(`${relative(file)}:${String(index + 1)} — ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
