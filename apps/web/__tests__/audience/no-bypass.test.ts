// D7 structural half for ADD O-036 AD-5: every audience read goes through
// createGrowthContextRepo under the caller's tenant context, so the read path may hold no
// hand-written query. Red at Wave 0 because none of the three files exist yet; Waves 4/7
// create them and this turns green only if they arrive clean.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const GUARDED: readonly { readonly rel: string; readonly abs: string }[] = [
  { rel: "lib/audience/read.ts", abs: path.join(WEB_ROOT, "lib", "audience", "read.ts") },
  { rel: "lib/audience/kinds.ts", abs: path.join(WEB_ROOT, "lib", "audience", "kinds.ts") },
  {
    rel: "app/(app)/audience/page.tsx",
    abs: path.join(WEB_ROOT, "app", "(app)", "audience", "page.tsx"),
  },
];

const DRIZZLE_IMPORT = /from\s+["']drizzle-orm/;
const SQL_TAG = /\bsql`/;

function sourceOf(file: { readonly rel: string; readonly abs: string }): string {
  if (!existsSync(file.abs)) {
    throw new Error(
      `apps/web/${file.rel} does not exist yet (expected at ${file.abs}) — the audience read ` +
        `path (ADD O-036 AD-5/AD-6) has not been built. This is a Wave 0 red for the RIGHT reason.`,
    );
  }
  return readFileSync(file.abs, "utf8");
}

describe("the audience read path contains no hand-written query (D7)", () => {
  test("CONTROL: both scans catch their offender and clear its safe neighbour", () => {
    expect(DRIZZLE_IMPORT.test('import { eq } from "drizzle-orm";')).toBe(true);
    expect(DRIZZLE_IMPORT.test('import { and, eq } from "drizzle-orm/pg-core";')).toBe(true);
    expect(DRIZZLE_IMPORT.test('import { createGrowthContextRepo } from "@growthmind/db";')).toBe(
      false,
    );

    expect(SQL_TAG.test("await db.execute(sql`select 1`);")).toBe(true);
    expect(SQL_TAG.test('const label = "sql";')).toBe(false);
  });

  for (const file of GUARDED) {
    test(`${file.rel} imports no drizzle-orm and tags no sql template`, () => {
      const source = sourceOf(file);

      expect(source).not.toMatch(DRIZZLE_IMPORT);
      expect(source).not.toMatch(SQL_TAG);
    });
  }
});
